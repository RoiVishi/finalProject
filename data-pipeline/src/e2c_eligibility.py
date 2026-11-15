"""Advisor feedback (8.11.2026) — E2c: data facts for the label and freeze decisions. No model is trained.

1  Item 6 — the E2 rule for overwritten plans (planned start AND finish equal the actual ones on
   >= 90% of a project's completed activities) was applied to BHD only. Here the same rule, with
   the same threshold, is applied to DSLIB.
   Also reported, without dropping anything: projects where one ratio value covers >= 90% of the
   activities (for example every activity exactly 20% longer than planned).
2  Item 6 — the continuous label the advisor mentions: ratio = actual / planned duration, in working
   days in both corpora (DSLIB: from the ETL; BHD: counted on each activity's own P6 calendar, as
   in E2b). Per project: activities with a ratio, share exactly at 1.0, comparable pairs.
   Note: this BHD ratio differs from the one summarised in E2b (calendar days, same-day activities
   left out; median 1.60). Here a one-day activity counts as 1 working day, as in DSLIB.
3  Item 9 — projects eligible for a within-project metric under each label:
     grew      the rule used so far: >= 30 activities and >= 5 in each class;
     ratio_A   >= 30 activities with a ratio (no class condition);
     ratio_B   ratio_A and >= 125 comparable pairs.
   A comparable pair is two activities of the same project with DIFFERENT ratios: only such a pair
   can show whether a model ranks them in the right order. 125 = 5 x 25 is the smallest number of
   pairs the `grew` rule allows, so ratio_B asks for the same minimum information.
   The tolerance label (> 20% AND >= 2 working days) is counted too, for reference only: its count
   was quoted in the question sent to the advisor.
4  Item 9 — the freeze as proposed to the advisor: whole DSLIB families are drawn in random order
   until the frozen set holds >= 15 projects. Simulated 20,000 times to see how many eligible
   projects land in it. NOTHING IS FROZEN HERE; this only informs the decision.

Reads outputs/corpus_v3_clean.csv (E2), outputs/dslib_labeled_tasks.csv, outputs/project_families.json
and the raw BHD tables in data_bhd/ (not in git).
Writes outputs/e2c_eligibility.json and outputs/dslib_overwritten_projects.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from buildings import dslib_buildings  # noqa: E402
from e2_data_audit import OVERWRITTEN_SHARE, RAW_BHD, read_bhd  # noqa: E402
from e2b_followups import tolerance_label  # noqa: E402
from p6_calendar import load_calendars, working_days  # noqa: E402
from train_compare import MIN_LABELED, SEED  # noqa: E402

OUT = HERE.parent / "outputs"
MIN_CLASS = 5                                             # the `grew` rule: >= 5 activities in each class
MIN_PAIRS = MIN_CLASS * (MIN_LABELED - MIN_CLASS)         # 125: the fewest pairs the `grew` rule allows
FREEZE_MIN_PROJECTS = 15                                  # the advisor: at least 15 DSLIB building projects
N_DRAWS = 20_000
SINGLE_RATIO_SHARE = 0.90                                 # reporting only: one ratio value on this share of a project
RULES = ["grew", "tolerance", "ratio_A", "ratio_B"]


# ---------------------------------------------------------------- rows of the cleaned corpus
def dslib_rows(clean: pd.DataFrame) -> pd.DataFrame:
    """Labelled DSLIB activities of the cleaned corpus, with dates and working-day durations."""
    ds = dslib_buildings(pd.read_csv(OUT / "dslib_labeled_tasks.csv", low_memory=False))
    ds = ds.assign(project="dslib::" + ds["project"].astype(str))
    keys = clean.loc[clean["source"] == "dslib", ["project", "task_id", "grew"]]
    d = keys.merge(ds.drop(columns=["grew"]), on=["project", "task_id"], how="left", validate="one_to_one")
    for c in ["baseline_start", "baseline_end", "actual_start", "actual_end"]:
        d[c] = pd.to_datetime(d[c], errors="coerce").dt.normalize()
    return pd.DataFrame({
        "project": d["project"], "source": "dslib", "task_id": d["task_id"], "grew": d["grew"].astype(int),
        "planned_wd": d["planned_duration_wd"], "actual_wd": d["actual_duration_wd"],
        "start_equal": d["baseline_start"] == d["actual_start"],
        "finish_equal": d["baseline_end"] == d["actual_end"]})


def bhd_rows(clean: pd.DataFrame) -> pd.DataFrame:
    """Labelled BHD activities of the cleaned corpus, working days counted on their P6 calendars."""
    keys = clean.loc[clean["source"] == "own", ["project", "task_id", "grew"]]
    parts = []
    for proj in sorted(keys["project"].unique()):
        name = proj.removeprefix("own::")
        raw = read_bhd(name).drop(columns=["grew"])
        g = keys[keys["project"] == proj].merge(raw, on=["project", "task_id"], how="left", validate="one_to_one")
        cals = load_calendars(RAW_BHD / name / "CALENDAR.csv")
        parts.append(pd.DataFrame({
            "project": proj, "source": "own", "task_id": g["task_id"], "grew": g["grew"].astype(int),
            "planned_wd": working_days(g["target_start_date"], g["target_end_date"], g["clndr_id"], cals),
            "actual_wd": working_days(g["act_start_date"], g["act_end_date"], g["clndr_id"], cals),
            "start_equal": g["target_start_date"] == g["act_start_date"],
            "finish_equal": g["target_end_date"] == g["act_end_date"]}))
    return pd.concat(parts, ignore_index=True)


def add_labels(rows: pd.DataFrame) -> pd.DataFrame:
    rows = rows.copy()
    ok = rows["planned_wd"] > 0           # BHD: 0 when the planned dates hold no working day of the calendar
    rows["ratio"] = (rows["actual_wd"] / rows["planned_wd"]).where(ok & rows["actual_wd"].notna())
    rows["tolerance"] = tolerance_label(rows["actual_wd"], rows["planned_wd"]).where(ok)
    return rows


# ---------------------------------------------------------------- 1: overwritten plans
def overwritten(rows: pd.DataFrame) -> dict:
    """Per project: share of labelled activities whose planned start and finish both equal the actual
    ones. Same definition and threshold as e2_data_audit.overwritten_table (E2, BHD)."""
    out = {}
    for p, g in rows.groupby("project"):
        both = g["start_equal"] & g["finish_equal"]
        out[p] = {"n": int(len(g)), "grew_rate": round(float(g["grew"].mean()), 3),
                  "planned_start_equals_actual": round(float(g["start_equal"].mean()), 3),
                  "planned_finish_equals_actual": round(float(g["finish_equal"].mean()), 3),
                  "both_equal": round(float(both.mean()), 3),
                  "labels_invalid": bool(both.mean() >= OVERWRITTEN_SHARE)}
    return out


# ---------------------------------------------------------------- 2-3: ratio and eligibility
def comparable_pairs(values: pd.Series) -> int:
    """Pairs of activities with different values = all pairs minus the pairs tied on the value."""
    v = values.dropna()
    n = len(v)
    tied = int(sum(c * (c - 1) // 2 for c in v.value_counts()))
    return n * (n - 1) // 2 - tied


def project_table(rows: pd.DataFrame) -> pd.DataFrame:
    recs = []
    for p, g in rows.groupby("project"):
        r, t = g["ratio"].dropna(), g["tolerance"].dropna()
        pos, tpos = int(g["grew"].sum()), int(t.sum())
        pairs = comparable_pairs(r)
        top = r.round(4).value_counts()
        recs.append({
            "project": p, "source": g["source"].iloc[0], "activities": int(len(g)),
            "grew_pos": pos, "grew_neg": int(len(g) - pos),
            "tolerance_pos": tpos, "tolerance_neg": int(len(t) - tpos),
            "with_ratio": int(len(r)),
            "ratio_median": round(float(r.median()), 3) if len(r) else None,
            "share_ratio_exactly_1": round(float((r == 1).mean()), 3) if len(r) else None,
            "most_common_ratio": float(top.index[0]) if len(r) else None,
            "share_at_most_common_ratio": round(float(top.iloc[0] / len(r)), 3) if len(r) else None,
            "comparable_pairs": pairs,
            "eligible_grew": bool(len(g) >= MIN_LABELED and min(pos, len(g) - pos) >= MIN_CLASS),
            "eligible_tolerance": bool(len(t) >= MIN_LABELED and min(tpos, len(t) - tpos) >= MIN_CLASS),
            "eligible_ratio_A": bool(len(r) >= MIN_LABELED),
            "eligible_ratio_B": bool(len(r) >= MIN_LABELED and pairs >= MIN_PAIRS)})
    return pd.DataFrame(recs)


def eligibility_counts(table: pd.DataFrame) -> dict:
    return {rule: {"dslib": int(table.loc[table["source"] == "dslib", f"eligible_{rule}"].sum()),
                   "bhd": int(table.loc[table["source"] == "own", f"eligible_{rule}"].sum()),
                   "projects": sorted(table.loc[table[f"eligible_{rule}"], "project"])}
            for rule in RULES}


def ratio_summary(rows: pd.DataFrame) -> dict:
    out = {}
    for s, g in rows.groupby("source"):
        r = g["ratio"].dropna()
        out["bhd" if s == "own" else s] = {
            "activities": int(len(g)), "with_ratio": int(len(r)),
            "median": round(float(r.median()), 3),
            "q25_q75": [round(float(v), 3) for v in r.quantile([0.25, 0.75])],
            "share_below_1": round(float((r < 1).mean()), 3),
            "share_exactly_1": round(float((r == 1).mean()), 3),
            "share_above_1": round(float((r > 1).mean()), 3),
            "planned_under_1_working_day": int((g["planned_wd"].between(0, 1, inclusive="neither")).sum())}
    return out


# ---------------------------------------------------------------- 4: freeze simulation
def simulate_freeze(table: pd.DataFrame, fam: dict, n_draws: int = N_DRAWS, seed: int = SEED) -> dict:
    """Draw DSLIB families in random order until the frozen set has >= FREEZE_MIN_PROJECTS projects;
    count the eligible projects in it under each rule. Nothing is frozen: this is a simulation."""
    ds = table[table["source"] == "dslib"].set_index("project")
    members: dict[str, list[str]] = {}
    for p in ds.index:
        members.setdefault(fam[p], []).append(p)
    families = sorted(members)
    rng = np.random.default_rng(seed)
    recs = []
    for _ in range(n_draws):
        chosen: list[str] = []
        n_fam = 0
        for i in rng.permutation(len(families)):
            chosen += members[families[i]]
            n_fam += 1
            if len(chosen) >= FREEZE_MIN_PROJECTS:
                break
        rec = {"families": n_fam, "projects": len(chosen)}
        for rule in RULES:
            rec[rule] = int(ds.loc[chosen, f"eligible_{rule}"].sum())
        recs.append(rec)
    sim = pd.DataFrame(recs)
    out = {"draws": n_draws, "seed": seed, "dslib_projects": int(len(ds)), "dslib_families": len(families),
           "frozen_families_mean": round(float(sim["families"].mean()), 1),
           "frozen_projects_mean": round(float(sim["projects"].mean()), 1), "eligible_in_frozen_set": {}}
    for rule in RULES:
        total = int(ds[f"eligible_{rule}"].sum())
        out["eligible_in_frozen_set"][rule] = {
            "eligible_dslib_projects_in_total": total,
            "mean": round(float(sim[rule].mean()), 1),
            "q25_median_q75": [int(v) for v in sim[rule].quantile([0.25, 0.5, 0.75])],
            "left_for_development_mean": round(float(total - sim[rule].mean()), 1),
            "share_of_draws_with_at_least": {str(k): round(float((sim[rule] >= k).mean()), 2) for k in (4, 5, 6, 8)}}
    return out


# ---------------------------------------------------------------- main
def main() -> int:
    clean = pd.read_csv(OUT / "corpus_v3_clean.csv", low_memory=False)
    fam = json.loads((OUT / "project_families.json").read_text())
    rows = add_labels(pd.concat([dslib_rows(clean), bhd_rows(clean)], ignore_index=True))
    assert len(rows) == len(clean), "every row of the cleaned corpus must be found in its source table"

    over = overwritten(rows)
    dropped = sorted(p for p, r in over.items() if r["labels_invalid"] and p.startswith("dslib::"))
    bhd_flagged = sorted(p for p, r in over.items() if r["labels_invalid"] and p.startswith("own::"))
    kept = rows[~rows["project"].isin(dropped)]

    def counts(r: pd.DataFrame) -> dict:
        return {("bhd" if s == "own" else s): {
                    "projects": int(g["project"].nunique()), "activities": int(len(g)),
                    "families": int(len({fam[p] for p in g["project"].unique()})),
                    "grew_rate": round(float(g["grew"].mean()), 3)} for s, g in r.groupby("source")} | {
                "all": {"projects": int(r["project"].nunique()), "activities": int(len(r)),
                        "families": int(len({fam[p] for p in r["project"].unique()}))}}

    table_before, table = project_table(rows), project_table(kept)
    result = {
        "config": {
            "overwritten_rule": f"planned start and finish both equal the actual ones on >= {OVERWRITTEN_SHARE:.0%} "
                                "of the project's labelled activities (the E2 rule, unchanged)",
            "ratio": "actual / planned duration in working days; DSLIB from the ETL, BHD on the P6 calendars; "
                     "defined when the planned duration is > 0",
            "eligibility": {
                "grew": f">= {MIN_LABELED} activities and >= {MIN_CLASS} in each class",
                "tolerance": "same rule on the tolerance label (> 20% and >= 2 working days); reference only",
                "ratio_A": f">= {MIN_LABELED} activities with a ratio",
                "ratio_B": f"ratio_A and >= {MIN_PAIRS} comparable pairs (pairs with different ratios)"},
            "freeze_simulation": f"whole DSLIB families in random order until >= {FREEZE_MIN_PROJECTS} projects",
            "families": "outputs/project_families.json"},
        "1_overwritten_plans": {
            "dslib_projects_dropped": dropped,
            "bhd_projects_meeting_the_rule": bhd_flagged,   # expected empty: E2 already dropped them
            "dslib_by_project": {p: r for p, r in over.items() if p.startswith("dslib::") and r["both_equal"] >= 0.5}},
        "1b_single_ratio_projects": {
            "what": f"projects left in the corpus where one ratio value covers >= {SINGLE_RATIO_SHARE:.0%} of the "
                    "activities; they carry almost no ranking information. Reported, NOT dropped.",
            "projects": table.loc[(table["with_ratio"] >= 10) & (table["share_at_most_common_ratio"] >= SINGLE_RATIO_SHARE),
                                  ["project", "activities", "most_common_ratio", "share_at_most_common_ratio",
                                   "grew_pos", "comparable_pairs"]].to_dict("records")},
        "2_corpus_counts": {"before": counts(rows), "after_dropping_dslib_overwritten": counts(kept)},
        "3_ratio": ratio_summary(kept),
        "4_eligible_projects": {"before": {k: {s: v[s] for s in ("dslib", "bhd")}
                                           for k, v in eligibility_counts(table_before).items()},
                                "after_dropping_dslib_overwritten": eligibility_counts(table)},
        "5_freeze_simulation": simulate_freeze(table, fam),
        "per_project": table.sort_values(["source", "project"]).to_dict("records"),
    }
    (OUT / "e2c_eligibility.json").write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
    (OUT / "dslib_overwritten_projects.json").write_text(json.dumps(
        {"rule": result["config"]["overwritten_rule"], "projects": dropped}, indent=1, ensure_ascii=False) + "\n")

    print("DSLIB projects meeting the overwritten-plan rule:", len(dropped))
    print("single-ratio projects (reported, not dropped):",
          [(r["project"], r["most_common_ratio"], r["share_at_most_common_ratio"])
           for r in result["1b_single_ratio_projects"]["projects"]])
    print("corpus after dropping them:", result["2_corpus_counts"]["after_dropping_dslib_overwritten"])
    print("ratio:", json.dumps(result["3_ratio"]))
    for rule, v in result["4_eligible_projects"]["after_dropping_dslib_overwritten"].items():
        print(f"eligible under {rule}: DSLIB {v['dslib']}, BHD {v['bhd']}")
    for rule, v in result["5_freeze_simulation"]["eligible_in_frozen_set"].items():
        print(f"frozen set, {rule}: mean {v['mean']}, quartiles {v['q25_median_q75']}, "
              f"P(>=6) {v['share_of_draws_with_at_least']['6']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
