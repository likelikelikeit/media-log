# media-log

도서 · 드라마/영화 · 게임 · 콘서트 기록 + 위시리스트 웹페이지. 작업 규약은 [AGENTS.md](AGENTS.md).

- 페이지: `index.html` 한 파일, GitHub Pages (`https://likelikelikeit.github.io/media-log/`)
- 데이터: 비공개 레포 `likelikelikeit/media-data`의 `data.json` (GitHub Contents API로 읽고 씀)
- 참고: 음악 페이지 [`music-ratings`](https://github.com/likelikelikeit/music-ratings) — 같은 구조

- 콘서트: 공연명·아티스트·구분·일시·관람 회차·공연장·예매처·비고·감상을 직접 입력. 위시 없이 관람 기록만 관리합니다. 데이터 구조는 version 4.
