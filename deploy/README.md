# פריסה לשרת (NFR-PORT-1, NFR-DEMO-2, NFR-SEC-1/2/5)

שרת: Oracle Cloud Always Free — Ubuntu 24.04 (ARM, 2 OCPU, 12GB), אזור ירושלים.
כתובת: https://foresite-sce.duckdns.org (DuckDNS → 82.70.209.61).

## איך זה בנוי

```
אינטרנט ──443/80──▶ web (Caddy: HTTPS + האתר)
                       └─ /api/* ──▶ backend :3000 ──▶ db :5432
                                              └──────▶ ai-service :8001
```

רק `web` פתוח לאינטרנט. `backend`, `db` ו-`ai-service` מדברים ביניהם ברשת הפנימית של Docker ואינם נגישים מבחוץ.
הקובץ `docker-compose.yml` הרגיל לא משתנה (פיתוח מקומי); בשרת מוסיפים מעליו את `deploy/docker-compose.prod.yml`.

## הפעלה ראשונה (פעם אחת, בשרת)

```bash
git clone https://github.com/RoiVishi/finalProject.git
cd finalProject
cp deploy/env.prod.example .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/; s/^DB_PASSWORD=.*/DB_PASSWORD=$(openssl rand -hex 32)/; s/^AI_SERVICE_TOKEN=.*/AI_SERVICE_TOKEN=$(openssl rand -hex 32)/" .env
cat .env        # לוודא ש-DOMAIN, JWT_SECRET, DB_PASSWORD ו-AI_SERVICE_TOKEN מלאים
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
```

הבנייה הראשונה לוקחת כמה דקות. Caddy מנפיק את תעודת ה-HTTPS לבד בדקה הראשונה.

> ⚠️ את `DB_PASSWORD` לא משנים אחרי ההפעלה הראשונה: Postgres קובע את הסיסמה רק כשהוא נוצר.

## עדכון לגרסה חדשה מ-main

**אוטומטי.** כל מיזוג ל-main שעובר CI מעדכן את השרת לבד: ‏`.github/workflows/deploy.yml` מתחבר לשרת ומריץ את `deploy/server-update.sh`. רואים כל עדכון ב-GitHub בלשונית Actions, תחת Deploy.

- **עדכון ידני מ-GitHub:** ‏Actions ← Deploy ← Run workflow.
- **השהיה (למשל לפני הוועדה):** ‏Actions ← Deploy ← "..." ← Disable workflow. מחזירים עם Enable workflow.
- **ידני מהשרת**, אם GitHub לא זמין:

```bash
~/finalProject/deploy/server-update.sh
```

הסקריפט מושך את main (רק fast-forward: אם שינו קבצים בשרת ידנית, הוא עוצר), בונה מחדש, מחכה שה-backend יענה, ומוחק images ישנים.

טיפ: כדי לא להקליד את שני קבצי ה-compose בכל פעם — `echo 'COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.prod.yml' >> .env`, ואז מספיק `docker compose up -d --build`.

## פריסה אוטומטית — הגדרה (פעם אחת)

1. **מפתח פריסה** (בעל ה-repo, במחשב שלו): `ssh-keygen -t ed25519 -f ~/foresite-deploy -N "" -C "github-deploy"`. החלק הפרטי נשמר רק ב-GitHub.
2. **סודות ב-GitHub** (‏Settings ← Secrets and variables ← Actions):
   - `DEPLOY_HOST` — כתובת השרת.
   - `DEPLOY_SSH_KEY` — כל התוכן של `~/foresite-deploy` (הפרטי).
   - `DEPLOY_KNOWN_HOSTS` — הפלט של `ssh-keyscan -t ed25519 <כתובת השרת>`.
3. **בשרת**, מוסיפים ל-`~/.ssh/authorized_keys` שורה אחת עם המפתח הציבורי, מוגבלת לסקריפט בלבד:

```
restrict,command="/home/ubuntu/finalProject/deploy/server-update.sh" ssh-ed25519 AAAA... github-deploy
```

`restrict` חוסם טרמינל, העברת פורטים וכל השאר; `command=` מריץ את הסקריפט בלי קשר למה שהתבקש. גם מי שישיג את המפתח יוכל רק לעדכן את השרת ל-main.

## בדיקות ותקלות

| מה | פקודה |
|---|---|
| מה רץ | `docker compose ps` |
| לוגים חיים | `docker compose logs -f backend` (או `web`, `ai-service`) |
| מיילים שנשלחו (NFR-DEMO-2) | `docker compose logs backend \| grep '\[mail\]'` |
| בריאות שירות ה-AI | `docker compose exec backend wget -qO- http://ai-service:8001/health` |
| עצירה | `docker compose down` (הנתונים נשמרים) |

תעודת HTTPS לא עולה → לבדוק ש-`nslookup foresite-sce.duckdns.org` מחזיר את כתובת השרת, ושפורטים 80/443 פתוחים גם ב-Security List של Oracle וגם ב-iptables בשרת.

## גיבוי בסיס הנתונים

```bash
docker compose exec -T db pg_dump -U app construction > backup-$(date +%F).sql
```

## נתוני דמו

הסקריפט `deploy/seed-demo.mjs` ממלא את האתר בשני פרויקטים לדוגמה: בניין בן 4 קומות באמצע הביצוע (24 משימות עם תלויות, חלקן הושלמו, חלקן בביצוע וחלקן חסומות), ושיפוץ קטן שעוד לא התחיל, עם הזמנה פתוחה שמופיעה במסך הבית. כל המשתמשים בדויים, בכתובות `@example.com`.

הסקריפט עובד רק דרך ה-API, בדיוק כמו הדפדפן, ולא נוגע בקוד או בבסיס הנתונים ישירות. אפשר להריץ אותו מכל מחשב שיש בו Node 18 ומעלה:

```bash
DEMO_PASSWORD='<סיסמה לבחירתך>' node deploy/seed-demo.mjs https://foresite-sce.duckdns.org/api --predict
```

`--predict` מבקש גם חיזוי משירות ה-AI לכל משימה פתוחה. הרצה חוזרת בטוחה: משתמש קיים מתחבר במקום להירשם, ופרויקט שכבר קיים מדולג.

מגבלה: ה-API רושם תאריך ביצוע בפועל של היום בכל שינוי סטטוס, ולכן כל המשימות שהושלמו "הסתיימו היום". התאריכים המתוכננים נקבעים יחסית להיום כדי שהתמונה תיראה כמו אתר פעיל.

## עוד לא כאן (משימות המשך)

- migrations ל-TypeORM, ואז `NODE_ENV=production` (כרגע הטבלאות נוצרות ב-synchronize).
- סוד משותף בין ה-backend לשירות ה-AI (החצי השני של NFR-SEC-5, KAN-129) — שינוי בקוד של `ai-service`.
- תיבת דואר בדפדפן לדמו במקום הלוג (NFR-DEMO-2).
