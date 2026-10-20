import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@/lib/db';

// Types
interface AlertEvent {
  id: string;
  correlationId: string;
  type: 'database' | 'guardian' | 'system';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  payload?: Record<string, any>;
  timestamp: Date;
  retryCount: number;
  nextRetryAt: Date | null;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'dlq';
}

interface AlertChannel {
  id: string;
  name: string;
  type: 'email' | 'slack' | 'telegram' | 'webhook';
  config: Record<string, any>;
  isActive: boolean;
}

interface DLQConfig {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  escalationThreshold: number;
  dlqRetentionHours: number;
}

// Configuration
const dlqConfig: DLQConfig = {
  maxRetries: 5,
  initialBackoffMs: 5000, // 5 seconds
  maxBackoffMs: 300000, // 5 minutes
  escalationThreshold: 3,
  dlqRetentionHours: 168, // 7 days
};

// Dead Letter Queue Manager
class DeadLetterQueueManager {
  private dlqFilePath: string;
  private alertsFilePath: string;

  constructor() {
    this.dlqFilePath = path.join(process.cwd(), 'data', 'dlq.json');
    this.alertsFilePath = path.join(process.cwd(), 'data', 'alerts.json');
    this.ensureDirectoriesExist();
  }

  private async ensureDirectoriesExist() {
    const dataDir = path.dirname(this.dlqFilePath);
    try {
      await fs.access(dataDir);
    } catch {
      await fs.mkdir(dataDir, { recursive: true });
    }
  }

  // Generate Correlation ID
  generateCorrelationId(): string {
    return uuidv4();
  }

  // Create a new alert event
  async createAlertEvent(
    type: AlertEvent['type'],
    severity: AlertEvent['severity'],
    message: string,
    payload?: Record<string, any>
  ): Promise<AlertEvent> {
    const correlationId = this.generateCorrelationId();
    const alertEvent: AlertEvent = {
      id: uuidv4(),
      correlationId,
      type,
      severity,
      message,
      payload,
      timestamp: new Date(),
      retryCount: 0,
      nextRetryAt: null,
      status: 'pending',
    };

    try {
      // Try to save to database first
      await prisma.alertEvent.create({
        data: {
          id: alertEvent.id,
          correlationId: alertEvent.correlationId,
          type: alertEvent.type,
          severity: alertEvent.severity,
          message: alertEvent.message,
          payload: alertEvent.payload || {},
          timestamp: alertEvent.timestamp,
          retryCount: alertEvent.retryCount,
          nextRetryAt: alertEvent.nextRetryAt,
          status: alertEvent.status,
        },
      });
    } catch (dbError) {
      console.error('Database unavailable, falling back to file storage:', dbError);
      // Fallback to file storage
      await this.saveToFile(alertEvent, this.alertsFilePath);
    }

    return alertEvent;
  }

  // Process alert with retry/backoff logic
  async processAlert(alertId: string): Promise<void> {
    let alert: AlertEvent;
    
    try {
      // Try to get from database first
      alert = await prisma.alertEvent.findUnique({
        where: { id: alertId },
      }) as AlertEvent;
    } catch (dbError) {
      console.error('Database unavailable, falling back to file storage:', dbError);
      // Fallback to file storage
      alert = await this.loadFromFile(alertId, this.alertsFilePath);
      if (!alert) {
        throw new Error(`Alert with ID ${alertId} not found in file storage`);
      }
    }

    if (alert.status === 'success' || alert.status === 'dlq') {
      return; // Already processed or in DLQ
    }

    // Check if we should retry
    if (alert.retryCount >= dlqConfig.maxRetries) {
      await this.moveToDLQ(alert);
      return;
    }

    // Calculate backoff time
    const backoffTime = Math.min(
      dlqConfig.initialBackoffMs * Math.pow(2, alert.retryCount),
      dlqConfig.maxBackoffMs
    );
    
    const nextRetryAt = new Date(Date.now() + backoffTime);
    
    // Update alert status
    alert.status = 'processing';
    alert.retryCount += 1;
    alert.nextRetryAt = nextRetryAt;
    
    try {
      // Try to update in database
      await prisma.alertEvent.update({
        where: { id: alertId },
        data: {
          retryCount: alert.retryCount,
          nextRetryAt: alert.nextRetryAt,
          status: alert.status,
        },
      });
    } catch (dbError) {
      console.error('Database unavailable, updating file storage:', dbError);
      // Fallback to file storage
      await this.saveToFile(alert, this.alertsFilePath);
    }

    // Schedule retry
    setTimeout(async () => {
      await this.sendAlert(alert);
    }, backoffTime);
  }

  // Send alert through configured channels
  async sendAlert(alert: AlertEvent): Promise<void> {
    const channels = await this.getActiveChannels();
    let allChannelsFailed = true;
    
    const sendPromises = channels.map(async (channel) => {
      try {
        await this.dispatchAlert(channel, alert);
        allChannelsFailed = false;
        
        // Mark as successful in database if possible
        try {
          await prisma.alertEvent.update({
            where: { id: alert.id },
            data: { status: 'success' },
          });
        } catch (dbError) {
          console.error('Failed to update alert status in database:', dbError);
          // Update in file storage as fallback
          alert.status = 'success';
          await this.saveToFile(alert, this.alertsFilePath);
        }
      } catch (error) {
        console.error(`Failed to send alert via ${channel.name}:`, error);
        
        // If all channels failed and we've hit escalation threshold
        if (allChannelsFailed && alert.retryCount >= dlqConfig.escalationThreshold) {
          await this.escalateAlert(alert);
        }
      }
    });
    
    await Promise.all(sendPromises);
  }

