#!/usr/bin/env python3
"""스킬 워크플로우 보드를 내 컴퓨터에서 띄웁니다. 실행은 내 컴퓨터의 Claude Code가 맡습니다.

    python3 skills-dashboard/local/serve.py --pack ~/Downloads/wadiz-skills-pack.zip

- 브라우저에 http://127.0.0.1:8787 이 열립니다. 이 컴퓨터 안에서만 열립니다.
- 프로젝트와 결과 파일은 ~/SkillBoard/ 에 저장됩니다.
- 파이썬 표준 라이브러리만 씁니다.
"""
import argparse
import base64
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import build  # noqa: E402  (skills-dashboard/build.py)

TIER_MODEL = {'quick': 'haiku', 'default': 'sonnet', 'complex': 'opus'}
STEP_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash']
STEP_ALLOWED = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(python3:*)', 'Bash(python:*)',
                'Bash(pip install:*)', 'Bash(pip3 install:*)', 'Bash(ls:*)', 'Bash(mkdir:*)']
SEG = re.compile(r'^[A-Za-z0-9_-]{1,80}$')
PING_EVERY = 2.0


class App:
    def __init__(self, args):
        self.args = args
        self.home = os.path.abspath(os.path.expanduser(args.home))
        self.token = secrets.token_urlsafe(24)
        self.claude = args.claude or shutil.which('claude')
        self.servers = {'매그니픽': args.magnific_name, '힉스필드': args.higgsfield_name}
        files = build.read_source(args.pack)
        html, skills, _ = build.build_html(args.pack, files)
        self.skills_dir = os.path.join(self.home, 'skills')
        for (sid, inner), text in build.skill_files(files).items():
            p = os.path.join(self.skills_dir, sid, *inner.split('/'))
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w', encoding='utf-8') as f:
                f.write(text)
        with open(os.path.join(HERE, 'runtime.js'), encoding='utf-8') as f:
            runtime = f.read()
        cfg = json.dumps({'token': self.token, 'home': self.home, 'skills': self.skills_dir,
                          'claude': bool(self.claude), 'sep': os.sep}, ensure_ascii=False)
        marker = "<script>\n'use strict';"
        if marker not in html:
            sys.exit('template.html 의 페이지 스크립트 시작 부분을 찾지 못했어요.')
        inject = ('<script>window.__SKILLBOARD_LOCAL__ = ' + cfg.replace('</', '<\\/') + ';</script>\n'
                  '<script>' + runtime + '</script>\n')
        self.html = html.replace(marker, inject + marker, 1).encode('utf-8')
        self.skill_count = len(skills)

    # ── 경로 ──
    def project_dir(self, project, *sub):
        project = project if SEG.match(str(project or '')) else '_scratch'
        p = os.path.join(self.home, 'projects', project, *sub)
        os.makedirs(p, exist_ok=True)
        return p

    def data_path(self, path, is_doc):
        segs = str(path or '').split('/')
        if not segs or not all(SEG.match(s) for s in segs):
            raise ValueError('bad path')
        base = os.path.join(self.home, 'data', *segs)
        return base + '.json' if is_doc else base

    # ── Claude Code 실행 ──
    def spawn(self, cmd, cwd, prompt):
        p = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        p.stdin.write(prompt.encode('utf-8'))
        p.stdin.close()
        err = []
        threading.Thread(target=lambda: err.append(p.stderr.read().decode('utf-8', 'replace')), daemon=True).start()
        return p, err


def prompt_from_input(inp):
    if isinstance(inp, str):
        return inp
    turns = [t for t in (inp or []) if isinstance(t, dict) and t.get('content')]
    if not turns:
        return ''
    if len(turns) == 1:
        return turns[0]['content']
    out = [turns[0]['content'], '\n\n---\n# 이 단계의 대화 기록 (오래된 순)']
    for t in turns[1:-1]:
        who = '사용자' if t.get('role') == 'user' else 'Claude(앞선 답)'
        out.append(f'\n## {who}\n{t["content"]}')
    out.append('\n\n---\n# 지금 사용자 메시지 (여기에 답한다)\n' + turns[-1]['content'])
    return '\n'.join(out)


def classify_failure(text):
    t = (text or '').lower()
    if any(k in t for k in ('not logged in', 'please run /login', 'invalid api key', 'authentication', 'unauthorized')):
        return 'session_expired', 'Claude Code 로그인이 필요해요. 터미널에서 claude 를 실행해 로그인해 주세요.'
    if any(k in t for k in ('rate limit', 'usage limit', 'limit reached', 'overloaded')):
        return 'rate_limited', 'Claude 사용량 한도에 걸렸어요. 잠시 뒤 다시 보내 주세요.'
    return 'upstream_error', (text or 'Claude Code 실행이 끝나지 않았어요.').strip()[:400]


