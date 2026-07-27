# פלטפורמת AI לניהול פרויקטי בנייה — חיזוי עיכובים

פרויקט גמר, הנדסת תוכנה (מסלול בינה מלאכותית), SCE · 2026–2027

## מבנה הריפו

| תיקייה | תפקיד | טכנולוגיה |
|---|---|---|
| `data-pipeline/` | ETL, EDA ואימון מודלים על דאטהסט P6 | Python, pandas, scikit-learn |
| `ai-service/` | שירות חיזוי עיכובים (REST) | FastAPI |
| `backend/` | מערכת ניהול: משתמשים (RBAC), פרויקטים, משימות ותלויות | NestJS, TypeORM, PostgreSQL |
| `frontend/` | Dashboard + תאום דיגיטלי סכמטי | React, Three.js (R3F) |

## הרצה מהירה

```bash
# 1. דאטה + מודל (חד־פעמי)
cd data-pipeline
pip install -r requirements.txt
git clone --depth 1 https://github.com/EverseDevelopment/Buildings.Historical.Data.git data
python src/etl.py "data/Buildings Data"
python src/eda.py
python src/train_baseline.py
mkdir -p ../ai-service/model && cp outputs/model_rf_classifier.joblib ../ai-service/model/

# 2. כל המערכת
docker compose up --build
# או ידנית: ai-service → uvicorn app.main:app --port 8001
#            backend    → npm install && npm run start:dev
#            frontend   → npm install && npm run dev
```

## תוצאות המודל — מצב עדכני (26.7.2026, registry v2)

דאטה אחרי ETL ודה־דופליקציה: **126,706 משימות** ב־**59 פרויקטים**, מהן **11,705 מתויגות** (40.5% באיחור) ב־17 פרויקטים.

שני תרחישי הערכה נגד זליגה (RR-4), seed=42, השוואת 5 מודלים (`data-pipeline/outputs/model_comparison.json`):

**תרחיש A — פרויקט חדש לגמרי** (GroupShuffleSplit לפי פרויקט): כל המודלים כמעט אקראיים (AUC ‏0.54–0.58). ממצא מחקרי: הכללה בין פרויקטים שונים קשה — ראו פרק הניסויים.

**תרחיש B — פרויקט רץ** (פיצול טמפורלי לפי אחוזון 70 בתוך כל פרויקט; 13 פרויקטים, 8,172 אימון / 3,428 מבחן) — טענת הפריסה של המוצר:

| מודל | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|
| Dummy (רוב) | 0 | 0 | 0 | 0.50 |
| Logistic Regression | 0.38 | 0.81 | 0.52 | 0.61 |
| **Random Forest מכויל (מוגש, v2)** | **0.48** | **0.68** | **0.56** | **0.77** |

- **כיול (PRED-13):** sigmoid על הפרוסה המאוחרת של ה-train (בסיס האיחורים נסחף 0.46→0.29 לאורך חיי פרויקט) — Brier ‏0.224→0.190; `outputs/figures/reliability_curve_B.png`.
- **רגרסיית ימי איחור:** RF‏ MAE ‏28.49 מול dummy ‏28.94 — מרווח דק (0.45 יום); גורל ההגשה שלה = הכרעת מנחה (PRED-11).
- **שער איכות (PRED-6):** רץ ב-CI — המודל חייב לנצח את ה-baselines בתרחיש B, כולל בדיקת Brier. סטטוס: PASSED.
- **חוזה פיצ'רים (PRED-8):** `feature_schema.json` יחיד בשורש; השירות מסרב למודל מסכמה אחרת, וכל תשובה נושאת `model_version` + `feature_schema_version`.

צעדים באים: מתאם פיצ'רים לפרויקטים שנוצרים בפלטפורמה (PRED-9, כולל הכרעת CPM/float), NLP על שמות משימות (RR-9), תיקוף חיצוני NYC (RR-8).

כל הריצות משוחזרות: config + seed + מדדים ב-`model_comparison.json`; המודלים המוגשים ב-`ai-service/model/registry/v2/`.

**Jira:** [לוח הדרישות (KAN)](https://roi24100-1785071624170.atlassian.net/browse/KAN) — כל דרישה = סיפור.

## API עיקרי

- `POST /auth/register`, `POST /auth/login` — JWT
- `GET/POST /projects`, `GET/POST /tasks` — RBAC לפי תפקיד
- `GET /tasks/:id/blocked` — חסימות לפי תלויות ("אי אפשר להתחיל חשמל — שלד לא הושלם")
- `POST /tasks/:id/predict` — עדכון סיכון עיכוב משירות ה-AI
- AI service: `POST /predict`, `POST /predict/batch`, `GET /health`

## סטטוס מול צ'קליסט ציון בסיס

- [x] קוד ב-Git, בדיקות יחידה (ai-service), CI (GitHub Actions)
- [x] API חיצוני (שירות AI כ-REST), דאטהסט אמיתי + pipeline מתועד
- [ ] פריסה לשרת מרוחק, Jira מקושר לדרישות, סקר ספרות, מסמך דרישות
