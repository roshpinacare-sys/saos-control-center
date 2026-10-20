import { createHash } from 'crypto';
import { EventEmitter } from 'events';

// Types for our alert system
interface AlertPayload {
  id: string;
  type: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  metadata?: Record<string, any>;
}

interface AlertChannel {
  name: string;
  send: (alert: AlertPayload) => Promise<boolean>;
}

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

interface EscalationPolicy {
  levels: {
    level: number;
    recipients: string[];
    delayMs: number;
  }[];
}

// Alert System Core Class
class AlertSystem extends EventEmitter {
  private correlationIdCounter = 0;
  private sentAlerts = new Set<string>();
  private deadLetterQueue: AlertPayload[] = [];
  private channels: Map<string, AlertChannel> = new Map();
  private retryConfig: RetryConfig = {
    maxRetries: 5,
    initialDelayMs: 1000,
    maxDelayMs: 300000, // 5 minutes
    backoffFactor: 2,
  };
  private escalationPolicy: EscalationPolicy = {
    levels: [
      { level: 1, recipients: ['ops-team@example.com'], delayMs: 0 },
      { level: 2, recipients: ['engineering-lead@example.com'], delayMs: 300000 },
      { level: 3, recipients: ['cto@example.com'], delayMs: 600000 },
    ],
  };

  // Add a notification channel
  addChannel(name: string, channel: AlertChannel) {
    this.channels.set(name, channel);
  }

  // Generate a unique correlation ID
  private generateCorrelationId(): string {
    this.correlationIdCounter++;
    return `alert_${Date.now()}_${this.correlationIdCounter}`;
  }

  // Calculate delay with exponential backoff
  private calculateRetryDelay(attempt: number): number {
    const delay = this.retryConfig.initialDelayMs * 
      Math.pow(this.retryConfig.backoffFactor, attempt);
    return Math.min(delay, this.retryConfig.maxDelayMs);
  }

  // Send alert to a specific channel with retry logic
  private async sendWithRetry(
    channelName: string,
    alert: AlertPayload,
    attempt = 0
  ): Promise<boolean> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      console.error(`Alert channel ${channelName} not found`);
      return false;
    }

    try {
      const success = await channel.send(alert);
      if (success) {
        return true;
      }
    } catch (error) {
      console.error(`Failed to send alert to ${channelName}:`, error);
    }

    if (attempt >= this.retryConfig.maxRetries) {
      console.error(`Max retries exceeded for alert ${alert.id} on channel ${channelName}`);
      this.deadLetterQueue.push(alert);
      return false;
    }

    const delay = this.calculateRetryDelay(attempt);
    console.log(`Retrying alert ${alert.id} on ${channelName} in ${delay}ms (attempt ${attempt + 1})`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    return this.sendWithRetry(channelName, alert, attempt + 1);
  }

  // Deduplication check
  private isDuplicate(alert: AlertPayload): boolean {
    const hash = createHash('sha256')
      .update(alert.type + alert.message + JSON.stringify(alert.metadata))
      .digest('hex');
    
    if (this.sentAlerts.has(hash)) {
      return true;
    }
    
    this.sentAlerts.add(hash);
    return false;
  }

  // Send alert to all channels with fallback mechanism
  async sendAlert(
    type: string,
    message: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    metadata?: Record<string, any>,
    channels?: string[]
  ): Promise<void> {
    const alert: AlertPayload = {
      id: this.generateCorrelationId(),
      type,
      message,
      severity,
      timestamp: Date.now(),
      metadata: {
        ...metadata,
        correlationId: alert.id,
      },
    };

    // Skip if duplicate
    if (this.isDuplicate(alert)) {
      return;
    }

    console.log(`Sending alert: ${alert.id} - ${type}`);
    
    const targetChannels = channels || Array.from(this.channels.keys());
    const results = await Promise.allSettled(
      targetChannels.map(channelName => 
        this.sendWithRetry(channelName, alert)
      )
    );

    // Check if any channel succeeded
    const anySuccess = results.some(result => result.status === 'fulfilled' && result.value);
    
    if (!anySuccess && severity === 'critical') {
      // Fallback mechanism for critical alerts
      console.error(`All channels failed for critical alert ${alert.id}. Escalating immediately.`);
      this.escalate(alert, 0);
    }

    // Check if we need to escalate based on failure count
    const failureCount = results.filter(result => 
      result.status === 'rejected' || (result.status === 'fulfilled' && !result.value)
    ).length;
    
    if (failureCount > 0) {
      // Determine escalation level based on failure ratio
      const escalationLevel = Math.min(
        Math.ceil((failureCount / targetChannels.length) * this.escalationPolicy.levels.length),
        this.escalationPolicy.levels.length
      );
      
      if (escalationLevel > 0) {
        this.escalate(alert, escalationLevel);
      }
    }
  }

  // Escalate alert to higher levels
  private escalate(alert: AlertPayload, level: number) {
    const escalationLevel = Math.min(level, this.escalationPolicy.levels.length);
    const policy = this.escalationPolicy.levels[escalationLevel - 1];
    
    if (policy) {
      console.log(`Escalating alert ${alert.id} to level ${escalationLevel}:`, policy.recipients);
      
      // In a real implementation, you would send emails, pages, etc.
      // For this example, we'll just log it
      setTimeout(() => {
        console.log(`Escalation notification for alert ${alert.id} sent to:`, policy.recipients);
      }, policy.delayMs);
    }
  }

  // Process dead letter queue
  processDeadLetterQueue() {
    console.log(`Processing ${this.deadLetterQueue.length} dead letter alerts`);
    
    for (const alert of this.deadLetterQueue) {
      console.error(`Dead letter alert: ${alert.id} - ${alert.type}`, alert);
      // In a real implementation, you might store these in a database
      // or send them to a dedicated monitoring system
    }
    
    this.deadLetterQueue = [];
  }
}

