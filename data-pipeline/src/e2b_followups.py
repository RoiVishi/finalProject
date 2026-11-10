"""Advisor feedback (8.11.2026) — E2b: places where E1/E2 departed from the advisor's instructions.

1  Item 9 — "compare every variant on the same fixed set of test projects". E2 compared E1 with the
   cleaned run although three things changed at once (rows cleaned, 2 projects dropped, family
   definition). Here each change is applied alone, with the SAME split seeds:
     R1  original rows, 66 projects, name families      (only the family definition changes vs E1)
     R2  original rows, 64 projects, name families      (only the 2 projects dropped vs R1)
     R3  cleaned rows,  64 projects, name families      (only the row cleaning vs R2; = E2)
   Within-project comparisons are reported on the projects eligible in ALL of R1..R3.
   Fixed test sets: every family of the 66-project map is assigned to one of 5 folds by a seeded
   permutation, 10 times (10 x 5-fold, each project tested 10 times). The assignment is computed
   ONCE and reused in R1..R3, so a project meets the same companions in train and test in every
   run; R2/R3 only remove rows. (A first version used 20 random GroupShuffleSplits per run; because
   the splits depend on the set of groups, dropping two projects re-drew every split and the
   split-to-split noise was as large as the effects being compared.)
4  Item 6 — every result also by source corpus (pooled AUC and within-project AUC).
5  Item 1(f) — top-10% table per project: activities, the project's grew rate, the grew rate of
   the 10% highest-scored activities, lift.
2  Item 3 — labelled share per project AND planned-position decile (BHD), with the status of the rest.
3  Item 6 — the two label definitions side by side: DSLIB calendar-day vs working-day `grew`;
   BHD calendar-day vs working-day `grew`, working days counted on each activity's own P6 calendar
   (p6_calendar.py: week and holidays); and the tolerance label the advisor suggests
   (> 20% AND >= 2 working days).
   A sample of activities where the definitions disagree is written for reading by hand.

6  Item 8 — all four baselines the advisor lists (planned duration, number of successors, project
   features only, source corpus only), each compared with the clean and the full model.
7  Item 2 — are BHD "planned" dates the original plan? Compared, task by task (task_code), between
   versions of the same project found in the raw data (baseline vs later update).
8  Item 6 — the continuous label the advisor mentions (actual / planned duration), summarised.
9  Item 3 — the advisor's hypothesis "only the fast activities of the late part had finished":
   among BHD activities that had STARTED by the data date, planned duration of the completed vs
   the still-running ones, per planned-position decile and per project.

Families: outputs/project_families.json as rebuilt in E2b (containment added to the rule).

Writes outputs/e2b_followups.json and outputs/e2b_label_disagreements_sample.csv.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from advisor_checks import SEED, TARGET, eligibility, paired, scores  # noqa: E402
from buildings import OWN_BUILDINGS, dslib_buildings  # noqa: E402
from e2_data_audit import WORK_TYPES, read_bhd  # noqa: E402
from train_compare import summarise_aucs  # noqa: E402

OUT = HERE.parent / "outputs"
VARIANTS = ["full", "clean", "duration", "successors", "project_only", "source"]
BASELINES = ["duration", "successors", "project_only", "source"]   # item 8: all four rule/simple baselines
N_FOLDS, N_REPEATS = 5, 10


def fold_plan(fam: dict) -> list[dict]:
    """N_REPEATS assignments family -> fold, fixed for every run."""
    families = sorted(set(fam.values()))
    plans = []
    for r in range(N_REPEATS):
        perm = np.random.default_rng(SEED + r).permutation(families)
        plans.append({f: i % N_FOLDS for i, f in enumerate(perm)})
    return plans
DROPPED = {"own::jumaira", "own::cairo alex-road"}


# ---------------------------------------------------------------- 1, 4, 5: same-split decomposition
def run(df: pd.DataFrame, fam: dict, plans: list[dict]) -> dict:
    """Family-level folds fixed by `plans`; returns per-project and per-source rows."""
    groups = df["project"].map(fam)
    proj_rows, pooled_rows = [], []
    splits = [(r * N_FOLDS + k, groups.map(plan) == k) for r, plan in enumerate(plans) for k in range(N_FOLDS)]
    for seed, is_test in splits:
        tr, te = df[~is_test], df[is_test]
        for v in VARIANTS:
            s = scores(v, tr, te)
            t = te.assign(_s=s)
            pooled_rows.append((seed, v, "all", roc_auc_score(t[TARGET], t["_s"])))
            for src, g in t.groupby("source"):
                if g[TARGET].nunique() == 2:
                    pooled_rows.append((seed, v, src, roc_auc_score(g[TARGET], g["_s"])))
            for proj, g in t.groupby("project"):
                if eligibility(g):
                    continue
                k = max(1, int(round(0.10 * len(g))))
                proj_rows.append((seed, v, proj, g["source"].iloc[0], len(g), roc_auc_score(g[TARGET], g["_s"]),
                                  float(g[TARGET].mean()), float(g.nlargest(k, "_s")[TARGET].mean())))
    pp = pd.DataFrame(proj_rows, columns=["seed", "variant", "project", "source", "n_test", "auc",
                                          "base_rate", "top10_rate"])
    po = pd.DataFrame(pooled_rows, columns=["seed", "variant", "source", "auc"])
    per_project = pp.groupby(["variant", "project", "source"], as_index=False)[
        ["n_test", "auc", "base_rate", "top10_rate"]].mean()
    return {"per_project": per_project, "pooled": po,
            "projects_by_source": df.groupby("source")["project"].nunique().to_dict()}


def summarise_run(r: dict, common: list[str]) -> dict:
    pp = r["per_project"][r["per_project"]["project"].isin(common)]
    out = {}
    for v in VARIANTS:
        x = pp[pp["variant"] == v]
        out[v] = {
            "within_common": summarise_aucs(x["auc"]),
            "within_by_source": {s: summarise_aucs(g["auc"]) for s, g in x.groupby("source")},
            "pooled_median_by_source": r["pooled"][r["pooled"]["variant"] == v]
                .groupby("source")["auc"].median().round(4).to_dict(),
            "pooled_projects_by_source": r["projects_by_source"],
        }
    a = lambda v: pp[pp["variant"] == v].set_index("project")["auc"]  # noqa: E731
    out["paired_common"] = {**{f"clean - {b}": paired(a("clean"), a(b)) for b in BASELINES},
                            **{f"full - {b}": paired(a("full"), a(b)) for b in BASELINES},
                            "clean - full": paired(a("clean"), a("full"))}
    meds = {b: out[b]["within_common"]["median_auc"] for b in BASELINES}
    out["strongest_baseline_by_median"] = max(meds, key=meds.get)
    return out


def top10_table(r: dict) -> list[dict]:
    pp = r["per_project"]
    rows = []
    for proj, g in pp.groupby("project"):
        row = {"project": proj, "source": g["source"].iloc[0], "test_activities_mean": round(float(g["n_test"].iloc[0]), 1),
               "project_grew_rate": round(float(g["base_rate"].iloc[0]), 3)}
        for v in VARIANTS:
            gv = g[g["variant"] == v]
            if len(gv):
                row[f"top10_grew_rate_{v}"] = round(float(gv["top10_rate"].iloc[0]), 3)
                row[f"lift_{v}"] = round(float(gv["top10_rate"].iloc[0] / max(gv["base_rate"].iloc[0], 1e-9)), 2)
        rows.append(row)
    return sorted(rows, key=lambda x: (x["source"], x["project"]))


# ---------------------------------------------------------------- 2: survivorship per project x decile
def survivorship_by_project(bhd: pd.DataFrame) -> dict:
    work = bhd[bhd["task_type"].isin(WORK_TYPES) & (bhd["planned_hr"] > 0)].copy()
    work["decile"] = (work["rel_position"].clip(0, 0.9999) * 10).astype(int) * 10
    out = {}
    for p, g in work.groupby("project"):
        t = g.groupby("decile").agg(
            activities=("status", "size"),
            labelled=("grew", lambda s: int(s.notna().sum())),
            running=("status", lambda s: int((s == "TK_Active").sum())),
            running_known_overrun=("running_overrun_known", "sum"),
            not_started=("status", lambda s: int((s == "TK_NotStart").sum())),
            grew_rate_labelled=("grew", "mean"))
        t["labelled_share"] = (t["labelled"] / t["activities"]).round(3)
        t["grew_rate_labelled"] = t["grew_rate_labelled"].round(3)
        out[p] = {f"{d}-{d + 10}%": {k: (None if pd.isna(v) else (int(v) if k != "labelled_share" and
                                                                     k != "grew_rate_labelled" else float(v)))
                                     for k, v in r.items()} for d, r in t.iterrows()}
    return out


# ---------------------------------------------------------------- 3: label definitions side by side
def busdays(a: pd.Series, b: pd.Series, weekmask: str) -> pd.Series:
    """Working days from a to b inclusive of the start day, like a one-day activity = 1."""
    ok = a.notna() & b.notna()
    out = pd.Series(np.nan, index=a.index)
    out[ok] = np.busday_count(a[ok].values.astype("datetime64[D]"),
                              (b[ok] + pd.Timedelta(days=1)).values.astype("datetime64[D]"), weekmask=weekmask)
    return out


def tolerance_label(actual: pd.Series, planned: pd.Series) -> pd.Series:
    """Advisor's suggestion (item 6): overrun of more than 20% AND at least 2 working days."""
    over = actual - planned
    return ((over > 0.20 * planned) & (over >= 2)).astype(float).where(actual.notna() & planned.notna())


