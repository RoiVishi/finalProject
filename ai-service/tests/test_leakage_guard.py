"""PRED-14 (KAN-93), checked against the committed artifacts: every registry model
reads exactly the schema whitelist and no post-hoc column.

Registry v4/v5 were fitted on the whole labeled frame; the label and three post-hoc
columns were present at fit time and dropped by the ColumnTransformer (remainder='drop').
That is asserted here explicitly. Artifacts trained after PRED-14 (v6+) must not have
received them at all (`require_clean_fit_frame`).
"""
import sys
from pathlib import Path

import joblib
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data-pipeline" / "src"))
from leakage import check_artifact

REGISTRY = ROOT / "ai-service" / "model" / "registry"
ARTIFACTS = sorted((p for p in REGISTRY.glob("v*/classifier.joblib")),
                   key=lambda p: int(p.parent.name[1:]))
LAST_PRE_PRED14 = 5


@pytest.mark.skipif(not ARTIFACTS, reason="no committed registry artifact")
@pytest.mark.parametrize("path", ARTIFACTS, ids=lambda p: p.parent.name)
def test_artifact_consumes_exactly_the_whitelist(path):
    version = int(path.parent.name[1:])
    report = check_artifact(joblib.load(path), require_clean_fit_frame=version > LAST_PRE_PRED14)
    if version <= LAST_PRE_PRED14:
        # documented, not hidden: present at fit, never consumed
        assert set(report["post_hoc_present_at_fit_but_dropped"]) <= {"is_late", "delay_days", "extreme_delay", "status_code"}
