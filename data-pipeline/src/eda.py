"""
EDA: exploratory analysis of the labeled task dataset.
Writes outputs/eda_report.md + charts (PNG) for the project book.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "outputs"
FIG = OUT / "figures"
FIG.mkdir(parents=True, exist_ok=True)


def main():
    df = pd.read_csv(OUT / "labeled_tasks.csv")
    from train_compare import EXCLUDE_PROJECTS  # DATA-2: same dedup corpus everywhere
    df = df[~df["project"].isin(EXCLUDE_PROJECTS)]
    lab = df[df["is_late"].notna()].copy()
    lab["is_late"] = lab["is_late"].astype(int)

    lines = ["# EDA Report — Task Delay Dataset\n"]
    lines.append(f"- Total tasks: **{len(df):,}** across **{df['project'].nunique()}** projects (after dedup)")
    lines.append(f"- Labeled tasks: **{len(lab):,}** in **{lab['project'].nunique()}** projects")
    lines.append(f"- Late rate: **{lab['is_late'].mean():.1%}**")
    lines.append(f"- Delay days: median {lab['delay_days'].median():.0f}, "
                 f"IQR [{lab['delay_days'].quantile(.25):.0f}, {lab['delay_days'].quantile(.75):.0f}], "
                 f"min {lab['delay_days'].min():.0f}, max {lab['delay_days'].max():.0f}")
    lines.append(f"- Extreme delays (>365d abs): {int(lab['extreme_delay'].sum())} tasks\n")

    # delay distribution (clipped for readability)
    plt.figure(figsize=(8, 4))
    lab["delay_days"].clip(-60, 120).hist(bins=60)
    plt.title("Delay distribution (days, clipped to [-60, 120])")
    plt.xlabel("delay days (actual - planned finish)")
    plt.tight_layout()
    plt.savefig(FIG / "delay_distribution.png", dpi=120)
    plt.close()

    # late rate per project
    per_proj = lab.groupby("project").agg(n=("is_late", "size"), late_rate=("is_late", "mean")).sort_values("n", ascending=False)
    lines.append("## Labeled tasks per project\n")
    lines.append(per_proj.to_markdown())
    plt.figure(figsize=(9, 5))
    per_proj["late_rate"].plot(kind="bar")
    plt.title("Late rate by project")
    plt.ylabel("share of late tasks")
    plt.xticks(fontsize=6, rotation=90)
    plt.tight_layout()
    plt.savefig(FIG / "late_rate_by_project.png", dpi=120)
    plt.close()

    # feature vs label quick look
    lines.append("\n## Feature medians by class (late vs on-time)\n")
    feats = ["planned_duration_days", "total_float_hr", "n_pred", "n_succ", "upstream_cnt", "downstream_cnt", "rel_position"]
    lines.append(lab.groupby("is_late")[feats].median().to_markdown())

    plt.figure(figsize=(8, 4))
    lab.boxplot(column="planned_duration_days", by="is_late", showfliers=False)
    plt.suptitle("")
    plt.title("Planned duration vs lateness")
    plt.tight_layout()
    plt.savefig(FIG / "duration_vs_late.png", dpi=120)
    plt.close()

    (OUT / "eda_report.md").write_text("\n".join(lines))
    print(f"Wrote {OUT / 'eda_report.md'} and figures to {FIG}")


if __name__ == "__main__":
    main()
