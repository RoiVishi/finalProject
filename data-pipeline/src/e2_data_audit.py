"""Advisor feedback (8.11.2026) — E2: data audit for items 6, 3 and 4.

Reads the raw BHD P6 tables of the 9 building projects (data_bhd/Buildings Data, not in git),
outputs/dslib_labeled_tasks.csv and outputs/corpus_v3_buildings.csv. Writes
outputs/e2_data_audit.json and outputs/corpus_v3_clean.csv (not in git). Nothing here changes
the served model.

Item 6 — rows and label
  6a  rows by activity type; which rows are not work activities (milestones, LOE, WBS summary,
      zero planned working duration)
  6b  how large the overruns are (share of `grew` that is a 1-day overrun; relative overrun)
  6c  whether BHD "planned" dates are the original plan: completed activities whose planned
      start equals, or comes after, their actual start
Item 3 — survivorship (BHD)
  every activity of every building project, by status at the export (data date =
  PROJECT.last_recalc_date); activities still running whose elapsed time already exceeds the
  planned duration are known overruns; per decile of planned position: labelled share and the
  grew rate with its bounds when the unlabelled activities are counted
Item 4 — families by activity similarity
  containment of normalised task names between every pair of the 66 projects
Clean rows (rule fixed BEFORE re-running E1, see EXPERIMENT_LOG.md E2)
  BHD: task_type TT_Task or TT_Rsrc AND target_drtn_hr_cnt > 0
  BHD: drop a project whose planned dates were overwritten by the actual dates (planned start AND
       planned finish equal the actual ones for >= 90% of its completed activities): there the
       planned duration IS the actual duration, so `grew` is 0 by construction (6c)
  DSLIB: planned_duration_wd > 0
Families (item 4): connected components over project pairs whose normalised task-name sets have
  Jaccard >= 0.5, merged with the identical-signature families of advisor_checks.families();
  written to outputs/project_families.json, which advisor_checks.py reads when present.
"""
from __future__ import annotations

import json
import re
import sys
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from buildings import OWN_BUILDINGS, dslib_buildings  # noqa: E402

BASE = HERE.parent
OUT = BASE / "outputs"
RAW_BHD = BASE / "data_bhd" / "Buildings Data"
WORK_TYPES = {"TT_Task", "TT_Rsrc"}
OVERWRITTEN_SHARE = 0.90   # planned dates == actual dates on this share of completed activities
FAMILY_JACCARD = 0.5
DATES = ["target_start_date", "target_end_date", "act_start_date", "act_end_date"]


# ---------------------------------------------------------------- raw BHD
def read_bhd(project: str) -> pd.DataFrame:
    def table(name):
        t = pd.read_csv(RAW_BHD / project / f"{name}.csv", encoding="utf-8", encoding_errors="replace",
                        on_bad_lines="skip", low_memory=False)
        t.columns = [c.strip().lower() for c in t.columns]
        return t
    t = table("TASK")
    data_date = pd.to_datetime(table("PROJECT")["last_recalc_date"].iloc[0], errors="coerce")
    for c in DATES:
        t[c] = pd.to_datetime(t[c], errors="coerce")
    p0, p1 = t["target_start_date"].min(), t["target_end_date"].max()
    span = max((p1 - p0).days, 1)
    out = pd.DataFrame({
        "project": "own::" + project,
        "task_id": t["task_id"],
        "task_code": t["task_code"].astype(str),
        "task_name": t["task_name"].astype(str),
        "task_type": t["task_type"],
        "status": t["status_code"],
        "planned_hr": pd.to_numeric(t["target_drtn_hr_cnt"], errors="coerce"),
        "rel_position": (t["target_start_date"] - p0).dt.days / span,
        "data_date": data_date,
    })
    for c in DATES:
        out[c] = t[c].dt.normalize()
    out["planned_days"] = (out["target_end_date"] - out["target_start_date"]).dt.days
    out["actual_days"] = (out["act_end_date"] - out["act_start_date"]).dt.days
    out["grew"] = np.where(out[DATES].notna().all(axis=1),
                           (out["actual_days"] > out["planned_days"]).astype(float), np.nan)
    elapsed = (out["data_date"] - out["act_start_date"]).dt.days
    out["running_overrun_known"] = (out["status"] == "TK_Active") & (elapsed > out["planned_days"])
    return out


