# Sprint 2 — Roi's tasks report (26.7.2026)

**Jira:** KAN-80 (RR-4 scenario-B widening), KAN-87 (PRED-8 feature schema), KAN-92 (PRED-13 calibration)

## 1. Scenario B widened — 2 projects → 13 projects

The v1 split (global cut at rel_position ≤ 0.7, ≥20 labeled per side) covered only 2 projects
(622 train / 232 test). Analysis showed the threshold wasn't the constraint — most projects
concentrate their labeled activities on one side of any *global* cut. Fix: cut each project at
its **own 70th-percentile** of rel_position (train = the project's earliest 70% of labeled
activities, test = latest 30%). Still strictly temporal within project; now covers **13 projects,
8,172 train / 3,428 test** (15× more test data).

**Honest consequence:** champion AUC dropped 0.828 → **0.768** — the old number was measured on
2 easy projects; the new one is far more credible. F1 actually improved (0.517 → **0.560**),
recall 0.68. Regression tightened: RF-reg MAE **28.49 vs dummy 28.94** — only a 0.45-day margin.
⚠️ The proposed gate floor "MAE ≤ dummy − 5" is NOT met on the widened split — this goes to the
advisor discussion (options: keep regression served with its honest error, or gate it off per
PRED-11 until improved).

## 2. PRED-8 — Feature contract (`feature_schema.json`)

One committed schema file at repo root: 11 features with dtype/unit/nullability/role, semantic
definition and the platform derivation source (feeds PRED-9 later), plus the post-hoc blacklist
(feeds PRED-14). Version `1.0`.

- Training reads NUM/CAT feature lists **from the schema** (no more duplicated lists).
- Registry meta records `feature_schema_version`; the schema file is copied into each version dir.
- The service **refuses at startup** an artifact whose schema version differs from the running
  schema (503 + reason in /health), and every response now carries `feature_schema_version`.

## 3. PRED-13 — Calibration (+ a real research finding)

Naive calibration (isotonic, cv=3 on the whole B train) **worsened** test Brier (0.184 → 0.195).
Cause: the late-activity base rate drifts across a project's life (train 0.46 → test 0.29), so a
calibrator fitted on the whole train span learns stale frequencies. **Documented protocol:**
per-project temporal sub-split of the train at q=0.75 — champion fitted on the earlier part,
**sigmoid (Platt)** calibrator fitted on the latest slice (the distribution closest to deployment).
Selected on train-side data only; test never touched.

Result (scenario B test, same base model): Brier **0.2236 → 0.1895**; AUC preserved (0.768);
F1 0.5601, recall 0.6816. Scenario A Brier also improves (0.143 → 0.135). Reliability curve:
`outputs/figures/reliability_curve_B.png` (book-ready). The quality gate now also enforces
"calibrated ≤ uncalibrated" — currently **PASSED**.

This is a book-worthy finding: *"calibration under within-project distribution drift requires a
temporally-local calibration slice"* — connects directly to the literature-survey chapter on
distribution shift.

## Registry v2 (served)

`classifier.joblib` = sigmoid-calibrated RF (tuned params from S1) · `regressor.joblib` = RF-reg
· `feature_schema.json` copy · `meta.json` with calibration protocol + metrics for both scenarios.

## Tests & CI

8 tests green (3 new: schema-mismatch unit, schema-refusal 503, schema version in response);
ruff clean; quality gate PASSED with the new Brier check.

## Files changed
```
feature_schema.json                          (new, repo root)
data-pipeline/src/train_compare.py           (quantile split, schema-driven, calibration)
data-pipeline/src/quality_gate.py            (+Brier check)
data-pipeline/outputs/model_comparison.json  (regenerated)
data-pipeline/outputs/figures/reliability_curve_B.png (new)
ai-service/app/main.py                       (schema enforcement, schema version in responses, calibrated-model SHAP)
ai-service/tests/test_api.py                 (8 tests)
ai-service/model/registry/v2/*               (served artifact)
```

## For the advisor meeting
1. Approve the widened scenario-B methodology (per-project quantile) and the updated honest numbers.
2. Regression margin is thin (0.45 days) — decide: serve with honest MAE, or gate off (PRED-11).
3. Re-derive gate floors from the widened run (AUC ≥ 0.70? F1 ≥ 0.45 ✓, recall ≥ 0.55 ✓, Brier ≤ 0.20 ✓).
