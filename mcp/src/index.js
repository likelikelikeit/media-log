// media-log-mcp — 감상 기록(책·영화·드라마·게임) 읽기 전용 MCP + 요약 API.
// 데이터: 비공개 레포 media-data의 data.json (구조는 ../../DATA.md, version 3).
// 약속(도구 이름·인자·API 모양)은 home-system 저장소 services/media-log.md가 원본이다.
// 바꾸면 그 문서와 CHANGELOG, Agent Workshop 중계 목록을 같이 고쳐야 한다.

const SERVER = { name: "media-log-mcp", version: "1.0.0" };
const KNOWN_VERSION = 3;
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const KINDS = ["book", "movie", "drama", "game"];
const STATUSES = ["wish", "doing", "done"];
const KIND_KO = { book: "도서", movie: "영화", drama: "드라마", game: "게임" };
const STATUS_KO = { wish: "위시", doing: "하는 중", done: "완료" };
const CACHE_MS = 30_000;

const INSTRUCTIONS = `형진의 감상 기록(책·영화·드라마·게임)이다. 읽기 전용이며, 고치거나 추가하는 일은 media-log 사이트에서 형진이 한다. 답은 한국어로 한다.
- kind: book(도서)·movie(영화)·drama(드라마)·game(게임). status: wish(위시, 아직 안 봄)·doing(읽는/보는/하는 중)·done(완료).
- 점수(rating)는 0.5–10, 0.5 단위. null이면 아직 매기지 않은 것이니 추측해서 채우지 않는다. 점수 등급표는 아직 정해지지 않았으니 숫자 그대로 전한다.
- 드라마는 에피소드를 한 편씩 기록할 수 있다(옴니버스물). 드라마 자체 점수가 없고 에피소드 점수가 있으면 score에 에피소드 평균이 들어가고 scoreFrom이 "episodes"다. 이때는 "에피소드 평균"이라고 밝힌다.
- 날짜는 YYYY-MM-DD, 모르면 YYYY-MM이나 YYYY만 있다. 모르는 월·일을 채워 말하지 않는다. 어느 해 기록인지는 date(끝낸 날)의 연도, 없으면 added(추가한 날)의 연도로 본다.
- 위시는 아직 안 본 것이라 평균 점수와 감상 완료 통계에 넣지 않는다.
- review(감상)·memo(메모)는 형진이 쓴 글이다. 인용할 때 바꾸거나 덧붙이지 않는다. 목록 도구는 감상을 줄여서 주니, 전문이 필요하면 media_get을 쓴다.
- 목록은 total과 offset을 확인하고, 첫 페이지만 보고 전체라고 말하지 않는다.`;

/* ---------- 데이터 읽기 ---------- */
let cache = null; // { at, data }

async function loadData(env, fresh) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const repo = env.DATA_REPO || "likelikelikeit/media-data";
  const path = env.DATA_PATH || "data.json";
  const branch = env.DATA_BRANCH || "main";
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.raw+json",
      "User-Agent": "media-log-mcp"
    }
  });
  if (r.status === 404) throw new Error("데이터 파일이 아직 없습니다 (media-data/data.json)");
  if (r.status === 401 || r.status === 403) throw new Error(`GitHub가 데이터 읽기를 거부했습니다 (${r.status}) — GITHUB_TOKEN 확인 필요`);
  if (!r.ok) throw new Error(`데이터를 읽지 못했습니다 (GitHub ${r.status})`);
  const data = prepare(await r.json());
  cache = { at: Date.now(), data };
  return data;
}

/* data.json을 읽기 좋은 모양으로 정리한다. 사이트(index.html)의 규칙과 같게 한다. */
function prepare(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const items = (Array.isArray(d.items) ? d.items : []).filter(x => x && x.id && String(x.title || "").trim());
  const ids = new Set(items.map(x => x.id));
  const episodes = (Array.isArray(d.episodes) ? d.episodes : []).filter(e => e && e.id && ids.has(e.itemId));
  const epsBy = new Map();
  for (const e of episodes) {
    if (!epsBy.has(e.itemId)) epsBy.set(e.itemId, []);
    epsBy.get(e.itemId).push(e);
  }
  for (const list of epsBy.values()) list.sort(epSort);
  return { version: +d.version || 1, updatedAt: d.updatedAt || null, items, episodes, epsBy };
}

const isNum = (v) => typeof v === "number" && !isNaN(v);
const epSort = (a, b) => (a.season ?? 999) - (b.season ?? 999) || (a.no ?? 9999) - (b.no ?? 9999);
const kstDay = (ms) => new Date((+ms || 0) + 9 * 3600e3).toISOString().slice(0, 10);
const dayOf = (x) => x.date || kstDay(x.added);
const yearOf = (x) => dayOf(x).slice(0, 4);
const round1 = (n) => Math.round(n * 10) / 10;
const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const iso = (ms) => ms ? new Date(+ms).toISOString() : null;
const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n) + "…" : s; };