def label_definitions(bhd: pd.DataFrame, ds: pd.DataFrame, clean_projects: set[str]) -> tuple[dict, pd.DataFrame]:
    res = {}
    # DSLIB: the ETL already has both units
    d = ds[ds["grew"].notna() & (ds["planned_duration_wd"] > 0)].copy()
    d["project"] = "dslib::" + d["project"].astype(str)
    a0, a1 = pd.to_datetime(d["actual_start"]), pd.to_datetime(d["actual_end"])
    d["grew_wd"] = d["grew"]
    d["grew_cal"] = ((a1 - a0).dt.days > d["planned_duration_days"]).astype(float)
    d["tol_wd"] = tolerance_label(d["actual_duration_wd"], d["planned_duration_wd"])
    res["dslib"] = {"n": int(len(d)), "grew_working_days": round(float(d["grew_wd"].mean()), 3),
                    "grew_calendar_days": round(float(d["grew_cal"].mean()), 3),
                    "agreement_cal_vs_wd": round(float((d["grew_wd"] == d["grew_cal"]).mean()), 3),
                    "tolerance_label_rate": round(float(d["tol_wd"].mean()), 3),
                    "share_of_grew_kept_by_tolerance": round(float(d.loc[d["grew_wd"] == 1, "tol_wd"].mean()), 3)}
    # BHD: calendar-day label as in etl.py; working days counted on each activity's own P6 calendar
    # (TASK.clndr_id -> CALENDAR.csv: working days of the week and holidays). The first E2b version
    # assumed a Fri+Sat weekend; the manual check found it wrong (most calendars work Saturday), so
    # that count is kept only as a record of the mistake.
    from p6_calendar import load_calendars, working_days
    from e2_data_audit import RAW_BHD
    b = bhd[bhd["grew"].notna() & bhd["task_type"].isin(WORK_TYPES) & (bhd["planned_hr"] > 0)
            & bhd["project"].isin(clean_projects)].copy()
    pw, aw = pd.Series(np.nan, index=b.index), pd.Series(np.nan, index=b.index)
    calendar_report = {}
    for proj, g in b.groupby("project"):
        cals = load_calendars(RAW_BHD / proj.removeprefix("own::") / "CALENDAR.csv")
        pw[g.index] = working_days(g["target_start_date"], g["target_end_date"], g["clndr_id"], cals)
        aw[g.index] = working_days(g["act_start_date"], g["act_end_date"], g["clndr_id"], cals)
        used = g["clndr_id"].value_counts()
        calendar_report[proj] = [{"clndr_id": int(c), "activities": int(n),
                                  "name": cals[int(c)].name if int(c) in cals else None,
                                  "workdays": cals[int(c)].workdays if int(c) in cals else None,
                                  "holidays": int(len(cals[int(c)].holidays)) if int(c) in cals else None}
                                 for c, n in used.items()]
    b["planned_wd_p6"], b["actual_wd_p6"] = pw, aw
    b["grew_wd_p6"] = (aw > pw).astype(float).where(pw.notna() & aw.notna())
    b["tol_wd_p6"] = tolerance_label(aw, pw)
    fs_p = busdays(b["target_start_date"], b["target_end_date"], "Sun Mon Tue Wed Thu")
    fs_a = busdays(b["act_start_date"], b["act_end_date"], "Sun Mon Tue Wed Thu")
    b["grew_cal"] = b["grew"]
    has = b["grew_wd_p6"].notna()
    res["bhd"] = {
        "n": int(len(b)), "n_with_calendar": int(has.sum()),
        "grew_calendar_days": round(float(b["grew_cal"].mean()), 3),
        "grew_working_days_p6_calendar": round(float(b.loc[has, "grew_wd_p6"].mean()), 3),
        "agreement_cal_vs_wd_p6": round(float((b.loc[has, "grew_cal"] == b.loc[has, "grew_wd_p6"]).mean()), 3),
        "tolerance_label_rate_p6": round(float(b.loc[has, "tol_wd_p6"].mean()), 3),
        "share_of_grew_kept_by_tolerance_p6": round(float(b.loc[has & (b["grew_cal"] == 1), "tol_wd_p6"].mean()), 3),
        "superseded_fri_sat_assumption": {
            "grew_working_days": round(float((fs_a > fs_p).mean()), 3),
            "agreement_cal_vs_wd": round(float((b["grew_cal"] == (fs_a > fs_p).astype(float)).mean()), 3)},
    }
    res["bhd_calendars_used"] = calendar_report
    res["by_project_agreement_cal_vs_wd"] = {
        **{p: round(float((g["grew_cal"] == g["grew_wd_p6"]).mean()), 3) for p, g in b[has].groupby("project")},
        **{p: round(float((g["grew_cal"] == g["grew_wd"]).mean()), 3) for p, g in d.groupby("project")
           if len(g) >= 30}}
    res["note"] = ("BHD working days use each activity's P6 calendar (week + holidays from CALENDAR.csv); "
                   "DSLIB working days come from the ETL (holidays ignored there).")
    # sample for reading by hand: disagreements in BHD and DSLIB projects
    sb = b[has & (b["grew_cal"] != b["grew_wd_p6"])].groupby("project").head(5)[
        ["project", "task_name", "clndr_id", "target_start_date", "target_end_date", "act_start_date",
         "act_end_date", "planned_wd_p6", "actual_wd_p6", "grew_cal", "grew_wd_p6", "tol_wd_p6"]]
    sd = d[d["grew_cal"] != d["grew_wd"]].groupby("project").head(3).head(15)[
        ["project", "task_name", "baseline_start", "baseline_end", "planned_duration_wd", "actual_start",
         "actual_end", "actual_duration_wd", "grew_cal", "grew_wd", "tol_wd"]]
    sample = pd.concat([sb.assign(source="bhd"), sd.assign(source="dslib")], ignore_index=True)
    return res, sample


