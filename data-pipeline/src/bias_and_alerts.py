"""
Two product-review checks (26.7.26):

1. LABEL-SELECTION BIAS — "who are the unlabeled 91%?"
   A task is labeled only if it has an actual finish. If labeled tasks differ
   systematically from unlabeled ones, the model learned a biased world.
   We compare feature distributions (labeled vs unlabeled) on the dedup corpus.

2. ALERT VOLUME — "how many red tasks will a contractor actually see?"
   With precision ~0.48, every second alert is false. We simulate, per test
   project, how many activities land in the high/medium bands under
   (a) the current placeholder bands (0.33/0.66) and
   (b) quantile-derived bands (top 10% = high, next 20% = medium).
   Feeds the PRED-12 banding-protocol decision.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_compare import EXCLUDE_PROJECTS, NUM_FEATURES, load_labeled, temporal_split

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "outputs"
REGISTRY = BASE.parent / "ai-service" / "model" / "registry"


def label_bias() -> dict:
    df = pd.read_csv(OUT / "labeled_tasks.csv")
    df = df[~df["project"].isin(EXCLUDE_PROJECTS)]
    labeled = df[df["is_late"].notna()]
    unlabeled = df[df["is_late"].isna()]
    rows = {}
    for f in NUM_FEATURES:
        rows[f] = {
            "labeled_median": round(float(labeled[f].median()), 2) if labeled[f].notna().any() else None,
            "unlabeled_median": round(float(unlabeled[f].median()), 2) if unlabeled[f].notna().any() else None,
            "labeled_missing": round(float(labeled[f].isna().mean()), 3),
            "unlabeled_missing": round(float(unlabeled[f].isna().mean()), 3),
        }
    proj_label_share = (df.assign(lab=df["is_late"].notna())
                          .groupby("project")["lab"].mean().round(3).sort_values())
    out = {
        "n_labeled": len(labeled), "n_unlabeled": len(unlabeled),
        "share_labeled": round(len(labeled) / len(df), 3),
        "projects_with_zero_labels": int((proj_label_share == 0).sum()),
        "n_projects_total": int(df["project"].nunique()),
        "feature_medians": rows,
        "note": ("Labeling requires an actual finish date. Most unlabeled tasks sit in "
                 "projects that never recorded actuals at all — a file-level property "
                 "(which schedules were maintained), not a task-level one."),
    }
    print(f"[bias] labeled {out['n_labeled']} / unlabeled {out['n_unlabeled']} "
          f"({out['share_labeled']:.0%} labeled); "
          f"{out['projects_with_zero_labels']}/{out['n_projects_total']} projects have zero labels")
    big_gaps = {f: r for f, r in rows.items()
                if r["labeled_median"] is not None and r["unlabeled_median"] is not None
                and abs(r["labeled_median"] - r["unlabeled_median"]) >
                    0.5 * (abs(r["labeled_median"]) + 1)}
    for f, r in big_gaps.items():
        print(f"[bias] notable gap in {f}: labeled median {r['labeled_median']} "
              f"vs unlabeled {r['unlabeled_median']}")
    out["notable_gaps"] = list(big_gaps)
    return out


def alert_volume() -> dict:
    versions = sorted((p for p in REGISTRY.glob("v*") if p.name[1:].isdigit()),
                      key=lambda p: int(p.name[1:]))
    if not versions:
        raise SystemExit("no registry versions found — run train_compare.py first")
    clf = joblib.load(versions[-1] / "classifier.joblib")
    lab = load_labeled()
    tr, te, _ = temporal_split(lab)
    te = te.copy()
    te["p"] = clf.predict_proba(te)[:, 1]

    # Thresholds derived on TRAIN-side data (the latest calibration slice), then
    # bands/precision are *scored* on the untouched test set. Deriving quantiles from
    # the same test predictions we score would be a mild fit-on-test (16.8 audit, I6).
    cal_parts = []
    for _, g in tr.groupby("project"):
        c = g["rel_position"].quantile(0.75)
        cal_parts.append(g[g["rel_position"] > c])
    cal = pd.concat(cal_parts).copy()
    p_cal = clf.predict_proba(cal)[:, 1]
    q80, q90 = float(pd.Series(p_cal).quantile(0.80)), float(pd.Series(p_cal).quantile(0.90))
    schemes = {
        "placeholder_0.33_0.66": (0.33, 0.66),
        f"quantile_top10_high (t1={q80:.2f}, t2={q90:.2f})": (float(q80), float(q90)),
    }
    result = {"model_version": versions[-1].name, "n_test": len(te), "schemes": {}}
    for name, (t1, t2) in schemes.items():
        per_proj = te.groupby("project")["p"].apply(
            lambda s: pd.Series({"high": int((s >= t2).sum()),
                                 "medium": int(((s >= t1) & (s < t2)).sum()),
                                 "n": len(s)}))
        pp = per_proj.unstack()
        # precision of the high band under this scheme
        high_mask = te["p"] >= t2
        prec_high = float(te.loc[high_mask, "is_late"].mean()) if high_mask.any() else None
        result["schemes"][name] = {
            "t1": round(t1, 3), "t2": round(t2, 3),
            "median_high_per_project": int(pp["high"].median()),
            "median_medium_per_project": int(pp["medium"].median()),
            "max_high_per_project": int(pp["high"].max()),
            "share_high_overall": round(float(high_mask.mean()), 3),
            "precision_in_high_band": round(prec_high, 3) if prec_high is not None else None,
        }
        print(f"[alerts] {name}: median high/project={result['schemes'][name]['median_high_per_project']}, "
              f"share high={result['schemes'][name]['share_high_overall']:.1%}, "
              f"precision(high)={result['schemes'][name]['precision_in_high_band']}")
    return result


def main() -> int:
    out = {"label_bias": label_bias(), "alert_volume": alert_volume()}
    (OUT / "bias_and_alerts.json").write_text(json.dumps(out, indent=2))
    print(f"Saved {OUT / 'bias_and_alerts.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
