"""p6_calendar: week parsing (incl. DEL padding), holidays, extra working days, inclusive counts."""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from p6_calendar import load_calendars, working_days  # noqa: E402

DAY = "(0||0(s|08:00|f|16:00)())"
# 6-day week: Sunday..Thursday + Saturday work, Friday (day 6) off, written with P6's DEL padding.
WEEK = "".join(f"(0||{d}()({DAY}))" if d != 6 else "(0||6()(\x7f\x7f  ))" for d in range(1, 8))
# 2010-04-01 (Thu, serial 40269) is a holiday; 2010-04-02 (Fri, serial 40270) is worked.
EXC = f"(0||0(d|40269)())(0||1(d|40270)({DAY}))"
DATA = f"(0||CalendarData()((0||DaysOfWeek()({WEEK}))(0||Exceptions()({EXC}))))"


def _cals(tmp_path):
    f = tmp_path / "CALENDAR.csv"
    pd.DataFrame({"clndr_id": [1], "clndr_name": ["six-day"], "base_clndr_id": [None],
                  "clndr_data": [DATA]}).to_csv(f, index=False)
    return load_calendars(f)


def test_week_and_exceptions(tmp_path):
    c = _cals(tmp_path)[1]
    assert c.workdays == ["Sun", "Mon", "Tue", "Wed", "Thu", "Sat"]
    assert [str(d) for d in c.holidays] == ["2010-04-01"]
    assert [str(d) for d in c.extra_workdays] == ["2010-04-02"]


def test_inclusive_working_day_count(tmp_path):
    cals = _cals(tmp_path)
    s = pd.Series(pd.to_datetime(["2010-03-28", "2010-03-26", "2010-03-25"]))   # Sun, Fri, Thu
    e = pd.Series(pd.to_datetime(["2010-03-28", "2010-03-27", "2010-04-03"]))   # Sun, Sat, Sat
    n = working_days(s, e, pd.Series([1, 1, 1]), cals)
    # one-day activity = 1; Fri+Sat -> only Sat = 1;
    # Thu 25 .. Sat 3 Apr: 10 days, minus Fri 26 (weekend), minus Thu 1 (holiday), Fri 2 worked -> 8
    assert n.tolist() == [1, 1, 8]
