import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createHash } from 'crypto';

// DLQ Configuration
const DLQ_DIR = path.join(process.cwd(), 'dead-letter-queue');
const DLQ_LOG_FILE = path.join(DLQ_DIR, 'dlq.log');

// Alert Channels
const ALERT_CHANNELS = {
  LOCAL: 'local',
  EXTERNAL: 'external',
};

// DLQ Entry Interface
interface DLQEntry {
  id: string;
  correlationId: string;
  channel: string;
  payload: any;
  timestamp: number;
  retryCount: number;
  error: string;
}

// Alert Interface
interface Alert {
  id: string;
  correlationId: string;
  channel: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
}

// Initialize DLQ Directory
async function initDLQ() {
  try {
    await fs.access(DLQ_DIR);
  } catch {
    await fs.mkdir(DLQ_DIR, { recursive: true });
  }
}

// Generate Correlation ID
function generateCorrelationId(): string {
  return crypto.randomUUID();
}

// Log DLQ Operation
async function logDLQOperation(operation: string, data: any) {
  const logEntry = {
    timestamp: Date.now(),
    operation,
    data,
  };
  
  try {
    await fs.appendFile(DLQ_LOG_FILE, JSON.stringify(logEntry) + '\n');
  } catch (error) {
    console.error('Failed to log DLQ operation:', error);
  }
}

// Send Alert with DLQ Fallback
export async function sendAlert(alert: Alert): Promise<boolean> {
  const correlationId = alert.correlationId || generateCorrelationId();
  alert.correlationId = correlationId;
  
  try {
    // Try local alert channel first
    if (await trySendAlertToChannel(ALERT_CHANNELS.LOCAL, alert)) {
      await logDLQOperation('alert_sent', { channel: ALERT_CHANNELS.LOCAL, correlationId });
      return true;
    }
    
    // Try external alert channel
    if (await trySendAlertToChannel(ALERT_CHANNELS.EXTERNAL, alert)) {
      await logDLQOperation('alert_sent', { channel: ALERT_CHANNELS.EXTERNAL, correlationId });
      return true;
    }
    
    // Both channels failed, send to DLQ
    await addToDLQ(alert, 'Both alert channels failed');
    await notifyMonitoringSystem(correlationId);
    return false;
  } catch (error) {
    await addToDLQ(alert, `Alert sending failed: ${error}`);
    await notifyMonitoringSystem(correlationId);
    return false;
  }
}

