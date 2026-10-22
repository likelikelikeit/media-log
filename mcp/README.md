# media-log-mcp

감상 기록(책·영화·드라마·게임)을 AI가 읽는 **읽기 전용 MCP**와, 상황판용 요약 API. Cloudflare Worker 하나로 돈다.

- 데이터: 비공개 레포 `likelikelikeit/media-data`의 `data.json` (구조는 [../DATA.md](../DATA.md), version 3)
- 서비스 간 약속(도구 이름·인자·API 모양)의 원본: 비공개 `likelikelikeit/home-system`의 `services/media-log.md`
  도구 이름·인자를 바꾸면 그 문서·CHANGELOG와 Agent Workshop 중계 목록을 같이 고쳐야 한다.
- 고치기·추가는 사이트(`index.html`)에서만 한다. 이 서버는 쓰지 않는다.

## 경로

| 경로 | 인증 | 내용 |
|---|---|---|
| `GET /health` | 없음 | `{ "ok": true }` |
| `POST /mcp` | Bearer | MCP JSON-RPC (Streamable HTTP, JSON 응답). `initialize`의 `instructions`에 데이터 해석 규칙 |
| `GET /api/items?kind=&status=&q=&offset=&limit=` | Bearer | `{total, offset, limit, items}`, 날짜순, limit 최대 200 |
| `GET /api/summary` | Bearer | `{version, updatedAt, total, episodes, wish, kinds, doing[], recentDone[10]}` |

인증 실패는 HTTP 401 `{ "error": "unauthorized" }`. 데이터를 못 읽으면 API는 502, MCP 도구는 `isError: true`.

## MCP 도구

| 도구 | 인자 | 결과 |
|---|---|---|
| `media_recent` | `limit` 기본 5·최대 20 | 하는 중 전부, 최근 완료·위시·에피소드 묶음 |
| `media_list` | `kind`, `status`, `sort`(date/rating/added/title), `offset`, `limit` 기본 20·최대 50 | `{total, offset, limit, items}` |
| `media_search` | `query`(필수), `kind` | 최대 30개, 에피소드에서 걸리면 `matchedEpisodes` |
| `media_get` | `id`(필수) | 감상·메모 전문, 드라마면 에피소드 전부. 에피소드 id도 받는다 |
| `media_stats` | `kind`, `year`(YYYY) | 완료 개수(종류·연도별), 평균, 분포, top 5, 하는 중·위시 수 |

결과는 `content[0].text`에 JSON 문자열로 담긴다. 항목마다 `score`(드라마는 자체 점수가 없으면 에피소드 평균)와 `scoreFrom`(`own`/`episodes`)이 붙는다. 목록 도구는 감상을 160자로 줄인다.

## 배포

```bash
cd mcp
npm install
npx wrangler login                       # 처음 한 번
npx wrangler secret put MCP_KEY          # 이미 배포된 Worker에 있으면 생략 — 시크릿은 배포해도 남는다
npx wrangler secret put GITHUB_TOKEN     # media-data Contents: Read 전용 fine-grained 토큰
npm run deploy
```

`wrangler.toml`의 이름이 이미 떠 있는 `media-log-mcp`와 같아서, 배포하면 그 Worker를 이 코드로 바꾼다. 주소(`https://media-log-mcp.<계정>.workers.dev`)와 시크릿은 그대로다.

배포 뒤 확인:

```bash
curl https://media-log-mcp.<계정>.workers.dev/health
curl -H "Authorization: Bearer $MCP_KEY" https://media-log-mcp.<계정>.workers.dev/api/summary
```

## 테스트

```bash
npm test     # GitHub 응답을 흉내 내서 도구·API·인증을 검사 (네트워크 없이)
```