function epsOf(data, x) { return data.epsBy.get(x.id) || []; }
function epAvg(data, x) {
  const r = epsOf(data, x).map(e => e.rating).filter(isNum);
  return r.length ? round1(mean(r)) : null;
}
function scoreOf(data, x) {
  if (isNum(x.rating)) return { score: x.rating, scoreFrom: "own" };
  const a = x.kind === "drama" ? epAvg(data, x) : null;
  return a !== null ? { score: a, scoreFrom: "episodes" } : { score: null, scoreFrom: null };
}
const epLabel = (e) => e.season != null && e.no != null ? `S${e.season}E${e.no}` : e.no != null ? `${e.no}화` : e.season != null ? `시즌 ${e.season}` : "";

/* 항목 하나를 내보내는 모양. full이면 감상·메모·에피소드 전문까지. */
function view(data, x, full) {
  const { score, scoreFrom } = scoreOf(data, x);
  const eps = epsOf(data, x);
  const out = {
    id: x.id, kind: x.kind, kindKo: KIND_KO[x.kind] || x.kind,
    status: x.status, statusKo: STATUS_KO[x.status] || x.status,
    title: x.title, creator: x.creator || "", year: x.year || "",
    rating: isNum(x.rating) ? x.rating : null, score, scoreFrom,
    started: x.started || "", date: x.date || "", recordYear: x.status === "wish" ? null : yearOf(x),
    where: Array.isArray(x.where) ? x.where : [],
    review: full ? (x.review || "") : clip(x.review, 160),
    memo: full ? (x.memo || "") : clip(x.memo, 120),
    episodeCount: eps.length,
    added: iso(x.added), updated: iso(x.updated || x.added)
  };
  if (full) {
    out.cover = x.cover || "";
    out.tmdbId = x.tmdbId || null;
    out.episodes = eps.map(e => epView(e, true));
  }
  return out;
}
function epView(e, full, parent) {
  const o = {
    id: e.id, label: epLabel(e), season: e.season ?? null, no: e.no ?? null, title: e.title || "",
    rating: isNum(e.rating) ? e.rating : null, date: e.date || "",
    review: full ? (e.review || "") : clip(e.review, 160),
    added: iso(e.added), updated: iso(e.updated || e.added)
  };
  if (parent) { o.itemId = parent.id; o.itemTitle = parent.title; }
  return o;
}

/* 정렬: date(끝낸 날, 없으면 추가한 날) 최신순이 기본 */
function sortItems(data, list, sort) {
  const by = {
    date: (a, b) => dayOf(b).localeCompare(dayOf(a)) || (b.added || 0) - (a.added || 0),
    added: (a, b) => (b.added || 0) - (a.added || 0),
    title: (a, b) => String(a.title).localeCompare(String(b.title), "ko"),
    rating: (a, b) => (scoreOf(data, b).score ?? -1) - (scoreOf(data, a).score ?? -1) || dayOf(b).localeCompare(dayOf(a))
  };
  return list.slice().sort(by[sort] || by.date);
}

const hit = (s, q) => String(s || "").toLowerCase().includes(q);
function matches(data, x, q) {
  return hit(x.title, q) || hit(x.creator, q) || hit(x.review, q) || hit(x.memo, q) || hit((x.where || []).join(" "), q) || hit(x.year, q);
}

function filterItems(data, { kind, status, q }) {
  const qq = String(q || "").trim().toLowerCase();
  return data.items.filter(x =>
    (!kind || x.kind === kind) && (!status || x.status === status) &&
    (!qq || matches(data, x, qq) || epsOf(data, x).some(e => hit(e.title, qq) || hit(e.review, qq))));
}

