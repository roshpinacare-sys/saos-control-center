import { v4 as uuidv4 } from 'uuid';

interface IdempotencyEntry {
  key: string;
  timestamp: number;
  response: any;
}

const idempotencyCache = new Map<string, IdempotencyEntry>();
const MAX_CACHE_AGE_MS = 60000; // 1 minute
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// 1. מחולל מזהים אקראיים ייחודיים עבור כל התראה
function generateIdempotencyKey(): string {
  return uuidv4();
}

// 5. שמירת ה-Idempotency-Key במבנה נתונים מקומי למשך חלון זמן מוגדר
function addToIdempotencyCache(key: string, response: any): void {
  const entry: IdempotencyEntry = {
    key,
    timestamp: Date.now(),
    response,
  };
  idempotencyCache.set(key, entry);
  
  // ניקוי אוטומטי של רשומות ישנות
  setTimeout(() => {
    idempotencyCache.delete(key);
  }, MAX_CACHE_AGE_MS);
}

// בדיקה אם המפתח כבר קיים בקאש
function isIdempotencyKeyValid(key: string): boolean {
  const entry = idempotencyCache.get(key);
  if (!entry) return false;
  
  // בדיקת תקופת תוקף
  if (Date.now() - entry.timestamp > MAX_CACHE_AGE_MS) {
    idempotencyCache.delete(key);
    return false;
  }
  
  return true;
}

// 6. הגדרת timeout מרבי לניסיונות חוזרים
async function sendWithRetry(url: string, options: RequestInit, idempotencyKey: string): Promise<Response> {
  let retryCount = 0;
  let backoffTime = INITIAL_BACKOFF_MS;
  
  while (retryCount < MAX_RETRIES) {
    try {
      // הוספת ה-Idempotency-Key כ-header בבקשות ה-POST
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Idempotency-Key': idempotencyKey,
        },
        signal: AbortSignal.timeout(10000), // 10 seconds timeout
      });
      
      // 3. טיפול בתגובות מסוג 409 עם ניסיון מחדש עם זמן המתנה מדוד
      if (response.status === 409) {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          throw new Error(`Max retries reached for idempotency key: ${idempotencyKey}`);
        }
        
        // המתנה מדוד (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, backoffTime));
        backoffTime *= 2; // הכפלת זמן ההמתנה
        continue;
      }
      
      // 4. הוספת לוגיקת deduplication ברמת הלקוח
      if (response.status === 200 || response.status === 201) {
        const responseBody = await response.clone().text();
        addToIdempotencyCache(idempotencyKey, responseBody);
      }
      
      return response;
    } catch (error) {
      retryCount++;
      if (retryCount >= MAX_RETRIES) {
        throw error;
      }
      
      // המתנה מדוד במקרה של שגיאת רשת
      await new Promise(resolve => setTimeout(resolve, backoffTime));
      backoffTime *= 2;
    }
  }
  
  throw new Error(`Max retries reached for idempotency key: ${idempotencyKey}`);
}

// פונקציה ראשית לשליחת התראה עם מנגנון idempotency
export async function sendNotificationWithIdempotency(
  endpoint: string,
  notificationData: any
): Promise<Response> {
  const idempotencyKey = generateIdempotencyKey();
  
  // 4. לוגיקת deduplication ברמת הלקוח - בדיקה אם כבר שלחנו את ההתראה
  if (isIdempotencyKeyValid(idempotencyKey)) {
    return new Response(idempotencyCache.get(idempotencyKey)?.response, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // 2. הוספת ה-Idempotency-Key כ-header בבקשות ה-POST לערוץ המקומי
  const options: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(notificationData),
  };
  
  try {
    // 3. יישום טיפול בתגובות מסוג 409 עם ניסיון מחדש עם זמן המתנה מדוד
    return await sendWithRetry(endpoint, options, idempotencyKey);
  } catch (error) {
    // 7. טיפול במקרים שבהם ה-Idempotency-Key אינו מזוהה על ידי השרת (למשל 404)
    if (error instanceof Error && error.message.includes('404')) {
      // במקרה של 404, מחיקת המפתח מהקאש אם קיים
      idempotencyCache.delete(idempotencyKey);
      throw new Error('Notification endpoint not found');
    }
    
    throw error;
  }
}

// פונקציית עזר לניקוי קאש ה-idempotency (למשל בכיבוי האפליקציה)
export function clearIdempotencyCache(): void {
  idempotencyCache.clear();
}

// פונקציית עזר לקבלת גודל הקאש למטרות דיבוג
export function getIdempotencyCacheSize(): number {
  return idempotencyCache.size;
}