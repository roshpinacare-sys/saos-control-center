import { createHash } from 'crypto';
import { randomBytes } from 'crypto';
import { setTimeout } from 'timers/promises';

// ממשקים וטיפוסים למערכת ה-escalation
type AlertChannel = {
  id: string;
  name: string;
  type: 'slack' | 'email' | 'webhook' | 'pagerduty';
  endpoint: string;
  priority: 'normal' | 'critical';
};

type EscalationTier = {
  level: number;
  delayMs: number;
  backoffFactor: number;
  channels: string[]; // IDs of channels to use for this tier
};

type AlertPayload = {
  id: string;
  correlationId: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  timestamp: Date;
  metadata?: Record<string, any>;
};

type EscalationPolicy = {
  id: string;
  name: string;
  description: string;
  maxRetries: number;
  maxTimeoutMs: number;
  correlationId: string;
  tiers: EscalationTier[];
  channels: AlertChannel[];
};

// מחלקת EscalationManager
export class EscalationManager {
  private policies: Map<string, EscalationPolicy> = new Map();
  private activeAlerts: Map<string, {
    payload: AlertPayload;
    currentTier: number;
    lastAttempt: number;
    retryCount: number;
  }> = new Map();

  constructor() {
    // הטמעת מדיניות ברירת מחדל ל-DB Guard
    this.createDefaultPolicy();
  }

  // יצירת מדיניות ברירת מחדל ל-DB Guard
  private createDefaultPolicy() {
    const dbGuardPolicy: EscalationPolicy = {
      id: 'db-guard-escalation',
      name: 'DB Guard Escalation Policy',
      description: 'Escalation policy for database guard alerts',
      maxRetries: 5,
      maxTimeoutMs: 300000, // 5 דקות
      correlationId: this.generateCorrelationId(),
      tiers: [
        {
          level: 1,
          delayMs: 5000, // 5 שניות
          backoffFactor: 2,
          channels: ['db-guard-normal'],
        },
        {
          level: 2,
          delayMs: 15000, // 15 שניות
          backoffFactor: 2,
          channels: ['db-guard-normal'],
        },
        {
          level: 3,
          delayMs: 30000, // 30 שניות
          backoffFactor: 2,
          channels: ['db-guard-normal'],
        },
        {
          level: 4,
          delayMs: 60000, // 1 דקה
          backoffFactor: 2,
          channels: ['db-guard-critical'],
        },
        {
          level: 5,
          delayMs: 120000, // 2 דקות
          backoffFactor: 2,
          channels: ['db-guard-critical', 'db-guard-oncall'],
        },
      ],
      channels: [
        {
          id: 'db-guard-normal',
          name: 'DB Guard Alerts',
          type: 'slack',
          endpoint: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK',
          priority: 'normal',
        },
        {
          id: 'db-guard-critical',
          name: 'DB Guard Critical',
          type: 'pagerduty',
          endpoint: 'https://events.pagerduty.com/integration/YOUR/INTEGRATION/KEY',
          priority: 'critical',
        },
        {
          id: 'db-guard-oncall',
          name: 'DB Guard On-Call',
          type: 'email',
          endpoint: 'oncall@example.com',
          priority: 'critical',
        },
      ],
    };

    this.policies.set(dbGuardPolicy.id, dbGuardPolicy);
  }

