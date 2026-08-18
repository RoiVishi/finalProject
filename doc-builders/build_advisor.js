// דף הכנה לפגישת מנחה — עמוד אחד
const docx = require('docx');
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, ShadingType, LevelFormat } = docx;
const FONT = 'Arial', NAVY = '1F3864', ACCENT = '2E5FA3';
const run = (t, o = {}) => new TextRun({ text: t, font: FONT, rightToLeft: true, size: o.size || 20, bold: !!o.bold, color: o.color, italics: !!o.italics });
const p = (t, o = {}) => new Paragraph({ bidirectional: true, spacing: { after: o.after ?? 90, line: 280 }, children: Array.isArray(t) ? t : [run(t, o)] });
const h = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, bidirectional: true, spacing: { before: 160, after: 80 }, children: [run(t, { bold: true, size: 23, color: ACCENT })] });
function mkTable(headers, rows, widths) {
  const cp = (txt, o = {}) => new Paragraph({ bidirectional: true, spacing: { after: 20, line: 250 }, children: [run(String(txt), { size: 17, ...o })] });
  return new Table({ visuallyRightToLeft: true, width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, margins: { top: 50, bottom: 50, left: 80, right: 80 },
    rows: [ new TableRow({ tableHeader: true, children: headers.map((hh, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: NAVY }, children: [cp(hh, { bold: true, color: 'FFFFFF' })] })) }),
      ...rows.map((r, ri) => new TableRow({ children: r.map((c, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: 'F2F5FA' } : undefined, children: [cp(c)] })) })) ] });
}
const ch = [];
ch.push(
  new Paragraph({ bidirectional: true, spacing: { after: 60 }, alignment: AlignmentType.CENTER, children: [run('ForeSite — דף הכנה לפגישה ראשונה עם המנחה', { bold: true, size: 30, color: NAVY })] }),
  new Paragraph({ bidirectional: true, spacing: { after: 140 }, alignment: AlignmentType.CENTER, children: [run('רועי וישנגרד + שותף · 17.8.2026 · Jira: roi24100-1785071624170.atlassian.net/browse/KAN', { size: 18, color: '666666' })] }),
  h('הרעיון במשפט'),
  p('פלטפורמת ניהול לפרויקטי בנייה (קבלן ראשי מזמין את כל בעלי המקצוע, משימות + תלויות + מסמכים) שבליבה מנוע ML שחוזה אילו פעילויות צפויות לאחר — מוסבר (SHAP בעברית), מכויל, ויודע לומר "אין מספיק נתונים" כשאין לו בסיס.'),
  h('מה כבר בנוי (לפני הפגישה הראשונה)'),
  p('מסמך דרישות מלא (v1.8, ~72 דרישות, מקושר Jira) · צינור נתונים על 70 לוחות P6 אמיתיים — אחרי שני סבבי ניקוי כפילויות: 122,057 פעילויות ב-51 פרויקטים, 10,609 מתויגות · השוואת 5 מודלים בשני תרחישי הערכה נגד דליפה · כיול הסתברויות · registry מגורסן (v4) · שירות FastAPI עם הסברים · שער איכות שרץ לפני כל פרסום מודל וגם ב-CI · כל מספר משוחזר (seed 42) ומגיע מקובץ אמת אחד (numbers.json).'),
  h('התוצאות (registry v4 · 11 פרויקטים · 7,396 אימון / 3,108 מבחן)'),
  mkTable(['תרחיש', 'מדד', 'תוצאה', 'משמעות'], [
    ['A — פרויקט חדש (זר)', 'ROC-AUC', '0.57 לאלוף; 20 פיצולים חוזרים (RR-13): טווח 0.18–0.88, LOPO ‏0.0–0.92', 'העברה חוצת-פרויקטים חלשה ולא-יציבה — נמדד; המוצר ממוסגר כמבוסס-היסטוריה'],
    ['B — בחירת אלוף', 'ROC-AUC', 'XGBoost ‏0.751 מול RF ‏0.750 — תיקו סטטיסטי (bootstrap)', 'הבחירה לפי כלל שנקבע מראש; מוצג בשקיפות כתיקו'],
    ['B — המודל המוגש (מכויל)', 'AUC / F1 / Brier', '0.723 / 0.500 / 0.207 (מול 0.234 לפני כיול)', 'טענת הפריסה: אלו המספרים שהמוצר חי איתם'],
    ['B — רגרסיית ימים', 'MAE', '28.92 מול 28.81 לניחוש חציון — מפסידה', 'נוטרלה אוטומטית (PRED-11): המסך אומר "לא ידוע" במקום מספר גרוע מניחוש'],
    ['עקומת למידה (RR-11)', 'AUC לפי % היסטוריה', 'שמיש מ-40% היסטוריה (0.714)', 'לפני כן: הימנעות מובנית — "אין מספיק נתונים"'],
    ['אבלציית float ‏(RR-12)', 'Δ AUC', 'בלי float: ‏−0.0015 בלבד; יוריסטיקת CPM לבדה: 0.487', 'המודל לא זקוק ל-CPM; מתאם הפיצ\'רים פושט בהתאם'],
    ['ולידציה חיצונית (RR-8)', 'NYC, ‏3,661 פרויקטים', '61.8% מחליקים >30 יום; שיעור איחור 42.7% (אצלנו 41.3%); על סוכנויות זרות AUC ‏0.60–0.68', 'הבעיה אוניברסלית; העברה חוצת-הקשר חלשה — כפי שהוצהר מראש'],
  ], [1900, 1400, 2700, 3300]),
  h('שלוש שאלות מתודולוגיות שנשמח לחשוב עליהן איתך'),
  mkTable(['#', 'השאלה', 'מה מצאנו', 'הצעתנו לדיון'], [
    ['1', 'איך גוזרים רף Brier מוחלט לשער האיכות?', 'רף עגול (0.20) יושב בתוך רווח בר-הסמך שלנו [0.200–0.215] — לא מדיד; מול דמה פריס (0.223) הניצחון מובהק (P=0.9998), מול "אורקל" שיעור-הבסיס — לא', 'לגזור את הרף מהשוואה לדמה הפריס, ולדווח CI לצד כל מספר'],
    ['2', 'איך מכריעים תיקו סטטיסטי בין מודלים?', 'XGBoost−RF: ‏ΔAUC ‏0.0004, CI ‏[−0.010, +0.012]', 'כלל שנקבע מראש + מרווח קידום עתידי (החלפה רק אם Δ≥0.01)'],
    ['3', 'רצועות סיכון: קבועות או מקוונטילים?', 'עם 0.33/0.66 — 21.5% מהמשימות "אדומות" (הצפה); קוונטילים מפרוסת הכיול: 7.5% אדומות, דיוק 0.60', 'רצועות מקוונטילים, כמשתני סביבה (PRED-12) — ניתן לשינוי בלי build'],
  ], [400, 2300, 3600, 3000]),
  h('מה נבקש מהפגישה'),
  p('א. אישור מסמך הדרישות v1.8 כבסיס הפרויקט (כולל ההגדרה המעודכנת של PRED-9 — מתאם פיצ\'רים בלי CPM, מגובה בניסוי RR-12; CPM נשאר אופציה מוצרית לדשבורד). ב. עמדתך בשלוש השאלות המתודולוגיות. ג. קביעת קצב פגישות ואבני דרך לקראת ההגשות.'),
);
const doc = new Document({
  numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.RIGHT, style: { paragraph: { indent: { left: 300, hanging: 220 } }, run: { font: FONT } } }] }] },
  styles: { default: { document: { run: { font: FONT, size: 20 } } } },
  sections: [{ properties: { page: { margin: { top: 700, bottom: 700, left: 800, right: 800 } } }, children: ch }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync('/home/claude/afyon/דף הכנה לפגישת מנחה.docx', b); console.log('OK', b.length); });
