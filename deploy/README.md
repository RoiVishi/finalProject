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
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/; s/^DB_PASSWORD=.*/DB_PASSWORD=$(openssl rand -hex 32)/" .env
cat .env        # לוודא ש-DOMAIN, JWT_SECRET ו-DB_PASSWORD מלאים
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
```

הבנייה הראשונה לוקחת כמה דקות. Caddy מנפיק את תעודת ה-HTTPS לבד בדקה הראשונה.

> ⚠️ את `DB_PASSWORD` לא משנים אחרי ההפעלה הראשונה: Postgres קובע את הסיסמה רק כשהוא נוצר.

## עדכון לגרסה חדשה מ-main

```bash
cd ~/finalProject
git pull
docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
```

טיפ: כדי לא להקליד את שני הקבצים בכל פעם — `echo 'COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.prod.yml' >> .env`, ואז מספיק `docker compose up -d --build`.

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