  // יצירת Correlation ID ייחודי
  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }

  // התחלת אזעקה חדשה
  public async triggerAlert(policyId: string, payload: Omit<AlertPayload, 'id' | 'correlationId' | 'timestamp'>) {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy with ID ${policyId} not found`);
    }

    const alertId = `alert_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const fullPayload: AlertPayload = {
      ...payload,
      id: alertId,
      correlationId: policy.correlationId,
      timestamp: new Date(),
    };

    // רישום האזעקה כפעילה
    this.activeAlerts.set(alertId, {
      payload: fullPayload,
      currentTier: 1,
      lastAttempt: Date.now(),
      retryCount: 0,
    });

    // התחלת תהליך ה-escalation
    this.startEscalation(alertId);

    return {
      alertId,
      correlationId: policy.correlationId,
      message: 'Alert escalation started',
    };
  }

  // התחלת תהליך ה-escalation
  private async startEscalation(alertId: string) {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return;

    const policy = this.policies.get('db-guard-escalation'); // במקרה זה, מדיניית ברירת המחדל
    if (!policy) return;

    const tier = policy.tiers[alert.currentTier - 1];
    if (!tier) {
      this.logEscalationEvent(alertId, 'escalation_completed', 'All tiers exhausted');
      this.activeAlerts.delete(alertId);
      return;
    }

    // בדיקת timeout מרבי
    const timeSinceStart = Date.now() - alert.payload.timestamp.getTime();
    if (timeSinceStart > policy.maxTimeoutMs) {
      this.logEscalationEvent(alertId, 'escalation_timeout', `Max timeout exceeded: ${policy.maxTimeoutMs}ms`);
      this.activeAlerts.delete(alertId);
      return;
    }

    // המתנה לפי backoff
    await setTimeout(tier.delayMs);

    // שליחת התראה לערוצים המתאימים
    await this.sendAlert(alertId, tier);

    // עדכון ניסיון הניסיון
    alert.lastAttempt = Date.now();
    alert.retryCount += 1;
    alert.currentTier += 1;
    this.activeAlerts.set(alertId, alert);

    // בדיקה אם ניתן להמשיך לטייר הבא
    if (alert.retryCount < policy.maxRetries) {
      this.startEscalation(alertId);
    } else {
      this.logEscalationEvent(alertId, 'escalation_completed', 'Max retries reached');
      this.activeAlerts.delete(alertId);
    }
  }

  // שליחת התראה לערוצים
  private async sendAlert(alertId: string, tier: EscalationTier) {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return;

    const policy = this.policies.get('db-guard-escalation');
    if (!policy) return;

    const message = `Tier ${tier.level} Alert: ${alert.payload.title}\n${alert.payload.message}`;

    // יצירת payload משולב עם מידע על ה-escalation
    const escalationPayload = {
      ...alert.payload,
      escalationLevel: tier.level,
      retryCount: alert.retryCount,
      message,
    };

    // שליחה לכל הערוצים בטייר הנוכחי
    for (const channelId of tier.channels) {
      const channel = policy.channels.find(c => c.id === channelId);
      if (channel) {
        try {
          await this.dispatchToChannel(channel, escalationPayload);
          this.logEscalationEvent(alertId, 'alert_sent', `Sent to ${channel.name} (Tier ${tier.level})`);
        } catch (error) {
          this.logEscalationEvent(alertId, 'alert_failed', `Failed to send to ${channel.name}: ${error.message}`);
        }
      }
    }
  }

  // שליחה לערוץ ספציפי
  private async dispatchToChannel(channel: AlertChannel, payload: any) {
    switch (channel.type) {
      case 'slack':
        await this.sendToSlack(channel.endpoint, payload);
        break;
      case 'email':
        await this.sendToEmail(channel.endpoint, payload);
        break;
      case 'webhook':
        await this.sendToWebhook(channel.endpoint, payload);
        break;
      case 'pagerduty':
        await this.sendToPagerDuty(channel.endpoint, payload);
        break;
      default:
        throw new Error(`Unsupported channel type: ${channel.type}`);
    }
  }

  // שליחה ל-Slack
  private async sendToSlack(webhookUrl: string, payload: any) {
    // יישום אמיתי ישלח בקשת HTTP ל-webhook
    // לדוגמה פשוטה:
    console.log(`Sending to Slack: ${JSON.stringify(payload)}`);
    // ביישום אמיתי:
    // const response = await fetch(webhookUrl, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ text: payload.message }),
    // });
    // if (!response.ok) throw new Error(`Slack error: ${response.statusText}`);
  }

  // שליחה לדוא"ל
  private async sendToEmail(email: string, payload: any) {
    // יישום אמיתי ישלח דוא"ל
    console.log(`Sending email to ${email}: ${JSON.stringify(payload)}`);
  }

  // שליחה ל-Webhook
  private async sendToWebhook(url: string, payload: any) {
    // יישום אמיתי ישלח בקשת HTTP ל-webhook
    console.log(`Sending to webhook ${url}: ${JSON.stringify(payload)}`);
  }

  // שליחה ל-PagerDuty
  private async sendToPagerDuty(integrationKey: string, payload: any) {
    // יישום אמיתי ישלח ל-PagerDuty
    console.log(`Sending to PagerDuty: ${JSON.stringify(payload)}`);
  }

  // רישום אירועי escalation
  private logEscalationEvent(alertId: string, event: string, details: string) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      alertId,
      event,
      details,
    };
    
    // ביישום אמיתי, זה ייכתב לקובץ לוג או למסד נתונים
    console.log('Escalation Event:', JSON.stringify(logEntry));
  }

  // קבלת מצב האזעקה הפעילה
  public getAlertStatus(alertId: string) {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) return null;

    return {
      alertId,
      correlationId: alert.payload.correlationId,
      title: alert.payload.title,
      severity: alert.payload.severity,
      currentTier: alert.currentTier,
      retryCount: alert.retryCount,
      lastAttempt: new Date(alert.lastAttempt),
      createdAt: alert.payload.timestamp,
    };
  }
}

// דוגמה לשימוש
const escalationManager = new EscalationManager();

// הפעלת אזעקה לדוגמה
(async () => {
  try {
    const result = await escalationManager.triggerAlert('db-guard-escalation', {
      title: 'Database Connection Failure',
      message: 'Failed to connect to primary database cluster',
      severity: 'critical',
      metadata: {
        cluster: 'primary',
        error: 'Connection timeout',
      },
    });

    console.log('Alert triggered:', result);

    // בדיקת מצב האזעקה לאחר כמה שניות
    setTimeout(() => {
      const status = escalationManager.getAlertStatus(result.alertId);
      console.log('Alert status:', status);
    }, 10000);

  } catch (error) {
    console.error('Failed to trigger alert:', error);
  }
})();
