import { safeError } from './safe-error';

// מנגנון Retry/Backoff עבור ערוצי התראה של DB Guard
interface RetryConfig {
  maxAttempts: number;
  maxDelayMs: number;
  baseDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  maxDelayMs: 30000, // 30 שניות
  baseDelayMs: 1000, // 1 שנייה
};

/**
 * מבצעת פעולה עם מנגנון Retry/Backoff מעריכי
 * @param fn פונקציה לביצוע
 * @param config הגדרות הניסיונות
 * @returns תוצאת הפונקציה
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < config.maxAttempts) {
    attempt++;
    try {
      return await fn();
    } catch (error) {
      lastError = safeError(error);
      
      // בדיקת סוגי השגיאות שמצדיקות ניסיון חוזר
      if (!isRetryableError(lastError)) {
        throw lastError;
      }
      
      // חישוב זמן המתנה מעריכי
      const delayMs = Math.min(
        config.baseDelayMs * Math.pow(2, attempt - 1),
        config.maxDelayMs
      );
      
      console.warn(`[DB Guard Retry] ניסיון ${attempt}/${config.maxAttempts} נכשל. ניסיון חוזר עוד ${delayMs}ms.`, {
        error: lastError.message,
        attempt,
        delayMs,
        correlationId: lastError.cause?.['correlationId'] || 'N/A'
      });
      
      // המתנה לפני הניסיון הבא
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw new Error(`[DB Guard] נכשלו כל ${config.maxAttempts} הניסיונות. אחרונה: ${lastError?.message}`);
}

/**
 * בודקת האם השגיאה מצדיקה ניסיון חוזר
 */
function isRetryableError(error: Error): boolean {
  // שגיאות רשת
  if (error.message.includes('timeout') || 
      error.message.includes('connection refused') ||
      error.message.includes('network error') ||
      error.message.includes('ECONNRESET')) {
    return true;
  }
  
  // שגיאות HTTP זמניות (5xx)
  const statusCode = error.cause?.['statusCode'] as number;
  if (statusCode && statusCode >= 500 && statusCode < 600) {
    return true;
  }
  
  return false;
}

/**
 * שולח התראה לערוץ מקומי עם Retry/Backoff
 */
export async function sendLocalAlert(
  message: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  correlationId: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<void> {
  const alert = {
    id: correlationId,
    message,
    severity,
    timestamp: new Date().toISOString(),
    source: 'db-guard',
    type: 'alert'
  };

  await withRetry(
    async () => {
      // בדיקה אם הערוץ המקומי זמין
      try {
        // נניח שיש פונקציה ששולחת לערוץ מקומי
        await alertToChannel('local', alert);
        console.log(`[DB Guard] התראה מקומית נשלחה בהצלחה. ID: ${correlationId}`);
      } catch (error) {
        throw new Error(`שליחה לערוץ מקומי נכשלה: ${error.message}`);
      }
    },
    config
  );
}

/**
 * שולח התראה ל-Control Center עם Retry/Backoff
 */
export async function sendControlCenterAlert(
  message: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  correlationId: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<void> {
  const alert = {
    id: correlationId,
    message,
    severity,
    timestamp: new Date().toISOString(),
    source: 'db-guard',
    type: 'alert',
    service: 'saos-control-center'
  };

  await withRetry(
    async () => {
      // בדיקה אם ה-Control Center זמין
      try {
        // נניח שיש פונקציה ששולחת ל-Control Center
        await alertToChannel('control-center', alert);
        console.log(`[DB Guard] התראה ל-Control Center נשלחה בהצלחה. ID: ${correlationId}`);
      } catch (error) {
        throw new Error(`שליחה ל-Control Center נכשלה: ${error.message}`);
      }
    },
    config
  );
}

// פונקציות דמויות להדגמה (במערכת אמיתית היו קיימות)
async function alertToChannel(channel: string, alert: any): Promise<void> {
  // בדיקת קונקציה לערוץ
  if (channel === 'local') {
    // סימולציה של שליחה לערוץ מקומי
    if (Math.random() < 0.3) { // 30% סיכוי לכשל
      throw new Error('ערוץ מקומי לא זמין');
    }
  } else if (channel === 'control-center') {
    // סימולציה של שליחה ל-Control Center
    if (Math.random() < 0.4) { // 40% סיכוי לכשל
      throw new Error('Control Center לא זמין');
    }
  }
  
  // במערכת אמיתית כאן הייתה שליחה אסינכרונית
}

// פונקציית עזר ליצירת ID קורלציה
export function generateCorrelationId(): string {
  return `db-guard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