# ---------------------------------------------------------------- item 6
def item6(bhd: pd.DataFrame, ds: pd.DataFrame) -> dict:
    lab = bhd[bhd["grew"].notna()]
    by_type = lab.groupby("task_type", dropna=False)["grew"].agg(["size", "mean"]).round(3)
    zero_hr = lab[lab["task_type"].isin(WORK_TYPES) & ~(lab["planned_hr"] > 0)]
    dsl = ds[ds["grew"].notna()]

    over_bhd = (lab["actual_days"] - lab["planned_days"])[lab["grew"] == 1]
    rel_bhd = over_bhd / lab.loc[lab["grew"] == 1, "planned_days"].clip(lower=1)
    over_ds = (dsl["actual_duration_wd"] - dsl["planned_duration_wd"])[dsl["grew"] == 1]
    rel_ds = over_ds / dsl.loc[dsl["grew"] == 1, "planned_duration_wd"].clip(lower=1)

    done = bhd[(bhd["status"] == "TK_Complete") & bhd[DATES].notna().all(axis=1)]
    gap = (done["target_start_date"] - done["act_start_date"]).dt.days
    return {
        "6a_bhd_labelled_by_task_type": {str(k): {"n": int(r["size"]), "grew_rate": float(r["mean"])}
                                         for k, r in by_type.iterrows()},
        "6a_bhd_work_rows_with_zero_planned_hours": int(len(zero_hr)),
        "6a_dslib_labelled_rows": int(len(dsl)),
        "6a_dslib_zero_planned_working_days": int((dsl["planned_duration_wd"] <= 0).sum()),
        "6a_dslib_zero_calendar_but_positive_working_days": int(
            ((dsl["planned_duration_days"] <= 0) & (dsl["planned_duration_wd"] > 0)).sum()),
        "6b_bhd_overrun_days_among_grew": {
            "n": int(len(over_bhd)), "share_1_day": round(float((over_bhd == 1).mean()), 3),
            "share_le_2_days": round(float((over_bhd <= 2).mean()), 3),
            "share_relative_le_10pct": round(float((rel_bhd <= 0.10).mean()), 3),
            "median_days": float(over_bhd.median())},
        "6b_dslib_overrun_working_days_among_grew": {
            "n": int(len(over_ds)), "share_1_day": round(float((over_ds <= 1).mean()), 3),
            "share_le_2_days": round(float((over_ds <= 2).mean()), 3),
            "share_relative_le_10pct": round(float((rel_ds <= 0.10).mean()), 3),
            "median_days": float(over_ds.median())},
        "6c_bhd_completed_activities": {
            "n": int(len(done)),
            "planned_start_equals_actual_start": round(float((gap == 0).mean()), 3),
            "planned_start_after_actual_start": round(float((gap > 0).mean()), 3),
            "planned_start_after_actual_start_by_over_7_days": round(float((gap > 7).mean()), 3),
            "planned_end_equals_actual_end": round(float(
                (done["target_end_date"] == done["act_end_date"]).mean()), 3),
            "by_project": overwritten_table(done),
        },
    }


def overwritten_table(done: pd.DataFrame) -> dict:
    """Per project: share of completed activities whose planned start / finish equal the actual ones,
    and whether the planned dates still agree with the planned duration in hours."""
    out = {}
    for p, g in done.groupby("project"):
        s_eq = g["target_start_date"] == g["act_start_date"]
        e_eq = g["target_end_date"] == g["act_end_date"]
        out[p] = {"n": int(len(g)), "grew_rate": round(float(g["grew"].mean()), 3),
                  "planned_start_equals_actual": round(float(s_eq.mean()), 3),
                  "planned_finish_equals_actual": round(float(e_eq.mean()), 3),
                  "both_equal": round(float((s_eq & e_eq).mean()), 3),
                  "labels_invalid": bool((s_eq & e_eq).mean() >= OVERWRITTEN_SHARE)}
    return out


