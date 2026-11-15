"""Advisor feedback (8.11.2026), item 9 — freeze the test set. The draw is made ONCE.

Procedure, as proposed to the advisor and written in the experiment log before this script ran:
  1. Pool: the DSLIB building projects of the cleaned corpus, after dropping the 13 projects whose
     planned dates repeat the actual ones (outputs/dslib_overwritten_projects.json, E2c).
     BHD is not frozen: it has 7 projects and all are needed for development.
  2. Whole families (outputs/project_families.json, the E2b map) are drawn in random order until
     the set holds >= 15 projects. A family is never split between the frozen set and development.
  3. The draw is accepted if it holds >= 6 projects eligible for the within-project metric under
     the primary label (`grew`: >= 30 activities and >= 5 in each class). Otherwise the next seed
     is tried. Seeds are SEED, SEED + 1, ...; every rejected attempt is recorded.
No model result is read here. Eligibility is counted on the labels only.

Run:  python3 src/freeze_test_set.py
  - first run: writes outputs/frozen_test_set.json;
  - later runs: recompute the draw and CHECK that it equals the file. The file is never rewritten.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from e2c_eligibility import FREEZE_MIN_PROJECTS, add_labels, dslib_rows, project_table  # noqa: E402
from frozen import FROZEN_FILE  # noqa: E402
from train_compare import SEED  # noqa: E402

OUT = HERE.parent / "outputs"
MIN_ELIGIBLE = 6            # eligible projects (primary label) the frozen set must hold
MAX_ATTEMPTS = 100
FROZEN_ON = "2026-11-15"    # date of the one draw
PRIMARY = "eligible_grew"

LIMITS = [
    "The final within-project number rests on the eligible frozen projects only (see n_eligible_grew). "
    "With so few projects its confidence interval is wide; small differences cannot be claimed.",
    "The frozen set is DSLIB only. The final number says nothing direct about projects like those of BHD "
    "(mid-execution snapshots, much higher overrun rate). BHD results are development results.",
    "The frozen families are not untouched: they were part of E1, E2, E2b and E2c. From the freeze on, "
    "no decision may use them.",
    "The draw was conditioned on holding >= 6 eligible projects, so the frozen set is richer in eligible "
    "projects than a plain random draw; rejected attempts are listed.",
    "Families come from name similarity with thresholds chosen by us (E2b). Another rule would give "
    "another frozen set.",
    "Eligibility was counted with the primary label on whole projects. Under the tolerance label fewer "
    "frozen projects are eligible (see n_eligible_tolerance).",
]


def draw(pool: pd.DataFrame, fam: dict, seed: int) -> list[str]:
    """Whole families in a seeded random order until >= FREEZE_MIN_PROJECTS projects. `pool` is indexed by project."""
    members: dict[str, list[str]] = {}
    for p in sorted(pool.index):
        members.setdefault(fam[p], []).append(p)
    families = sorted(members)
    chosen: list[str] = []
    for i in np.random.default_rng(seed).permutation(len(families)):
        chosen += members[families[i]]
        if len(chosen) >= FREEZE_MIN_PROJECTS:
            break
    return sorted(chosen)


def freeze(pool: pd.DataFrame, fam: dict, seed: int = SEED) -> dict:
    """First seed whose draw holds >= MIN_ELIGIBLE eligible projects. Returns the draw and the rejected attempts."""
    rejected = []
    for attempt in range(MAX_ATTEMPTS):
        chosen = draw(pool, fam, seed + attempt)
        n_elig = int(pool.loc[chosen, PRIMARY].sum())
        if n_elig >= MIN_ELIGIBLE:
            return {"seed": seed + attempt, "attempt": attempt, "projects": chosen, "rejected_attempts": rejected}
        rejected.append({"attempt": attempt, "seed": seed + attempt, "projects": len(chosen), "eligible": n_elig})
    raise RuntimeError(f"no draw with >= {MIN_ELIGIBLE} eligible projects in {MAX_ATTEMPTS} attempts")


def describe(pool: pd.DataFrame, projects: list[str], fam: dict) -> dict:
    g = pool.loc[projects]
    return {"n_projects": len(projects), "projects": projects,
            "n_families": len({fam[p] for p in projects}), "families": sorted({fam[p] for p in projects}),
            "activities": int(g["activities"].sum()),
            "grew_rate": round(float(g["grew_pos"].sum() / g["activities"].sum()), 3),
            "n_eligible_grew": int(g["eligible_grew"].sum()),
            "eligible_grew": sorted(g.index[g["eligible_grew"]]),
            "n_eligible_tolerance": int(g["eligible_tolerance"].sum()),
            "n_eligible_ratio_B": int(g["eligible_ratio_B"].sum())}


def build() -> dict:
    clean = pd.read_csv(OUT / "corpus_v3_clean.csv", low_memory=False)
    fam = json.loads((OUT / "project_families.json").read_text())
    dropped = set(json.loads((OUT / "dslib_overwritten_projects.json").read_text())["projects"])
    table = project_table(add_labels(dslib_rows(clean)))
    pool = table[~table["project"].isin(dropped)].set_index("project")
    res = freeze(pool, fam)
    frozen = res["projects"]
    development = sorted(set(pool.index) - set(frozen))
    split_families = {fam[p] for p in frozen} & {fam[p] for p in development}
    assert not split_families, f"families split between frozen and development: {split_families}"
    return {
        "frozen_on": FROZEN_ON,
        "procedure": (f"whole DSLIB families in seeded random order until >= {FREEZE_MIN_PROJECTS} projects; "
                      f"accepted when >= {MIN_ELIGIBLE} projects are eligible under the primary label "
                      "(grew: >= 30 activities and >= 5 in each class); otherwise the next seed"),
        "inputs": {"corpus": "outputs/corpus_v3_clean.csv", "families": "outputs/project_families.json",
                   "dropped_before_the_draw": "outputs/dslib_overwritten_projects.json"},
        "seed_base": SEED, "seed_used": res["seed"], "attempt": res["attempt"],
        "rejected_attempts": res["rejected_attempts"],
        "pool": {"dslib_projects": int(len(pool)), "dslib_families": len({fam[p] for p in pool.index}),
                 "eligible_grew": int(pool["eligible_grew"].sum())},
        "frozen": describe(pool, frozen, fam),
        "development": {"dslib": describe(pool, development, fam),
                        "bhd_projects": sorted(clean.loc[clean["source"] == "own", "project"].unique())},
        "use": ["development_only() from src/frozen.py in every script that trains, tunes, calibrates, "
                "sets thresholds or compares variants",
                "the frozen projects are read once, by the final evaluation, after every decision is fixed"],
        "limits_on_validity": LIMITS,
    }


def main() -> int:
    result = build()
    text = json.dumps(result, indent=1, ensure_ascii=False) + "\n"
    f = result["frozen"]
    if FROZEN_FILE.exists():
        stored = json.loads(FROZEN_FILE.read_text())
        same = stored["frozen"]["projects"] == f["projects"] and stored["seed_used"] == result["seed_used"]
        print("frozen set on file:", len(stored["frozen"]["projects"]), "projects;",
              "recomputed draw is IDENTICAL" if same else "recomputed draw DIFFERS — do not use, find out why")
        return 0 if same else 1
    FROZEN_FILE.write_text(text)
    print(f"FROZEN {f['n_projects']} projects in {f['n_families']} families "
          f"(seed {result['seed_used']}, attempt {result['attempt']}, rejected {len(result['rejected_attempts'])})")
    print("eligible in the frozen set: grew", f["n_eligible_grew"], "| tolerance", f["n_eligible_tolerance"],
          "| ratio B", f["n_eligible_ratio_B"])
    d = result["development"]["dslib"]
    print(f"development: {d['n_projects']} DSLIB projects ({d['n_eligible_grew']} eligible) "
          f"+ {len(result['development']['bhd_projects'])} BHD projects")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
