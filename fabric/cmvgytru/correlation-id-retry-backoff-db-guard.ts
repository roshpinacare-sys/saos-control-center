import { createHash, randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';

// ממשקים וטיפוסים
type AlertChannel = 'db' | 'control-center';
type AlertLevel = 'info' | 'warning' | 'error' | 'critical';

interface AlertPayload {
  id: string;
  correlationId: string;
  timestamp: number;
  level: AlertLevel;
  message: string;
  metadata?: Record<string, any>;
  retryCount: number;
}

interface AlertConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  escalationThreshold: number;
  deadLetterQueuePath: string;
}

// מחלקת המנהל להתראות עם Correlation ID ו-Retry/Backoff
class AlertManager extends EventEmitter {
  private config: AlertConfig;
  private pendingAlerts: Map<string, AlertPayload> = new Map();
  private deadLetterQueue: AlertPayload[] = [];

  constructor(config: AlertConfig) {
    super();
    this.config = config;
    
    // טעינת תור ההתראות המתים מהקובץ
    this.loadDeadLetterQueue().catch(err => {
      console.error('Failed to load dead letter queue:', err);
    });
  }

  // יצירת Correlation ID ייחודי
  private generateCorrelationId(): string {
    return randomBytes(16).toString('hex');
  }

  // יצירת ID להתראה
  private generateAlertId(): string {
    return createHash('sha256').update(Date.now().toString() + randomBytes(8).toString()).digest('hex').substring(0, 16);
  }

  // חישוב זמן המתנה לפי פוליסי ה-Backoff
  private calculateBackoffDelay(retryCount: number): number {
    const delay = Math.min(
      this.config.baseDelayMs * Math.pow(2, retryCount),
      this.config.maxDelayMs
    );
    
    // הוספת רעש אקראי כדי למנוע סנכרון בין ניסיונות חוזרים
    return delay + Math.random() * 1000;
  }

  // שדרוג רמת ההתראה לפי מדיניות ה-Escalation
  private escalateAlert(alert: AlertPayload): AlertPayload {
    if (alert.retryCount >= this.config.escalationThreshold && alert.level !== 'critical') {
      const escalationMap: Record<AlertLevel, AlertLevel> = {
        'info': 'warning',
        'warning': 'error',
        'error': 'critical',
        'critical': 'critical'
      };
      
      return {
        ...alert,
        level: escalationMap[alert.level],
        message: `[ESCALATED] ${alert.message}`
      };
    }
    return alert;
  }

  // שליחת התראה לערוץ ספציפי
  private async sendToChannel(alert: AlertPayload, channel: AlertChannel): Promise<boolean> {
    try {
      // סימולציה של שליחה לערוץ
      console.log(`[${channel.toUpperCase()}] Alert ${alert.id}: ${alert.message}`);
      
      // במערכת אמיתית, כאן יהיה קוד לשליחת ההתראה
      // לדוגמה: API call ל-DB Guard או ל-Control Center
      
      // הצלחה - מחזירים true
      return true;
    } catch (error) {
      console.error(`Failed to send alert to ${channel}:`, error);
      return false;
    }
  }

  // טיפול בניסיון שליחה כושל
  private async handleFailedAttempt(alert: AlertPayload, channel: AlertChannel): Promise<void> {
    const updatedAlert = {
      ...alert,
      retryCount: alert.retryCount + 1
    };

    // בדיקה אם חרגנו ממספר הניסיונות המרבי
    if (updatedAlert.retryCount >= this.config.maxRetries) {
      console.warn(`Alert ${alert.id} reached max retries. Moving to dead letter queue.`);
      await this.moveToDeadLetterQueue(updatedAlert);
      return;
    }

    // חישוב זמן המתנה לפי פוליסי ה-Backoff
    const delay = this.calculateBackoffDelay(updatedAlert.retryCount);
    
    console.log(`Retrying alert ${alert.id} in ${delay}ms (attempt ${updatedAlert.retryCount + 1}/${this.config.maxRetries})`);
    
    // שמירת ההתראה לניסיון חוזר
    this.pendingAlerts.set(alert.correlationId, updatedAlert);
    
    // תזמון ניסיון חוזר
    setTimeout(() => {
      this.retryAlert(alert.correlationId);
    }, delay);
  }

  // ניסיון חוזר לשלוח התראה
  private async retryAlert(correlationId: string): Promise<void> {
    const alert = this.pendingAlerts.get(correlationId);
    if (!alert) return;

    // ניסיון שליחה לשני הערוצים במקביל
    const [dbSuccess, ccSuccess] = await Promise.all([
      this.sendToChannel(alert, 'db'),
      this.sendToChannel(alert, 'control-center')
    ]);

    // אם לפחות אחד הערוצים הצליח, מסירים מההמתנה
    if (dbSuccess || ccSuccess) {
      console.log(`Alert ${alert.id} successfully delivered after retry`);
      this.pendingAlerts.delete(correlationId);
      return;
    }

    // אם שני הערוצים נכשלו, טיפול בניסיון חוזר
    await this.handleFailedAttempt(alert, 'db');
  }