# ---------------------------------------------------------------- item 3
def item3(bhd: pd.DataFrame, ds: pd.DataFrame) -> dict:
    work = bhd[bhd["task_type"].isin(WORK_TYPES) & (bhd["planned_hr"] > 0)].copy()
    per_project = {}
    for p, g in work.groupby("project"):
        per_project[p] = {
            "data_date": str(g["data_date"].iloc[0].date()),
            "activities": int(len(g)),
            "labelled": int(g["grew"].notna().sum()),
            "running": int((g["status"] == "TK_Active").sum()),
            "running_known_overrun": int(g["running_overrun_known"].sum()),
            "not_started": int((g["status"] == "TK_NotStart").sum()),
            "share_of_project_time_elapsed_at_export": round(float(
                ((g["data_date"].iloc[0] - g["target_start_date"].min()).days)
                / max((g["target_end_date"].max() - g["target_start_date"].min()).days, 1)), 2),
        }
    work["decile"] = (work["rel_position"].clip(0, 0.9999) * 10).astype(int)
    rows = {}
    for d, g in work.groupby("decile"):
        lab = g["grew"].notna()
        known1 = (g["grew"] == 1) | g["running_overrun_known"]
        known0 = g["grew"] == 0
        unknown = ~(known1 | known0)
        rows[f"{d * 10}-{d * 10 + 10}%"] = {
            "activities": int(len(g)), "labelled_share": round(float(lab.mean()), 3),
            "grew_rate_labelled_only": round(float(g.loc[lab, "grew"].mean()), 3) if lab.any() else None,
            "running_known_overrun": int(g["running_overrun_known"].sum()),
            "grew_rate_lower_bound_all": round(float(known1.mean()), 3),
            "grew_rate_upper_bound_all": round(float((known1 | unknown).mean()), 3),
        }
    dsl = ds.copy()
    return {
        "bhd_work_activities_per_project": per_project,
        "bhd_by_planned_position_decile": rows,
        "bhd_totals": {"activities": int(len(work)), "labelled": int(work["grew"].notna().sum()),
                       "running": int((work["status"] == "TK_Active").sum()),
                       "running_known_overrun": int(work["running_overrun_known"].sum()),
                       "not_started": int((work["status"] == "TK_NotStart").sum())},
        "dslib_labelled_share": round(float(dsl["grew"].notna().mean()), 3),
        "dslib_note": "DSLIB projects are completed archives with a frozen baseline and tracking periods; "
                      "an unlabelled DSLIB activity lacks dates, not an outcome still to come",
    }


# ---------------------------------------------------------------- item 4
def norm(name: str) -> str:
    s = re.sub(r"[^a-z֐-׿]+", " ", str(name).lower())
    return re.sub(r"\s+", " ", s).strip()


def item4(bhd: pd.DataFrame, ds: pd.DataFrame, corpus_projects: set[str]) -> dict:
    names = {p: {norm(n) for n in g["task_name"]} - {""} for p, g in bhd.groupby("project")}
    for p, g in ds.groupby("project"):
        names["dslib::" + str(p)] = {norm(n) for n in g["task_name"]} - {""}
    names = {p: s for p, s in names.items() if p in corpus_projects}
    pairs = []
    for a, b in combinations(sorted(names), 2):
        A, B = names[a], names[b]
        if min(len(A), len(B)) < 5:
            continue
        inter = len(A & B)
        cont = inter / min(len(A), len(B))
        if cont >= 0.5:
            pairs.append({"a": a, "b": b, "containment": round(cont, 3),
                          "jaccard": round(inter / len(A | B), 3), "shared_names": inter,
                          "sizes": [len(A), len(B)]})
    return {"method": "set of normalised task names per project; containment = shared / smaller set; "
                      "pairs with containment >= 0.5 and both sets >= 5 names",
            "pairs": sorted(pairs, key=lambda x: -x["containment"])}


