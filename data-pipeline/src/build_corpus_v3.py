"""Corpus v3 — building projects only, label `grew` (registry v6, RR-21c).

Inputs (both produced by committed ETL scripts; the CSVs themselves are not in git):
  outputs/labeled_tasks.csv         etl.py           (Buildings.Historical.Data)
  outputs/dslib_labeled_tasks.csv   rr17_dslib_etl.py (Ghent DSLIB 3.4)
Output:
  outputs/corpus_v3_buildings.csv   one row per labeled activity of a building project
  outputs/corpus_v3_summary.json    counts per source and project (committed)

Label `grew` = the activity took longer than planned (actual duration > planned duration).
  own:   calendar days on dates (etl.py);  DSLIB: working days (rr17_dslib_etl.py).
  The two definitions agree on 91.8% of DSLIB activities where both can be computed (RR-21).
Features: the 11 plan-time features of feature_schema.json, identical names in both ETLs.
DSLIB has no task type → task_type is missing there (the pipeline imputes "NA", as for JPF).
Project ids are prefixed with their source ("own::", "dslib::") so they can never collide.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from buildings import OWN_BUILDINGS, OWN_NOT_BUILDINGS, OWN_UNKNOWN, dslib_buildings, own_buildings  # noqa: E402
from leakage import schema_features  # noqa: E402

OUT = HERE.parent / "outputs"
TARGET = "grew"
CORPUS = OUT / "corpus_v3_buildings.csv"


def build() -> pd.DataFrame:
    return build_from(pd.read_csv(OUT / "labeled_tasks.csv", low_memory=False),
                      pd.read_csv(OUT / "dslib_labeled_tasks.csv", low_memory=False))


def build_from(own: pd.DataFrame, ds: pd.DataFrame) -> pd.DataFrame:
    """Pure: filter both ETL outputs to labeled building activities and stack them."""
    feats = schema_features()
    own = own_buildings(own)
    own = own[own[TARGET].notna()].copy()
    own["source"] = "own"
    own["project"] = "own::" + own["project"].astype(str)

    ds = dslib_buildings(ds)
    ds = ds[ds[TARGET].notna()].copy()
    ds["source"] = "dslib"
    ds["project"] = "dslib::" + ds["project"].astype(str)
    ds["task_type"] = pd.Series([None] * len(ds), index=ds.index, dtype=object)

    cols = ["project", "source", "task_id", *feats, TARGET]
    corpus = pd.concat([own[cols], ds[cols]], ignore_index=True)
    corpus[TARGET] = corpus[TARGET].astype(int)
    return corpus


def main() -> int:
    corpus = build()
    corpus.to_csv(CORPUS, index=False)
    by_src = corpus.groupby("source").agg(projects=("project", "nunique"), activities=(TARGET, "size"),
                                          grew_rate=(TARGET, "mean"))
    summary = {
        "target": TARGET,
        "sources": {s: {"projects": int(r.projects), "activities": int(r.activities),
                        "grew_rate": round(float(r.grew_rate), 3)} for s, r in by_src.iterrows()},
        "total": {"projects": int(corpus["project"].nunique()), "activities": len(corpus),
                  "grew_rate": round(float(corpus[TARGET].mean()), 3)},
        "own_buildings": OWN_BUILDINGS, "own_excluded_not_buildings": OWN_NOT_BUILDINGS,
        "own_excluded_unknown": OWN_UNKNOWN,
        "dslib_filter": "sector_group == 'buildings' (residential/commercial/institutional) AND tracking flag G",
    }
    (OUT / "corpus_v3_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: summary[k] for k in ("sources", "total")}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
