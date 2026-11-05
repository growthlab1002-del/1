"""한국형 하이퍼링크 디지털 플래너 생성기 (굿노트·노타빌리티용 PDF).

사용법:  python3 make_planner.py [연도] [출력파일]
"""
import sys
from calendar import monthrange
from datetime import date, timedelta
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from holidays import ANNIVERSARIES, korean_holidays, solar_to_lunar

YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else 2027
OUT = sys.argv[2] if len(sys.argv) > 2 else f"output/{YEAR}_korean_planner_sample.pdf"

# ── 페이지 & 테마 ─────────────────────────────────────────────
W, H = 1180, 820  # 아이패드 가로 비율(약 1.44:1)
M = 36  # 바깥 여백
SIDEBAR = 74
CW = W - SIDEBAR  # 콘텐츠 영역 오른쪽 경계

C = {
    "bg": HexColor("#FBF8F3"),
    "paper": HexColor("#FFFFFF"),
    "ink": HexColor("#2F2B28"),
    "sub": HexColor("#8E867E"),
    "faint": HexColor("#BDB5AC"),
    "line": HexColor("#E6E0D7"),
    "accent": HexColor("#6F8F78"),  # 세이지
    "accent_l": HexColor("#E3ECE4"),
    "sun": HexColor("#D0574B"),
    "sat": HexColor("#4C78B0"),
    "hol_bg": HexColor("#FBEAE7"),
    "tab": [HexColor(h) for h in ["#E9E1D6", "#F0D9D2", "#F3E3C9", "#DCE7DA", "#D6E2EC"]],
}
WD = "월화수목금토일"

FD = Path(__file__).parent / "fonts"
pdfmetrics.registerFont(TTFont("R", str(FD / "NanumGothic-Regular.ttf")))
pdfmetrics.registerFont(TTFont("B", str(FD / "NanumGothic-Bold.ttf")))
pdfmetrics.registerFont(TTFont("EB", str(FD / "NanumGothic-ExtraBold.ttf")))

HOL = korean_holidays(YEAR)


def anniv(d: date):
    return ANNIVERSARIES.get((d.month, d.day))


def day_color(d: date):
    if d in HOL or d.weekday() == 6:
        return C["sun"]
    if d.weekday() == 5:
        return C["sat"]
    return C["ink"]


def lunar_str(d: date) -> str:
    m, dd, leap = solar_to_lunar(d)
    return f"{'윤' if leap else ''}{m}.{dd}"


# ── 페이지 키 ────────────────────────────────────────────────
def k_month(m):
    return f"m{m:02d}"


def k_day(d):
    return f"d{d.isoformat()}"


def k_week(i):
    return f"w{i:02d}"


# 주차: 1월 1일이 포함된 주(월요일 시작)를 W01로
first_monday = date(YEAR, 1, 1) - timedelta(date(YEAR, 1, 1).weekday())
WEEKS = []
d = first_monday
while d.year <= YEAR and not (d.year == YEAR and d > date(YEAR, 12, 31)):
    WEEKS.append(d)
    d += timedelta(7)


def week_index(day: date) -> int:
    return (day - first_monday).days // 7 + 1


# ── 캔버스 헬퍼 ──────────────────────────────────────────────
cv = canvas.Canvas(OUT, pagesize=(W, H))
cv.setTitle(f"{YEAR} 한국형 하이퍼링크 플래너 (샘플)")
cv.setAuthor("Planner Studio")


def link(key, x, y, w, h):
    cv.linkRect("", key, (x, y, x + w, y + h), relative=1, thickness=0)


def text(s, x, y, size=12, font="R", color=None, align="l"):
    cv.setFont(font, size)
    cv.setFillColor(color or C["ink"])
    if align == "c":
        cv.drawCentredString(x, y, s)
    elif align == "r":
        cv.drawRightString(x, y, s)
    else:
        cv.drawString(x, y, s)


def rrect(x, y, w, h, r=10, fill=None, stroke=None, lw=1):
    if fill is not None:
        cv.setFillColor(fill)
    if stroke is not None:
        cv.setStrokeColor(stroke)
        cv.setLineWidth(lw)
    cv.roundRect(x, y, w, h, r, fill=1 if fill is not None else 0, stroke=1 if stroke is not None else 0)


