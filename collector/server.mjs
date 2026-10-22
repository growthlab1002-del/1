#!/usr/bin/env node
// 로컬 모드 서버: 대시보드를 http://localhost:4321 에서 열고, 저장·업로드·Aside 분석·수집을 이 PC에서 처리합니다.
// 사용법: node collector/server.mjs [--port 4321] [--mock] [--aside-cmd "aside exec {prompt}"]

import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ASIDE_CMD, collect, extractObject, runAside } from "./collect.mjs";
import { analysisPrompt, mockAnalysis } from "./sources.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = path.join(ROOT, "ad-reference-board", "index.html");
const DATA = path.resolve(process.env.AD_BOARD_DATA || path.join(ROOT, "data"));
const ASSETS = path.join(DATA, "assets");

const opts = { port: 4321, mock: false, template: process.env.ASIDE_CMD || DEFAULT_ASIDE_CMD };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === "--port") opts.port = Number(process.argv[++i]);
  else if (k === "--mock") opts.mock = true;
  else if (k === "--aside-cmd") opts.template = process.argv[++i];
  else { console.error(`알 수 없는 옵션: ${k}`); process.exit(1); }
}

const COLLECTIONS = ["refs", "briefs"];
const MEDIA = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm" };
const EXT = Object.fromEntries(Object.entries(MEDIA).map(([e, t]) => [t, e]));
const newId = () => randomBytes(10).toString("hex");

/* ---------- 저장소: data/<컬렉션>.json ---------- */
const store = {};
let rev = 1;
async function load() {
  await mkdir(ASSETS, { recursive: true });
  for (const c of COLLECTIONS) {
    try { store[c] = new Map(Object.entries(JSON.parse(await readFile(path.join(DATA, c + ".json"), "utf8")))); }
    catch { store[c] = new Map(); }
  }
}
const pending = {};
function persist(c) {
  rev++;
  // 쓰기를 몰아서 한 번에 저장합니다 (수집 중 연속 쓰기).
  clearTimeout(pending[c]);
  pending[c] = setTimeout(async () => {
    const f = path.join(DATA, c + ".json"), tmp = f + ".tmp";
    await writeFile(tmp, JSON.stringify(Object.fromEntries(store[c]), null, 2));
    await rename(tmp, f);
  }, 150);
}
const list = (c) => [...store[c].entries()].map(([id, v]) => ({ id, ...v }));

/* ---------- 수집 작업 ---------- */
const jobs = new Map();
function startCollect(brief, { sources, limit, queries }) {
  const job = { id: newId(), briefId: brief.id, status: "running", log: [], added: 0, startedAt: Date.now() };
  jobs.set(job.id, job);
  const seen = new Set([...store.refs.values()].map((r) => r.url));
  collect({ brief, sources, limit, queries, template: opts.template, mock: opts.mock, seen, rawDir: DATA,
    log: (m) => { job.log.push(m); console.log(m); },
    onItems: async (items) => {
      for (const r of items) store.refs.set(newId(), { ...r, assetId: null, assetType: null, createdAt: Date.now(), updatedAt: Date.now(), addedBy: null });
      if (items.length) persist("refs");
    } })
    .then((n) => { job.added = n; job.status = "done"; job.log.push(`완료: 새 레퍼런스 ${n}개`); })
    .catch((e) => { job.status = "error"; job.log.push(`오류: ${e.message}`); });
  return job;
}

/* ---------- HTTP ---------- */
const LOCAL_HOSTS = new Set([`localhost:${opts.port}`, `127.0.0.1:${opts.port}`]);
function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error("too_large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function json(req) {
  if (!/^application\/json/.test(req.headers["content-type"] || "")) throw Object.assign(new Error("JSON만 받습니다"), { status: 415 });
  try { return JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString("utf8") || "{}"); }
  catch (e) { throw e.status ? e : Object.assign(new Error("잘못된 JSON"), { status: 400 }); }
}
const plainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

