"""Primavera P6 calendars (CALENDAR.csv, field clndr_data) -> working-day counts.

Why (E2b, found in the manual check of item 6): the first working-day count for BHD assumed a
Friday + Saturday weekend. The P6 calendars of the projects say otherwise: most are 6-day weeks
(only Friday off) or 7-day calendars, and they list holidays. Each activity carries its own
calendar (TASK.clndr_id), so working days are counted with that calendar.

clndr_data format (P6 export):
  DaysOfWeek()( (0||1()(<periods>)) ... (0||7()(<periods>)) )   1 = Sunday ... 7 = Saturday;
                                                                  no periods = non-working day
  Exceptions()( (0||k(d|NNNNN)()) ... )                           NNNNN = days since 1899-12-30;
                                                                  no periods = holiday, periods =
                                                                  an extra working day
A calendar without a DaysOfWeek block inherits the week of its base calendar (base_clndr_id).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

P6_EPOCH = pd.Timestamp("1899-12-30")
DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]          # P6 day 1..7
NUMPY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]         # numpy weekmask order
_PAD = " \t\r\n\x7f"                                                   # P6 exports pad with DEL characters


@dataclass
class Calendar:
    name: str
    workdays: list[str]                       # e.g. ["Sun","Mon","Tue","Wed","Thu","Sat"]
    holidays: np.ndarray = field(default_factory=lambda: np.array([], dtype="datetime64[D]"))
    extra_workdays: np.ndarray = field(default_factory=lambda: np.array([], dtype="datetime64[D]"))

    @property
    def weekmask(self) -> str:
        return " ".join(d for d in NUMPY_ORDER if d in self.workdays)


def _week(data: str) -> list[str] | None:
    i = data.find("DaysOfWeek")
    if i < 0:
        return None
    body = data[i:]
    j = body.find("Exceptions")
    body = body[:j] if j > 0 else body
    days = []
    for d in range(1, 8):
        m = re.search(r"\(0\|\|%d\(\)\(" % d, body)
        if m and not body[m.end():].lstrip(_PAD).startswith(")"):
            days.append(DAY_NAMES[d - 1])
    return days


def _exceptions(data: str) -> tuple[list, list]:
    i = data.find("Exceptions")
    if i < 0:
        return [], []
    hol, extra = [], []
    for m in re.finditer(r"\(d\|(\d+)\)\(", data[i:]):
        date = P6_EPOCH + pd.Timedelta(days=int(m.group(1)))
        rest = data[i + m.end():i + m.end() + 200].lstrip(_PAD)
        (hol if rest.startswith(")") else extra).append(date)
    return hol, extra


def load_calendars(path) -> dict[int, Calendar]:
    c = pd.read_csv(path, low_memory=False)
    c.columns = [x.strip().lower() for x in c.columns]
    raw = {int(r.clndr_id): r for r in c.itertuples()}
    out: dict[int, Calendar] = {}

    def week_of(cid, depth=0):
        r = raw.get(cid)
        if r is None or depth > 5:
            return None
        w = _week(str(r.clndr_data))
        if w is None and pd.notna(getattr(r, "base_clndr_id", np.nan)):
            return week_of(int(r.base_clndr_id), depth + 1)
        return w

    for cid, r in raw.items():
        w = week_of(cid)
        if not w:
            continue
        hol, extra = _exceptions(str(r.clndr_data))
        cal = Calendar(str(r.clndr_name).strip(), w, np.array(hol, dtype="datetime64[D]"))
        ex = np.array(extra, dtype="datetime64[D]")
        # an "extra working day" only matters when it falls on a day the week does not already work
        cal.extra_workdays = ex[~np.is_busday(ex, weekmask=cal.weekmask)] if len(ex) else ex
        out[cid] = cal
    return out


def working_days(start: pd.Series, end: pd.Series, cal_id: pd.Series, cals: dict[int, Calendar]) -> pd.Series:
    """Working days from start to end, both included (a one-day activity = 1), on each row's calendar.
    NaN when a date or the calendar is missing."""
    out = pd.Series(np.nan, index=start.index)
    ok = start.notna() & end.notna() & cal_id.isin(list(cals))
    for cid, idx in cal_id[ok].groupby(cal_id[ok]).groups.items():
        cal = cals[int(cid)]
        a = start[idx].values.astype("datetime64[D]")
        b = (end[idx] + pd.Timedelta(days=1)).values.astype("datetime64[D]")
        n = np.busday_count(a, b, weekmask=cal.weekmask, holidays=cal.holidays)
        if len(cal.extra_workdays):
            ex = cal.extra_workdays
            n = n + np.array([((ex >= x) & (ex < y)).sum() for x, y in zip(a, b)])
        out[idx] = n
    return out
