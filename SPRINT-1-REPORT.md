# Sprint 1 Report — AI Core (26.7.2026)

**Jira stories:** KAN-79 (RR-3), KAN-80 (RR-4), KAN-81 (RR-5), KAN-41 (PRED-4), KAN-40 (PRED-3), KAN-75 (PRED-6)

## What was done

### 1. Model comparison — `data-pipeline/src/train_compare.py` (RR-3, RR-4, RR-5)
Five classifiers (dummy, LogReg, RF, XGBoost, MLP) and three regressors (dummy, RF, XGBoost) evaluated in **two leakage-aware scenarios**:

- **Scenario A — cross-project** (GroupShuffleSplit by project): simulates a brand-new project.
- **Scenario B — within-project temporal** (train on first 70% of each project's timeline by `rel_position`, test on the rest): simulates a live project mid-execution. This is the deployment claim.

Hyperparameters tuned with GridSearchCV + GroupKFold(3) on the scenario-A training set (seed=42, full config in `outputs/model_comparison.json`).

### 2. Results (classification, ROC-AUC / F1)

| Model | A: cross-project | B: temporal |
|---|---|---|
| dummy | 0.500 / 0.000 | 0.500 / 0.282 |
| Logistic Regression | 0.553 / 0.622 | 0.817 / 0.231 |
| **Random Forest (champion)** | 0.543 / 0.135 | **0.828 / 0.517** |
| XGBoost | 0.554 / 0.211 | 0.816 / 0.446 |
| MLP | 0.576 / 0.567 | 0.825 / 0.504 |

Regression (delay days, MAE): scenario B — **XGBoost 25.7** vs dummy 32.9 (champion regressor); scenario A remains worse than dummy (documented limitation).

**Scientific finding for the project book:** cross-project transfer is near-random (~0.55 AUC) — schedules differ too much between projects; within-project temporal prediction is strong (0.83 AUC). This motivates the product design: predictions improve as a project accumulates history.

**Known limitation:** scenario B currently covers only 2 projects with ≥20 labeled tasks on each side of the temporal cut (622 train / 232 test). Action item for next sprint: relax the threshold / enrich labeling to widen coverage, and discuss with the advisor.

### 3. Model registry — `ai-service/model/registry/v1/` (PRED-4)
`classifier.joblib` + `regressor.joblib` + `meta.json` (version, champion names, tuned params, metrics in both scenarios, feature list, seed). The service loads the newest `vN` automatically; every API response carries `model_version`. Legacy artifact still works as fallback.

### 4. AI service v0.2.0 — `ai-service/app/main.py` (PRED-1, PRED-3, PRED-5)
- `/predict`, `/predict/batch` now return `estimated_delay_days` (champion regressor) + `model_version`.
- **`/explain` (new):** SHAP TreeExplainer, contributions aggregated per base feature, top-k signed values with **domain-language labels in Hebrew and English** (NFR-USE-1 — no bare scores).
- `/health` reports version + champion. Missing registry → 503 with actionable guidance (PRED-5).

### 5. Quality gate — `data-pipeline/src/quality_gate.py` (PRED-6)
Fails (exit 1) unless the champion beats the dummy on F1+AUC in both scenarios and beats LogReg on AUC in scenario B, and the champion regressor beats the dummy MAE in scenario B. Wired into GitHub Actions (`ci.yml`, data-pipeline job). **Current status: PASSED.**

### 6. Tests — `ai-service/tests/test_api.py`
5 tests, all passing: health contract, prediction shape + model_version, batch consistency, explanation contract (labels, signed values, descending magnitude), and 503 degradation with an empty registry. `ruff` lint: clean.

## Files changed/added
```
data-pipeline/src/train_compare.py        (new)
data-pipeline/src/quality_gate.py         (new)
data-pipeline/outputs/model_comparison.json (new)
ai-service/app/main.py                    (rewritten, v0.2.0)
ai-service/tests/test_api.py              (extended, 5 tests)
ai-service/model/registry/v1/*            (new: classifier, regressor, meta)
ai-service/requirements.txt               (+shap, +xgboost, +numpy)
data-pipeline/requirements.txt            (+xgboost)
.github/workflows/ci.yml                  (+quality-gate step)
SPRINT-1-REPORT.md                        (this file)
```

## Next sprint candidates (Sprint 2)
1. Widen scenario-B coverage (labeling/threshold) + re-run comparison.
2. Backend wiring: TASK-5 — cache predictions per activity via the new API (incl. `estimated_delay_days`), staleness flag.
3. AUTH-4/5: invitations + project membership (start of the mandatory management core).
4. Git: commit this sprint on a feature branch, PR, verify CI runs green including the gate.
