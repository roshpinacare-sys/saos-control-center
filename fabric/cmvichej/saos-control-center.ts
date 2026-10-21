import { createLogger, transports, format, Logger } from 'winston';
import { ElasticsearchTransport } from '@elastic/elasticsearch/libtransport';
import { Client } from '@elastic/elasticsearch';
import fs from 'fs';
import path from 'path';

// Configuration for the logging system
interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  format: 'json' | 'text';
  enableConsole: boolean;
  enableFile: boolean;
  enableElasticsearch: boolean;
  elasticsearchUrl?: string;
  logDirectory: string;
  retentionDays: number;
}

// Default configuration
const defaultConfig: LoggingConfig = {
  level: 'info',
  format: 'json',
  enableConsole: true,
  enableFile: true,
  enableElasticsearch: false,
  logDirectory: './logs',
  retentionDays: 30,
};

// Central logging system class
class SaosLoggingSystem {
  private logger: Logger;
  private config: LoggingConfig;
  private elasticsearchClient: Client | null = null;

  constructor(config: Partial<LoggingConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    
    // Ensure log directory exists
    if (!fs.existsSync(this.config.logDirectory)) {
      fs.mkdirSync(this.config.logDirectory, { recursive: true });
    }

    // Initialize Elasticsearch client if enabled
    if (this.config.enableElasticsearch && this.config.elasticsearchUrl) {
      this.elasticsearchClient = new Client({
        node: this.config.elasticsearchUrl,
      });
    }

    // Create logger with specified transports
    const transportsArray: any[] = [];

    // Console transport
    if (this.config.enableConsole) {
      transportsArray.push(
        new transports.Console({
          format: this.config.format === 'json' 
            ? format.json() 
            : format.combine(format.colorize(), format.simple()),
        })
      );
    }

    // File transport
    if (this.config.enableFile) {
      transportsArray.push(
        new transports.File({
          filename: path.join(this.config.logDirectory, 'saos-control-center.log'),
          format: format.json(),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
        })
      );

      // Error file transport
      transportsArray.push(
        new transports.File({
          filename: path.join(this.config.logDirectory, 'error.log'),
          level: 'error',
          format: format.json(),
          maxsize: 10 * 1024 * 1024, // 10MB
          maxFiles: 5,
        })
      );
    }

    // Elasticsearch transport
    if (this.config.enableElasticsearch && this.elasticsearchClient) {
      transportsArray.push(
        new ElasticsearchTransport({
          client: this.elasticsearchClient,
          index: 'saos-logs',
        })
      );
    }

    this.logger = createLogger({
      level: this.config.level,
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.metadata()
      ),
      transports: transportsArray,
    });

    // Set up log rotation and cleanup
    this.setupLogRetention();

    // Replace console methods
    this.overrideConsoleMethods();
  }

  // Set up log retention based on configuration
  private setupLogRetention(): void {
    const intervalMs = 24 * 60 * 60 * 1000; // Check daily
    
    setInterval(() => {
      const now = new Date();
      const cutoffDate = new Date(now);
      cutoffDate.setDate(now.getDate() - this.config.retentionDays);

      // Find and delete old log files
      fs.readdir(this.config.logDirectory, (err, files) => {
        if (err) return;

        files.forEach(file => {
          const filePath = path.join(this.config.logDirectory, file);
          fs.stat(filePath, (err, stats) => {
            if (err) return;
            
            if (stats.mtime < cutoffDate) {
              fs.unlink(filePath, err => {
                if (err) this.logger.error(`Failed to delete old log file: ${filePath}`, { error: err });
              });
            }
          });
        });
      });
    }, intervalMs);
  }

  // Override console methods to use our logger
  private overrideConsoleMethods(): void {
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };

    console.log = (...args: any[]) => {
      this.logger.info(args.join(' '), { originalMethod: 'console.log' });
      originalConsole.log.apply(console, args);
    };

    console.warn = (...args: any[]) => {
      this.logger.warn(args.join(' '), { originalMethod: 'console.warn' });
      originalConsole.warn.apply(console, args);
    };

    console.error = (...args: any[]) => {
      this.logger.error(args.join(' '), { originalMethod: 'console.error' });
      originalConsole.error.apply(console, args);
    };

    console.info = (...args: any[]) => {
      this.logger.info(args.join(' '), { originalMethod: 'console.info' });
      originalConsole.info.apply(console, args);
    };

    console.debug = (...args: any[]) => {
      this.logger.debug(args.join(' '), { originalMethod: 'console.debug' });
      originalConsole.debug.apply(console, args);
    };
  }

  // Method to search logs
  async searchLogs(query: any, filters: any = {}): Promise<any[]> {
    if (!this.elasticsearchClient) {
      this.logger.warn('Elasticsearch is not configured. Cannot search logs.');
      return [];
    }

    try {
      const response = await this.elasticsearchClient.search({
        index: 'saos-logs',
        body: {
          query: {
            bool: {
              must: [
                {
                  query_string: {
                    query: query,
                  },
                },
              ],
              filter: filters,
            },
          },
          sort: [
            { timestamp: { order: 'desc' } },
          ],
        },
      });

      return response.body.hits.hits.map((hit: any) => hit._source);
    } catch (error) {
      this.logger.error('Failed to search logs', { error });
      return [];
    }
  }

  // Method to export logs
  async exportLogs(filters: any = {}): Promise<string> {
    if (!this.elasticsearchClient) {
      this.logger.warn('Elasticsearch is not configured. Cannot export logs.');
      return '';
    }

    try {
      const response = await this.elasticsearchClient.search({
        index: 'saos-logs',
        body: {
          query: {
            bool: {
              filter: filters,
            },
          },
          sort: [
            { timestamp: { order: 'asc' } },
          ],
        },
      });

      const logs = response.body.hits.hits.map((hit: any) => hit._source);
      return JSON.stringify(logs, null, 2);
    } catch (error) {
      this.logger.error('Failed to export logs', { error });
      return '';
    }
  }

  // Method to set log level
  setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    this.logger.level = level;
    this.config.level = level;
    this.logger.info(`Log level changed to ${level}`);
  }

  // Method to get current log level
  getLogLevel(): string {
    return this.config.level;
  }

  // Method to add alert integration
  addAlertIntegration(alertSystem: any): void {
    // In a real implementation, this would integrate with existing alert systems
    this.logger.info('Alert integration added', { system: alertSystem.constructor.name });
  }

  // Method to create a child logger with additional context
  child(context: Record<string, any>): Logger {
    return this.logger.child(context);
  }
}

// Initialize the logging system
const loggingSystem = new SaosLoggingSystem({
  level: process.env.LOG_LEVEL as any || 'info',
  format: process.env.LOG_FORMAT as any || 'json',
  enableConsole: process.env.NODE_ENV !== 'production',
  enableFile: true,
  enableElasticsearch: process.env.ELASTICSEARCH_URL ? true : false,
  elasticsearchUrl: process.env.ELASTICSEARCH_URL,
  logDirectory: process.env.LOG_DIR || './logs',
  retentionDays: parseInt(process.env.LOG_RETENTION_DAYS || '30', 10),
});

// Export the logging system and utilities
export default loggingSystem;

// Example usage in other parts of the application
// Instead of console.log('Some message'), use:
// loggingSystem.info('Some message', { context: 'some-module' });

// For more structured logging with child loggers:
// const logger = loggingSystem.child({ service: 'dex-service' });
// logger.info('Processing swap', { txId: 'abc123' });

// For error logging with stack traces:
// try {
//   // some operation
// } catch (error) {
//   loggingSystem.error('Operation failed', { error: error.message, stack: error.stack });
// }