const intArg = (v, def, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
function enumArg(v, allowed, name) {
  if (v === undefined || v === null || v === "") return undefined;
  if (!allowed.includes(v)) throw new ArgError(`${name}는 ${allowed.join("·")} 중 하나여야 합니다`);
  return v;
}
class ArgError extends Error {}

/* ---------- 도구 ---------- */
const TOOLS = [
  {
    name: "media_recent",
    description: "요즘 무엇을 읽고 보고 하는지: 하는 중인 것 전부, 최근 완료한 것, 최근 위시에 넣은 것, 최근 본 드라마 에피소드를 묶음별로 준다.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20, default: 5, description: "묶음마다 몇 개 (하는 중은 전부)" } } }
  },
  {
    name: "media_list",
    description: "조건에 맞는 기록 목록. 종류·상태로 거르고 정렬한다. total과 offset으로 다음 페이지를 읽는다.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: KINDS }, status: { type: "string", enum: STATUSES },
        sort: { type: "string", enum: ["date", "rating", "added", "title"], default: "date", description: "date=끝낸 날(없으면 추가한 날) 최신순, rating=점수 높은 순" },
        offset: { type: "integer", minimum: 0, default: 0 }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 }
      }
    }
  },
  {
    name: "media_search",
    description: "제목·저자/감독·감상·메모·볼 곳, 드라마 에피소드 제목·감상에서 찾는다. 최대 30개.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "찾을 말" }, kind: { type: "string", enum: KINDS } }, required: ["query"] }
  },
  {
    name: "media_get",
    description: "기록 하나의 전부: 감상·메모 전문, 드라마면 에피소드 목록까지. 에피소드 id를 주면 그 에피소드와 소속 드라마를 준다.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
  },
  {
    name: "media_stats",
    description: "완료한 기록의 통계: 종류별·연도별 개수, 평균 점수, 점수 분포, 높은 점수 순, 하는 중·위시 개수. 위시는 평균에서 뺀다.",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: KINDS }, year: { type: "string", pattern: "^\\d{4}$", description: "YYYY" } } }
  }
];

async function callTool(name, args, env) {
  args = args && typeof args === "object" ? args : {};
  const data = await loadData(env);
  const warn = data.version > KNOWN_VERSION ? { warning: `데이터 version ${data.version}은 이 서버(${KNOWN_VERSION})보다 새롭습니다. 모르는 필드는 빠져 있을 수 있습니다.` } : {};

  if (name === "media_recent") {
    const n = intArg(args.limit, 5, 1, 20);
    const by = (k) => (a, b) => String(b[k] || "").localeCompare(String(a[k] || ""));
    const doing = data.items.filter(x => x.status === "doing").sort((a, b) => (b.started || kstDay(b.added)).localeCompare(a.started || kstDay(a.added)));
    const done = sortItems(data, data.items.filter(x => x.status === "done"), "date").slice(0, n);
    const wish = data.items.filter(x => x.status === "wish").sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, n);
    const byId = new Map(data.items.map(x => [x.id, x]));
    const eps = data.episodes.slice().sort((a, b) => by("date")(a, b) || (b.updated || 0) - (a.updated || 0)).slice(0, n);
    return {
      ...warn,
      doing: doing.map(x => view(data, x)),
      recentDone: done.map(x => view(data, x)),
      recentWish: wish.map(x => view(data, x)),
      recentEpisodes: eps.map(e => epView(e, false, byId.get(e.itemId)))
    };
  }

  if (name === "media_list") {
    const kind = enumArg(args.kind, KINDS, "kind"), status = enumArg(args.status, STATUSES, "status");
    const sort = enumArg(args.sort, ["date", "rating", "added", "title"], "sort") || "date";
    const offset = intArg(args.offset, 0, 0, 1e9), limit = intArg(args.limit, 20, 1, 50);
    const all = sortItems(data, filterItems(data, { kind, status }), sort);
    return { ...warn, total: all.length, offset, limit, items: all.slice(offset, offset + limit).map(x => view(data, x)) };
  }

  if (name === "media_search") {
    const q = String(args.query || "").trim();
    if (!q) throw new ArgError("query가 비어 있습니다");
    const kind = enumArg(args.kind, KINDS, "kind");
    const qq = q.toLowerCase();
    const found = sortItems(data, filterItems(data, { kind, q }), "date");
    return {
      ...warn, query: q, total: found.length, shown: Math.min(30, found.length),
      items: found.slice(0, 30).map(x => {
        const v = view(data, x);
        const eh = epsOf(data, x).filter(e => hit(e.title, qq) || hit(e.review, qq));
        if (eh.length) v.matchedEpisodes = eh.map(e => epView(e, false));
        return v;
      })
    };
  }

  if (name === "media_get") {
    const id = String(args.id || "").trim();
    if (!id) throw new ArgError("id가 비어 있습니다");
    const x = data.items.find(y => y.id === id);
    if (x) return { ...warn, item: view(data, x, true) };
    const e = data.episodes.find(y => y.id === id);
    if (e) {
      const p = data.items.find(y => y.id === e.itemId);
      return { ...warn, episode: epView(e, true, p), item: view(data, p, false) };
    }
    throw new ArgError(`id ${id}인 기록이 없습니다`);
  }

  if (name === "media_stats") {
    const kind = enumArg(args.kind, KINDS, "kind");
    const year = args.year ? String(args.year) : "";
    if (year && !/^\d{4}$/.test(year)) throw new ArgError("year는 YYYY 형식이어야 합니다");
    const inKind = data.items.filter(x => !kind || x.kind === kind);
    const done = inKind.filter(x => x.status === "done" && (!year || yearOf(x) === year));
    const scored = done.map(x => ({ x, ...scoreOf(data, x) })).filter(s => isNum(s.score));
    const count = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
    const dist = {};
    for (const s of scored) { const b = Math.floor(s.score) + "점대"; dist[b] = (dist[b] || 0) + 1; }
    return {
      ...warn,
      filter: { kind: kind || "전체", year: year || "전체" },
      done: done.length,
      doneByKind: count(done, x => x.kind),
      doneByYear: year ? undefined : count(done, yearOf),
      rated: scored.length,
      averageScore: scored.length ? round1(mean(scored.map(s => s.score))) : null,
      scoreDistribution: dist,
      top: scored.sort((a, b) => b.score - a.score || dayOf(b.x).localeCompare(dayOf(a.x))).slice(0, 5).map(s => view(data, s.x)),
      doing: inKind.filter(x => x.status === "doing").length,
      wish: inKind.filter(x => x.status === "wish").length,
      note: "평균·분포·top은 완료(done)한 것 중 점수가 있는 것만. 드라마 점수가 없으면 에피소드 평균을 쓴다(scoreFrom). 위시는 빠진다."
    };
  }

  throw new ArgError(`알 수 없는 도구: ${name}`);
}