// Try to send alert to specific channel
async function trySendAlertToChannel(channel: string, alert: Alert): Promise<boolean> {
  try {
    // Simulate sending to local alert system (DB Guard)
    if (channel === ALERT_CHANNELS.LOCAL) {
      // In a real implementation, this would interact with your local alert system
      console.log(`Sending alert to local channel: ${alert.message}`);
      return true;
    }
    
    // Simulate sending to external alert system (Control Center)
    if (channel === ALERT_CHANNELS.EXTERNAL) {
      // In a real implementation, this would interact with your external alert system
      console.log(`Sending alert to external channel: ${alert.message}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`Failed to send alert to ${channel} channel:`, error);
    return false;
  }
}

// Add alert to DLQ
async function addToDLQ(alert: Alert, error: string): Promise<void> {
  const dlqEntry: DLQEntry = {
    id: crypto.randomUUID(),
    correlationId: alert.correlationId,
    channel: alert.channel,
    payload: alert,
    timestamp: Date.now(),
    retryCount: 0,
    error,
  };
  
  try {
    const dlqFile = path.join(DLQ_DIR, `dlq-${Date.now()}.json`);
    await fs.writeFile(dlqFile, JSON.stringify(dlqEntry, null, 2));
    await logDLQOperation('alert_to_dlq', { correlationId: dlqEntry.correlationId, error });
  } catch (error) {
    console.error('Failed to add alert to DLQ:', error);
    throw error;
  }
}

// Notify monitoring system about DLQ addition
async function notifyMonitoringSystem(correlationId: string): Promise<void> {
  try {
    // In a real implementation, this would send a notification to your monitoring system
    console.log(`Notifying monitoring system about DLQ entry with correlation ID: ${correlationId}`);
    await logDLQOperation('monitoring_notified', { correlationId });
  } catch (error) {
    console.error('Failed to notify monitoring system:', error);
  }
}

// Process DLQ entries
export async function processDLQ(): Promise<void> {
  try {
    const files = await fs.readdir(DLQ_DIR);
    const dlqFiles = files.filter(file => file.startsWith('dlq-') && file.endsWith('.json'));
    
    for (const file of dlqFiles) {
      const filePath = path.join(DLQ_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const entry: DLQEntry = JSON.parse(content);
      
      // Try to resend the alert
      const alert: Alert = entry.payload;
      const success = await trySendAlertToChannel(entry.channel, alert);
      
      if (success) {
        // Successfully resent, remove from DLQ
        await fs.unlink(filePath);
        await logDLQOperation('dlq_entry_resolved', { correlationId: entry.correlationId });
      } else {
        // Increment retry count
        entry.retryCount += 1;
        entry.timestamp = Date.now();
        
        // If max retries reached, move to permanent error storage
        if (entry.retryCount >= 5) {
          await moveToPermanentErrorStorage(entry);
          await fs.unlink(filePath);
        } else {
          // Update the entry with new retry count
          await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
        }
      }
    }
  } catch (error) {
    console.error('Failed to process DLQ:', error);
    await logDLQOperation('dlq_processing_error', { error });
  }
}

// Move entry to permanent error storage
async function moveToPermanentErrorStorage(entry: DLQEntry): Promise<void> {
  const errorDir = path.join(DLQ_DIR, 'permanent-errors');
  
  try {
    await fs.mkdir(errorDir, { recursive: true });
    const errorFile = path.join(errorDir, `error-${entry.id}.json`);
    await fs.writeFile(errorFile, JSON.stringify(entry, null, 2));
    await logDLQOperation('moved_to_permanent_error', { correlationId: entry.correlationId });
  } catch (error) {
    console.error('Failed to move entry to permanent error storage:', error);
    throw error;
  }
}

// Get DLQ statistics
export async function getDLQStats(): Promise<any> {
  try {
    const files = await fs.readdir(DLQ_DIR);
    const dlqFiles = files.filter(file => file.startsWith('dlq-') && file.endsWith('.json'));
    
    const stats = {
      totalEntries: dlqFiles.length,
      entriesByChannel: {
        [ALERT_CHANNELS.LOCAL]: 0,
        [ALERT_CHANNELS.EXTERNAL]: 0,
      },
      oldestEntry: null,
      newestEntry: null,
    };
    
    for (const file of dlqFiles) {
      const filePath = path.join(DLQ_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const entry: DLQEntry = JSON.parse(content);
      
      // Count by channel
      stats.entriesByChannel[entry.channel] += 1;
      
      // Track oldest and newest
      if (!stats.oldestEntry || entry.timestamp < stats.oldestEntry.timestamp) {
        stats.oldestEntry = entry;
      }
      
      if (!stats.newestEntry || entry.timestamp > stats.newestEntry.timestamp) {
        stats.newestEntry = entry;
      }
    }
    
    return stats;
  } catch (error) {
    console.error('Failed to get DLQ stats:', error);
    throw error;
  }
}

// Handle edge case: both alert systems unavailable on first run
export async function handleInitialBootFailure(): Promise<void> {
  try {
    // Check if this is a fresh environment
    const dlqFiles = await fs.readdir(DLQ_DIR).catch(() => []);
    if (dlqFiles.length === 0) {
      // Create a special alert for the initial boot failure
      const bootFailureAlert: Alert = {
        id: 'initial-boot-failure',
        correlationId: generateCorrelationId(),
        channel: 'system',
        message: 'Initial boot failure - both alert systems unavailable',
        severity: 'critical',
        timestamp: Date.now(),
      };
      
      // Add directly to DLQ without trying to send
      await addToDLQ(bootFailureAlert, 'Initial boot failure - both alert systems unavailable');
      await logDLQOperation('initial_boot_failure_handled', { correlationId: bootFailureAlert.correlationId });
    }
  } catch (error) {
    console.error('Failed to handle initial boot failure:', error);
    throw error;
  }
}

// Initialize DLQ on module load
initDLQ();