def tool_result_text(content):
    if isinstance(content, str):
        return content
    parts = []
    for c in content or []:
        if isinstance(c, dict) and c.get('type') == 'text':
            parts.append(c.get('text', ''))
        elif isinstance(c, dict):
            parts.append(json.dumps(c, ensure_ascii=False))
    return '\n'.join(parts)


class Handler(BaseHTTPRequestHandler):
    app: App = None
    protocol_version = 'HTTP/1.0'

    def log_message(self, fmt, *a):
        if self.app.args.verbose:
            sys.stderr.write('[serve] ' + fmt % a + '\n')

    # ── 공통 ──
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def fail(self, code, message, status=200, **extra):
        self.send_json({'error': {'code': code, 'message': message, **extra}}, status)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n).decode('utf-8') or '{}') if n else {}

    def authed(self):
        if self.headers.get('X-SB-Token') != self.app.token:
            self.fail('forbidden', 'token', 403)
            return False
        return True

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ('/', '/index.html'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(self.app.html)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(self.app.html)
        elif path == '/media':
            self.serve_media()
        else:
            self.send_error(404)

    def do_POST(self):
        if not self.authed():
            return
        route = urllib.parse.urlparse(self.path).path
        try:
            data = self.body()
        except Exception:
            return self.fail('bad_request', 'JSON 이 아니에요', 400)
        handlers = {'/api/sample': self.api_sample, '/api/mcp': self.api_mcp, '/api/db': self.api_db,
                    '/api/save': self.api_save, '/api/fetch-media': self.api_fetch_media}
        h = handlers.get(route)
        if not h:
            return self.fail('not_found', route, 404)
        try:
            h(data)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # 화면에 원인을 보여 줌
            try:
                self.fail('upstream_error', f'{type(e).__name__}: {e}')
            except Exception:
                pass

    # ── 단계 실행: claude -p 를 프로젝트 폴더에서 ──
    def api_sample(self, d):
        app = self.app
        if not app.claude:
            return self.stream_error('sampling_disabled', 'Claude Code 를 찾지 못했어요. 설치 후 다시 실행해 주세요.')
        cwd = app.project_dir(d.get('project'))
        prompt = prompt_from_input(d.get('input'))
        imgs = d.get('images') or []
        if imgs:
            names = []
            for i, im in enumerate(imgs[:8]):
                name = re.sub(r'[^A-Za-z0-9._-]', '_', im.get('name') or f'image{i}.png')[-80:]
                name = f'{int(time.time())}_{i}_{name}'
                with open(os.path.join(app.project_dir(d.get('project'), 'inputs'), name), 'wb') as f:
                    f.write(base64.b64decode(im.get('b64') or ''))
                names.append('inputs/' + name)
            prompt += '\n\n(첨부 이미지 파일: ' + ', '.join(names) + ' — Read 도구로 열어 본다)'
        cmd = [app.claude, '-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
               '--no-session-persistence', '--model', TIER_MODEL.get(d.get('tier'), 'sonnet'),
               '--permission-mode', 'acceptEdits', '--add-dir', app.skills_dir,
               '--tools', *STEP_TOOLS, '--allowedTools', *STEP_ALLOWED]
        p, err = app.spawn(cmd, cwd, prompt)
        self.send_response(200)
        self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

        lines, done = [], threading.Event()

        def reader():
            for raw in p.stdout:
                lines.append(raw)
            done.set()
        threading.Thread(target=reader, daemon=True).start()

        text, result, last_ping = '', None, time.time()
        try:
            while True:
                while lines:
                    ev = self.parse_line(lines.pop(0))
                    if not ev:
                        continue
                    if ev.get('type') == 'stream_event' and ev.get('parent_tool_use_id') is None:
                        e = ev.get('event') or {}
                        if e.get('type') == 'message_start' and text and not text.endswith('\n\n'):
                            text += '\n\n'
                            self.emit({'t': 'delta', 'text': '\n\n'})
                        elif e.get('type') == 'content_block_delta' and (e.get('delta') or {}).get('type') == 'text_delta':
                            chunk = e['delta'].get('text', '')
                            text += chunk
                            self.emit({'t': 'delta', 'text': chunk})
                        elif e.get('type') == 'content_block_start' and (e.get('content_block') or {}).get('type') == 'tool_use':
                            self.emit({'t': 'activity', 'text': activity_label(e['content_block'].get('name'))})
                    elif ev.get('type') == 'result' or ('duration_api_ms' in ev and 'session_id' in ev and 'type' not in ev):
                        result = ev
                if done.is_set() and not lines:
                    break
                if time.time() - last_ping > PING_EVERY:
                    self.emit({'t': 'ping'})
                    last_ping = time.time()
                time.sleep(0.05)
            p.wait(timeout=10)
        except (BrokenPipeError, ConnectionResetError):
            p.kill()  # 화면에서 중지
            return
        r = result or {}
        if r.get('is_error') or (p.returncode and not text.strip()):
            code, msg = classify_failure(r.get('result') or ''.join(err) or text)
            if r.get('subtype') == 'error_max_turns' and text.strip():
                return self.emit({'t': 'done', 'text': text, 'truncated': True})
            return self.emit({'t': 'error', 'code': code, 'message': msg})
        final = text if text.strip() else (r.get('result') or '')
        self.emit({'t': 'done', 'text': final, 'truncated': r.get('stop_reason') == 'max_tokens'})

    def stream_error(self, code, message):
        self.send_response(200)
        self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
        self.end_headers()
        self.emit({'t': 'error', 'code': code, 'message': message})

    def emit(self, obj):
        self.wfile.write((json.dumps(obj, ensure_ascii=False) + '\n').encode('utf-8'))
        self.wfile.flush()

    @staticmethod
    def parse_line(raw):
        try:
            return json.loads(raw.decode('utf-8', 'replace'))
        except Exception:
            return None

    # ── 매그니픽·힉스필드: Claude Code 에 연결된 MCP 도구를 한 번 부르고 결과를 그대로 돌려줌 ──
    def api_mcp(self, d):
        app = self.app
        server, tool, inp = d.get('server'), d.get('tool'), d.get('input') or {}
        name = app.servers.get(server)
        if not name or not re.match(r'^[A-Za-z0-9_-]+$', str(tool or '')):
            return self.fail('not_in_manifest', f'{server}/{tool}', server=server)
        if not app.claude:
            return self.fail('server_not_connected', 'Claude Code 를 찾지 못했어요.', server=server)
        full = f'mcp__{name}__{tool}'
        prompt = (f'Call the tool `{full}` exactly once. Use exactly this JSON object as its arguments, '
                  'unchanged (do not add, remove or edit any field):\n```json\n'
                  + json.dumps(inp, ensure_ascii=False) + '\n```\n'
                  'Do not call any other tool. After the tool returns, reply with the single word DONE.')
        cmd = [app.claude, '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
               '--model', app.args.mcp_model, '--max-turns', '2', '--tools', '', '--allowedTools', full]
        p, err = app.spawn(cmd, app.project_dir('_mcp'), prompt)
        status, use_ids, res = None, set(), None
        for raw in p.stdout:
            ev = self.parse_line(raw)
            if not ev:
                continue
            if ev.get('type') == 'system' and ev.get('subtype') == 'init':
                for s in ev.get('mcp_servers') or []:
                    if s.get('name') == name:
                        status = s.get('status')
            msg = ev.get('message') or {}
            if ev.get('type') == 'assistant':
                for c in msg.get('content') or []:
                    if c.get('type') == 'tool_use' and c.get('name') == full:
                        use_ids.add(c.get('id'))
            if ev.get('type') == 'user':
                for c in msg.get('content') or []:
                    if c.get('type') == 'tool_result' and c.get('tool_use_id') in use_ids and res is None:
                        res = c
        p.wait(timeout=30)
        if res is None:
            if status is None:
                return self.fail('server_not_connected', f'Claude Code 에 "{name}" 연결이 없어요.', server=server)
            if status in ('needs-auth', 'needs_auth', 'needs-login'):
                return self.fail('needs_reauth', f'"{name}" 로그인이 필요해요. claude 실행 후 /mcp 에서 로그인해 주세요.', server=server)
            if status != 'connected':
                return self.fail('server_unavailable', f'"{name}" 연결 상태: {status}', server=server, retryable=True)
            code, msg = classify_failure(''.join(err))
            return self.fail(code, msg, server=server)
        text = tool_result_text(res.get('content'))
        if res.get('is_error'):
            return self.fail('tool_error', text[:1000], server=server)
        try:
            payload = json.loads(text)
        except Exception:
            payload = text
        self.send_json({'result': {'content': [{'type': 'text', 'text': text}], 'payload': payload}})

    # ── 프로젝트 저장 (파일) ──
    def api_db(self, d):
        op, path = d.get('op'), d.get('path')
        try:
            if op == 'list':
                folder = self.app.data_path(path, False)
                docs = []
                if os.path.isdir(folder):
                    for fn in sorted(os.listdir(folder)):
                        if fn.endswith('.json'):
                            with open(os.path.join(folder, fn), encoding='utf-8') as f:
                                docs.append({'id': fn[:-5], 'data': json.load(f)})
                return self.send_json({'docs': docs})
            fp = self.app.data_path(path, True)
            if op == 'get':
                if not os.path.exists(fp):
                    return self.send_json({'data': None})
                with open(fp, encoding='utf-8') as f:
                    return self.send_json({'data': json.load(f)})
            if op in ('set', 'update'):
                body = d.get('data') or {}
                if op == 'update' and os.path.exists(fp):
                    with open(fp, encoding='utf-8') as f:
                        body = {**json.load(f), **body}
                os.makedirs(os.path.dirname(fp), exist_ok=True)
                tmp = fp + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(body, f, ensure_ascii=False)
                os.replace(tmp, fp)
                return self.send_json({'ok': True})
            if op == 'delete':
                if os.path.exists(fp):
                    os.remove(fp)
                return self.send_json({'ok': True})
        except ValueError:
            return self.fail('bad_request', 'path')
        self.fail('bad_request', 'op')

    def api_save(self, d):
        name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '_', d.get('filename') or 'export.md').strip() or 'export.md'
        fp = os.path.join(self.app.project_dir(d.get('project'), 'exports'), name)
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(d.get('data') or '')
        self.send_json({'path': fp})

    def api_fetch_media(self, d):
        url = d.get('url') or ''
        if not url.startswith('https://'):
            return self.fail('bad_request', 'https 주소만 받아요')
        req = urllib.request.Request(url, headers={'User-Agent': 'SkillBoard/1.0'})
        with urllib.request.urlopen(req, timeout=120) as r:
            ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
            if ext not in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.webm'):
                ext = mimetypes.guess_extension((r.headers.get('Content-Type') or '').split(';')[0]) or '.bin'
            base = re.sub(r'[^A-Za-z0-9가-힣._-]', '_', d.get('name') or 'media')[:80]
            fp = os.path.join(self.app.project_dir(d.get('project'), 'media'), base + ext)
            with open(fp, 'wb') as f:
                shutil.copyfileobj(r, f)
        self.send_json({'path': fp})

    def serve_media(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if (q.get('token') or [''])[0] != self.app.token:
            return self.send_error(403)
        fp = os.path.abspath((q.get('path') or [''])[0])
        if not fp.startswith(os.path.join(self.app.home, 'projects') + os.sep) or not os.path.isfile(fp):
            return self.send_error(404)
        ctype = mimetypes.guess_type(fp)[0] or 'application/octet-stream'
        size = os.path.getsize(fp)
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(size))
        self.end_headers()
        with open(fp, 'rb') as f:
            shutil.copyfileobj(f, self.wfile)


