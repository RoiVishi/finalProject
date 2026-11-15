"""The frozen test set (advisor item 9): who is in it, and guards that keep it out of development.

The set is chosen once by freeze_test_set.py and stored in outputs/frozen_test_set.json.
Every script that trains, tunes, calibrates, picks thresholds or compares variants must work on
`development_only(df)`. The frozen projects are read by one script only: the single final evaluation.

This module has no heavy imports on purpose, so any script can use it.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

FROZEN_FILE = Path(__file__).resolve().parent.parent / "outputs" / "frozen_test_set.json"


def frozen_projects(path: Path = FROZEN_FILE) -> set[str]:
    """Corpus ids ("dslib::C2013-06") of the frozen projects. Fails if the set was never frozen."""
    if not path.exists():
        raise FileNotFoundError(f"{path} is missing: run src/freeze_test_set.py before any experiment")
    return set(json.loads(path.read_text())["frozen"]["projects"])


def development_only(df: pd.DataFrame, path: Path = FROZEN_FILE) -> pd.DataFrame:
    """The rows of `df` that development may see: everything except the frozen projects."""
    out = df[~df["project"].isin(frozen_projects(path))]
    assert_no_frozen(out, "development_only", path)
    return out


def assert_no_frozen(df: pd.DataFrame, where: str = "", path: Path = FROZEN_FILE) -> None:
    """Raise if any frozen project is present. Call it right before fitting or tuning."""
    leaked = sorted(set(df["project"]) & frozen_projects(path))
    if leaked:
        raise AssertionError(f"frozen test projects reached {where or 'a development step'}: {leaked}")
