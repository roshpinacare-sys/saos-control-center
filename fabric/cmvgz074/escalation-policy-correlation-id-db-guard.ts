import { EventEmitter } from 'events';

// סכימת JSON סטנדרטית להתראות
interface AlertSchema {
  correlationId: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  payload: Record<string, unknown>;
}

// ממשק למטפל התראות
interface IAlertHandler {
  handleAlert(alert: AlertSchema): Promise<void>;
  escalateAlert(alert: AlertSchema): Promise<void>;
}

// מחלקת מדיניות Escalation
class EscalationPolicy {
  private levels: { delay: number; maxRetries: number }[];

  constructor() {
    // רמות escalation עם זמני המתנה מוגדלים
    this.levels = [
      { delay: 60 * 1000, maxRetries: 3 },    // 1 דקה, 3 ניסיונות
      { delay: 5 * 60 * 1000, maxRetries: 2 }, // 5 דקות, 2 ניסיונות
      { delay: 15 * 60 * 1000, maxRetries: 1 }, // 15 דקות, ניסיון אחד
    ];
  }

  getNextLevel(currentLevel: number): number | null {
    if (currentLevel < this.levels.length - 1) {
      return currentLevel + 1;
    }
    return null; // הגענו לרמת ה-escalation הגבוהה ביותר
  }

  getDelayForLevel(level: number): number {
    return this.levels[level]?.delay || 0;
  }

  getMaxRetriesForLevel(level: number): number {
    return this.levels[level]?.maxRetries || 0;
  }
}

// מחלקת ערוץ התראה
abstract class AlertChannel implements IAlertHandler {
  protected name: string;
  protected escalationPolicy: EscalationPolicy;
  protected eventEmitter: EventEmitter;
  protected currentLevel: number = 0;
  protected retryCount: number = 0;

  constructor(name: string, escalationPolicy: EscalationPolicy, eventEmitter: EventEmitter) {
    this.name = name;
    this.escalationPolicy = escalationPolicy;
    this.eventEmitter = eventEmitter;
  }

  abstract sendAlert(alert: AlertSchema): Promise<void>;
  abstract escalateAlert(alert: AlertSchema): Promise<void>;

  async handleAlert(alert: AlertSchema): Promise<void> {
    try {
      await this.sendAlert(alert);
      this.resetRetryCount();
    } catch (error) {
      this.eventEmitter.emit('alertFailed', { alert, channel: this.name, error });
      await this.handleFailure(alert, error);
    }
  }

  private async handleFailure(alert: AlertSchema, error: unknown): Promise<void> {
    this.retryCount++;
    const maxRetries = this.escalationPolicy.getMaxRetriesForLevel(this.currentLevel);
    
    if (this.retryCount >= maxRetries) {
      // נגמרו הניסיונות לרמה הנוכחית, ננסה להתקדם לרמת escalation הבאה
      const nextLevel = this.escalationPolicy.getNextLevel(this.currentLevel);
      
      if (nextLevel !== null) {
        this.currentLevel = nextLevel;
        this.retryCount = 0;
        const delay = this.escalationPolicy.getDelayForLevel(this.currentLevel);
        
        this.eventEmitter.emit('alertEscalated', { 
          alert, 
          fromChannel: this.name, 
          toLevel: this.currentLevel,
          delay
        });
        
        // מתינה לפי זמן ה-backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        await this.handleAlert(alert);
      } else {
        // הגענו לרמת ה-escalation הגבוהה ביותר ועדיין נכשל
        this.eventEmitter.emit('alertDeadLetter', { alert, channel: this.name, error });
      }
    } else {
      // עדיין יש ניסיונות נותרים ברמה הנוכחית
      const delay = this.escalationPolicy.getDelayForLevel(this.currentLevel);
      await new Promise(resolve => setTimeout(resolve, delay));
      await this.handleAlert(alert);
    }
  }

  private resetRetryCount(): void {
    this.retryCount = 0;
    this.currentLevel = 0;
  }
}

// ערוץ התראה מקומי
class LocalAlertChannel extends AlertChannel {
  constructor(escalationPolicy: EscalationPolicy, eventEmitter: EventEmitter) {
    super('alertDatabaseConnectionFailure', escalationPolicy, eventEmitter);
  }

