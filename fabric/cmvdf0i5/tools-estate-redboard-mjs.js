// tools/estate-redboard.mjs — מנגנון אימות מפתחות ל-Hive API

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

// ─── הגדרות מוגנות ──────────────────────────────────────────────────────
const SECURE_CONFIG_PATH = join(process.cwd(), 'src', 'lib', 'secure-material.json');
const AUTH_LOG_PATH = join(process.cwd(), 'logs', 'auth-attempts.log');

// טעינת מפתחות API מקובץ מוגן
function loadApiKeys() {
  try {
    if (!existsSync(SECURE_CONFIG_PATH)) {
      throw new Error('קובץ הגדרות מוגן לא נמצא');
    }
    
    const config = JSON.parse(readFileSync(SECURE_CONFIG_PATH, 'utf-8'));
    
    // אימות שהמפתחות קיימים
    if (!config.hiveApiKey || !config.hiveApiSecret) {
      throw new Error('מפתחות API לא מוגדרים בקובץ ההגדרות');
    }
    
    return {
      apiKey: config.hiveApiKey,
      apiSecret: config.hiveApiSecret,
      username: config.hiveUsername || 'default'
    };
  } catch (error) {
    console.error('שגיאה בטעינת מפתחות API:', error.message);
    throw error;
  }
}

// רישום ניסיון אימות
function logAuthAttempt(success, username, ip, userAgent) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    success,
    username,
    ip,
    userAgent,
    hash: createHash('sha256').update(timestamp + username + ip).digest('hex')
  };
  
  try {
    // יצירת תיקיית logs אם לא קיימת
    const logDir = join(process.cwd(), 'logs');
    if (!existsSync(logDir)) {
      import('fs').then(fs => fs.mkdirSync(logDir));
    }
    
    // הוספת הרשומה לקובץ הלוג
    writeFileSync(AUTH_LOG_PATH, JSON.stringify(logEntry) + '\n', { flag: 'a' });
  } catch (error) {
    console.error('שגיאה ברישום ניסיון אימות:', error.message);
  }
}

// אימות בקשת API ל-Hive
export async function authenticateHiveRequest(requestData, requestHeaders = {}) {
  try {
    const { apiKey, apiSecret, username } = loadApiKeys();
    
    // יצירת חתימת הבקשה (לפי פרוטוקול Hive API)
    const timestamp = new Date().toISOString();
    const signature = createHash('sha256')
      .update(`${timestamp}${apiKey}${JSON.stringify(requestData)}`)
      .digest('hex');
    
    // הכנת הבקשה עם פרטי האימות
    const authHeaders = {
      'X-Hive-API-Key': apiKey,
      'X-Hive-API-Signature': signature,
      'X-Hive-Username': username,
      'X-Hive-Timestamp': timestamp,
      ...requestHeaders
    };
    
    // דימוי שליחת הבקשה ל-Hive API
    const mockResponse = {
      success: true,
      data: requestData,
      headers: authHeaders
    };
    
    // רישום הניסיון המוצלח
    logAuthAttempt(
      true,
      username,
      requestHeaders['x-forwarded-for'] || 'unknown',
      requestHeaders['user-agent'] || 'unknown'
    );
    
    return mockResponse;
  } catch (error) {
    // רישום הניסיון הכושל
    logAuthAttempt(
      false,
      requestData.username || 'unknown',
      requestHeaders['x-forwarded-for'] || 'unknown',
      requestHeaders['user-agent'] || 'unknown'
    );
    
    // החזרת שגיאה ברורה
    throw new Error(`אימות נכשל: ${error.message}`);
  }
}

// בדיקת תקינות מפתחות
export function validateApiKeys() {
  try {
    const { apiKey, apiSecret } = loadApiKeys();
    
    // בדיקת אורך מינימלי למפתחות
    if (apiKey.length < 16 || apiSecret.length < 16) {
      throw new Error('מפתחות API קצרים מדי');
    }
    
    // בדיקת תבנית (לדוגמה: מכילים רק תווים הקסדצימליים)
    if (!/^[a-fA-F0-9]+$/.test(apiKey) || !/^[a-fA-F0-9]+$/.test(apiSecret)) {
      throw new Error('מפתחות API אינם תקפים');
    }
    
    return true;
  } catch (error) {
    console.error('אימות מפתחות נכשל:', error.message);
    return false;
  }
}

// דוגמה לשימוש
// const requestData = { method: 'get_account', params: ['username'] };
// const headers = { 'x-forwarded-for': '192.168.1.1', 'user-agent': 'MyApp/1.0' };
// authenticateHiveRequest(requestData, headers)
//   .then(response => console.log('בקשה מאומתת:', response))
//   .catch(error => console.error('שגיאה:', error.message));