def fast_finish_hypothesis(bhd: pd.DataFrame) -> dict:
    """Of the activities that had started by the data date, did the ones that finished have shorter
    planned durations than the ones still running? Planned working hours (target_drtn_hr_cnt)."""
    w = bhd[bhd["task_type"].isin(WORK_TYPES) & (bhd["planned_hr"] > 0)
            & bhd["status"].isin(["TK_Complete", "TK_Active"])].copy()
    w["decile"] = (w["rel_position"].clip(0, 0.9999) * 10).astype(int) * 10
    by_decile = {}
    for d, g in w.groupby("decile"):
        c, a = g[g["status"] == "TK_Complete"], g[g["status"] == "TK_Active"]
        by_decile[f"{d}-{d + 10}%"] = {
            "completed": int(len(c)), "running": int(len(a)),
            "median_planned_hours_completed": float(c["planned_hr"].median()) if len(c) else None,
            "median_planned_hours_running": float(a["planned_hr"].median()) if len(a) else None}
    per_project = {}
    for p, g in w.groupby("project"):
        c, a = g[g["status"] == "TK_Complete"], g[g["status"] == "TK_Active"]
        if len(c) >= 10 and len(a) >= 10:
            per_project[p] = {"completed": int(len(c)), "running": int(len(a)),
                              "median_planned_hours_completed": float(c["planned_hr"].median()),
                              "median_planned_hours_running": float(a["planned_hr"].median())}
    shorter = [v["median_planned_hours_completed"] < v["median_planned_hours_running"] for v in per_project.values()]
    return {"by_decile_all_projects": by_decile, "per_project_min_10_each": per_project,
            "projects_where_completed_are_shorter": f"{sum(shorter)}/{len(shorter)}"}


