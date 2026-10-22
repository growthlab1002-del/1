#!/usr/bin/env node
// 제품 브리프(JSON)를 받아 Aside CLI로 소스별 레퍼런스를 찾아 refs.json으로 저장합니다.
// 사용법: node collector/collect.mjs --brief brief.json [--sources pinterest,tvcf] [--limit 8] [--queries 2] [--out refs.json] [--mock]

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { SOURCES, buildPrompt } from "./sources.mjs";

function parseArgs(argv) {
  const a = { limit: 8, queries: 2, out: "refs.json", timeout: 300, mock: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--brief") a.brief = next();
    else if (k === "--sources") a.sources = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--limit") a.limit = Number(next());
    else if (k === "--queries") a.queries = Number(next());
    else if (k === "--out") a.out = next();
    else if (k === "--timeout") a.timeout = Number(next());
    else if (k === "--aside-cmd") a.asideCmd = next();
    else if (k === "--mock") a.mock = true;
    else if (k === "-h" || k === "--help") a.help = true;
    else throw new Error(`알 수 없는 옵션: ${k}`);
  }
  return a;
}

const HELP = `사용법: node collector/collect.mjs --brief brief.json [옵션]
  --sources   pinterest,tvcf,sourcecreative,frameset,youtube,vimeo (기본: 전체)
  --limit     검색어당 가져올 개수 (기본 8)
  --queries   소스당 사용할 검색어 수 (기본 2)
  --out       결과 파일 (기본 refs.json)
  --timeout   Aside 1회 호출 제한 시간(초, 기본 300)
  --aside-cmd Aside 실행 명령 템플릿 (기본 "aside exec {prompt}", 환경변수 ASIDE_CMD도 가능)
  --mock      Aside 없이 가짜 결과로 동작 확인`;

// "aside exec {prompt}" 같은 템플릿을 [명령, 인자...]로 바꿉니다. {prompt}가 없으면 맨 뒤에 붙입니다.
function commandFor(template, prompt) {
  const parts = template.match(/"[^"]*"|'[^']*'|\S+/g).map((t) => t.replace(/^["']|["']$/g, ""));
  const i = parts.indexOf("{prompt}");
  if (i >= 0) parts[i] = prompt; else parts.push(prompt);
  return parts;
}

// Windows cmd.exe용 인자 이스케이프 (cross-spawn 방식). .cmd/.bat 실행 파일은 메타문자를 한 번 더 이스케이프해야 합니다.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
export function cmdQuote(arg, doubleEscape = true) {
  let a = String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  a = `"${a}"`.replace(CMD_META, "^$1");
  return doubleEscape ? a.replace(CMD_META, "^$1") : a;
}
// cmd는 인자 안의 줄바꿈을 받지 못해 " / "로 바꿔 한 줄로 넘깁니다.
export function cmdLine(cmd, args) {
  return [cmd.replace(CMD_META, "^$1"), ...args.map((a) => cmdQuote(String(a).replace(/\r?\n/g, " / ")))].join(" ");
}

