// node --test test/  — GitHub 응답을 흉내 내서 Worker를 직접 부른다.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker, { _internal } from "../src/index.js";

const env = { MCP_KEY: "k".repeat(32), GITHUB_TOKEN: "gh-test", DATA_REPO: "o/r" };
const AUTH = { Authorization: "Bearer " + env.MCP_KEY };
const DATA = {
  version: 3, updatedAt: 1760000000000,
  items: [
    { id: "m1", kind: "movie", status: "done", title: "인터스텔라", creator: "크리스토퍼 놀란", year: "2014", rating: 9.5, review: "우주".repeat(200), date: "2014", where: ["극장"], added: 1700000000000, updated: 1700000000000 },
    { id: "m2", kind: "drama", status: "done", title: "블랙 미러", creator: "Charlie Brooker", rating: null, review: "", date: "2026-10-01", where: ["넷플릭스"], added: 1750000000000 },
    { id: "m3", kind: "book", status: "doing", title: "총, 균, 쇠", creator: "재레드 다이아몬드", started: "2026-09", added: 1755000000000 },
    { id: "m4", kind: "book", status: "wish", title: "이처럼 사소한 것들", rating: null, where: ["도서관 및 학교"], memo: "친구 추천", added: 1760000000000 },
    { id: "m5", kind: "book", status: "done", title: "소년이 온다", creator: "한강", rating: 9, review: "오래 남았다", date: "2026-09-21", added: 1758000000000 }
  ],
  episodes: [
    { id: "e1", itemId: "m2", season: 3, no: 1, title: "추락", rating: 9, review: "평점 사회", date: "2026-09-30", added: 1, updated: 2 },
    { id: "e2", itemId: "m2", season: 3, no: 4, title: "샌 주니페로", rating: 8, date: "2026-10-01", added: 1, updated: 3 },
    { id: "e3", itemId: "gone", season: 1, no: 1, title: "고아" }
  ]
};
let calls;
beforeEach(() => {
  _internal.resetCache();
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.Authorization, accept: init.headers.Accept });
    return new Response(JSON.stringify(DATA), { status: 200 });
  };
});
const req = (path, init) => worker.fetch(new Request("https://x.dev" + path, init), env);
const rpc = async (method, params, id = 1) => {
  const r = await req("/mcp", { method: "POST", headers: { ...AUTH, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  return r.json();
};
const call = async (name, args) => {
  const r = await rpc("tools/call", { name, arguments: args });
  const c = r.result.content[0].text;
  return r.result.isError ? { error: c } : JSON.parse(c);
};

test("health는 인증 없이", async () => {
  const r = await req("/health");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});
test("인증 실패는 401 {error: unauthorized}", async () => {
  for (const p of ["/mcp", "/api/items", "/api/summary"]) {
    const r = await req(p, { headers: { Authorization: "Bearer wrong" } });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: "unauthorized" });
  }
});
test("initialize: instructions와 버전", async () => {
  const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.equal(r.result.serverInfo.name, "media-log-mcp");
  assert.match(r.result.instructions, /읽기 전용/);
  const r2 = await rpc("initialize", { protocolVersion: "1999-01-01" });
  assert.ok(["2025-06-18", "2025-03-26", "2024-11-05"].includes(r2.result.protocolVersion));
});
test("notifications는 202", async () => {
  const r = await req("/mcp", { method: "POST", headers: AUTH, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(r.status, 202);
});
test("tools/list: 약속한 다섯 도구 이름", async () => {
  const r = await rpc("tools/list", {});
  assert.deepEqual(r.result.tools.map(t => t.name), ["media_recent", "media_list", "media_search", "media_get", "media_stats"]);
});
test("GitHub에서 raw로, 토큰으로 읽고 캐시한다", async () => {
  await call("media_list", {}); await call("media_list", {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/o/r/contents/data.json?ref=main");
  assert.equal(calls[0].auth, "Bearer gh-test");
  assert.equal(calls[0].accept, "application/vnd.github.raw+json");
});
test("media_list: 날짜순, 페이지, 상한 50", async () => {
  const r = await call("media_list", { limit: 99 });
  assert.equal(r.total, 5); assert.equal(r.limit, 50);
  assert.deepEqual(r.items.map(x => x.id), ["m2", "m5", "m4", "m3", "m1"]);
  const p = await call("media_list", { status: "done", sort: "rating", offset: 1, limit: 1 });
  assert.equal(p.total, 3); assert.deepEqual(p.items.map(x => x.id), ["m5"]);
});
test("드라마 점수는 에피소드 평균, 출처 표시", async () => {
  const r = await call("media_list", { kind: "drama" });
  assert.equal(r.items[0].rating, null);
  assert.equal(r.items[0].score, 8.5); assert.equal(r.items[0].scoreFrom, "episodes");
  assert.equal(r.items[0].episodeCount, 2);
});
test("목록의 감상은 줄이고 get은 전문", async () => {
  const l = await call("media_list", { kind: "movie" });
  assert.ok(l.items[0].review.length <= 161);
  const g = await call("media_get", { id: "m1" });
  assert.equal(g.item.review.length, 400);
});
test("부분 날짜는 그대로, recordYear는 date→added", async () => {
  const g = await call("media_get", { id: "m1" });
  assert.equal(g.item.date, "2014"); assert.equal(g.item.recordYear, "2014");
  const w = await call("media_get", { id: "m4" });
  assert.equal(w.item.recordYear, null);
});
test("media_get: 드라마는 에피소드 전부, 에피소드 id도 받음", async () => {
  const g = await call("media_get", { id: "m2" });
  assert.deepEqual(g.item.episodes.map(e => e.label), ["S3E1", "S3E4"]);
  const e = await call("media_get", { id: "e2" });
  assert.equal(e.episode.title, "샌 주니페로"); assert.equal(e.episode.itemTitle, "블랙 미러");
  const no = await call("media_get", { id: "nope" });
  assert.match(no.error, /없습니다/);
});
test("고아 에피소드는 버린다", async () => {
  const s = await (await req("/api/summary", { headers: AUTH })).json();
  assert.equal(s.episodes, 2);
});
test("media_search: 에피소드 제목도 찾고 표시", async () => {
  const r = await call("media_search", { query: "주니페로" });
  assert.equal(r.total, 1); assert.equal(r.items[0].id, "m2");
  assert.equal(r.items[0].matchedEpisodes[0].title, "샌 주니페로");
  const k = await call("media_search", { query: "한강", kind: "book" });
  assert.deepEqual(k.items.map(x => x.id), ["m5"]);
  assert.match((await call("media_search", { query: " " })).error, /비어/);
});
test("media_recent: 묶음별", async () => {
  const r = await call("media_recent", { limit: 2 });
  assert.deepEqual(r.doing.map(x => x.id), ["m3"]);
  assert.deepEqual(r.recentDone.map(x => x.id), ["m2", "m5"]);
  assert.deepEqual(r.recentWish.map(x => x.id), ["m4"]);
  assert.deepEqual(r.recentEpisodes.map(e => e.title), ["샌 주니페로", "추락"]);
  assert.equal(r.recentEpisodes[0].itemTitle, "블랙 미러");
});
test("media_stats: 위시는 평균에서 빼고 연도 거르기", async () => {
  const s = await call("media_stats", {});
  assert.equal(s.done, 3); assert.equal(s.rated, 3);
  assert.equal(s.averageScore, 9);  // (9.5 + 8.5 + 9) / 3
  assert.deepEqual(s.doneByYear, { "2014": 1, "2026": 2 });
  assert.equal(s.wish, 1); assert.equal(s.doing, 1);
  const y = await call("media_stats", { year: "2026", kind: "book" });
  assert.equal(y.done, 1); assert.equal(y.top[0].title, "소년이 온다");
  assert.match((await call("media_stats", { year: "26" })).error, /YYYY/);
});
test("잘못된 enum은 isError", async () => {
  assert.match((await call("media_list", { kind: "music" })).error, /kind/);
});
test("API: /api/items 상한 200·q, /api/summary 모양", async () => {
  const i = await (await req("/api/items?limit=999&q=놀란", { headers: AUTH })).json();
  assert.equal(i.limit, 200); assert.equal(i.total, 1);
  const s = await (await req("/api/summary", { headers: AUTH })).json();
  for (const k of ["version", "episodes", "total", "doing", "recentDone", "wish", "kinds"]) assert.ok(k in s, k);
  assert.equal(s.total, 5); assert.equal(s.wish, 1);
  assert.deepEqual(s.kinds, { book: 3, movie: 1, drama: 1, game: 0 });
  assert.ok(Array.isArray(s.doing) && Array.isArray(s.recentDone));
});
test("GitHub 실패는 도구 isError / API 502", async () => {
  globalThis.fetch = async () => new Response("{}", { status: 401 });
  assert.match((await call("media_list", {})).error, /GITHUB_TOKEN/);
  _internal.resetCache();
  const r = await req("/api/summary", { headers: AUTH });
  assert.equal(r.status, 502);
});
test("모르는 메서드와 도구", async () => {
  assert.equal((await rpc("foo/bar", {})).error.code, -32601);
  assert.equal((await rpc("tools/call", { name: "music_top" })).error.code, -32602);
});