VERSION_PAIRS = [   # (labelled update in the corpus, earlier version of the same schedule) — found by task-code
    ("update of jungle 20-07-2010", "baseline of jungle"),   # and name containment = 1.0 over the raw folders
    ("update of jungle 20-07-2010", "jungle recovery plan"),
    ("Update 01-09-2010", "medor_003"),
    ("Update 01-09-2010", "schedule of Medor"),
]


def version_comparison() -> list[dict]:
    from e2_data_audit import RAW_BHD

    def load(p):
        t = pd.read_csv(RAW_BHD / p / "TASK.csv", low_memory=False)
        pr = pd.read_csv(RAW_BHD / p / "PROJECT.csv", low_memory=False)
        pr.columns = [c.lower() for c in pr.columns]
        for c in ["target_start_date", "target_end_date", "act_start_date"]:
            t[c] = pd.to_datetime(t[c], errors="coerce").dt.normalize()
        t["planned_days"] = (t["target_end_date"] - t["target_start_date"]).dt.days
        return t.set_index("task_code"), str(pr["last_recalc_date"].iloc[0])[:10]
    rows = []
    for upd, early in VERSION_PAIRS:
        u, du = load(upd)
        e, de = load(early)
        k = u.index.intersection(e.index)
        x, y = u.loc[k], e.loc[k]
        done = x["status_code"] == "TK_Complete"
        rows.append({
            "update": upd, "update_data_date": du, "earlier": early, "earlier_data_date": de,
            "common_tasks": int(len(k)), "earlier_all_not_started": bool((y["status_code"] == "TK_NotStart").all()),
            "completed_in_update": int(done.sum()),
            "completed_same_planned_start": round(float((x[done]["target_start_date"] == y[done]["target_start_date"]).mean()), 3),
            "completed_same_planned_duration_days": round(float((x[done]["planned_days"] == y[done]["planned_days"]).mean()), 3),
            "completed_same_planned_hours": round(float((x[done]["target_drtn_hr_cnt"] == y[done]["target_drtn_hr_cnt"]).mean()), 3),
            "all_same_planned_start": round(float((x["target_start_date"] == y["target_start_date"]).mean()), 3),
        })
    return rows


