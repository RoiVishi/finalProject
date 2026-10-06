/**
 * NFR-I18N-1: Hebrew-first string catalogue. Every user-facing string of the
 * auth flow lives here, so screens never hard-code copy and a second locale
 * can be added later by adding a sibling file with the same keys.
 */
export const he = {
  app: {
    name: 'ForeSite',
    tagline: 'ניהול פרויקטי בנייה · חיזוי עיכובים',
  },
  common: {
    email: 'דוא"ל',
    password: 'סיסמה',
    submit: 'שליחה',
    loading: 'רגע...',
    backToLogin: 'חזרה לכניסה',
    logout: 'התנתקות',
  },
  login: {
    title: 'כניסה למערכת',
    submit: 'כניסה',
    forgot: 'שכחתי סיסמה',
    noAccount: 'אין לך חשבון?',
    toRegister: 'להרשמה',
  },
  register: {
    title: 'הרשמה',
    invited: 'נרשמים דרך קישור הזמנה — אחרי ההרשמה תצורפו לפרויקט אוטומטית.',
    fullName: 'שם מלא',
    phone: 'טלפון',
    profession: 'מקצוע',
    chooseProfession: 'בחירת מקצוע',
    passwordHint: 'לפחות 8 תווים, אות אחת וספרה אחת',
    submit: 'יצירת חשבון',
    haveAccount: 'כבר רשומים?',
    toLogin: 'לכניסה',
  },
  forgot: {
    title: 'איפוס סיסמה',
    intro: 'נשלח קישור לאיפוס לכתובת הדוא"ל שלך.',
    submit: 'שליחת קישור',
    // AUTH-7: identical message whether or not the address is registered.
    sent: 'אם הכתובת רשומה במערכת, נשלח אליה קישור לאיפוס הסיסמה. הקישור תקף לזמן מוגבל.',
  },
  reset: {
    title: 'בחירת סיסמה חדשה',
    newPassword: 'סיסמה חדשה',
    confirm: 'אימות סיסמה',
    submit: 'שמירת הסיסמה',
    done: 'הסיסמה עודכנה. אפשר להיכנס עם הסיסמה החדשה.',
    missingToken: 'הקישור אינו תקין או שפג תוקפו',
  },
  invitation: {
    title: 'הזמנה לפרויקט',
    intro: 'הוזמנת להצטרף לפרויקט. אפשר לאשר או לדחות את ההזמנה.',
    accept: 'הצטרפות לפרויקט',
    decline: 'דחיית ההזמנה',
  },
  validation: {
    email: 'כתובת דוא"ל לא תקינה',
    password: 'הסיסמה חייבת לכלול לפחות 8 תווים, אות אחת וספרה אחת',
    passwordRequired: 'יש להזין סיסמה',
    fullName: 'יש להזין שם מלא',
    phone: 'מספר טלפון לא תקין',
    profession: 'יש לבחור מקצוע מהרשימה',
    mismatch: 'הסיסמאות אינן תואמות',
  },
  errors: {
    network: 'השרת אינו זמין כרגע. נסו שוב בעוד רגע.',
    generic: 'משהו השתבש. נסו שוב.',
    sessionExpired: 'פג תוקף ההתחברות. יש להיכנס מחדש.',
  },
  // Labels for the backend Profession enum (users/user.entity.ts). Keys must match.
  professions: {
    main_contractor: 'קבלן ראשי',
    project_manager: 'מנהל/ת פרויקט',
    engineer: 'מהנדס/ת',
    subcontractor: 'קבלן משנה',
    inspector: 'מפקח/ת',
  },
};

export default he;