// Channel Implementations
class LocalAlertChannel implements AlertChannel {
  name = 'local';
  
  async send(alert: AlertPayload): Promise<boolean> {
    console.log(`[LOCAL] Alert ${alert.id}: ${alert.type} - ${alert.message}`);
    return true;
  }
}

class ExternalAlertChannel implements AlertChannel {
  name = 'external';
  
  async send(alert: AlertPayload): Promise<boolean> {
    console.log(`[EXTERNAL] Alert ${alert.id}: ${alert.type} - ${alert.message}`);
    // Simulate potential failure
    if (Math.random() < 0.2) {
      throw new Error('External service unavailable');
    }
    return true;
  }
}

class DatabaseAlertChannel implements AlertChannel {
  name = 'database';
  
  async send(alert: AlertPayload): Promise<boolean> {
    console.log(`[DATABASE] Alert ${alert.id}: ${alert.type} - ${alert.message}`);
    // Simulate potential failure
    if (Math.random() < 0.3) {
      throw new Error('Database connection failed');
    }
    return true;
  }
}

// Initialize the alert system
const alertSystem = new AlertSystem();
alertSystem.addChannel('local', new LocalAlertChannel());
alertSystem.addChannel('external', new ExternalAlertChannel());
alertSystem.addChannel('database', new DatabaseAlertChannel());

// Example usage
export function alertDatabaseConnectionFailure(metadata?: Record<string, any>) {
  alertSystem.sendAlert(
    'database_connection_failure',
    'Database connection failed. Retrying...',
    'critical',
    {
      ...metadata,
      database: 'primary',
      operation: 'connection',
    },
    ['local', 'database', 'external']
  );
}

export function alertFetchFailure(endpoint: string, error: string, metadata?: Record<string, any>) {
  alertSystem.sendAlert(
    'fetch_failure',
    `Failed to fetch ${endpoint}: ${error}`,
    'high',
    {
      ...metadata,
      endpoint,
      error,
    },
    ['local', 'external']
  );
}

// Periodic dead letter queue processing
setInterval(() => {
  alertSystem.processDeadLetterQueue();
}, 60000); // Every minute

// Export the alert system for advanced usage
export { alertSystem };
