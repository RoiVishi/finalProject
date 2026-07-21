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

## תוצאות baseline v1 (16.7.2026)

דאטה אחרי ETL ודה־דופליקציה: **126,706 משימות** ב־**59 פרויקטים**, מהן **11,705 מתויגות** (40.5% באיחור) ב־17 פרויקטים.

חלוקת Train/Test **לפי פרויקטים** (למניעת זליגה), seed=42:

| מודל | Accuracy | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|---|
| Dummy (רוב) | 0.52 | 0 | 0 | 0 | 0.50 |
| Logistic Regression | 0.53 | 0.50 | 0.80 | 0.62 | 0.55 |
| Random Forest | 0.52 | 0.47 | 0.09 | 0.15 | 0.57 |

**מסקנה כנה (חשוב לספר):** הכללה בין פרויקטים שונים היא קשה — AUC ‏0.55–0.57 בלבד ממאפייני תכנון ורשת בלבד. זה ממצא מחקרי לגיטימי, והוא מגדיר את הצעדים הבאים:

1. **תרחיש הערכה תואם־מוצר:** חיזוי משימות עתידיות מתוך היסטוריית *אותו* פרויקט (split זמני בתוך פרויקט) — התרחיש האמיתי של הפלטפורמה, עם מאפייני היסטוריה (שיעור איחורים עד כה, עיכוב מצטבר במעלה הזרם).
2. הנדסת מאפיינים עשירה יותר: לוחות שנה, WBS, משאבים, קטגוריית עבודה מ־NLP על שמות משימות.
3. XGBoost + MLP + כוונון היפר־פרמטרים; SHAP להסברתיות.
4. תיקוף חיצוני מול NYC Open Data.

כל הריצות משוחזרות: `data-pipeline/outputs/metrics.json` שומר config + seed + מדדים.

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
