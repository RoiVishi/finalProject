"""
DATA-2 hardening — containment de-duplication.

The original dedup (name+code Jaccard > 0.8) misses the case where one P6 file
CONTAINS another (e.g. a "merged" master file that includes a standalone
project). Jaccard is diluted by the container's extra tasks, so the pair
passes. This scan flags any project pair where >=80% of the smaller project's
task codes appear in the larger one, and reports which side to drop
(the container, unless it holds unique labeled tasks the standalone lacks).

Run: python src/dedup_containment.py   → prints pairs + writes outputs/dedup_containment.json
"""
from __future__ import annotations

import json
from itertools import combinations
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "outputs"
CONTAINMENT = 0.8


def main() -> int:
    df = pd.read_csv(OUT / "labeled_tasks.csv")
    codes = {p: set(g["task_code"].astype(str)) for p, g in df.groupby("project")}
    labeled = {p: set(g.loc[g["is_late"].notna(), "task_code"].astype(str))
               for p, g in df.groupby("project")}
    findings = []
    for a, b in combinations(sorted(codes), 2):
        small, big = (a, b) if len(codes[a]) <= len(codes[b]) else (b, a)
        inter = len(codes[small] & codes[big])
        ratio = inter / max(1, len(codes[small]))
        if ratio >= CONTAINMENT:
            unique_labeled_in_big = len(labeled[big] - labeled[small])
            drop = big if unique_labeled_in_big == 0 else small
            findings.append({
                "contained": small, "container": big,
                "containment": round(ratio, 3),
                "overlap_tasks": inter,
                "labeled_small": len(labeled[small]), "labeled_big": len(labeled[big]),
                "unique_labeled_in_container": unique_labeled_in_big,
                "recommended_drop": drop,
            })
            print(f"CONTAINMENT: '{small}' ⊂ '{big}' ({ratio:.0%}, {inter} tasks) "
                  f"→ drop '{drop}'")
    (OUT / "dedup_containment.json").write_text(json.dumps(findings, indent=2))
    if not findings:
        print("no containment pairs found")
    return 0


if __name__ == "__main__":
    main()
