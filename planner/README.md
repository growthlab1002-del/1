# 한국형 하이퍼링크 플래너 생성기

굿노트·노타빌리티용 하이퍼링크 PDF 다이어리를 코드로 생성합니다.

```bash
pip install reportlab korean_lunar_calendar
python3 make_planner.py 2027            # → output/2027_korean_planner_sample.pdf
```

## 구성 (437페이지, 링크 약 9,400개)
표지 → 연간 달력 → 공휴일 목록 → D-day·연간 목표 → [월간 → 주간 → 일간] × 12 → 부록(경조사·월급날 가계부·독서)

- 오른쪽 탭(연간 / 1~12월 / D-day / 부록)은 모든 페이지에서 동작
- 월간 날짜 → 일간, 주차(W01…) → 주간, 일간의 어제/내일/주간/월간 이동
- 음력 병기, 공휴일·대체공휴일 자동 계산(`holidays.py`, 현행 규정 기준)

## 파일
- `make_planner.py` — 레이아웃·링크 생성
- `holidays.py` — 공휴일·대체공휴일·음력 변환 (`python3 holidays.py 2027`로 확인)
- `fonts/` — 나눔고딕 (SIL OFL, 상업적 이용 가능)
