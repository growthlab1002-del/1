// 내 컴퓨터용 런타임: claude.ai 가 페이지에 주는 window.claude.use(...) 를 로컬 서버(serve.py)로 채움.
// 반환·오류 모양은 claude.ai 규격(sample · mcp · db · user · downloads)과 같게 맞춰 페이지 코드를 그대로 씀.
(function () {
  'use strict';
  const L = window.__SKILLBOARD_LOCAL__;
  const H = { 'X-SB-Token': L.token, 'Content-Type': 'application/json' };
  // 페이지의 전역 상태 S 에서 지금 열린 프로젝트를 읽음 (프로젝트별 작업 폴더)
  const project = () => (typeof S !== 'undefined' && S && S.run) ? S.run.id : '_scratch';

  async function api(path, body) {
    let r;
    try { r = await fetch(path, { method: 'POST', headers: H, body: JSON.stringify(body || {}) }); }
    catch (e) { throw { code: 'upstream_error', message: '로컬 서버에 연결하지 못했어요. serve.py 가 켜져 있는지 확인해 주세요.' }; }
    const j = await r.json().catch(() => ({ error: { code: 'upstream_error', message: 'HTTP ' + r.status } }));
    if (j.error) throw j.error;
    return j;
  }
  function toB64(blob) {
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); });
  }

  /* sample: 단계 실행 */
  async function sample(input, opts) {
    opts = opts || {};
    if (opts.signal && opts.signal.aborted) throw { code: 'cancelled', message: 'aborted' };
    const list = !opts.images ? [] : (opts.images instanceof Blob ? [opts.images] : Array.from(opts.images));
    const images = await Promise.all(list.map(async (b, i) => ({ name: b.name || ('image' + i + '.png'), b64: await toB64(b) })));
    const ctl = new AbortController();
    if (opts.signal) opts.signal.addEventListener('abort', () => ctl.abort());
    let text = '';
    const fail = (code, message) => { const e = { code, message }; if (text) e.text = text; return e; };
    let resp;
    try {
      resp = await fetch('/api/sample', { method: 'POST', headers: H, signal: ctl.signal,
        body: JSON.stringify({ input, tier: opts.modelTier || 'default', project: project(), images }) });
    } catch (e) { throw fail(ctl.signal.aborted ? 'cancelled' : 'upstream_error', String(e)); }
    const reader = resp.body.getReader(), dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.t === 'delta' && ev.text) { text += ev.text; if (opts.onText) opts.onText({ text, delta: ev.text }); }
          else if (ev.t === 'activity') { if (opts.onActivity) opts.onActivity(ev.text); }
          else if (ev.t === 'error') throw fail(ev.code || 'upstream_error', ev.message || '');
          else if (ev.t === 'done') {
            const final = ev.text || text;
            if (final !== text) { const d = final.startsWith(text) ? final.slice(text.length) : final; text = final; if (opts.onText) opts.onText({ text, delta: d }); }
            if (!text.trim()) throw fail('empty_completion', 'empty');
            return { text, truncated: !!ev.truncated, modelTierApplied: opts.modelTier || 'default' };
          }
        }
      }
    } catch (e) {
      if (ctl.signal.aborted) throw fail('cancelled', 'aborted');
      if (e && e.code) throw e;
      throw fail('upstream_error', String(e));
    }
    if (ctl.signal.aborted) throw fail('cancelled', 'aborted');
    throw fail('upstream_error', '응답이 중간에 끊겼어요.');
  }
  sample.limits = async () => ({ maxPromptBytes: 4000000, images: { maxCount: 8, maxInputBytes: 20000000, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } });
  sample.json = async (input, opts) => {
    const r = await sample(input, opts);
    const m = r.text.match(/```(?:json)?\s*([\s\S]*?)```/);
    try { return JSON.parse(m ? m[1] : r.text); } catch (e) { throw { code: 'invalid_json', message: 'parse', text: r.text }; }
  };

  /* mcp: 매그니픽·힉스필드 */
  const mcp = {
    callTool: async (server, tool, input) => (await api('/api/mcp', { server, tool, input })).result,
    listTools: async () => ({ servers: [] })
  };

  /* db: ~/SkillBoard/data 의 JSON 파일 */
  const snap = (path, data) => ({ id: path.split('/').pop(), exists: data != null, data: () => (data == null ? undefined : data), metadata: { fromCache: false, hasPendingWrites: false } });
  const docRef = path => ({
    id: path.split('/').pop(), path,
    get: async () => snap(path, (await api('/api/db', { op: 'get', path })).data),
    set: async data => { await api('/api/db', { op: 'set', path, data }); },
    update: async data => { await api('/api/db', { op: 'update', path, data }); },
    delete: async () => { await api('/api/db', { op: 'delete', path }); },
    collection: sub => colRef(path + '/' + sub)
  });
  const colRef = path => ({
    path,
    get: async () => { const docs = (await api('/api/db', { op: 'list', path })).docs.map(d => snap(path + '/' + d.id, d.data)); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [] }; },
    doc: id => docRef(path + '/' + id)
  });
  const db = { collection: colRef, doc: docRef };

  const user = { id: async () => 'local', me: async () => ({ id: 'local', name: '' }), isOwner: () => true, canEdit: () => true, can: () => true, profiles: async () => ({}) };

  /* downloads: 프로젝트 폴더 exports/ 에 저장 */
  const downloads = {
    save: async ({ filename, data }) => {
      const text = typeof data === 'string' ? data : await new Response(data).text();
      const j = await api('/api/save', { project: project(), filename, data: text });
      return { status: 'saved', path: j.path };
    }
  };

  const caps = { sample, mcp, db, user, downloads };
  window.claude = Object.freeze({ use: async name => caps[name] || null });
  window.__SKILLBOARD_LOCAL__.api = api;
})();
