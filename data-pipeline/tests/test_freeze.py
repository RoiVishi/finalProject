"""freeze_test_set / frozen: whole families, the eligibility condition, determinism, and the guards."""
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from freeze_test_set import MIN_ELIGIBLE, draw, freeze  # noqa: E402
from frozen import FROZEN_FILE, assert_no_frozen, development_only, frozen_projects  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "outputs"


def _pool(n=40, eligible_every=3):
    return pd.DataFrame({"project": [f"dslib::p{i:02d}" for i in range(n)],
                         "eligible_grew": [i % eligible_every == 0 for i in range(n)]}).set_index("project")


def _fam(n=40, size=2):
    return {f"dslib::p{i:02d}": f"F{i // size}" for i in range(n)}


def test_draw_takes_whole_families_and_is_deterministic():
    pool, fam = _pool(), _fam(size=4)
    a, b = draw(pool, fam, seed=1), draw(pool, fam, seed=1)
    assert a == b                                              # same seed, same draw
    assert len(a) == 16                                        # 4 whole families: the first count >= 15
    fams = {fam[p] for p in a}
    assert all((fam[p] in fams) == (p in a) for p in pool.index)   # no family is split
    assert draw(pool, fam, seed=2) != a


def test_freeze_moves_to_the_next_seed_until_enough_eligible_projects():
    pool, fam = _pool(eligible_every=4), _fam()                # 10 eligible of 40: some draws fall short
    res = freeze(pool, fam, seed=0)
    assert int(pool.loc[res["projects"], "eligible_grew"].sum()) >= MIN_ELIGIBLE
    assert res["attempt"] == len(res["rejected_attempts"])
    assert all(r["eligible"] < MIN_ELIGIBLE for r in res["rejected_attempts"])
    assert res["projects"] == draw(pool, fam, res["seed"])


def test_freeze_fails_when_the_condition_cannot_be_met():
    pool = _pool()
    pool["eligible_grew"] = False
    with pytest.raises(RuntimeError):
        freeze(pool, _fam())


def test_guards(tmp_path):
    f = tmp_path / "frozen_test_set.json"
    f.write_text(json.dumps({"frozen": {"projects": ["dslib::A", "dslib::B"]}}))
    df = pd.DataFrame({"project": ["dslib::A", "dslib::C", "own::D"], "x": [1, 2, 3]})
    assert frozen_projects(f) == {"dslib::A", "dslib::B"}
    assert list(development_only(df, f)["project"]) == ["dslib::C", "own::D"]
    with pytest.raises(AssertionError):
        assert_no_frozen(df, "a test", f)
    with pytest.raises(FileNotFoundError):
        frozen_projects(tmp_path / "missing.json")


@pytest.mark.skipif(not FROZEN_FILE.exists(), reason="the test set has not been frozen yet")
def test_the_frozen_file_is_consistent():
    r = json.loads(FROZEN_FILE.read_text())
    fam = json.loads((OUT / "project_families.json").read_text())
    dropped = set(json.loads((OUT / "dslib_overwritten_projects.json").read_text())["projects"])
    frozen, dev = set(r["frozen"]["projects"]), set(r["development"]["dslib"]["projects"])
    assert len(frozen) >= 15 and r["frozen"]["n_eligible_grew"] >= MIN_ELIGIBLE
    assert all(p.startswith("dslib::") for p in frozen)       # BHD is not frozen
    assert not frozen & dev and not (frozen | dev) & dropped
    assert not {fam[p] for p in frozen} & {fam[p] for p in dev}   # no family on both sides
    assert len(frozen) + len(dev) == r["pool"]["dslib_projects"]


def test_flagged_projects_have_a_reason_and_a_corpus_id():
    from buildings import FLAGGED_PROJECTS
    assert FLAGGED_PROJECTS and all(k.startswith(("dslib::", "own::")) and v for k, v in FLAGGED_PROJECTS.items())
