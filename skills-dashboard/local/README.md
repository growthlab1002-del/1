# 내 컴퓨터에서 쓰기 (Claude Code)

claude.ai 대시보드와 같은 화면을 내 컴퓨터에서 띄웁니다. 실행은 내 컴퓨터의 **Claude Code**가 맡아요.
지금 쓰시는 Claude 구독으로 돌아가고, API 키는 필요 없어요.

## claude.ai 버전과 다른 점

| | claude.ai | 내 컴퓨터 |
|---|---|---|
| 단계 실행 | Claude (claude.ai) | Claude Code (구독 사용량) |
| 스킬 스크립트 계산·검산 (`calc_quote.py` 등) | 안 됨 → 직접 계산 | **됨** |
| 엑셀·PPT 파일 만들기 | 안 됨 → 표로 | **됨** (프로젝트 폴더 `outputs/`) |
| 이미지·영상 미리보기 | 「열기」 링크만 | **화면 안에서 미리보기** |
| 생성 결과 저장 | 매그니픽·힉스필드에만 | **내 폴더 `media/`에도 자동 저장** |
| 프로젝트 저장 | claude.ai 계정 | 내 폴더 `~/SkillBoard/` |

두 버전의 프로젝트는 서로 이어지지 않아요.

## 1. 준비 (처음 한 번)

1. **Python 3.9 이상**을 설치해요. Mac은 이미 깔려 있는 경우가 많아요. 터미널에서 `python3 --version`으로 확인해요.
2. **Claude Code**를 설치하고 로그인해요. 설치는 https://code.claude.com 에서 할 수 있어요.
   설치 후 터미널에서 `claude`를 실행하면 Claude 구독 계정으로 로그인하는 화면이 나와요.
3. (선택) 견적 엑셀·제안서 PPT 파일까지 받으려면 다음을 설치해요.
   ```bash
   pip3 install openpyxl python-pptx Pillow
   ```
   안 깔아도 돌아가요. 이 경우 Claude가 설치를 한 번 시도하고, 안 되면 표로 대신 줘요.

## 2. 매그니픽·힉스필드 연결 (처음 한 번)

터미널에서 아래 두 줄을 실행해요.

```bash
claude mcp add --transport http --scope user higgsfield https://mcp.higgsfield.ai/mcp
claude mcp add --transport http --scope user magnific <매그니픽 MCP 주소>
```

- **매그니픽 주소 찾기:** claude.ai **설정 → 커넥터 → 매그니픽**에서 등록하신 주소를 그대로 복사해요. 공개 문서에서는 주소를 찾지 못했어요.
- **로그인:** `claude`를 실행하고 `/mcp`를 입력해요. `higgsfield`와 `magnific`을 하나씩 골라 로그인해요.
- **이름을 다르게 등록했다면:** 실행할 때 `--magnific-name 이름 --higgsfield-name 이름`을 붙여요.

## 3. 실행

```bash
python3 skills-dashboard/local/serve.py --pack ~/Downloads/wadiz-skills-pack.zip
```

- 브라우저에 `http://127.0.0.1:8787` 이 자동으로 열려요. 이 컴퓨터 안에서만 열리는 주소예요.
- 끌 때는 터미널에서 `Ctrl+C`를 눌러요.
- 실행 옵션
  - `--home 폴더`: 저장 폴더를 바꿔요(기본 `~/SkillBoard`).
  - `--port 번호`: 주소의 포트를 바꿔요(기본 8787).
  - `--no-browser`: 브라우저를 자동으로 열지 않아요.

쓰는 법은 claude.ai 버전과 같아요. 상위 폴더의 [README](../README.md)를 보세요.

## 파일이 생기는 곳

```
~/SkillBoard/
  projects/<프로젝트>/
    outputs/   Claude가 만든 파일 (견적 엑셀, 제안서 PPT, 캘린더 CSV …)
    media/     매그니픽·힉스필드 결과 (씬1_이미지_….png, 씬1_영상_….mp4)
    exports/   내보내기 .md
    inputs/    대화에 첨부한 이미지
  skills/      스킬 팩에서 풀어 둔 스킬 (스크립트 실행용)
  data/        프로젝트 진행 상태
```

## 알아 둘 것

- **허용 범위:** Claude Code에는 각 단계에서 파일 읽기·쓰기와 `python3`·`pip install`·`ls`·`mkdir` 실행만 허용해요. 다른 명령은 실행하지 않아요. 작업은 그 프로젝트 폴더 안에서 해요.
- **크레딧:** 매그니픽·힉스필드 생성은 크레딧을 써요. 만들기 전에 항상 개수와 예상 크레딧(힉스필드)을 확인받아요.
- **속도:** 매그니픽·힉스필드 호출은 Claude Code를 한 번씩 거쳐서, 호출마다 몇 초가 더 걸려요. 이 호출에는 빠른 모델(haiku)을 써요.
- **내 사진:** 내 컴퓨터 사진을 매그니픽·힉스필드에 바로 올리는 기능은 아직 없어요. 공개 이미지 주소를 「내 이미지를 링크로 추가」에 넣어요.

## 문제가 생기면

| 화면 메시지 | 할 일 |
|---|---|
| Claude Code(claude)를 찾지 못했어요 | Claude Code를 설치하고 터미널을 새로 연 뒤 다시 실행해요 |
| Claude Code 로그인이 필요해요 | 터미널에서 `claude`를 실행해 로그인해요 |
| Claude Code에 "magnific"(또는 "higgsfield") 연결이 없어요 | 위 2번의 `claude mcp add`를 실행해요 |
| "…" 로그인이 필요해요 | `claude` 실행 후 `/mcp`에서 해당 연결에 로그인해요 |