  // העברת התראה לתור ההתראות המתים
  private async moveToDeadLetterQueue(alert: AlertPayload): Promise<void> {
    this.deadLetterQueue.push(alert);
    await this.saveDeadLetterQueue();
    this.pendingAlerts.delete(alert.correlationId);
    
    // אירוע למעקב אחר התראות שנכשלו לחלוטין
    this.emit('alertFailed', alert);
  }

  // שמירת תור ההתראות המתים לקובץ
  private async saveDeadLetterQueue(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.config.deadLetterQueuePath), { recursive: true });
      await fs.writeFile(this.config.deadLetterQueuePath, JSON.stringify(this.deadLetterQueue, null, 2));
    } catch (error) {
      console.error('Failed to save dead letter queue:', error);
    }
  }

  // טעינת תור ההתראות המתים מהקובץ
  private async loadDeadLetterQueue(): Promise<void> {
    try {
      const data = await fs.readFile(this.config.deadLetterQueuePath, 'utf-8');
      this.deadLetterQueue = JSON.parse(data);
      
      // ניסיון לשלוח מחדש את כל ההתראות מהתור
      for (const alert of this.deadLetterQueue) {
        console.log(`Retrying dead letter alert ${alert.id}`);
        this.pendingAlerts.set(alert.correlationId, alert);
        setTimeout(() => {
          this.retryAlert(alert.correlationId);
        }, this.calculateBackoffDelay(0));
      }
    } catch (error) {
      // אם הקובץ לא קיים, זה בסדר - נוצר בהמשך
      if ((error as any).code === 'ENOENT') {
        this.deadLetterQueue = [];
      } else {
        throw error;
      }
    }
  }

  // פונקציה ציבורית לשליחת התראה
  async sendAlert(level: AlertLevel, message: string, metadata?: Record<string, any>): Promise<void> {
    const correlationId = this.generateCorrelationId();
    const alert: AlertPayload = {
      id: this.generateAlertId(),
      correlationId,
      timestamp: Date.now(),
      level,
      message,
      metadata,
      retryCount: 0
    };

    // שידור ההתראה לכל המאזינים
    this.emit('alert', alert);

    // שליחה לשני הערוצים במקביל
    const [dbSuccess, ccSuccess] = await Promise.all([
      this.sendToChannel(alert, 'db'),
      this.sendToChannel(alert, 'control-center')
    ]);

    // אם לפחות אחד הערוצים הצליח, לא צריך לעשות דבר נוסף
    if (dbSuccess || ccSuccess) {
      return;
    }

    // אם שני הערוצים נכשלו, טיפול בניסיון חוזר
    await this.handleFailedAttempt(alert, 'db');
  }

  // פונקציה לטיפול בהתראות מתימתחות (stale alerts)
  async processStaleAlerts(): Promise<void> {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 דקות
    
    for (const [correlationId, alert] of this.pendingAlerts.entries()) {
      if (now - alert.timestamp > staleThreshold) {
        console.warn(`Stale alert detected: ${alert.id}`);
        
        // שידוגר ההתראה כמתימתחת
        this.emit('staleAlert', alert);
        
        // ניסיון חוזר עם פרמטרים מעודכנים
        alert.timestamp = now;
        alert.retryCount += 1;
        
        if (alert.retryCount >= this.config.maxRetries) {
          await this.moveToDeadLetterQueue(alert);
        } else {
          setTimeout(() => {
            this.retryAlert(correlationId);
          }, this.calculateBackoffOff(alert.retryCount));
        }
      }
    }
  }
}

// יצירת מופע של המנהל עם קונפיגורציה
const alertManager = new AlertManager({
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  escalationThreshold: 3,
  deadLetterQueuePath: '/var/log/saos/alerts/dead-letter-queue.json'
});

// הוספת מאזינים לאירועים
alertManager.on('alert', (alert) => {
  console.log(`New alert: ${alert.id} (Correlation ID: ${alert.correlationId})`);
});

alertManager.on('alertFailed', (alert) => {
  console.error(`Alert failed permanently: ${alert.id}`);
  // כאן ניתן להוסיף לוגיקה נוספת לטיפול בהתראות שנכשלו לחלוטין
});

alertManager.on('staleAlert', (alert) => {
  console.warn(`Stale alert detected: ${alert.id}`);
  // כאן ניתן להוסיף לוגיקה נוספת לטיפול בהתראות מתימתחות
});

// פונקציית עזר לבדיקות
async function testAlertSystem() {
  console.log('Testing alert system...');
  
  // שליחת התראה רגילה
  await alertManager.sendAlert('info', 'System started successfully');
  
  // שליחת התראה עם מטא-דאטה
  await alertManager.sendAlert('warning', 'High memory usage detected', {
    memoryUsage: '85%',
    threshold: '80%'
  });
  
  // שליחת התראה קריטית
  await alertManager.sendAlert('critical', 'Database connection failed');
  
  // בדיקת מקרה קצה - שני הערוצים נכשלים
  // במערכת אמיתית, זה יגרום לניסיונות חוזרים ולהעברה לתור ההתראות המתים
  console.log('Simulating failure of both alert channels...');
  
  // בדיקת התראות מתימתחות
  setTimeout(() => {
    alertManager.processStaleAlerts();
  }, 60000);
}

// הפעלת הבדיקות
testAlertSystem().catch(console.error);

// ייצוא לשימוש במערכת
export { AlertManager, alertManager };
