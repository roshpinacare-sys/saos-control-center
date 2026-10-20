import { prisma } from '@/lib/db';
import { SafeError } from '@/lib/safe-error';
import { randomUUID } from 'crypto';

type DLQEntry = {
  id: string;
  correlationId: string;
  channel: 'local' | 'external';
  payload: any;
  timestamp: Date;
  attempts: number;
  lastError: string | null;
  metadata: Record<string, any>;
  status: 'pending' | 'retry' | 'escalated' | 'completed';
};

type AlertChannel = 'local' | 'external' | 'emergency';

export class DeadLetterQueue {
  private static instance: DeadLetterQueue;
  private maxRetries = 3;
  private escalationThreshold = 3;
  private backoffBaseMs = 5000; // 5 seconds base backoff

  private constructor() {}

  static getInstance(): DeadLetterQueue {
    if (!DeadLetterQueue.instance) {
      DeadLetterQueue.instance = new DeadLetterQueue();
    }
    return DeadLetterQueue.instance;
  }

  async enqueueAlert(
    correlationId: string,
    channel: AlertChannel,
    payload: any,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    try {
      await prisma.deadLetterQueue.create({
        data: {
          id: randomUUID(),
          correlationId,
          channel,
          payload: JSON.stringify(payload),
          timestamp: new Date(),
          attempts: 0,
          lastError: null,
          metadata: JSON.stringify(metadata),
          status: 'pending',
        },
      });
    } catch (error) {
      throw new SafeError('Failed to enqueue alert to DLQ', { cause: error });
    }
  }

  async processPendingEntries(): Promise<void> {
    try {
      const pendingEntries = await prisma.deadLetterQueue.findMany({
        where: { status: 'pending' },
      });

      for (const entry of pendingEntries) {
        await this.processEntry(entry);
      }
    } catch (error) {
      throw new SafeError('Failed to process DLQ entries', { cause: error });
    }
  }

  private async processEntry(entry: any): Promise<void> {
    try {
      const parsedPayload = JSON.parse(entry.payload);
      const parsedMetadata = JSON.parse(entry.metadata);

      // Attempt to send the alert
      const success = await this.sendAlert(entry.channel, parsedPayload, parsedMetadata);

      if (success) {
        // Mark as completed
        await prisma.deadLetterQueue.update({
          where: { id: entry.id },
          data: { status: 'completed' },
        });
        return;
      }

      // If failed, increment attempts and check if we need to escalate
      const newAttempts = entry.attempts + 1;
      let newStatus: 'retry' | 'escalated' = 'retry';

      if (newAttempts >= this.maxRetries) {
        newStatus = 'escalated';
        
        // Escalate to emergency channel
        await this.sendAlert('emergency', parsedPayload, parsedMetadata);
      }

      // Update entry with new attempts and status
      await prisma.deadLetterQueue.update({
        where: { id: entry.id },
        data: {
          attempts: newAttempts,
          lastError: 'Failed to send alert',
          status: newStatus,
          nextRetryAt: this.calculateNextRetry(newAttempts),
        },
      });
    } catch (error) {
      // Log error and update entry
      await prisma.deadLetterQueue.update({
        where: { id: entry.id },
        data: {
          lastError: error instanceof Error ? error.message : 'Unknown error',
          attempts: entry.attempts + 1,
        },
      });
      throw new SafeError(`Failed to process DLQ entry ${entry.id}`, { cause: error });
    }
  }

  private async sendAlert(
    channel: AlertChannel,
    payload: any,
    metadata: Record<string, any>
  ): Promise<boolean> {
    try {
      // In a real implementation, this would send to the appropriate channel
      // For now, we'll simulate with a mock implementation
      
      if (channel === 'local') {
        // Send to local alert system
        // This would be the implementation from src/components/ui/alert.ts
        console.log('Sending to local alert:', { payload, metadata });
      } else if (channel === 'external') {
        // Send to external Control Center
        // This would be the implementation from the Control Center API
        console.log('Sending to external Control Center:', { payload, metadata });
      } else if (channel === 'emergency') {
        // Send to emergency channel
        console.log('Escalating to emergency channel:', { payload, metadata });
      }

      // Simulate potential failure
      if (Math.random() < 0.3) {
        throw new Error('Simulated alert failure');
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  private calculateNextRetry(attempts: number): Date {
    const delayMs = this.backoffBaseMs * Math.pow(2, attempts);
    return new Date(Date.now() + delayMs);
  }

  async getDLQEntries(status?: 'pending' | 'retry' | 'escalated' | 'completed'): Promise<DLQEntry[]> {
    try {
      const whereClause = status ? { status } : {};
      const entries = await prisma.deadLetterQueue.findMany({
        where: whereClause,
        orderBy: { timestamp: 'desc' },
      });

      return entries.map(entry => ({
        ...entry,
        payload: JSON.parse(entry.payload),
        metadata: JSON.parse(entry.metadata),
      }));
    } catch (error) {
      throw new SafeError('Failed to retrieve DLQ entries', { cause: error });
    }
  }

  async retryEntry(id: string): Promise<void> {
    try {
      const entry = await prisma.deadLetterQueue.findUnique({
        where: { id },
      });

      if (!entry || entry.status !== 'pending') {
        throw new SafeError('Entry not found or not in pending state');
      }

      await this.processEntry(entry);
    } catch (error) {
      throw new SafeError(`Failed to retry DLQ entry ${id}`, { cause: error });
    }
  }
}

// Prisma schema extension (would be in schema.prisma):
// model DeadLetterQueue {
//   id          String   @id @default(cuid())
//   correlationId String
//   channel     String   // 'local' | 'external' | 'emergency'
//   payload     String   // JSON string of the alert payload
//   timestamp   DateTime
//   attempts    Int      @default(0)
//   lastError   String?  // Last error message
//   metadata    String   // JSON string of additional metadata
//   status      String   // 'pending' | 'retry' | 'escalated' | 'completed'
//   nextRetryAt DateTime?
//   createdAt   DateTime @default(now())
//   updatedAt   DateTime @updatedAt
// }