/* ---------- MCP (Streamable HTTP, JSON 응답) ---------- */
async function handleRpc(msg, env) {
  const { id, method, params } = msg || {};
  const isNote = id === undefined || id === null;
  const ok = (result) => isNote ? null : { jsonrpc: "2.0", id, result };
  const fail = (code, message) => isNote ? null : { jsonrpc: "2.0", id, error: { code, message } };
  if (!msg || msg.jsonrpc !== "2.0" || typeof method !== "string") return fail(-32600, "Invalid Request");
  switch (method) {
    case "initialize": {
      const want = params && params.protocolVersion;
      return ok({
        protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS
      });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS });
    case "tools/call": {
      const name = params && params.name;
      if (!TOOLS.some(t => t.name === name)) return fail(-32602, `알 수 없는 도구: ${name}`);
      try {
        const result = await callTool(name, params.arguments, env);
        return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 1) }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: (e instanceof ArgError ? "잘못된 인자: " : "조회 실패: ") + e.message }], isError: true });
      }
    }
    default:
      if (method.startsWith("notifications/")) return null;
      return fail(-32601, `Method not found: ${method}`);
  }
}

/* ---------- HTTP ---------- */
const json = (body, status = 200, extra) => new Response(JSON.stringify(body), {
  status, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, extra || {})
});

function authorized(request, env) {
  const key = env.MCP_KEY || "";
  const got = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!key || got.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health") return json({ ok: true });
    if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });

    if (path === "/mcp") {
      if (request.method === "GET") return json({ error: "SSE stream not supported; use POST" }, 405, { Allow: "POST" });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405, { Allow: "POST" });
      let body;
      try { body = await request.json(); } catch (e) { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
      if (Array.isArray(body)) {
        const out = (await Promise.all(body.map(m => handleRpc(m, env)))).filter(Boolean);
        return out.length ? json(out) : new Response(null, { status: 202 });
      }
      const out = await handleRpc(body, env);
      return out ? json(out) : new Response(null, { status: 202 });
    }

    if (request.method !== "GET") return json({ error: "method not allowed" }, 405, { Allow: "GET" });

    try {
      if (path === "/api/items") {
        const data = await loadData(env);
        const kind = KINDS.includes(url.searchParams.get("kind")) ? url.searchParams.get("kind") : undefined;
        const status = STATUSES.includes(url.searchParams.get("status")) ? url.searchParams.get("status") : undefined;
        const offset = intArg(url.searchParams.get("offset"), 0, 0, 1e9);
        const limit = intArg(url.searchParams.get("limit"), 50, 1, 200);
        const all = sortItems(data, filterItems(data, { kind, status, q: url.searchParams.get("q") }), "date");
        return json({ total: all.length, offset, limit, items: all.slice(offset, offset + limit).map(x => view(data, x)) });
      }
      if (path === "/api/summary") {
        const data = await loadData(env);
        const kinds = Object.fromEntries(KINDS.map(k => [k, data.items.filter(x => x.kind === k).length]));
        return json({
          version: data.version,
          updatedAt: iso(data.updatedAt),
          total: data.items.length,
          episodes: data.episodes.length,
          wish: data.items.filter(x => x.status === "wish").length,
          kinds,
          doing: data.items.filter(x => x.status === "doing").map(x => view(data, x)),
          recentDone: sortItems(data, data.items.filter(x => x.status === "done"), "date").slice(0, 10).map(x => view(data, x))
        });
      }
    } catch (e) {
      return json({ error: e.message }, 502);
    }
    return json({ error: "not found" }, 404);
  }
};

// 테스트용
export const _internal = { prepare, callTool, scoreOf, resetCache: () => { cache = null; } };
