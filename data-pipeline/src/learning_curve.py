"""
RR-11 — Within-project learning curve (cold-start analysis).

Question: from what point in a project's life do predictions become usable?

Design (leakage-aware, comparable across points):
- FIXED test set: each qualifying project's latest 30% of labeled activities
  (rel_position > the project's own 70th percentile) — identical to the
  scenario-B test set of train_compare.py, so the f=0.70 point reproduces the
  headline result.
- Varying train set: for history fraction f in {0.10..0.70}, train on each
  project's labeled activities with rel_position <= that project's f-quantile.
  Train grows monotonically with f; test never changes.
- Model: the tuned champion, read dynamically from model_comparison.json
  (name + best params — XGBoost in the v3/v4 runs), seed 42. AUC is
  threshold-free (primary); F1/recall at the default 0.5 threshold (secondary).

Output: outputs/learning_curve.json + outputs/figures/learning_curve.png,
and a derived usability threshold (first f with AUC >= 0.70) for PRED-10.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score, recall_score, roc_auc_score
from sklearn.pipeline import Pipeline

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_compare import (MIN_LABELED, MIN_PER_SIDE, SEED, TEMPORAL_Q,
                           load_labeled, make_preprocessor)

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "outputs"
FRACTIONS = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70]
USABILITY_AUC = 0.70


def champion():
    """Build the current champion from model_comparison.json (name + tuned params)."""
    r = json.loads((OUT / "model_comparison.json").read_text())
    name = r["champion"]["classifier"]
    params = {k.replace("model__", ""): v for k, v in r.get("best_params", {}).get(name, {}).items()}
    if name == "xgboost":
        from xgboost import XGBClassifier
        est = XGBClassifier(random_state=SEED, n_jobs=-1, eval_metric="logloss",
                            tree_method="hist", **params)
    else:
        est = RandomForestClassifier(class_weight="balanced", random_state=SEED,
                                     n_jobs=-1, **params)
    print(f"champion for curve: {name} {params}")
    return Pipeline([("prep", make_preprocessor()), ("model", est)])


def main() -> int:
    lab = load_labeled()   # dedup-hardened corpus (DATA-2)

    # qualifying projects + FIXED test set (identical rule to train_compare scenario B)
    tests, trains_by_project = [], {}
    for name, g in lab.groupby("project"):
        if len(g) < MIN_LABELED:
            continue
        cut70 = g["rel_position"].quantile(TEMPORAL_Q)
        tr_g, te_g = g[g["rel_position"] <= cut70], g[g["rel_position"] > cut70]
        if len(tr_g) >= MIN_PER_SIDE and len(te_g) >= MIN_PER_SIDE:
            tests.append(te_g)
            trains_by_project[name] = g
    test = pd.concat(tests)
    print(f"fixed test: {len(test)} tasks, {len(trains_by_project)} projects, "
          f"late rate {test['is_late'].mean():.3f}")

    points = []
    for f in FRACTIONS:
        parts = []
        for name, g in trains_by_project.items():
            cut = g["rel_position"].quantile(f)
            part = g[g["rel_position"] <= cut]
            # never let train leak into the fixed test window
            cut70 = g["rel_position"].quantile(TEMPORAL_Q)
            parts.append(part[part["rel_position"] <= cut70])
        train = pd.concat(parts)
        if train["is_late"].nunique() < 2:
            print(f"f={f}: single-class train, skipped")
            continue
        model = champion()
        model.fit(train, train["is_late"])
        proba = model.predict_proba(test)[:, 1]
        pred = (proba >= 0.5).astype(int)
        pt = {
            "history_fraction": f,
            "n_train": int(len(train)),
            "train_late_rate": round(float(train["is_late"].mean()), 3),
            "auc": round(float(roc_auc_score(test["is_late"], proba)), 4),
            "f1": round(float(f1_score(test["is_late"], pred, zero_division=0)), 4),
            "recall": round(float(recall_score(test["is_late"], pred, zero_division=0)), 4),
        }
        points.append(pt)
        print(f"f={f:.0%}: n_train={pt['n_train']:>5}  AUC={pt['auc']}  "
              f"F1={pt['f1']}  recall={pt['recall']}")

    usable = next((p for p in points if p["auc"] >= USABILITY_AUC), None)
    result = {
        "config": {
            "seed": SEED, "fractions": FRACTIONS,
            "fixed_test": {"rule": f"rel_position > per-project q{TEMPORAL_Q}",
                           "n_test": int(len(test)),
                           "n_projects": len(trains_by_project)},
            "model": ("tuned champion from model_comparison.json: "
                      + json.loads((OUT / 'model_comparison.json').read_text())["champion"]["classifier"]),
            "usability_criterion": f"first fraction with AUC >= {USABILITY_AUC}",
        },
        "points": points,
        "usability_threshold": (
            {"history_fraction": usable["history_fraction"], "auc": usable["auc"],
             "n_train": usable["n_train"]} if usable else None),
    }
    (OUT / "learning_curve.json").write_text(json.dumps(result, indent=2))

    # ---- figure (book-ready) ----
    xs = [p["history_fraction"] * 100 for p in points]
    fig_dir = OUT / "figures"
    fig_dir.mkdir(exist_ok=True)
    plt.figure(figsize=(6.8, 5.0), dpi=150)
    plt.axhline(0.5, ls="--", lw=1, color="#9a9a9a")
    plt.annotate("chance (AUC 0.5)", xy=(xs[0], 0.5), xytext=(0, 6),
                 textcoords="offset points", fontsize=9, color="#8a8f98")
    plt.axhline(USABILITY_AUC, ls=":", lw=1.2, color="#1baf7a")
    plt.annotate(f"usability threshold ({USABILITY_AUC})", xy=(xs[-1], USABILITY_AUC),
                 xytext=(-150, 6), textcoords="offset points", fontsize=9, color="#1baf7a")
    plt.plot(xs, [p["auc"] for p in points], marker="o", ms=6, lw=2, color="#2a78d6")
    plt.annotate("ROC-AUC", xy=(xs[-1], points[-1]["auc"]), xytext=(6, 4),
                 textcoords="offset points", color="#3a3a3a", fontsize=10)
    plt.plot(xs, [p["f1"] for p in points], marker="o", ms=6, lw=2, color="#eb6834")
    plt.annotate("F1 (late)", xy=(xs[-1], points[-1]["f1"]), xytext=(6, -12),
                 textcoords="offset points", color="#3a3a3a", fontsize=10)
    if usable:
        ux = usable["history_fraction"] * 100
        plt.axvline(ux, ls=":", lw=1, color="#1baf7a")
    plt.xlabel("Available project history (% of labeled activities, temporal)")
    plt.ylabel("Score on fixed test set (latest 30%)")
    plt.title("RR-11 — Within-project learning curve (cold-start)")
    plt.ylim(0.2, 0.9)
    plt.grid(alpha=0.25, lw=0.5)
    plt.tight_layout()
    plt.savefig(fig_dir / "learning_curve.png")
    plt.close()
    print(f"\nSaved {OUT / 'learning_curve.json'} and figures/learning_curve.png")
    if usable:
        print(f"USABILITY: AUC >= {USABILITY_AUC} first reached at "
              f"{usable['history_fraction']:.0%} history (AUC {usable['auc']})")
    else:
        print(f"USABILITY: AUC >= {USABILITY_AUC} not reached at any fraction")
    return 0


if __name__ == "__main__":
    sys.exit(main())