export function runAside(template, prompt, timeoutSec, { platform = process.platform, spawnFn = spawn } = {}) {
  const [cmd, ...args] = commandFor(template, prompt);
  const win = platform === "win32";
  const attempt = (viaCmd) => new Promise((resolve, reject) => {
    let child, done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    try {
      if (viaCmd) {
        const line = cmdLine(cmd, args);
        if (line.length > 8000) throw new Error("지시문이 Windows 명령줄 길이 제한을 넘습니다. 브리프의 검색어나 설명을 줄여 주세요.");
        child = spawnFn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { stdio: ["ignore", "pipe", "pipe"], windowsVerbatimArguments: true });
      } else {
        child = spawnFn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      }
    } catch (e) { return reject(e); }
    let out = "", err = "";
    const timer = setTimeout(() => {
      if (win) spawnFn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }).on("error", () => {});
      else child.kill("SIGTERM");
      finish(reject, new Error(`시간 초과(${timeoutSec}초)`));
    }, timeoutSec * 1000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => finish(reject, e));
    child.on("close", (code) => {
      // cmd.exe는 명령을 못 찾으면 9009로 끝납니다.
      if (viaCmd && code === 9009) return finish(reject, Object.assign(new Error("not found"), { code: "ENOENT" }));
      if (code !== 0 && !out.trim()) finish(reject, new Error(`Aside 종료 코드 ${code}: ${err.trim().slice(0, 400)}`));
      else finish(resolve, out);
    });
  });
  // Windows에서 aside가 .cmd 같은 스크립트면 셸 없이 실행되지 않아(ENOENT/EINVAL) cmd.exe로 다시 시도합니다.
  return attempt(false)
    .catch((e) => (win && (e.code === "ENOENT" || e.code === "EINVAL") ? attempt(true) : Promise.reject(e)))
    .catch((e) => Promise.reject(e.code === "ENOENT" ? new Error(`'${cmd}' 명령을 찾을 수 없습니다. Aside CLI 설치와 PATH를 확인하세요.`) : e));
}

// 출력에서 JSON 객체를 찾아냅니다 (제품 분석 결과용).
export function extractObject(text) {
  const tries = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) tries.push(m[1]);
  tries.push(text);
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) tries.push(text.slice(s, e + 1));
  for (const t of tries) {
    try { const v = JSON.parse(t.trim()); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch {}
  }
  return null;
}

// 출력에서 JSON 배열을 찾아냅니다: ```json 블록 → 전체 → 첫 '[' ~ 마지막 ']' 순서.
export function extractArray(text) {
  const tries = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) tries.push(m[1]);
  tries.push(text);
  const s = text.indexOf("["), e = text.lastIndexOf("]");
  if (s >= 0 && e > s) tries.push(text.slice(s, e + 1));
  for (const t of tries) {
    try {
      const v = JSON.parse(t.trim());
      if (Array.isArray(v)) return v;
      for (const k of ["results", "items", "data", "result"]) if (Array.isArray(v?.[k])) return v[k];
    } catch {}
  }
  return null;
}

const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : v == null ? "" : String(v).slice(0, max));
function httpUrl(u) { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } }
const RATIOS = ["1:1", "4:5", "9:16", "16:9", "1.91:1", "2:3"];

export function normalize(raw, { sourceKey, query, brief }) {
  const s = SOURCES[sourceKey];
  const url = httpUrl(raw.url || raw.link || raw.href);
  if (!url) return null;
  const rel = Math.round(Number(raw.relevance));
  const scenes = Array.isArray(raw.scenes) ? raw.scenes.map((x) => str(x, 200)).filter(Boolean).slice(0, 12) : [];
  return {
    title: str(raw.title, 200) || "(제목 없음)",
    url,
    thumb: httpUrl(raw.image || raw.thumbnail || raw.thumb),
    brand: str(raw.brand, 100),
    industry: str(brief.category, 60),
    platform: s.platform,
    format: s.kind === "video" ? "video" : "image",
    kind: s.kind === "video" ? "video-plan" : "image",
    ratio: RATIOS.includes(raw.ratio) ? raw.ratio : (s.kind === "video" ? "16:9" : "기타"),
    status: "collected",
    hook: str(raw.hook, 300),
    note: str(raw.note, 600),
    tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.map((t) => str(t, 30)).filter(Boolean))].slice(0, 10) : [],
    scenes,
    cta: str(raw.cta, 200),
    duration: str(raw.duration, 20),
    credits: str(raw.credits, 300),
    relevance: rel >= 1 && rel <= 5 ? rel : null,
    source: sourceKey,
    query,
    briefId: brief.id || null,
    collectedAt: Date.now(),
  };
}