def hline(x1, x2, y, color=None, lw=0.8, dash=None):
    cv.setStrokeColor(color or C["line"])
    cv.setLineWidth(lw)
    cv.setDash(*(dash or []))
    cv.line(x1, y, x2, y)
    cv.setDash()


def checkbox(x, y, s=11):
    rrect(x, y, s, s, 2.5, stroke=C["faint"], lw=1)


TABS = [("연간", "year")] + [(f"{m}월", k_month(m)) for m in range(1, 13)] + [("D-day", "dday"), ("부록", "appx")]


def page(key, active=None):
    """새 페이지 시작: 배경 + 사이드 탭"""
    cv.setFillColor(C["bg"])
    cv.rect(0, 0, W, H, fill=1, stroke=0)
    cv.bookmarkPage(key)
    th = (H - 24) / len(TABS)
    for i, (label, tk) in enumerate(TABS):
        y = H - 12 - (i + 1) * th
        on = tk == active
        if i == 0 or i >= 13:
            col = C["tab"][0]
        else:
            col = C["tab"][1 + (i - 1) // 3]
        x = CW + (4 if on else 12)
        rrect(x, y + 2, W - x + 10, th - 4, 8, fill=C["accent"] if on else col)
        text(label, x + (W - x) / 2, y + th / 2 - 4.5, 12.5 if on else 12, "B", C["paper"] if on else C["ink"], "c")
        link(tk, CW, y, SIDEBAR, th)


def end():
    cv.showPage()


def header(title, subtitle=None, crumbs=()):
    text(title, M, H - M - 30, 30, "EB")
    if subtitle:
        text(subtitle, M + cv.stringWidth(title, "EB", 30) + 14, H - M - 28, 14, "R", C["sub"])
    # 오른쪽 상단 이동 버튼들
    x = CW - 20
    for label, key in reversed(crumbs):
        wdt = cv.stringWidth(label, "B", 12) + 22
        x -= wdt
        rrect(x, H - M - 34, wdt, 26, 13, fill=C["paper"], stroke=C["line"])
        text(label, x + wdt / 2, H - M - 25, 12, "B", C["ink"], "c")
        link(key, x, H - M - 34, wdt, 26)
        x -= 8


# ── 1. 표지 ─────────────────────────────────────────────────
def cover():
    page("cover", None)
    rrect(M, M, CW - 2 * M + 10, H - 2 * M, 22, fill=C["paper"], stroke=C["line"])
    cx = (CW + 10) / 2
    text("KOREAN HYPERLINK PLANNER", cx, H - 230, 14, "B", C["accent"], "c")
    text(str(YEAR), cx, H - 400, 150, "EB", C["ink"], "c")
    text("한국형 하이퍼링크 다이어리", cx, H - 460, 26, "B", C["ink"], "c")
    text("음력 · 공휴일 · 대체공휴일 · D-day · 생활 기록", cx, H - 495, 15, "R", C["sub"], "c")
    bw, bh = 200, 50
    rrect(cx - bw / 2, 190, bw, bh, 25, fill=C["accent"])
    text("시작하기  →", cx, 209, 17, "B", C["paper"], "c")
    link("year", cx - bw / 2, 190, bw, bh)
    text("SAMPLE · 오른쪽 탭과 날짜를 눌러 이동해 보세요", cx, 120, 12, "R", C["faint"], "c")
    end()


# ── 2. 연간 달력 ─────────────────────────────────────────────
def mini_month(m, x, y, w, h):
    """y = 상단 기준"""
    rrect(x, y - h, w, h, 12, fill=C["paper"], stroke=C["line"])
    text(f"{m}월", x + 14, y - 26, 16, "EB")
    link(k_month(m), x, y - 34, w, 34)
    cw = (w - 20) / 7
    for i, wd in enumerate(WD):
        col = C["sun"] if i == 6 else C["sat"] if i == 5 else C["sub"]
        text(wd, x + 10 + cw * i + cw / 2, y - 48, 8.5, "B", col, "c")
    first = date(YEAR, m, 1)
    rh = (h - 62) / 6
    for dd in range(1, monthrange(YEAR, m)[1] + 1):
        day = date(YEAR, m, dd)
        idx = first.weekday() + dd - 1
        r, c = divmod(idx, 7)
        cx = x + 10 + cw * c
        cy = y - 62 - rh * (r + 1)
        if day in HOL:
            cv.setFillColor(C["hol_bg"])
            cv.circle(cx + cw / 2, cy + rh / 2 + 1, min(cw, rh) / 2 - 1, fill=1, stroke=0)
        text(str(dd), cx + cw / 2, cy + rh / 2 - 3, 9.5, "B" if day in HOL else "R", day_color(day), "c")
        link(k_day(day), cx, cy, cw, rh)


def year_page():
    page("year", "year")
    header(f"{YEAR} 연간 달력", "월 이름 → 월간, 날짜 → 일간", [("공휴일 목록", "holidays"), ("D-day", "dday")])
    gx, gy = M, H - M - 60
    cols, rows = 4, 3
    gap = 14
    w = (CW - 20 - M - gap * (cols - 1)) / cols
    h = (gy - M - gap * (rows - 1)) / rows
    for m in range(1, 13):
        r, c = divmod(m - 1, cols)
        mini_month(m, gx + c * (w + gap), gy - r * (h + gap), w, h)
    end()


# ── 3. 공휴일 목록 ───────────────────────────────────────────
def holidays_page():
    page("holidays", "year")
    header(f"{YEAR} 공휴일 · 대체공휴일", f"총 {len(HOL)}일 (주말 포함)", [("← 연간", "year")])
    items = list(HOL.items())
    col_w = (CW - 20 - M - 20) / 2
    top = H - M - 80
    rh = 30
    per_col = (len(items) + 1) // 2
    for i, (d, name) in enumerate(items):
        c, r = divmod(i, per_col)
        x = M + c * (col_w + 20)
        y = top - r * rh
        is_sub = name.startswith("대체")
        rrect(x, y - rh + 4, col_w, rh - 4, 8, fill=C["hol_bg"] if is_sub else C["paper"], stroke=C["line"])
        text(f"{d.month}월 {d.day}일 ({WD[d.weekday()]})", x + 14, y - 18, 13, "B", day_color(d))
        text(name, x + 150, y - 18, 13, "B" if is_sub else "R")
        text(f"음 {lunar_str(d)}", x + col_w - 14, y - 18, 11, "R", C["sub"], "r")
        link(k_day(d), x, y - rh + 4, col_w, rh - 4)
    y = top - per_col * rh - 26
    text("※ 「관공서의 공휴일에 관한 규정」 현행 기준 자동 계산. 선거일·임시공휴일은 지정 시 추가됩니다.", M, y, 11, "R", C["sub"])
    text("※ 날짜를 누르면 해당 일간 페이지로 이동합니다.", M, y - 18, 11, "R", C["sub"])
    end()


# ── 4. D-day & 연간 목표 ─────────────────────────────────────
def dday_page():
    page("dday", "dday")
    header("D-day & 연간 목표", None, [("← 연간", "year")])
    top = H - M - 70
    lw = (CW - 20 - M) * 0.58
    # D-day 표
    rrect(M, M, lw, top - M, 14, fill=C["paper"], stroke=C["line"])
    text("D-DAY", M + 20, top - 32, 15, "EB", C["accent"])
    heads = [("이름", 20), ("날짜", lw * 0.48), ("누적일", lw * 0.68), ("D-", lw * 0.84)]
    for t, ox in heads:
        text(t, M + ox, top - 62, 11, "B", C["sub"])
    for i in range(int((top - 92 - M - 10) // 36) + 1):
        y = top - 92 - i * 36
        hline(M + 20, M + lw - 20, y, dash=[2, 3] if i else None)
    # 누적일 계산표
    rx = M + lw + 20
    rw = CW - 20 - rx
    th = 250
    rrect(rx, top - th, rw, th, 14, fill=C["accent_l"])
    text("D-day 계산 도우미", rx + 18, top - 30, 14, "EB")
    text("두 날짜의 '누적일' 차이 = 남은 날", rx + 18, top - 50, 10.5, "R", C["sub"])
    acc = 0
    for m in range(1, 13):
        r, c = divmod(m - 1, 2)
        x = rx + 18 + c * (rw / 2 - 10)
        y = top - 80 - r * 26
        text(f"{m}월 1일", x, y, 12, "B")
        text(f"{acc + 1}일째", x + 80, y, 12, "R", C["accent"])
        acc += monthrange(YEAR, m)[1]
    # 연간 목표
    gy = top - th - 16
    rrect(rx, M, rw, gy - M, 14, fill=C["paper"], stroke=C["line"])
    text(f"{YEAR} 연간 목표", rx + 18, gy - 30, 14, "EB")
    for i in range(7):
        y = gy - 62 - i * 34
        checkbox(rx + 18, y + 2)
        hline(rx + 38, rx + rw - 18, y)
    end()


# ── 5. 월간 ─────────────────────────────────────────────────
def month_page(m):
    page(k_month(m), k_month(m))
    prev_m, next_m = (m - 2) % 12 + 1, m % 12 + 1
    eng = ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"][m - 1]
    header(f"{m}월", f"{eng} {YEAR}", [(f"← {prev_m}월", k_month(prev_m)), (f"{next_m}월 →", k_month(next_m))])
    first = date(YEAR, m, 1)
    ndays = monthrange(YEAR, m)[1]
    nrows = (first.weekday() + ndays + 6) // 7
    top = H - M - 70
    gx = M + 40
    gw = (CW - 20 - M) * 0.76 - 40
    cw = gw / 7
    # 요일 헤더
    for i, wd in enumerate(WD):
        col = C["sun"] if i == 6 else C["sat"] if i == 5 else C["sub"]
        text(wd, gx + cw * i + 10, top - 14, 12, "B", col)
    gtop = top - 26
    rh = (gtop - M) / nrows
    rrect(gx, M, gw, gtop - M, 10, fill=C["paper"], stroke=C["line"])
    for r in range(nrows):
        monday = first - timedelta(first.weekday()) + timedelta(7 * r)
        wi = week_index(monday)
        y = gtop - rh * (r + 1)
        # 주차 버튼
        rrect(M, y + rh / 2 - 13, 34, 26, 8, fill=C["accent_l"])
        text(f"W{wi:02d}", M + 17, y + rh / 2 - 4, 10, "B", C["accent"], "c")
        link(k_week(wi), M, y + rh / 2 - 13, 34, 26)
        if r:
            hline(gx, gx + gw, y + rh)
        for c in range(7):
            day = monday + timedelta(c)
            x = gx + cw * c
            if c:
                cv.setStrokeColor(C["line"])
                cv.line(x, y, x, y + rh)
            if day.month != m:
                continue
            if day in HOL:
                cv.setFillColor(C["hol_bg"])
                cv.rect(x + 1, y + 1, cw - 2, rh - 2, fill=1, stroke=0)
            text(str(day.day), x + 10, y + rh - 22, 16, "EB", day_color(day))
            text(f"음 {lunar_str(day)}", x + cw - 8, y + rh - 19, 8.5, "R", C["faint"], "r")
            label = HOL.get(day) or anniv(day)
            if label:
                fs = 9 if len(label) <= 8 else 7.5
                text(label, x + 10, y + rh - 38, fs, "B" if day in HOL else "R",
                     C["sun"] if day in HOL else C["sub"])
            link(k_day(day), x, y, cw, rh)
    # 오른쪽 패널
    px = gx + gw + 16
    pw = CW - 20 - px
    ph = (gtop - M - 16) / 2
    rrect(px, gtop - ph, pw, ph, 10, fill=C["paper"], stroke=C["line"])
    text("이달의 목표", px + 14, gtop - 26, 13, "EB")
    for i in range(6):
        y = gtop - 56 - i * 30
        checkbox(px + 14, y + 2)
        hline(px + 32, px + pw - 14, y)
    rrect(px, M, pw, ph, 10, fill=C["paper"], stroke=C["line"])
    text("메모", px + 14, M + ph - 26, 13, "EB")
    for i in range(7):
        hline(px + 14, px + pw - 14, M + ph - 56 - i * 28)
    end()


# ── 6. 주간 ─────────────────────────────────────────────────
def week_page(i, monday):
    sunday = monday + timedelta(6)
    mid = monday + timedelta(3)
    mm = mid.month if mid.year == YEAR else (1 if mid.year < YEAR else 12)
    page(k_week(i), k_month(mm))
    crumbs = []
    if i > 1:
        crumbs.append(("← 지난주", k_week(i - 1)))
    crumbs.append((f"{mm}월", k_month(mm)))
    if i < len(WEEKS):
        crumbs.append(("다음주 →", k_week(i + 1)))
    header(f"W{i:02d}", f"{monday.month}.{monday.day} ({WD[0]}) – {sunday.month}.{sunday.day} ({WD[6]})", crumbs)
    top = H - M - 64
    gap = 12
    bw = (CW - 20 - M - gap * 3) / 4
    bh = (top - M - gap) / 2
    for k in range(8):
        r, c = divmod(k, 4)
        x = M + c * (bw + gap)
        y = top - (r + 1) * bh - r * gap
        rrect(x, y, bw, bh, 12, fill=C["paper"], stroke=C["line"])
        if k == 7:
            text("이번 주 할 일", x + 14, y + bh - 28, 14, "EB", C["accent"])
            for j in range(9):
                yy = y + bh - 58 - j * 30
                checkbox(x + 14, yy + 2)
                hline(x + 32, x + bw - 14, yy)
            continue
        day = monday + timedelta(k)
        in_year = day.year == YEAR
        if day in HOL:
            rrect(x, y + bh - 44, bw, 44, 12, fill=C["hol_bg"])
        text(f"{day.day}", x + 14, y + bh - 32, 22, "EB", day_color(day) if in_year else C["faint"])
        text(f"{WD[k]}요일", x + 14 + cv.stringWidth(str(day.day), "EB", 22) + 8, y + bh - 30, 12, "B",
             day_color(day) if in_year else C["faint"])
        label = HOL.get(day) or anniv(day)
        if label and in_year:
            text(label, x + bw - 12, y + bh - 30, 9 if len(label) <= 9 else 7.5, "B",
                 C["sun"] if day in HOL else C["sub"], "r")
        if in_year:
            if not label:
                text("일간 ›", x + bw - 12, y + bh - 30, 9, "R", C["faint"], "r")
            link(k_day(day), x, y + bh - 50, bw, 50)
        for j in range(8):
            hline(x + 14, x + bw - 14, y + bh - 76 - j * 30, dash=[2, 3])
    end()


# ── 7. 일간 ─────────────────────────────────────────────────
def day_page(day: date):
    wi = week_index(day)
    page(k_day(day), k_month(day.month))
    prev_d, next_d = day - timedelta(1), day + timedelta(1)
    crumbs = []
    if prev_d.year == YEAR:
        crumbs.append(("‹ 어제", k_day(prev_d)))
    crumbs += [(f"W{wi:02d}", k_week(wi)), (f"{day.month}월", k_month(day.month))]
    if next_d.year == YEAR:
        crumbs.append(("내일 ›", k_day(next_d)))
    title = f"{day.month}월 {day.day}일"
    text(title, M, H - M - 30, 30, "EB", day_color(day) if day.weekday() >= 5 or day in HOL else C["ink"])
    x = M + cv.stringWidth(title, "EB", 30) + 12
    text(f"{WD[day.weekday()]}요일", x, H - M - 28, 16, "B", day_color(day))
    x += cv.stringWidth(f"{WD[day.weekday()]}요일", "B", 16) + 14
    text(f"음력 {lunar_str(day)}", x, H - M - 28, 13, "R", C["sub"])
    x += cv.stringWidth(f"음력 {lunar_str(day)}", "R", 13) + 14
    label = HOL.get(day) or anniv(day)
    if label:
        lw_ = cv.stringWidth(label, "B", 12) + 20
        rrect(x, H - M - 33, lw_, 24, 12, fill=C["hol_bg"] if day in HOL else C["accent_l"])
        text(label, x + lw_ / 2, H - M - 25, 12, "B", C["sun"] if day in HOL else C["accent"], "c")
    doy = day.timetuple().tm_yday
    ndays = 366 if monthrange(YEAR, 2)[1] == 29 else 365
    text(f"{doy}일째 · {ndays - doy}일 남음", M, H - M - 52, 11, "R", C["faint"])
    # 헤더 버튼
    xb = CW - 20
    for lab, key in reversed(crumbs):
        wdt = cv.stringWidth(lab, "B", 12) + 22
        xb -= wdt
        rrect(xb, H - M - 34, wdt, 26, 13, fill=C["paper"], stroke=C["line"])
        text(lab, xb + wdt / 2, H - M - 25, 12, "B", C["ink"], "c")
        link(key, xb, H - M - 34, wdt, 26)
        xb -= 8

    top = H - M - 70
    gap = 14
    total = CW - 20 - M
    w1, w2 = total * 0.30, total * 0.36
    w3 = total - w1 - w2 - 2 * gap
    # 시간표
    rrect(M, M, w1, top - M, 12, fill=C["paper"], stroke=C["line"])
    text("TIME", M + 14, top - 26, 13, "EB", C["accent"])
    hours = list(range(6, 25))
    rh = (top - 46 - M - 8) / len(hours)
    for i, hr in enumerate(hours):
        y = top - 46 - (i + 1) * rh
        text(f"{hr:02d}", M + 14, y + rh / 2 - 4, 10, "B", C["sub"])
        hline(M + 40, M + w1 - 14, y, dash=[1, 3] if i < len(hours) - 1 else None)
    # 할 일
    x2 = M + w1 + gap
    ph = 140
    rrect(x2, top - ph, w2, ph, 12, fill=C["accent_l"])
    text("오늘의 우선순위 TOP 3", x2 + 14, top - 26, 13, "EB")
    for i in range(3):
        y = top - 58 - i * 30
        text(str(i + 1), x2 + 18, y + 3, 13, "EB", C["accent"])
        hline(x2 + 36, x2 + w2 - 14, y, color=C["paper"], lw=1.2)
    rrect(x2, M, w2, top - ph - gap - M, 12, fill=C["paper"], stroke=C["line"])
    ty = top - ph - gap
    text("TO-DO", x2 + 14, ty - 26, 13, "EB", C["accent"])
    n = int((ty - 50 - M) // 30)
    for i in range(n):
        y = ty - 54 - i * 30
        checkbox(x2 + 14, y + 2)
        hline(x2 + 32, x2 + w2 - 14, y)
    # 오른쪽: 지출 / 습관 / 한 줄 일기
    x3 = x2 + w2 + gap
    eh = 210
    rrect(x3, top - eh, w3, eh, 12, fill=C["paper"], stroke=C["line"])
    text("오늘의 지출", x3 + 14, top - 26, 13, "EB")
    text("금액", x3 + w3 - 14, top - 26, 10, "B", C["sub"], "r")
    for i in range(5):
        y = top - 56 - i * 28
        hline(x3 + 14, x3 + w3 - 14, y, dash=[2, 3])
    text("합계", x3 + 14, top - eh + 14, 11, "B", C["sub"])
    hy = top - eh - gap
    hh = 120
    rrect(x3, hy - hh, w3, hh, 12, fill=C["paper"], stroke=C["line"])
    text("습관 체크", x3 + 14, hy - 26, 13, "EB")
    habits = ["물 8잔", "운동", "독서", "영양제"]
    for i, hb in enumerate(habits):
        c, r = i % 2, i // 2
        xx = x3 + 14 + c * (w3 / 2 - 4)
        yy = hy - 58 - r * 30
        checkbox(xx, yy)
        text(hb, xx + 18, yy + 1, 11, "R")
    jy = hy - hh - gap
    rrect(x3, M, w3, jy - M, 12, fill=C["paper"], stroke=C["line"])
    text("한 줄 일기 · 감사", x3 + 14, jy - 26, 13, "EB")
    nlines = int((jy - 50 - M) // 28)
    for i in range(nlines):
        hline(x3 + 14, x3 + w3 - 14, jy - 54 - i * 28)
    end()


# ── 8. 부록 ─────────────────────────────────────────────────
APPX = [("경조사 기록", "appx"), ("월급날 가계부", "appx_budget"), ("독서 기록", "appx_book")]


def appx_header(title, key):
    crumbs = [(t, k) for t, k in APPX if k != key]
    header(title, "부록", crumbs)


def table(x, top, w, cols, nrows, rh=34):
    """cols: [(제목, 비율)]"""
    rrect(x, M, w, top - M, 12, fill=C["paper"], stroke=C["line"])
    cx = x + 16
    for t, ratio in cols:
        text(t, cx, top - 28, 11, "B", C["sub"])
        cx += (w - 32) * ratio
    hline(x + 12, x + w - 12, top - 40, color=C["faint"])
    for i in range(nrows):
        hline(x + 12, x + w - 12, top - 40 - (i + 1) * rh, dash=[2, 3])


def appx_pages():
    page("appx", "appx")
    appx_header("경조사 기록", "appx")
    top = H - M - 64
    table(M, top, CW - 20 - M,
          [("날짜", .12), ("이름", .16), ("관계", .12), ("내용(결혼·부고·돌 등)", .26), ("보낸 금액", .12), ("받은 금액", .12), ("메모", .10)],
          int((top - M - 50) // 34))
    end()

    page("appx_budget", "appx")
    appx_header("월급날 가계부", "appx_budget")
    top = H - M - 64
    lw = (CW - 20 - M) * 0.36
    rrect(M, top - 200, lw, 200, 12, fill=C["accent_l"])
    text("이번 달 수입", M + 16, top - 28, 13, "EB")
    for i, t in enumerate(["월급", "부수입", "기타", "합계"]):
        y = top - 64 - i * 34
        text(t, M + 16, y + 4, 12, "B" if t == "합계" else "R")
        hline(M + 80, M + lw - 16, y, color=C["paper"], lw=1.2)
    rrect(M, M, lw, top - 214 - M, 12, fill=C["paper"], stroke=C["line"])
    text("고정 지출", M + 16, top - 242, 13, "EB")
    for i, t in enumerate(["월세·관리비", "통신비", "보험", "구독", "대출 상환", "적금·투자", "부모님 용돈"]):
        y = top - 276 - i * 32
        text(t, M + 16, y + 4, 11.5, "R")
        hline(M + 110, M + lw - 16, y, dash=[2, 3])
    table(M + lw + 14, top, CW - 20 - M - lw - 14,
          [("날짜", .14), ("항목", .34), ("분류", .2), ("금액", .32)], int((top - M - 50) // 34))
    end()

    page("appx_book", "appx")
    appx_header("독서 기록", "appx_book")
    top = H - M - 64
    table(M, top, CW - 20 - M,
          [("완독일", .12), ("제목", .30), ("저자", .16), ("별점", .12), ("한 줄 평", .30)],
          int((top - M - 50) // 34))
    end()


# ── 빌드 ───────────────────────────────────────────────────
def build():
    Path(OUT).parent.mkdir(parents=True, exist_ok=True)
    cover()
    year_page()
    holidays_page()
    dday_page()
    days_done = set()
    for m in range(1, 13):
        month_page(m)
        for i, monday in enumerate(WEEKS, 1):
            mid = monday + timedelta(3)
            owner = mid.month if mid.year == YEAR else (1 if mid.year < YEAR else 12)
            if owner != m:
                continue
            week_page(i, monday)
            for k in range(7):
                day = monday + timedelta(k)
                if day.year == YEAR and day not in days_done:
                    day_page(day)
                    days_done.add(day)
    appx_pages()
    cv.save()
    print(f"saved {OUT}  ({cv.getPageNumber() - 1} pages)")


if __name__ == "__main__":
    build()