async function handle(req, res) {
  // 다른 웹사이트가 이 서버(=Aside 실행)를 부르지 못하게 Host와 Origin을 확인합니다.
  if (!LOCAL_HOSTS.has(req.headers.host || "")) return send(res, 403, { error: "forbidden_host" });
  const origin = req.headers.origin;
  if (req.method !== "GET" && origin && !LOCAL_HOSTS.has(origin.replace(/^http:\/\//, ""))) return send(res, 403, { error: "forbidden_origin" });

  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html"))
    return send(res, 200, await readFile(PAGE), "text/html; charset=utf-8");

  if (req.method === "GET" && parts[0] === "_blob" && parts.length === 2) {
    const m = /^([a-f0-9]{20})\.(png|jpg|webp|gif|mp4|webm)$/.exec(parts[1]);
    if (!m) return send(res, 404, { error: "not_found" });
    try { return send(res, 200, await readFile(path.join(ASSETS, parts[1])), MEDIA[m[2]]); } catch { return send(res, 404, { error: "not_found" }); }
  }

  if (parts[0] !== "api") return send(res, 404, { error: "not_found" });
  const [, a, b] = parts;

  if (a === "ping" && req.method === "GET") return send(res, 200, { local: true, mock: opts.mock, rev });

  if (a === "assets") {
    if (req.method === "POST" && !b) {
      const type = (req.headers["content-type"] || "").split(";")[0].trim();
      if (!EXT[type]) return send(res, 415, { error: "unsupported_type" });
      const id = `${newId()}.${EXT[type]}`;
      await writeFile(path.join(ASSETS, id), await readBody(req, 20 * 1024 * 1024));
      return send(res, 200, { id, url: "/_blob/" + id, contentType: type });
    }
    if (req.method === "DELETE" && /^[a-f0-9]{20}\.(png|jpg|webp|gif|mp4|webm)$/.test(b || "")) {
      await rm(path.join(ASSETS, b), { force: true }); return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: "method_not_allowed" });
  }

  if (a === "analyze" && req.method === "POST") {
    const body = await json(req);
    const product = plainObject(body.product) ? body.product : {};
    const photo = /^[a-f0-9]{20}\.(png|jpg|webp)$/.test(body.photoAssetId || "") ? path.join(ASSETS, body.photoAssetId) : null;
    if (opts.mock) return send(res, 200, { brief: mockAnalysis(product) });
    let out;
    try { out = await runAside(opts.template, analysisPrompt(product, photo), 600); }
    catch (e) { return send(res, 502, { error: "aside_failed", message: e.message }); }
    const brief = extractObject(out);
    if (!brief) return send(res, 502, { error: "no_json", message: "Aside 결과에서 JSON을 찾지 못했습니다", raw: out.slice(0, 2000) });
    return send(res, 200, { brief });
  }

  if (a === "collect" && req.method === "POST") {
    const body = await json(req);
    const brief = store.briefs.get(String(body.briefId || ""));
    if (!brief) return send(res, 404, { error: "brief_not_found" });
    const running = [...jobs.values()].find((j) => j.status === "running" && j.briefId === body.briefId);
    if (running) return send(res, 409, { error: "already_running", jobId: running.id });
    const n = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
    const job = startCollect({ id: body.briefId, ...brief }, {
      sources: Array.isArray(body.sources) ? body.sources.filter((s) => typeof s === "string") : undefined,
      limit: n(body.limit, 1, 30, 8), queries: n(body.queries, 1, 5, 2) });
    return send(res, 200, { jobId: job.id });
  }

  if (a === "jobs" && req.method === "GET" && b) {
    const job = jobs.get(b);
    return job ? send(res, 200, job) : send(res, 404, { error: "not_found" });
  }

  if (COLLECTIONS.includes(a)) {
    const col = store[a];
    if (req.method === "GET" && !b) {
      if (url.searchParams.get("since") === String(rev)) return send(res, 200, { rev, unchanged: true });
      return send(res, 200, { rev, docs: list(a) });
    }
    if (req.method === "POST" && !b) {
      const body = await json(req); if (!plainObject(body)) return send(res, 400, { error: "invalid_argument" });
      const id = newId(); col.set(id, body); persist(a); return send(res, 200, { id });
    }
    if (b && /^[A-Za-z0-9_-]{1,64}$/.test(b)) {
      if (req.method === "PUT") {
        const body = await json(req); if (!plainObject(body)) return send(res, 400, { error: "invalid_argument" });
        col.set(b, body); persist(a); return send(res, 200, { id: b });
      }
      if (req.method === "DELETE") { col.delete(b); persist(a); return send(res, 200, { ok: true }); }
    }
  }
  return send(res, 404, { error: "not_found" });
}

await load();
http.createServer((req, res) => handle(req, res).catch((e) => send(res, e.status || 500, { error: e.status ? "bad_request" : "server_error", message: e.message })))
  .listen(opts.port, "127.0.0.1", () => {
    console.log(`광고 레퍼런스 보드 (로컬 모드) → http://localhost:${opts.port}`);
    console.log(`데이터 폴더: ${DATA}${opts.mock ? "\n--mock: Aside 대신 가짜 결과를 씁니다" : `\nAside 명령: ${opts.template}`}`);
  });
