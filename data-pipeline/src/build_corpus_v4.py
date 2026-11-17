"""Corpus v4: corpus v3 with the cleaning rules of src/clean_rules.py (advisor item 6). Used from E3 on.

Inputs:  outputs/corpus_v3_buildings.csv (build_corpus_v3.py), outputs/dslib_labeled_tasks.csv
         (rr17_dslib_etl.py), the raw BHD tables in data_bhd/Buildings Data (not in git).
Output:  outputs/corpus_v4.csv (not in git) and outputs/corpus_v4_summary.json (committed).
Corpus v3 and every experiment before E3 (E1-E2c) are left as they are.

Run:  python src/build_corpus_v4.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from clean_rules import OVERWRITTEN_SHARE, WORK_TYPES, clean_bhd, clean_dslib, read_bhd_tasks  # noqa: E402

OUT = HERE.parent / "outputs"
RAW_BHD = HERE.parent / "data_bhd" / "Buildings Data"


def main() -> int:
    v3 = pd.read_csv(OUT / "corpus_v3_buildings.csv", low_memory=False)
    ds = pd.read_csv(OUT / "dslib_labeled_tasks.csv", low_memory=False)
    ds["project"] = "dslib::" + ds["project"].astype(str)
    own_v3 = v3[v3["source"] == "own"]
    raw = pd.concat([read_bhd_tasks(RAW_BHD, p.removeprefix("own::")) for p in sorted(own_v3["project"].unique())],
                    ignore_index=True)
    own, r_own = clean_bhd(own_v3, raw)
    dsl, r_ds = clean_dslib(v3[v3["source"] == "dslib"], ds)
    v4 = pd.concat([own, dsl], ignore_index=True).sort_values(["project", "task_id"])
    v4.to_csv(OUT / "corpus_v4.csv", index=False)
    by = v4.groupby("source").agg(projects=("project", "nunique"), activities=("grew", "size"), grew_rate=("grew", "mean"))
    summary = {
        "rules": {"work_types_bhd": sorted(WORK_TYPES), "planned_duration": "> 0",
                  "overwritten_plan": f"planned start and finish both equal the actual ones on >= {OVERWRITTEN_SHARE:.0%}"},
        "steps": {"own": r_own, "dslib": r_ds},
        "sources": {s: {"projects": int(r.projects), "activities": int(r.activities), "grew_rate": round(float(r.grew_rate), 3)}
                    for s, r in by.iterrows()},
        "total": {"projects": int(v4["project"].nunique()), "activities": len(v4), "grew_rate": round(float(v4["grew"].mean()), 3)},
    }
    (OUT / "corpus_v4_summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({k: summary[k] for k in ("sources", "total")}, indent=1))
    print("dropped:", r_own["dropped_projects"] + r_ds["dropped_projects"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
