import { v4 as uuidv4 } from 'uuid';

// ─── DB Guard Alert Correlation ────────────────────────────────────────────────
// FIX(Roast-78): Correlation ID ייחודי משותף בין ערוצי התראה (מקומי + POST ל-Control Center)
// הטמעה: UUID v4 נוצר פעם אחת לכל אירוע boot-failure, משותף לשני ה-IIFE.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DB Guard Alert — מערכת התראות לכשלי boot של מסד הנתונים
 * מפעילה שני ערוצים: רישום מקומי ו-POST ל-Control Center
 * עם Correlation ID משותף לטרקינג וטראובלשוטינג.
 */
const dbGuardAlert = async () => {
  // יצירת Correlation ID ייחודי עבור אירוע התראה זה
  const correlationId = uuidv4();
  const timestamp = new Date().toISOString();

  // IIFE #1: רישום מקומי לקובץ הלוגים
  (async () => {
    const logLine = JSON.stringify({
      level: 'CRITICAL',
      service: 'saos-dex',
      component: 'db-guard',
      event: 'boot-failure',
      timestamp,
      correlationId,
      message: 'Database connection failed during boot — check network and credentials',
    });

    try {
      // FIX: החלפת fs.appendFileSync (סינכרוני, חוסם) בכתיבה אסינכרונית
      await fs.promises.appendFile('/var/log/saos/db-guard.log', `${logLine}\n`);
    } catch (err) {
      // אפשרות אחרונה: רישום ל-stderr אם כתיבה לקובץ נכשלת
      console.error(`[db-guard][${correlationId}] Failed to write local log:`, err);
    }
  })();

  // IIFE #2: שליחה ל-Control Center
  (async () => {
    const alertPayload = {
      service: 'saos-dex',
      component: 'db-guard',
      event: 'boot-failure',
      timestamp,
      correlationId,
      message: 'Database connection failed during boot — check network and credentials',
      severity: 'critical',
    };

    try {
      const response = await fetch('https://control-center.saos.io/api/alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
        },
        body: JSON.stringify(alertPayload),
      });

      if (!response.ok) {
        // רישום כשל בשליחה ל-Control Center עם ה-Correlation ID
        console.error(`[db-guard][${correlationId}] Control Center alert failed:`, await response.text());
      }
    } catch (err) {
      // רישום כשל ברשת עם ה-Correlation ID
      console.error(`[db-guard][${correlationId}] Network error posting to Control Center:`, err);
    }
  })();
};

// ייצוא הפונקציה לשימוש במערכת
export default dbGuardAlert;