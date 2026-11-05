"""한국 공휴일 계산 (현행 「관공서의 공휴일에 관한 규정」 기준).

- 음력 공휴일(설날·부처님오신날·추석)은 korean_lunar_calendar로 양력 변환
- 대체공휴일 규칙
  * 설날·추석 연휴: 연휴 중 일요일 또는 다른 공휴일과 겹치면 연휴 다음 첫 평일
  * 어린이날: 토·일 또는 다른 공휴일과 겹치면 다음 첫 평일
  * 3·1절, 광복절, 개천절, 한글날, 부처님오신날, 성탄절: 토·일이면 다음 첫 평일
  * 신정, 현충일: 대체공휴일 없음
선거일·임시공휴일은 지정 시 수동으로 추가해야 한다.
"""
from datetime import date, timedelta

from korean_lunar_calendar import KoreanLunarCalendar


def lunar_to_solar(year: int, month: int, day: int) -> date:
    cal = KoreanLunarCalendar()
    cal.setLunarDate(year, month, day, False)
    return date.fromisoformat(cal.SolarIsoFormat())


def solar_to_lunar(d: date) -> tuple[int, int, bool]:
    """(음력 월, 음력 일, 윤달 여부)"""
    cal = KoreanLunarCalendar()
    cal.setSolarDate(d.year, d.month, d.day)
    return cal.lunarMonth, cal.lunarDay, cal.isIntercalation


def korean_holidays(year: int) -> dict[date, str]:
    hol: dict[date, list[str]] = {}

    def add(d: date, name: str):
        hol.setdefault(d, []).append(name)

    seollal = lunar_to_solar(year, 1, 1)
    chuseok = lunar_to_solar(year, 8, 15)
    seollal_days = [seollal - timedelta(1), seollal, seollal + timedelta(1)]
    chuseok_days = [chuseok - timedelta(1), chuseok, chuseok + timedelta(1)]

    add(date(year, 1, 1), "신정")
    for d, n in zip(seollal_days, ["설날 연휴", "설날", "설날 연휴"]):
        add(d, n)
    add(date(year, 3, 1), "삼일절")
    add(date(year, 5, 5), "어린이날")
    buddha = lunar_to_solar(year, 4, 8)
    add(buddha, "부처님오신날")
    add(date(year, 6, 6), "현충일")
    add(date(year, 8, 15), "광복절")
    for d, n in zip(chuseok_days, ["추석 연휴", "추석", "추석 연휴"]):
        add(d, n)
    add(date(year, 10, 3), "개천절")
    add(date(year, 10, 9), "한글날")
    add(date(year, 12, 25), "성탄절")

    base = set(hol)

    def next_free_weekday(after: date, taken: set[date]) -> date:
        d = after + timedelta(1)
        while d.weekday() >= 5 or d in taken:
            d += timedelta(1)
        return d

    subs: dict[date, str] = {}
    taken = set(base)

    # 설날·추석: 일요일 또는 다른 공휴일과 겹침
    for days, name in [(seollal_days, "설날"), (chuseok_days, "추석")]:
        overlap = any(d.weekday() == 6 for d in days) or any(len(hol[d]) > 1 for d in days)
        if overlap:
            s = next_free_weekday(days[-1], taken)
            subs[s] = f"대체공휴일({name})"
            taken.add(s)

    # 어린이날: 토·일 또는 다른 공휴일과 겹침
    cd = date(year, 5, 5)
    if cd.weekday() >= 5 or len(hol[cd]) > 1:
        s = next_free_weekday(cd, taken)
        subs[s] = "대체공휴일(어린이날)"
        taken.add(s)

    # 토·일 대체 대상 국경일 등
    for d, name in [
        (date(year, 3, 1), "삼일절"),
        (date(year, 8, 15), "광복절"),
        (date(year, 10, 3), "개천절"),
        (date(year, 10, 9), "한글날"),
        (buddha, "부처님오신날"),
        (date(year, 12, 25), "성탄절"),
    ]:
        if d.weekday() >= 5:
            s = next_free_weekday(d, taken)
            subs[s] = f"대체공휴일({name})"
            taken.add(s)

    out = {d: "·".join(names) for d, names in hol.items()}
    out.update(subs)
    return dict(sorted(out.items()))


# 공휴일은 아니지만 달력에 표시할 기념일
ANNIVERSARIES = {
    (2, 14): "발렌타인데이",
    (3, 14): "화이트데이",
    (5, 1): "근로자의 날",
    (5, 8): "어버이날",
    (5, 15): "스승의 날",
    (11, 11): "빼빼로데이",
    (12, 31): "연말",
}


if __name__ == "__main__":
    import sys

    y = int(sys.argv[1]) if len(sys.argv) > 1 else 2027
    wd = "월화수목금토일"
    for d, n in korean_holidays(y).items():
        print(d, wd[d.weekday()], n)
