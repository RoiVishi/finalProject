"""PRED-15 (KAN-94): global explainability of the SERVED model — mean |SHAP| ranking.

Run after every promotion (after train_compare.py writes a new registry version):

    python src/global_shap.py

Writes
  ai-service/model/registry/<served>/global_shap.json   served by GET /explain/global
  outputs/figures/global_shap_<served>.png               the project-book figure

Both are generated from the same data, so the book figure is never drawn by hand.
Rows: the scenario-B test split of the served model's corpus (v6: corpus v3, building
projects only; never used for fitting or selection), at most 2,000 rows, seed 42. Units: calibrated probability, identical to
the per-activity explanations (KAN-130). CI fails if the served version has no ranking
or a ranking computed for another version (ai-service/tests/test_global_shap.py).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "ai-service"))

from app import main as service  # noqa: E402  — the served model, loaded exactly as in production
from leakage import plan_time  # noqa: E402  — PRED-14: same whitelist as training
from train_compare import load_corpus, temporal_split  # noqa: E402

FIG_DIR = ROOT / "data-pipeline" / "outputs" / "figures"

# Chart ink (dataviz reference palette): one series → one hue, recessive chrome.
BAR = "#256abf"
INK, INK_2, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#fcfcfb"


def figure(result: dict, out: Path) -> None:
    rows = list(reversed(result["ranking"]))            # largest at the top
    labels = [r["label_en"] for r in rows]
    values = [r["mean_abs_contribution"] * 100 for r in rows]   # percentage points
    fig, ax = plt.subplots(figsize=(7.5, 0.42 * len(rows) + 1.2), dpi=200)
    fig.patch.set_facecolor(SURFACE)
    ax.set_facecolor(SURFACE)
    bars = ax.barh(labels, values, height=0.55, color=BAR)
    top = max(values) if values else 1
    for b, v in zip(bars, values):
        ax.text(b.get_width() + top * 0.01, b.get_y() + b.get_height() / 2, f"{v:.2f}",
                va="center", ha="left", fontsize=8, color=INK_2)
    ax.set_xlim(0, top * 1.12)
    ax.set_xlabel("Mean |contribution| to the served probability (percentage points)",
                  fontsize=8.5, color=INK_2)
    fig.suptitle(f"Global feature importance — registry {result['model_version']}",
                 x=0.02, ha="left", fontsize=10.5, color=INK, fontweight="bold")
    fig.text(0.02, 0.935, f"Mean |SHAP| over {result['n_rows']:,} activities of the scenario-B test split",
             ha="left", fontsize=8.5, color=INK_2)
    ax.tick_params(axis="y", labelsize=8.5, colors=INK, length=0)
    ax.tick_params(axis="x", labelsize=8, colors=MUTED)
    ax.grid(axis="x", color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color("#c3c2b7")
    fig.tight_layout(rect=(0, 0, 1, 0.92))
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, facecolor=SURFACE)
    plt.close(fig)


def main() -> dict:
    reg = service.get_registry()
    if not reg.ready or reg.dir is None:
        raise SystemExit(f"no served model: {reg.refusal}")
    _, b_test, _ = temporal_split(load_corpus(), ineligible_to_train=True)   # v6: corpus v3 (buildings)
    result = service.global_ranking(reg, plan_time(b_test))
    result["computed_on"] = "scenario-B test split (per-project temporal cut, q=0.7)"
    (reg.dir / service.GLOBAL_SHAP_FILE).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    figure(result, FIG_DIR / f"global_shap_{reg.version}.png")
    print(f"registry {reg.version}: " + ", ".join(
        f"{r['rank']}. {r['feature']} {r['mean_abs_contribution']:.4f}" for r in result["ranking"]))
    return result


if __name__ == "__main__":
    main()
