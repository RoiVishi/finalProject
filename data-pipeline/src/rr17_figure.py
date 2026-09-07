"""RR-17 figure — same conventions as rr15_jpf.png."""

import json
import sys
from pathlib import Path
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "outputs")
R = json.load(open(OUT / "rr17_dslib.json"))
A = R["part_A_transfer"]["labels"]
LC = R["post_hoc_label_construct"]
B = R["part_B_corpus_v3"]["runs"]
D = R["part_D_asof_snapshots"]["results"]
DP = R["post_hoc_part_D_variants"]["results"]
fig, ax = plt.subplots(1, 3, figsize=(17, 5.2), dpi=150)
# (1) label construct: signed position→label AUC per corpus
names = [
    "own\nis_late\n(updated plan)",
    "JPF\nis_late",
    "JPF\ngrew",
    "DSLIB\nis_late\n(frozen baseline)",
    "DSLIB\ngrew",
]
vals = [
    LC["own_is_late_updated_plan"]["auc_position_median"],
    LC["jpf_is_late"]["auc_position_median"],
    LC["jpf_grew"]["auc_position_median"],
    LC["dslib_is_late_frozen_baseline"]["auc_position_median"],
    LC["dslib_grew"]["auc_position_median"],
]
cols = ["#1baf7a", "#2a78d6", "#2a78d6", "#eb6834", "#eb6834"]
ax[0].axhline(0.5, ls="--", lw=1, color="#9a9a9a")
ax[0].bar(range(5), vals, color=cols, alpha=0.85)
for i, v in enumerate(vals):
    ax[0].text(i, v + 0.01, f"{v:.2f}", ha="center", fontsize=9)
ax[0].set_xticks(range(5))
ax[0].set_xticklabels(names, fontsize=7.5)
ax[0].set_ylim(0.3, 0.75)
ax[0].set_ylabel("median within-project AUC of rel_position → label")
ax[0].set_title("Same feature, opposite sign: label construct")
ax[0].grid(alpha=0.25, lw=0.5, axis="y")
# (2) transfer + corpus v3 on DSLIB buildings
lab = [
    "v4\nis_late",
    "v4\ngrew",
    "v5 (own+JPF)\ngrew",
    "v3-RF harm.\nhold-out grew",
    "v3-RF harm.\nhold-out is_late",
]
v = [
    A["is_late"]["by_group"]["buildings"]["v4"],
    A["grew"]["by_group"]["buildings"]["v4"],
    A["grew"]["by_group"]["buildings"]["v5_candidate"],
    B["random_forest__y_harmonised"]["dslib_holdout"]["grew"]["by_group"]["buildings"],
    B["random_forest__y_harmonised"]["dslib_holdout"]["is_late"]["by_group"][
        "buildings"
    ],
]
c2 = ["#9a9a9a", "#9a9a9a", "#2a78d6", "#1baf7a", "#1baf7a"]
ax[1].axhline(0.5, ls="--", lw=1, color="#9a9a9a")
ax[1].bar(range(5), v, color=c2, alpha=0.85)
for i, x in enumerate(v):
    ax[1].text(i, x + 0.01, f"{x:.2f}", ha="center", fontsize=9)
ax[1].set_xticks(range(5))
ax[1].set_xticklabels(lab, fontsize=7.5)
ax[1].set_ylim(0.3, 0.75)
ax[1].set_ylabel("ROC-AUC on DSLIB buildings")
ax[1].set_title("DSLIB buildings: transfer vs. corpus v3")
ax[1].grid(alpha=0.25, lw=0.5, axis="y")
# (3) as-of on real snapshots
lab3 = [
    "plan-time\n(11 feat.)",
    "plan-time\n+ as-of",
    "plan-time\n(no proj. size)\n+ as-of",
    "naive rule\nmedian slip",
    "as-of only\n(logistic)",
]
v3 = [
    D["is_late"]["plan_time_only"]["auc"],
    D["is_late"]["plan_time_plus_asof"]["auc"],
    DP["is_late"]["plan_time_without_project_size_plus_asof"]["auc"],
    D["is_late"]["naive_rule_median_slip"],
    DP["is_late"]["asof_only_logreg"]["auc"],
]
c3 = ["#9a9a9a", "#2a78d6", "#2a78d6", "#eb6834", "#eb6834"]
ax[2].axhline(0.5, ls="--", lw=1, color="#9a9a9a")
ax[2].bar(range(5), v3, color=c3, alpha=0.85)
for i, x in enumerate(v3):
    ax[2].text(i, x + 0.01, f"{x:.2f}", ha="center", fontsize=9)
ax[2].set_xticks(range(5))
ax[2].set_xticklabels(lab3, fontsize=7.5)
ax[2].set_ylim(0.3, 0.75)
ax[2].set_ylabel("pooled AUC, not-started activities at TP, is_late")
ax[2].set_title(
    f"As-of on {R['part_D_asof_snapshots']['n_snapshots']} real snapshots (GroupKFold by project)"
)
ax[2].grid(alpha=0.25, lw=0.5, axis="y")
plt.tight_layout()
(OUT / "figures").mkdir(exist_ok=True)
plt.savefig(OUT / "figures" / "rr17_dslib.png")
print("saved")
