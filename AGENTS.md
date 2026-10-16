# 작업 규약

## 무엇을 만드나
도서와 드라마/영화를 기록하는 개인 페이지. 메인 취미가 아니라서 **항목 수가 적다**(연 수십 개 수준).
대량 데이터용 기능(복잡한 통계, 페이지네이션 등)보다 빠르게 적고 찾는 쪽이 우선이다.

세 가지를 다룬다.
1. **도서** 기록 — 읽은 책, 평점, 짧은 감상
2. **드라마/영화** 기록 — 본 작품, 평점, 짧은 감상
3. **위시리스트** — 보고/읽고 싶은 것 메모. 특히 넷플릭스에 없어서 넷플 찜 목록에 못 넣는 작품을 적어 두는 곳.
   어디서 볼 수 있는지(OTT, 극장, 도서관 등) 메모할 수 있어야 하고, 다 보면 기록으로 옮길 수 있어야 한다.

## 구조 (음악 페이지 `likelikelikeit/music-ratings`를 따른다)
- 빌드 없는 단일 `index.html` (HTML + CSS + JS 인라인). GitHub Pages로 서빙.
- 데이터는 비공개 레포 `likelikelikeit/media-data`의 `data.json` 하나.
  - GitHub Contents API로 GET/PUT. 토큰(fine-grained PAT, media-data에 Contents read/write)은 브라우저 localStorage에만 둔다.
  - 토큰이 없으면 localStorage에만 저장. 내보내기/가져오기 JSON에는 토큰을 절대 넣지 않는다.
  - 저장 시 sha로 충돌 감지(409/422), 커밋 이력이 곧 되돌리기 이력.
- 음악 페이지의 동기화 코드(`LS`, `ghFetch`, `ghWrite`, 설정 화면)와 디자인·말투를 최대한 재사용해서 같은 시리즈처럼 보이게 한다.
  참고할 때 `gh api repos/likelikelikeit/music-ratings/contents/index.html --jq .content | base64 -d`로 받아 읽는다.
- `data.json`에는 `version` 필드를 둔다. 스키마를 바꾸면 version을 올리고 읽을 때 마이그레이션한다.

## 하지 말 것
- 데이터를 이 공개 레포에 커밋하지 않는다 (이 레포는 public).
- 외부 스크립트는 꼭 필요할 때만, 버전 고정해서.
- 아이폰/맥/윈도우 모두에서 쓰므로 모바일 폭(375px)에서 깨지지 않게.

## 커밋
- 커밋 메시지는 한국어, 무엇을 바꿨는지 한 줄.
