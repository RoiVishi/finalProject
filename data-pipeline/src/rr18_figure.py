"""RR-18 figure: customer-only model on new projects + learning curve."""
import json, sys, numpy as np
from pathlib import Path
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "outputs"); R = json.load(open(OUT / "rr18_customer_sim.json"))
A = R["part_A_new_project_holdout"]; C = R["part_C_learning_curve"]["curve"]; D = R["part_D_asof_combination"]["results"]["is_late"]
fig, ax = plt.subplots(1, 3, figsize=(17, 5.2), dpi=150)
# (1) hold-out new projects: customer-only RF vs pooled models from RR-17
lab = ["v4\n(own)", "v5\n(own+JPF)", "corpus v3\n(3 sources)", "customer\nis_late", "customer\nis_late >7d", "customer\ngrew"]
v = [0.4615, 0.4241, 0.529, A["is_late"]["random_forest"]["pooled"], A["is_late_7"]["random_forest"]["pooled"], A["grew"]["random_forest"]["pooled"]]
c = ["#9a9a9a", "#9a9a9a", "#9a9a9a", "#1baf7a", "#1baf7a", "#1baf7a"]
ax[0].axhline(0.5, ls="--", lw=1, color="#9a9a9a"); ax[0].bar(range(6), v, color=c, alpha=0.85)
for i, x in enumerate(v): ax[0].text(i, x + 0.01, f"{x:.2f}", ha="center", fontsize=9)
ax[0].set_xticks(range(6)); ax[0].set_xticklabels(lab, fontsize=7.5); ax[0].set_ylim(0.3, 0.8); ax[0].set_ylabel("pooled ROC-AUC, 46 unseen DSLIB projects")
ax[0].set_title("New projects of the same customer"); ax[0].grid(alpha=0.25, lw=0.5, axis="y")
# (2) learning curve
for lbl, col in (("is_late", "#2a78d6"), ("grew", "#eb6834")):
    ns = sorted(int(k) for k in C[lbl]); med = [C[lbl][str(n)]["pooled_median"] for n in ns]
    lo = [C[lbl][str(n)]["pooled_min"] for n in ns]; hi = [C[lbl][str(n)]["pooled_max"] for n in ns]
    ax[1].plot(ns, med, "o-", color=col, label=f"{lbl} (pooled, median of 10 draws)"); ax[1].fill_between(ns, lo, hi, color=col, alpha=0.15)
    pm = [C[lbl][str(n)]["per_project_median_of_medians"] for n in ns]; ax[1].plot(ns, pm, "s--", color=col, alpha=0.6, label=f"{lbl} (within-project median)")
ax[1].axhline(0.5, ls="--", lw=1, color="#9a9a9a"); ax[1].set_xlabel("number of the customer's projects used for training"); ax[1].set_ylabel("ROC-AUC on the fixed hold-out")
ax[1].set_title("Learning curve — still climbing at 71 projects"); ax[1].legend(fontsize=7.5); ax[1].grid(alpha=0.25, lw=0.5); ax[1].set_ylim(0.4, 0.75)
# (3) as-of: model vs drift rule on hold-out snapshots
lab3 = ["plan-time\ncustomer model", "drift rule\n(median start slip)", "share finished\nlate so far", "logistic\ncombination"]
v3 = [D["plan_time_model_alone"], D["drift_rule_alone"], D["share_finished_late_alone"], D["combination_model+drift_logistic"]]
ax[2].axhline(0.5, ls="--", lw=1, color="#9a9a9a"); ax[2].bar(range(4), v3, color=["#1baf7a", "#eb6834", "#eb6834", "#2a78d6"], alpha=0.85)
for i, x in enumerate(v3): ax[2].text(i, x + 0.01, f"{x:.2f}", ha="center", fontsize=9)
ax[2].set_xticks(range(4)); ax[2].set_xticklabels(lab3, fontsize=8); ax[2].set_ylim(0.3, 0.8); ax[2].set_ylabel("pooled AUC, not-started activities at TP, is_late")
ax[2].set_title(f"At as-of time ({R['part_D_asof_combination']['holdout_snapshots']} hold-out snapshots)"); ax[2].grid(alpha=0.25, lw=0.5, axis="y")
plt.tight_layout(); plt.savefig(OUT / "figures" / "rr18_customer_sim.png"); print("saved")