  // Move alert to Dead Letter Queue
  async moveToDLQ(alert: AlertEvent): Promise<void> {
    alert.status = 'dlq';
    
    try {
      // Try to update in database
      await prisma.alertEvent.update({
        where: { id: alert.id },
        data: { status: 'dlq' },
      });
    } catch (dbError) {
      console.error('Database unavailable, updating file storage:', dbError);
      // Fallback to file storage
      await this.saveToFile(alert, this.alertsFilePath);
    }
    
    // Add to DLQ file
    const dlqEntry = {
      alertId: alert.id,
      correlationId: alert.correlationId,
      timestamp: new Date(),
      reason: 'Max retries exceeded',
      alertData: alert,
    };
    
    try {
      let dlqData: any[] = [];
      try {
        const dlqContent = await fs.readFile(this.dlqFilePath, 'utf-8');
        dlqData = JSON.parse(dlqContent);
      } catch (error) {
        // File doesn't exist or is empty, start fresh
      }
      
      dlqData.push(dlqEntry);
      await fs.writeFile(this.dlqFilePath, JSON.stringify(dlqData, null, 2));
    } catch (error) {
      console.error('Failed to write to DLQ file:', error);
    }
    
    // Schedule DLQ cleanup
    setTimeout(() => {
      this.cleanupDLQ();
    }, dlqConfig.dlqRetentionHours * 60 * 60 * 1000);
  }

  // Escalate alert when critical
  async escalateAlert(alert: AlertEvent): Promise<void> {
    // In a real implementation, this would trigger alternative notification methods
    // like SMS, PagerDuty, or wake-up calls
    
    const escalationMessage = `[ESCALATION] Alert ${alert.correlationId} has failed to deliver through all channels. ` +
      `Original alert: ${alert.message}`;
    
    console.error(escalationMessage);
    
    // Create a new critical alert for the escalation
    await this.createAlertEvent(
      'system',
      'critical',
      escalationMessage,
      { originalAlertId: alert.id }
    );
  }

  // Get active notification channels
  private async getActiveChannels(): Promise<AlertChannel[]> {
    try {
      // Try to get from database
      return await prisma.alertChannel.findMany({
        where: { isActive: true },
      }) as AlertChannel[];
    } catch (dbError) {
      console.error('Database unavailable, falling back to default channels:', dbError);
      // Fallback to default channels
      return [
        {
          id: 'default-email',
          name: 'Default Email',
          type: 'email',
          config: {
            to: 'operator@example.com',
            from: 'alerts@example.com',
          },
          isActive: true,
        },
      ];
    }
  }

  // Dispatch alert to specific channel
  private async dispatchAlert(channel: AlertChannel, alert: AlertEvent): Promise<void> {
    // Simulate sending to different channel types
    switch (channel.type) {
      case 'email':
        console.log(`Sending email alert for ${alert.correlationId}: ${alert.message}`);
        // Implementation would use nodemailer or similar
        break;
      case 'slack':
        console.log(`Sending Slack alert for ${alert.correlationId}: ${alert.message}`);
        // Implementation would use @slack/web-api
        break;
      case 'telegram':
        console.log(`Sending Telegram alert for ${alert.correlationId}: ${alert.message}`);
        // Implementation would use node-telegram-bot-api
        break;
      case 'webhook':
        console.log(`Sending webhook alert for ${alert.correlationId}: ${alert.message}`);
        // Implementation would use fetch or axios
        break;
      default:
        throw new Error(`Unsupported alert channel type: ${channel.type}`);
    }
  }

  // Cleanup old DLQ entries
  private async cleanupDLQ(): Promise<void> {
    try {
      const dlqContent = await fs.readFile(this.dlqFilePath, 'utf-8');
      let dlqData: any[] = JSON.parse(dlqContent);
      
      const cutoffTime = new Date(Date.now() - dlqConfig.dlqRetentionHours * 60 * 60 * 1000);
      
      dlqData = dlqData.filter(entry => new Date(entry.timestamp) > cutoffTime);
      
      await fs.writeFile(this.dlqFilePath, JSON.stringify(dlqData, null, 2));
    } catch (error) {
      console.error('Failed to cleanup DLQ:', error);
    }
  }

  // Fallback file storage methods
  private async saveToFile(alert: AlertEvent, filePath: string): Promise<void> {
    let alerts: any[] = [];
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      alerts = JSON.parse(content);
    } catch (error) {
      // File doesn't exist or is empty, start fresh
    }
    
    // Replace if exists, otherwise add
    const existingIndex = alerts.findIndex(a => a.id === alert.id);
    if (existingIndex >= 0) {
      alerts[existingIndex] = alert;
    } else {
      alerts.push(alert);
    }
    
    await fs.writeFile(filePath, JSON.stringify(alerts, null, 2));
  }

  private async loadFromFile(alertId: string, filePath: string): Promise<AlertEvent | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const alerts: any[] = JSON.parse(content);
      return alerts.find(a => a.id === alertId) || null;
    } catch (error) {
      return null;
    }
  }
}

// Initialize the DLQ manager
const dlqManager = new DeadLetterQueueManager();

// API route for creating alerts
export async function POST(request: Request) {
  try {
    const { type, severity, message, payload } = await request.json();
    
    if (!type || !severity || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const alert = await dlqManager.createAlertEvent(type, severity, message, payload);
    
    // Start processing the alert
    dlqManager.processAlert(alert.id);
    
    return new Response(JSON.stringify({ success: true, alert }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error creating alert:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// API route for processing DLQ items
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  
  if (action === 'cleanup') {
    await dlqManager.cleanupDLQ();
    return new Response(JSON.stringify({ success: true, message: 'DLQ cleanup completed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  return new Response(JSON.stringify({ error: 'Invalid action' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}
