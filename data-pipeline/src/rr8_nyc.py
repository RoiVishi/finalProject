"""
RR-8 — External validation on an independent public dataset (NYC Open Data 95tx-snak).

Question: does the project's core paradigm — plan-time information ranks delay
risk — survive OUTSIDE our P6 corpus, on a foreign portfolio (NYC capital
projects), at PROJECT level?

Dataset structure (verified 17.8.26 via SoQL):
  22,464 rows = project × reporting_period snapshots; 3,661 distinct projects;
  10 reporting periods (2023-05 .. 2026-05, tri-annual);
  completion_date_type ∈ {Forecast (running), Actual (finished)}.

Design (honest, leakage-aware):
- Unit = project (managing_agency + pid).
- "Plan" reference = the FIRST observed snapshot of the project. To avoid
  left-censoring bias (projects that existed long before the window began),
  the primary cohort is projects whose first appearance is AFTER the first
  reporting period ("new" projects); the all-projects cohort is reported as a
  sensitivity check.
- Labels:
    slipped   = final forecast/actual completion is later than the first
                observed forecast by > GRACE_DAYS (forecast drift — available
                for every project);
    late      = actual completion later than first forecast by > GRACE_DAYS
                (ground truth — only for projects that finished in-window).
- Plan-time features (known at first snapshot only): managing agency,
  phase at first observation, planned horizon (first forecast − first
  data_date, days), first-seen calendar period. NOTHING from later snapshots.
- Models: logistic regression + the champion family (XGBoost, small grid),
  5-fold GroupKFold CV grouped by managing_agency — the transfer-style split:
  can the model rank projects of an UNSEEN agency? Compared to dummy (AUC 0.5).
- Expectation (stated in advance, per L8/RR-8): weaker signal than scenario B.
  A weak result is a RESULT — it delimits the product claim.

Run:  python src/rr8_nyc.py [path/to/nyc_95tx_snak.csv]
      (default: data-pipeline/data/nyc_95tx_snak.csv)
Output: outputs/rr8_nyc.json + figures/rr8_nyc.png
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

SEED = 42
GRACE_DAYS = 30            # slippage below a month is treated as noise, not delay
BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "outputs"


def load(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    for c in ("completion_date", "data_date"):
        df[c] = pd.to_datetime(df[c], errors="coerce")
    df["reporting_period"] = df["reporting_period"].astype(str)
    df["key"] = df["managing_agency"].astype(str) + "::" + df["pid"].astype(str)
    return df.dropna(subset=["completion_date", "data_date"])


def build_projects(df: pd.DataFrame) -> pd.DataFrame:
    first_period = df["reporting_period"].min()
    rows = []
    for key, g in df.sort_values("reporting_period").groupby("key"):
        first, last = g.iloc[0], g.iloc[-1]
        if first["completion_date_type"] != "Forecast":
            continue                                    # arrived already finished — no plan to judge
        actual = g[g["completion_date_type"] == "Actual"]
        actual_date = actual.iloc[0]["completion_date"] if len(actual) else None
        final_completion = actual_date if actual_date is not None else last["completion_date"]
        rows.append({
            "key": key,
            "agency": first["managing_agency"],
            "first_period": first["reporting_period"],
            "is_new": first["reporting_period"] > first_period,   # appeared after window start
            "n_snapshots": len(g),
            "first_phase": str(first.get("current_phase", "NA")),
            "plan_horizon_days": (first["completion_date"] - first["data_date"]).days,
            "slip_days": (final_completion - first["completion_date"]).days,
            "finished": actual_date is not None,
            "late_days_actual": ((actual_date - first["completion_date"]).days
                                 if actual_date is not None else None),
        })
    p = pd.DataFrame(rows)
    p["slipped"] = (p["slip_days"] > GRACE_DAYS).astype(int)
    p["late"] = p["late_days_actual"].apply(
        lambda d: None if d is None or pd.isna(d) else int(d > GRACE_DAYS))
    return p


FEATURES_NUM = ["plan_horizon_days"]
FEATURES_CAT = ["agency", "first_phase"]


def cv_auc(p: pd.DataFrame, label: str) -> dict:
    """GroupKFold by agency — the transfer split: rank projects of unseen agencies."""
    d = p.dropna(subset=[label]).copy()
    d[label] = d[label].astype(int)
    if d[label].nunique() < 2 or len(d) < 100:
        return {"n": len(d), "note": "insufficient data"}
    X, y, groups = d, d[label], d["agency"]
    prep = ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), FEATURES_NUM),
        ("cat", Pipeline([("imp", SimpleImputer(strategy="constant", fill_value="NA")),
                          ("oh", OneHotEncoder(handle_unknown="ignore"))]), FEATURES_CAT),
    ])
    models = {
        "logreg": LogisticRegression(max_iter=2000, class_weight="balanced"),
    }
    try:
        from xgboost import XGBClassifier
        models["xgboost"] = XGBClassifier(random_state=SEED, n_jobs=-1, eval_metric="logloss",
                                          learning_rate=0.05, max_depth=3, n_estimators=300,
                                          subsample=0.8, tree_method="hist")
    except ImportError:
        pass

    n_groups = d["agency"].nunique()
    gkf = GroupKFold(n_splits=min(5, n_groups))
    res = {"n": len(d), "positive_rate": round(float(y.mean()), 3),
           "n_agencies": int(n_groups), "models": {}}
    for name, est in models.items():
        aucs = []
        for tr_idx, te_idx in gkf.split(X, y, groups):
            if y.iloc[te_idx].nunique() < 2:
                continue
            pipe = Pipeline([("prep", prep), ("model", est)])
            pipe.fit(X.iloc[tr_idx], y.iloc[tr_idx])
            aucs.append(roc_auc_score(y.iloc[te_idx], pipe.predict_proba(X.iloc[te_idx])[:, 1]))
        res["models"][name] = {"auc_mean": round(float(np.mean(aucs)), 4),
                               "auc_std": round(float(np.std(aucs)), 4),
                               "auc_folds": [round(float(a), 4) for a in aucs]}
    return res


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "data" / "nyc_95tx_snak.csv"
    if not path.exists():
        print(f"CSV not found at {path}\nDownload: https://data.cityofnewyork.us/api/views/95tx-snak/rows.csv?accessType=DOWNLOAD")
        return 1
    df = load(path)
    p = build_projects(df)
    new = p[p["is_new"]]

    print(f"projects with a first-forecast plan: {len(p)} "
          f"({len(new)} 'new' — appeared after window start)")
    print(f"slippage >{GRACE_DAYS}d (all): {p['slipped'].mean():.1%} | "
          f"finished in-window: {p['finished'].mean():.1%}")

    result = {
        "config": {"seed": SEED, "grace_days": GRACE_DAYS, "source": "NYC Open Data 95tx-snak",
                   "unit": "project (agency+pid)", "plan_ref": "first observed Forecast snapshot",
                   "split": "GroupKFold by managing_agency (unseen-agency transfer)"},
        "descriptive": {
            "n_projects": len(p), "n_new": int(len(new)),
            "slipped_rate_all": round(float(p["slipped"].mean()), 3),
            "slipped_rate_new": round(float(new["slipped"].mean()), 3) if len(new) else None,
            "median_slip_days_all": float(p["slip_days"].median()),
            "finished_share": round(float(p["finished"].mean()), 3),
            "late_rate_actual_finishers": (round(float(p["late"].dropna().mean()), 3)
                                           if p["late"].notna().any() else None),
        },
        "model_slipped_new_cohort": cv_auc(new, "slipped"),
        "model_slipped_all": cv_auc(p, "slipped"),
        "model_late_actual": cv_auc(p, "late"),
    }
    (OUT / "rr8_nyc.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result["descriptive"], indent=2))
    for k in ("model_slipped_new_cohort", "model_slipped_all", "model_late_actual"):
        print(k, "->", json.dumps(result[k].get("models", result[k])))

    # figure: slip distribution + per-fold AUCs
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(10.5, 4.4), dpi=150)
    clip = p["slip_days"].clip(-100, 700)
    ax1.hist(clip, bins=40, color="#2a78d6", alpha=0.85)
    ax1.axvline(GRACE_DAYS, ls="--", lw=1.2, color="#eb6834")
    ax1.annotate(f"grace {GRACE_DAYS}d", xy=(GRACE_DAYS, ax1.get_ylim()[1]*0.9),
                 xytext=(6, 0), textcoords="offset points", color="#eb6834", fontsize=9)
    ax1.set_xlabel("Forecast slip vs first plan (days, clipped)")
    ax1.set_ylabel("Projects")
    ax1.set_title("NYC capital projects — completion slippage")
    ax1.grid(alpha=0.25, lw=0.5)

    m = result["model_slipped_new_cohort"].get("models", {})
    labels, vals = [], []
    for name, r in m.items():
        for i, a in enumerate(r["auc_folds"]):
            labels.append(name)
            vals.append(a)
    if vals:
        xs = [0 if n == "logreg" else 1 for n in labels]
        ax2.axhline(0.5, ls="--", lw=1, color="#9a9a9a")
        ax2.scatter(xs, vals, s=48, color="#eb6834", alpha=0.8, zorder=3)
        ax2.set_xticks([0, 1])
        ax2.set_xticklabels(["LogReg", "XGBoost"])
        for name, xpos in (("logreg", 0), ("xgboost", 1)):
            if name in m:
                ax2.hlines(m[name]["auc_mean"], xpos-0.2, xpos+0.2, color="#1F3864", lw=2.5)
        ax2.set_ylabel("AUC per fold (unseen agencies)")
        ax2.set_title("Plan-time features → slippage (new cohort)")
        ax2.set_ylim(0.3, 1.0)
        ax2.grid(alpha=0.25, lw=0.5, axis="y")
    plt.tight_layout()
    (OUT / "figures").mkdir(exist_ok=True)
    plt.savefig(OUT / "figures" / "rr8_nyc.png")
    print(f"\nSaved {OUT / 'rr8_nyc.json'} and figures/rr8_nyc.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
