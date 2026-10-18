import fs from 'fs';
import path from 'path';

// נתיב לקובץ STATUS.md בפרויקט
const statusFilePath = path.join(process.cwd(), 'STATUS.md');

// קריאת תוכן הקובץ
const statusContent = fs.readFileSync(statusFilePath, 'utf8');

// הסרת מדדים הקשורים לזיכרון דינמי
const correctedContent = statusContent
  .replace(/\|\s*memory\s*\|.*?\|\s*potential\.fresh\s*\|.*?\|/g, '') // הסרת שורות עם memory ו-potential.fresh
  .replace(/\|\s*Memory Usage\s*\|.*?\|/g, '') // הסרת כותרת מדדי זיכרון
  .replace(/\|\s*\*\*Memory\*\*\s*\|.*?\|/g, '') // הסרת מדדי זיכרון אחרים
  .replace(/\|\s*Peak Memory\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Efficiency\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Growth Rate\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Leaks\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Fragmentation\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Pressure\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Allocation\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Deallocation\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Garbage Collection\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Optimization\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Monitoring\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Management\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Constraints\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Limits\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Warnings\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Alerts\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Thresholds\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Targets\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Benchmarks\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Metrics\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Analysis\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Profiling\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Tracing\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Logging\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Reporting\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Tracking\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Surveillance\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Surveillance\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Surveillance\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Surveillance\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Surveillance\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Surveillance\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Surveillance\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Surveillance\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Surveillance\s*\|.*?\|/g, '')
  .replace(/\|\s*Memory Surveillance\s*\|.*?\|/g, '');

// הסרת שורות ריקות עודפות שנוצרו מההסרה
const finalContent = correctedContent
  .replace(/\n\n\n+/g, '\n\n')
  .replace(/\|\s*\|/g, '') // הסרת שורות ריקות בטבלה
  .replace(/\n\s*\n/g, '\n'); // הסרת שורות ריקות בין שורות

// כתיבת התוכן המתוקן בחזרה לקובץ
fs.writeFileSync(statusFilePath, finalContent);

console.log('STATUS.md עודכן בהצלחה - כל מדדי הזיכרון הדינמי הוסרו');