def families(pairs: list[dict], corpus: pd.DataFrame) -> dict:
    """Union-find over name-similar pairs (Jaccard >= FAMILY_JACCARD) and identical signatures."""
    from advisor_checks import families as signature_families
    sig = signature_families(corpus)
    parent = {p: p for p in corpus["project"].unique()}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        parent[find(a)] = find(b)
    for pr in pairs:
        if pr["jaccard"] >= FAMILY_JACCARD:
            union(pr["a"], pr["b"])
    for _, members in sig.groupby(sig).groups.items():
        members = list(members)
        for m in members[1:]:
            union(members[0], m)
    roots = sorted({find(p) for p in parent})
    fam_id = {r: f"F{i:02d}" for i, r in enumerate(roots)}
    return {p: fam_id[find(p)] for p in sorted(parent)}


# ---------------------------------------------------------------- clean corpus
def clean_corpus(corpus: pd.DataFrame, bhd: pd.DataFrame, ds: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    key = bhd.set_index(["project", "task_id"])[["task_type", "planned_hr"]]
    own = corpus[corpus["source"] == "own"].join(key, on=["project", "task_id"], rsuffix="_raw")
    dsk = ds.assign(project="dslib::" + ds["project"].astype(str)).set_index(["project", "task_id"])
    dsl = corpus[corpus["source"] == "dslib"].join(dsk[["planned_duration_wd"]], on=["project", "task_id"])
    steps = {"start": {"own": len(own), "dslib": len(dsl)}}
    own1 = own[own["task_type_raw"].isin(WORK_TYPES)]
    steps["work activity types only (BHD)"] = {"own": len(own1), "dslib": len(dsl)}
    own2 = own1[own1["planned_hr"] > 0]
    dsl2 = dsl[dsl["planned_duration_wd"] > 0]
    steps["planned working duration > 0"] = {"own": len(own2), "dslib": len(dsl2)}
    done = bhd[(bhd["status"] == "TK_Complete") & bhd[DATES].notna().all(axis=1)
               & bhd["task_type"].isin(WORK_TYPES)]
    invalid = [p for p, r in overwritten_table(done).items() if r["labels_invalid"]]
    own3 = own2[~own2["project"].isin(invalid)]
    steps["projects with planned dates overwritten by actuals dropped"] = {
        "own": len(own3), "dslib": len(dsl2), "dropped_projects": invalid}
    clean = pd.concat([own3[corpus.columns], dsl2[corpus.columns]], ignore_index=True)
    rates = {"before": corpus.groupby("source")["grew"].mean().round(3).to_dict(),
             "after": clean.groupby("source")["grew"].mean().round(3).to_dict(),
             "projects_after": clean.groupby("source")["project"].nunique().to_dict()}
    return clean, {"steps": steps, "grew_rate": rates}


def main() -> int:
    corpus = pd.read_csv(OUT / "corpus_v3_buildings.csv", low_memory=False)
    bhd = pd.concat([read_bhd(p) for p in OWN_BUILDINGS], ignore_index=True)
    ds = dslib_buildings(pd.read_csv(OUT / "dslib_labeled_tasks.csv", low_memory=False))
    ds = ds[("dslib::" + ds["project"].astype(str)).isin(set(corpus["project"]))]

    clean, clean_report = clean_corpus(corpus, bhd, ds)
    clean.sort_values(["project", "task_id"]).to_csv(OUT / "corpus_v3_clean.csv", index=False)
    result = {
        "item6": item6(bhd, ds),
        "item3": item3(bhd, ds),
        "item4": item4(bhd, ds, set(corpus["project"])),
        "clean_corpus": clean_report,
    }
    fam = families(result["item4"]["pairs"], corpus)
    groups = pd.Series(fam).groupby(pd.Series(fam)).apply(lambda x: sorted(x.index))
    result["item4"]["families"] = {"n_projects": len(fam), "n_families": int(groups.shape[0]),
                                   "multi_project_families": [g for g in groups if len(g) > 1]}
    (OUT / "project_families.json").write_text(json.dumps(fam, indent=1, ensure_ascii=False) + "\n")
    (OUT / "e2_data_audit.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str) + "\n")
    print(json.dumps(result, indent=1, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
