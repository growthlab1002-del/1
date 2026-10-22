# 레퍼런스 수집기 (Aside CLI)

대시보드에서 만든 **제품 브리프**를 받아, Aside 브라우저 에이전트로 아래 사이트를 검색해 레퍼런스를 모읍니다.

| 소스 | 용도 |
|---|---|
| Pinterest | 광고 이미지 (제품 연출·구도·조명) |
| TVCF, Source Creative, Frameset, YouTube, Vimeo | 영상 구조·기획 (훅, 씬 구성, CTA) |

## 준비
1. Node.js 18 이상
2. Aside 앱 설치, 로그인, Aside CLI 설치 (`aside`가 터미널에서 실행돼야 함)
3. Pinterest·TVCF 등 로그인이 필요한 사이트는 Aside 브라우저에서 미리 로그인

## 흐름
1. 대시보드 → **제품으로 레퍼런스 찾기**에 제품 사진·정보 입력 → **분석하기**
2. 브리프를 확인·수정하고 저장 → **브리프 JSON 내려받기**
3. 이 저장소 폴더에서 실행:
   ```bash
   node collector/collect.mjs --brief ~/Downloads/brief-xxxx.json
   ```
4. 생성된 `refs.json`을 대시보드 **수집 결과 가져오기**로 올리면 카드가 쌓입니다.

## 옵션
```
--sources   pinterest,tvcf,sourcecreative,frameset,youtube,vimeo  (기본: 전체)
--limit     검색어당 개수 (기본 8)
--queries   소스당 검색어 수 (기본 2)
--out       결과 파일 (기본 refs.json, 이미 있으면 이어서 추가·중복 제외)
--timeout   Aside 1회 호출 제한 시간(초, 기본 300)
--aside-cmd Aside 실행 명령 템플릿
--mock      Aside 없이 가짜 결과로 동작 확인
```

## Aside 명령 맞추기
기본값은 `aside exec {prompt}` 입니다. 설치된 Aside 버전의 실제 명령은 먼저 확인하세요:
```bash
aside --help
```
다르다면 템플릿을 바꿔 실행합니다. `{prompt}` 자리에 지시문이 들어가고, 없으면 맨 뒤에 붙습니다.
```bash
ASIDE_CMD='aside run --json {prompt}' node collector/collect.mjs --brief brief.json
```
Aside 출력에서 JSON 배열을 찾지 못하면 원문을 `raw-<소스>-<시각>.txt`로 남기고 다음 소스로 넘어갑니다.

## 동작 확인
```bash
node collector/collect.mjs --brief collector/sample-brief.json --mock --out /tmp/refs.json
```