def ratio_label(ds: pd.DataFrame, bhd: pd.DataFrame, clean_projects: set[str]) -> dict:
    """Continuous label: actual / planned duration (working days in DSLIB, calendar days in BHD)."""
    d = ds[ds["grew"].notna() & (ds["planned_duration_wd"] > 0)]
    r_ds = d["actual_duration_wd"] / d["planned_duration_wd"]
    b = bhd[bhd["grew"].notna() & bhd["task_type"].isin(WORK_TYPES) & (bhd["planned_hr"] > 0)
            & bhd["project"].isin(clean_projects) & (bhd["planned_days"] > 0)]
    r_b = b["actual_days"] / b["planned_days"]
    def q(r):
        return {"n": int(len(r)), "median": round(float(r.median()), 3),
                "q25_q75": [round(float(v), 3) for v in r.quantile([0.25, 0.75])],
                "share_gt_1": round(float((r > 1).mean()), 3), "share_gt_1_2": round(float((r > 1.2).mean()), 3),
                "share_gt_2": round(float((r > 2).mean()), 3)}
    return {"dslib_working_days": q(r_ds), "bhd_calendar_days_planned_gt_0": q(r_b),
            "note": "BHD rows with 0 planned calendar days (same-day activities) are left out of the ratio"}


def main() -> int:
    raw = pd.read_csv(OUT / "corpus_v3_buildings.csv", low_memory=False)
    raw[TARGET] = raw[TARGET].astype(int)
    clean = pd.read_csv(OUT / "corpus_v3_clean.csv", low_memory=False)
    clean[TARGET] = clean[TARGET].astype(int)
    fam = json.loads((OUT / "project_families.json").read_text())

    plans = fold_plan(fam)
    runs = {"R1_original_rows_66_projects": run(raw, fam, plans),
            "R2_original_rows_64_projects": run(raw[~raw["project"].isin(DROPPED)], fam, plans),
            "R3_cleaned_rows_64_projects": run(clean, fam, plans)}
    elig = [set(r["per_project"]["project"]) for r in runs.values()]
    common = sorted(set.intersection(*elig))
    decomposition = {k: summarise_run(r, common) for k, r in runs.items()}

    bhd = pd.concat([read_bhd(p) for p in OWN_BUILDINGS], ignore_index=True)
    ds = dslib_buildings(pd.read_csv(OUT / "dslib_labeled_tasks.csv", low_memory=False))
    ds = ds[("dslib::" + ds["project"].astype(str)).isin(set(raw["project"]))]
    labels, sample = label_definitions(bhd, ds, set(clean["project"]))
    sample.to_csv(OUT / "e2b_label_disagreements_sample.csv", index=False)

    labels["continuous_ratio"] = ratio_label(ds, bhd, set(clean["project"]))
    result = {
        "config": {"design": f"{N_REPEATS} x {N_FOLDS}-fold by family, fixed across runs", "seed_base": SEED, "families": "outputs/project_families.json",
                   "variants": VARIANTS, "eligible_per_run": {k: len(e) for k, e in zip(runs, elig)},
                   "common_eligible_projects": common},
        "1_decomposition_same_splits": decomposition,
        "5_top10_per_project_R3": top10_table(runs["R3_cleaned_rows_64_projects"]),
        "2_survivorship_bhd_per_project_decile": survivorship_by_project(bhd),
        "3_label_definitions": labels,
        "7_bhd_versions_of_the_same_project": version_comparison(),
        "9_fast_finish_hypothesis_bhd": fast_finish_hypothesis(bhd),
    }
    (OUT / "e2b_followups.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str) + "\n")
    for k, v in decomposition.items():
        print(k, {x: v[x]["within_common"]["median_auc"] for x in VARIANTS}, "strongest baseline:",
              v["strongest_baseline_by_median"])
        for p, q in v["paired_common"].items():
            print("   ", p, q["median_diff"], q["ci95"], f"{q['projects_a_better']}/{q['n_projects']}")
    print(json.dumps(result["9_fast_finish_hypothesis_bhd"], indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