export function mockOutput(sourceKey, query, limit) {
  const s = SOURCES[sourceKey];
  const items = Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
    title: `${query} 샘플 ${i + 1}`,
    url: `https://example.com/${sourceKey}/${encodeURIComponent(query)}/${i}`,
    image: `https://picsum.photos/seed/${sourceKey}${i}/600/750`,
    brand: "Sample Brand", ratio: s.kind === "video" ? "16:9" : "4:5",
    hook: "제품 클로즈업으로 시작", note: "조명 톤 참고",
    ...(s.kind === "video" ? { scenes: ["씬1: 제품 클로즈업", "씬2: 사용 장면", "씬3: 패키지 엔드컷"], cta: "지금 만나보세요", duration: "0:15" } : {}),
    tags: ["mock"], relevance: 5 - i,
  }));
  // 중복 제거 확인용으로 첫 항목을 한 번 더 넣습니다.
  return "작업을 완료했습니다.\n```json\n" + JSON.stringify([...items, items[0]], null, 2) + "\n```";
}

export const DEFAULT_ASIDE_CMD = "aside exec {prompt}";

// 브리프의 소스별 검색어마다 Aside를 실행해 새 레퍼런스를 모읍니다.
// seen: 이미 있는 URL 집합(중복 제외), onItems(새 항목들): 검색어 하나가 끝날 때마다 호출, log(문자열): 진행 상황
export async function collect({ brief, sources, limit = 8, queries = 2, template = DEFAULT_ASIDE_CMD, timeout = 300, mock = false,
  seen = new Set(), onItems = async () => {}, log = () => {}, rawDir = "." }) {
  const keys = (sources?.length ? sources : Object.keys(SOURCES)).filter((k) => {
    if (!SOURCES[k]) { log(`! 모르는 소스 건너뜀: ${k}`); return false; }
    return true;
  });
  let added = 0;
  for (const key of keys) {
    const qs = (brief.queries?.[key] || []).filter(Boolean).slice(0, queries);
    if (!qs.length) { log(`! ${key}: 브리프에 검색어가 없어 건너뜀`); continue; }
    for (const q of qs) {
      const head = `→ ${SOURCES[key].platform} "${q}" … `;
      let out;
      try {
        out = mock ? mockOutput(key, q, limit) : await runAside(template, buildPrompt(key, q, brief, limit), timeout);
      } catch (e) { log(head + `실패: ${e.message}`); continue; }
      const arr = extractArray(out);
      if (!arr) {
        const f = path.join(rawDir, `raw-${key}-${Date.now()}.txt`);
        await writeFile(f, out);
        log(head + `JSON을 찾지 못해 원문을 ${f}에 저장`);
        continue;
      }
      const fresh = [];
      for (const raw of arr) {
        const r = raw && typeof raw === "object" ? normalize(raw, { sourceKey: key, query: q, brief }) : null;
        if (!r || seen.has(r.url)) continue;
        seen.add(r.url); fresh.push(r);
      }
      added += fresh.length;
      await onItems(fresh);
      log(head + `${fresh.length}개`);
    }
  }
  return added;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.brief) { console.log(HELP); process.exit(a.help ? 0 : 1); }
  const brief = JSON.parse(await readFile(a.brief, "utf8"));
  const template = a.asideCmd || process.env.ASIDE_CMD || DEFAULT_ASIDE_CMD;

  let results = [];
  try { results = JSON.parse(await readFile(a.out, "utf8")); if (!Array.isArray(results)) results = []; } catch {}
  const added = await collect({ brief, sources: a.sources, limit: a.limit, queries: a.queries, template, timeout: a.timeout, mock: a.mock,
    seen: new Set(results.map((r) => r.url)), log: (m) => console.log(m),
    onItems: async (items) => { results.push(...items); await writeFile(a.out, JSON.stringify(results, null, 2)); } });
  await writeFile(a.out, JSON.stringify(results, null, 2));
  console.log(`\n완료: 새 레퍼런스 ${added}개 (전체 ${results.length}개) → ${a.out}\n대시보드에서 "수집 결과 가져오기"로 이 파일을 올리세요.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exit(1); });
