# ForeSite — פלטפורמת AI לניהול פרויקטי בנייה וחיזוי עיכובים

פרויקט גמר, הנדסת תוכנה (מסלול בינה מלאכותית), SCE · 2026–2027

## מבנה הריפו

| תיקייה | תפקיד | טכנולוגיה | סטטוס |
|---|---|---|---|
| `data-pipeline/` | ETL, ניסויים ואימון מודלים על דאטהסט P6 | Python, pandas, scikit-learn, XGBoost | פעיל |
| `ai-service/` | שירות חיזוי עיכובים (REST) | FastAPI | פעיל (v0.3) |
| `backend/` | מערכת ניהול: משתמשים (RBAC), פרויקטים, משימות ותלויות | NestJS, TypeORM, PostgreSQL | **בתכנון — scaffold טרם הוקם** |
| `frontend/` | Dashboard + תאום דיגיטלי סכמטי | React, Three.js (R3F) | **בתכנון** |

## הרצה מהירה

```bash
# המודל המאומן כבר בריפו (ai-service/model/registry/) — אין צורך לאמן.
docker compose up --build        # מרים db + ai-service (backend יצטרף כשה-scaffold יוקם)

# אימון מחדש מלא (משחזר את כל המספרים, seed 42):
cd data-pipeline
pip install -r requirements.txt
git clone --depth 1 https://github.com/EverseDevelopment/Buildings.Historical.Data.git data
python src/etl.py "data/Buildings Data"
python src/train_compare.py      # השוואה + כיול + שער + registry vN
python src/learning_curve.py && python src/ablation_float.py
python src/bias_and_alerts.py && python src/bootstrap_ci.py
python src/export_numbers.py     # outputs/numbers.json — מקור האמת לכל מסמך
```

## תוצאות המודל — מצב עדכני (17.8.2026, registry v4)

דאטה אחרי ETL ודה־דופליקציה מוקשחת (DATA-2, שני סבבים — כולל כפילויות-הכלה): **122,057 משימות** ב־**51 פרויקטים**, מהן **10,609 מתויגות** (41.3% באיחור) ב־15 פרויקטים.

שני תרחישי הערכה נגד זליגה (RR-4), seed=42, השוואת 5 מודלים (`data-pipeline/outputs/model_comparison.json`):

**תרחיש A — פרויקט חדש לגמרי** (GroupShuffleSplit לפי פרויקט): האלוף כמעט אקראי (AUC ‏0.57). ניסוי RR-13 (‏20 פיצולים חוזרים + LOPO) אישר: כל המודלים 0.55–0.60 בממוצע עם טווח 0.18–0.88; ‏LOPO ‏0.0–0.92 בין פרויקטים. המסקנה המוצרית: חיזוי מבוסס-היסטוריה בלבד + שער cold-start בשירות.

**תרחיש B — פרויקט רץ** (פיצול טמפורלי לפי אחוזון 70 בתוך כל פרויקט; 11 פרויקטים, 7,396 אימון / 3,108 מבחן) — טענת הפריסה של המוצר:

| מודל | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|
| Dummy (רוב) | 0 | 0 | 0 | 0.500 |
| Logistic Regression | 0.399 | 0.889 | 0.550 | 0.600 |
| **XGBoost (אלוף, fit מלא)** | **0.481** | **0.617** | **0.541** | **0.751** |
| Random Forest | 0.451 | 0.784 | 0.573 | 0.750 |
| MLP | 0.383 | 0.333 | 0.356 | 0.653 |

- **מה מוגש בפועל (registry v4):** הצנרת המכוילת — האלוף מאומן על החלק המוקדם של האימון + מכייל sigmoid על הפרוסה המאוחרת. מדדי ההגשה: **AUC ‏0.723, F1 ‏0.500, Brier ‏0.207** (מול 0.234 לא-מכויל). ההבחנה בין "מספרי הבחירה" ל"מספרי ההגשה" מפורשת ב-meta.json.
- **אלוף בהפרש תיקו:** ‏XGBoost עקף את RF ב-0.0004 בלבד — bootstrap מאשר תיקו סטטיסטי (`outputs/bootstrap_ci.json`); הבחירה עומדת על כלל שנקבע מראש (AUC תרחיש B).
- **רגרסיית ימי איחור: מנוטרלת אוטומטית (PRED-11).** ‏MAE ‏28.92 מול 28.81 לניחוש חציון — הרגרסור מפסיד, לא נארז ב-registry, ו-`estimated_delay_days` מוחזר `null`.
- **כיול (PRED-13):** sigmoid על הפרוסה המאוחרת של ה-train (שיעור הבסיס נסחף 0.46→0.30) — Brier ‏0.234→0.207; רווח בר-סמך ‏[0.200, 0.215]; מנצח מובהק את הדמה הפריס (P=0.9998). ‏`outputs/figures/reliability_curve_B.png`.
- **שער איכות (PRED-6):** רץ פעמיים — בתוך `train_compare.py` **לפני** כתיבת registry (מועמד נכשל לא מתפרסם), וב-CI על כל push. סטטוס: PASSED.
- **חוזה פיצ'רים (PRED-8):** `feature_schema.json` יחיד בשורש; השירות מסרב למודל מסכמה אחרת, דוחה שדות לא מוכרים (422), וכל תשובה נושאת `model_version` + `feature_schema_version`.
- **ניסויים מרכזיים:** עקומת למידה RR-11 (שמיש מ-40% היסטוריה); אבלציית float ‏RR-12 (בלי float: ‏−0.0015 AUC ⇒ אין CPM לחיזוי); יציבות RR-13 (לעיל); ולידציה חיצונית RR-8 על NYC (‏61.8% החלקה; איחור 42.7% מול 41.3% אצלנו; ‏AUC ‏0.60–0.68 על סוכנויות זרות).

כל הריצות משוחזרות: config + seed + מדדים ב-`model_comparison.json`; **כל מספר במסמכים מגיע מ-`outputs/numbers.json`** — לא מועתק ידנית.

**Jira:** [לוח הדרישות (KAN)](https://roi24100-1785071624170.atlassian.net/browse/KAN) — כל דרישה = סיפור.

## API — שירות ה-AI (קיים)

- `POST /predict`, `POST /predict/batch` — הסתברות מכוילת, רמת סיכון, `estimated_delay_days` (null כשהרגרסור מנוטרל)
- `POST /predict/project` — ‏PRED-9: ישויות גולמיות (משימות+תלויות) נכנסות, חיזויים פר-משימה יוצאים; שער cold-start לפי סף RR-11 (‏reliability: ‏ok / low_transfer_prior; מדיניות flag/abstain בקונפיגורציה)
- `POST /explain?top_k=k` — תרומות SHAP חתומות עם תוויות עברית/אנגלית (NFR-USE-1)
- `GET /health` — גרסת מודל, גרסת סכמה, רצועות סיכון חיות, סטטוס degraded כשאין מודל

## API — פלטפורמה (מתוכנן, טרם מומש)

`/auth/register` + 2FA · `/projects` + הזמנות בקישור · `/tasks` + תלויות וחסימות · אינטגרציית חיזוי פר-משימה

## סטטוס מול צ'קליסט ציון בסיס

- [x] קוד ב-Git, בדיקות יחידה (ai-service, 25 בדיקות), CI (GitHub Actions)
- [x] API חיצוני (שירות AI כ-REST), דאטהסט אמיתי + pipeline מתועד ומשוחזר
- [x] Jira מקושר לדרישות; מסמך דרישות v1.8 (טרם הוגש למנחה)
- [ ] scaffold ל-backend/frontend, פריסה לשרת מרוחק, סקר ספרות
