"""
RR-13 — Scenario-A stability: repeated splits + leave-one-project-out (LOPO).

Motivation: the single GroupShuffleSplit behind scenario A produced wildly
different AUCs across models (RF 0.19, LogReg 0.89, XGB 0.57) — a single
random draw of test projects is too noisy to gate on or to publish alone.

Part 1 — repeated splits: 20 GroupShuffleSplit draws (seeds 0..19), all five
models refit per draw with the tuned params from model_comparison.json.
Reported per model: mean/std/min/max AUC + share of draws above chance.

Part 2 — LOPO: for the champion only, each labeled project in turn becomes
the test set (train on all others). This is the honest per-project answer to
"what would a brand-new project experience?".

Output: outputs/scenario_a_stability.json + figures/scenario_a_stability.png
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_compare import SEED, load_labeled, make_preprocessor

OUT = Path(__file__).resolve().parents[1] / "outputs"
N_SPLITS = 20


def zoo(best):
    import ast

    def params(name):
        out = {}
        for k, v in best.get(name, {}).items():
            k = k.replace("model__", "")
            if isinstance(v, str) and v.startswith("("):   # stringified tuple, e.g. "(64,)"
                v = ast.literal_eval(v)
            out[k] = v
        return out
    from xgboost import XGBClassifier
    return {
        "dummy_majority": DummyClassifier(strategy="most_frequent"),
        "logistic_regression": LogisticRegression(max_iter=2000, class_weight="balanced",
                                                  **params("logistic_regression")),
        "random_forest": RandomForestClassifier(random_state=SEED, n_jobs=-1,
                                                class_weight="balanced", **params("random_forest")),
        "xgboost": XGBClassifier(random_state=SEED, n_jobs=-1, eval_metric="logloss",
                                 tree_method="hist", **params("xgboost")),
        "mlp": MLPClassifier(random_state=SEED, max_iter=400, **params("mlp")),
    }


def main() -> int:
    r = json.loads((OUT / "model_comparison.json").read_text())
    best = r["best_params"]
    champ = r["champion"]["classifier"]
    lab = load_labeled()
    groups = lab["project"]

    # ---------- part 1: repeated GroupShuffleSplit ----------
    aucs = {name: [] for name in zoo(best)}
    for seed in range(N_SPLITS):
        gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=seed)
        tr_idx, te_idx = next(gss.split(lab, groups=groups))
        tr, te = lab.iloc[tr_idx], lab.iloc[te_idx]
        if te["is_late"].nunique() < 2:
            print(f"seed {seed}: single-class test, skipped")
            continue
        for name, est in zoo(best).items():
            pipe = Pipeline([("prep", make_preprocessor()), ("model", est)])
            pipe.fit(tr, tr["is_late"])
            proba = (pipe.predict_proba(te)[:, 1] if hasattr(pipe, "predict_proba")
                     else pipe.decision_function(te))
            aucs[name].append(round(float(roc_auc_score(te["is_late"], proba)), 4))
        print(f"seed {seed}: " + "  ".join(f"{n}={aucs[n][-1]}" for n in aucs))

    summary = {}
    for name, vals in aucs.items():
        v = np.array(vals)
        summary[name] = {
            "mean": round(float(v.mean()), 4), "std": round(float(v.std()), 4),
            "min": round(float(v.min()), 4), "max": round(float(v.max()), 4),
            "share_above_chance": round(float((v > 0.5).mean()), 3),
            "n_splits": len(vals),
        }
        print(f"[summary] {name}: mean={summary[name]['mean']} ± {summary[name]['std']} "
              f"range [{summary[name]['min']}, {summary[name]['max']}] "
              f">chance in {summary[name]['share_above_chance']:.0%}")

    # ---------- part 2: LOPO for the champion ----------
    lopo = []
    for proj, g in lab.groupby("project"):
        if g["is_late"].nunique() < 2 or len(g) < 30:
            continue
        tr = lab[lab["project"] != proj]
        pipe = Pipeline([("prep", make_preprocessor()),
                         ("model", zoo(best)[champ])])
        pipe.fit(tr, tr["is_late"])
        auc = round(float(roc_auc_score(g["is_late"], pipe.predict_proba(g)[:, 1])), 4)
        lopo.append({"project": proj, "n": len(g),
                     "late_rate": round(float(g["is_late"].mean()), 3), "auc": auc})
        print(f"[LOPO] {proj[:35]:37s} n={len(g):5d}  AUC={auc}")
    lopo_aucs = np.array([x["auc"] for x in lopo])

    result = {
        "config": {"n_splits": N_SPLITS, "split": "GroupShuffleSplit by project, test 25%, seeds 0..19",
                   "models": "tuned params from model_comparison.json", "champion": champ},
        "repeated_splits": summary,
        "lopo_champion": {"projects": lopo,
                          "median_auc": round(float(np.median(lopo_aucs)), 4),
                          "share_above_chance": round(float((lopo_aucs > 0.5).mean()), 3)},
        "conclusion": ("Cross-project transfer is unstable and weak regardless of model choice; "
                       "single-split scenario-A numbers must never be quoted alone. "
                       "Product framing (history-based prediction, PRED-10 abstention) unchanged."),
    }
    (OUT / "scenario_a_stability.json").write_text(json.dumps(result, indent=2))

    # ---------- figure ----------
    fig_dir = OUT / "figures"
    fig_dir.mkdir(exist_ok=True)
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.6), dpi=150)
    names = [n for n in aucs if n != "dummy_majority"]
    ax1.axhline(0.5, ls="--", lw=1, color="#9a9a9a")
    bp = ax1.boxplot([aucs[n] for n in names], tick_labels=[n.replace("_", "\n") for n in names],
                     patch_artist=True, medianprops={"color": "#1F3864", "lw": 2})
    for patch in bp["boxes"]:
        patch.set_facecolor("#2a78d6")
        patch.set_alpha(0.35)
    ax1.set_ylabel("ROC-AUC")
    ax1.set_title(f"Scenario A across {N_SPLITS} repeated splits")
    ax1.grid(alpha=0.25, lw=0.5, axis="y")

    order = np.argsort(lopo_aucs)
    ax2.axvline(0.5, ls="--", lw=1, color="#9a9a9a")
    ax2.barh(range(len(lopo)), lopo_aucs[order],
             color=["#eb6834" if a < 0.5 else "#2a78d6" for a in lopo_aucs[order]], alpha=0.85)
    ax2.set_yticks(range(len(lopo)))
    ax2.set_yticklabels([lopo[i]["project"][:22] for i in order], fontsize=7)
    ax2.set_xlabel("ROC-AUC (leave-one-project-out)")
    ax2.set_title(f"LOPO — champion ({champ})")
    ax2.grid(alpha=0.25, lw=0.5, axis="x")
    plt.tight_layout()
    plt.savefig(fig_dir / "scenario_a_stability.png")
    plt.close()
    print(f"\nSaved {OUT / 'scenario_a_stability.json'} and figures/scenario_a_stability.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