  async sendAlert(alert: AlertSchema): Promise<void> {
    // סימולציה של שליחת התראה למערכת התראות מקומית
    console.log(`[${this.name}] Sending alert with correlation ID: ${alert.correlationId}`);
    
    // בדיקת סימולציה לכשל
    if (Math.random() < 0.3) { // 30% סיכוי לכשל
      throw new Error('Failed to send local alert');
    }
    
    console.log(`[${this.name}] Alert sent successfully`);
  }

  async escalateAlert(alert: AlertSchema): Promise<void> {
    // לוגיקת escalation לערוץ החיצוני
    console.log(`[${this.name}] Escalating alert to external channel`);
    // במערכת ממשית, כאן היינו מעבירים את ההתראה לערוץ החיצוני
  }
}

// ערוץ התראה חיצוני
class ExternalAlertChannel extends AlertChannel {
  constructor(escalationPolicy: EscalationPolicy, eventEmitter: EventEmitter) {
    super('fetchToControlCenter', escalationPolicy, eventEmitter);
  }

  async sendAlert(alert: AlertSchema): Promise<void> {
    // סימולציה של שליחת התראה ל-Control Center חיצוני
    console.log(`[${this.name}] Sending alert to Control Center with correlation ID: ${alert.correlationId}`);
    
    // בדיקת סימולציה לכשל
    if (Math.random() < 0.4) { // 40% סיכוי לכשל
      throw new Error('Failed to send external alert');
    }
    
    console.log(`[${this.name}] Alert sent to Control Center successfully`);
  }

  async escalateAlert(alert: AlertSchema): Promise<void> {
    // לוגיקת fallback לערוץ המקומי
    console.log(`[${this.name}] Escalating alert to local channel`);
    // במערכת ממשית, כאן היינו מעבירים את ההתראה לערוץ המקומי
  }
}

// מנהל התראות
class AlertManager {
  private channels: IAlertHandler[];
  private escalationPolicy: EscalationPolicy;
  private eventEmitter: EventEmitter;
  private deadLetterQueue: AlertSchema[] = [];

  constructor() {
    this.escalationPolicy = new EscalationPolicy();
    this.eventEmitter = new EventEmitter();
    this.channels = [
      new LocalAlertChannel(this.escalationPolicy, this.eventEmitter),
      new ExternalAlertChannel(this.escalationPolicy, this.eventEmitter)
    ];
    
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // הטמעת טיפול ב-edge-case שבו שני הערוצים נכשלים סימולטנית
    this.eventEmitter.on('alertDeadLetter', (data) => {
      console.error(`[${data.channel}] Alert failed at all escalation levels:`, data.error);
      this.deadLetterQueue.push(data.alert);
      console.log('Alert added to dead letter queue. Total in queue:', this.deadLetterQueue.length);
    });
    
    // טיפול באירועי escalation
    this.eventEmitter.on('alertEscalated', (data) => {
      console.log(`Alert escalated from level ${data.fromChannel} to level ${data.toLevel}. Will retry in ${data.delay / 1000} seconds.`);
    });
  }

  async sendAlert(alert: AlertSchema): Promise<void> {
    // שליחת ההתראה לכל הערוצים במקביל
    const promises = this.channels.map(channel => channel.handleAlert(alert));
    await Promise.allSettled(promises);
  }

  getDeadLetterQueue(): AlertSchema[] {
    return [...this.deadLetterQueue];
  }

  // מתודה לניקוי ה-queue (לאחר תיקון הבעיות)
  clearDeadLetterQueue(): void {
    this.deadLetterQueue = [];
  }
}

// דוגמת שימוש
async function main() {
  const alertManager = new AlertManager();
  
  // יצירת התראה עם Correlation ID
  const alert: AlertSchema = {
    correlationId: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    severity: 'critical',
    payload: {
      message: 'Database connection failure detected',
      details: 'Connection pool exhausted',
      service: 'DB-Guard'
    }
  };
  
  console.log(`Sending alert with correlation ID: ${alert.correlationId}`);
  await alertManager.sendAlert(alert);
  
  // בדיקת ה-Dead Letter Queue
  const deadLetterQueue = alertManager.getDeadLetterQueue();
  if (deadLetterQueue.length > 0) {
    console.log('Dead Letter Queue contents:');
    deadLetterQueue.forEach((item, index) => {
      console.log(`${index + 1}. Correlation ID: ${item.correlationId}, Severity: ${item.severity}`);
    });
  }
}

// הפעלת הדוגמה
main().catch(console.error);