def activity_label(name):
    return {'Write': '파일을 만드는 중', 'Edit': '파일을 고치는 중', 'Read': '파일을 읽는 중',
            'Bash': '스크립트를 실행하는 중', 'Glob': '파일을 찾는 중', 'Grep': '내용을 찾는 중'}.get(name, '작업하는 중')


def main():
    ap = argparse.ArgumentParser(description='스킬 워크플로우 보드 (내 컴퓨터 + Claude Code)')
    ap.add_argument('--pack', required=True, help='스킬 팩 zip 또는 풀린 폴더')
    ap.add_argument('--home', default='~/SkillBoard', help='프로젝트·결과를 저장할 폴더 (기본 ~/SkillBoard)')
    ap.add_argument('--port', type=int, default=8787)
    ap.add_argument('--no-browser', action='store_true', help='브라우저를 자동으로 열지 않음')
    ap.add_argument('--magnific-name', default='magnific', help='Claude Code 에 등록한 매그니픽 MCP 이름')
    ap.add_argument('--higgsfield-name', default='higgsfield', help='Claude Code 에 등록한 힉스필드 MCP 이름')
    ap.add_argument('--mcp-model', default='haiku', help='매그니픽·힉스필드 호출을 맡길 모델 (기본 haiku)')
    ap.add_argument('--claude', help='claude 실행 파일 경로 (기본: PATH 에서 찾음)')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    app = App(args)
    Handler.app = app
    srv = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    srv.daemon_threads = True
    url = f'http://127.0.0.1:{args.port}/'
    print(f'스킬 {app.skill_count}개를 불러왔어요. 프로젝트·결과 폴더: {app.home}', flush=True)
    if not app.claude:
        print('⚠ Claude Code(claude)를 찾지 못했어요. 설치하고 로그인한 뒤 다시 실행해 주세요.')
    print(f'대시보드: {url}  (끄려면 Ctrl+C)', flush=True)
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n종료했어요.')


if __name__ == '__main__':
    main()
