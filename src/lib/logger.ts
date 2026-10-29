/**
 * @fileOverview Structured Logger for CACU Production.
 * Outputs JSON logs for automated ingestion by log management platforms.
 * Redacts sensitive fields and includes high-level context.
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'PERF' | 'SECURITY';

interface LogPayload {
  message: string;
  level: LogLevel;
  service?: string;
  context?: Record<string, unknown>;
  error?: unknown;
  duration?: number; // For PERF logs
}

const REDACTED_FIELDS = ['password', 'token', 'secret', 'key', 'accountNumber'];

class Logger {
  private environment = process.env.NODE_ENV || 'development';

  private redact(obj?: Record<string, unknown>) {
    if (!obj || typeof obj !== 'object') return obj;
    const result: Record<string, unknown> = { ...obj };
    for (const field of REDACTED_FIELDS) {
      if (field in result) result[field] = '[REDACTED]';
    }
    return result;
  }

  private log(payload: LogPayload) {
    const output = {
      timestamp: new Date().toISOString(),
      environment: this.environment,
      ...payload,
      context: this.redact(payload.context),
    };

    if (payload.error instanceof Error) {
      output.error = {
        message: payload.error.message,
        stack: this.environment === 'development' ? payload.error.stack : undefined,
      };
    }

    if (this.environment === 'test') return;

    if (payload.level === 'ERROR' || payload.level === 'SECURITY') {
      console.error(JSON.stringify(output));
    } else {
      console.log(JSON.stringify(output));
    }
  }

  info(message: string, context?: Record<string, unknown>, service = 'App') {
    this.log({ message, level: 'INFO', context, service });
  }

  warn(message: string, context?: Record<string, unknown>, service = 'App') {
    this.log({ message, level: 'WARN', context, service });
  }

  error(message: string, error?: unknown, context?: Record<string, unknown>, service = 'App') {
    this.log({ message, level: 'ERROR', error, context, service });
  }

  security(message: string, context?: Record<string, unknown>, service = 'Auth') {
    this.log({ message, level: 'SECURITY', context, service });
  }

  perf(message: string, duration: number, context?: Record<string, unknown>, service = 'DB') {
    if (duration > 500) {
      this.log({ message: `SLOW QUERY: ${message}`, level: 'PERF', duration, context, service });
    }
  }
}

export const logger = new Logger();
