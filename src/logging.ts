export type LogLevel = 'silent' | 'info' | 'debug';

const LOG_PRIORITY: Record<LogLevel, number> = {
  silent: 0,
  info: 1,
  debug: 2,
};

let cachedLogLevel: LogLevel | undefined;

export function getLogLevel(): LogLevel {
  if (cachedLogLevel) return cachedLogLevel;
  cachedLogLevel = 'info';
  return cachedLogLevel;
}

/**
 * Programmatically set the log level (avoids env var race conditions with --debug flag).
 */
export function setLogLevel(level: LogLevel): void {
  cachedLogLevel = level;
}

function formatTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Log a progress/activity message at info level.
 */
export function logProgress(tag: string, message: string, details?: Record<string, unknown>): void {
  if (LOG_PRIORITY['info'] <= LOG_PRIORITY[getLogLevel()]) {
    const timestamp = formatTimestamp();
    const detailStr = details ? ` ${JSON.stringify(details)}` : '';
    console.log(`${timestamp} [${tag}] ${message}${detailStr}`);
  }
}

/**
 * Create a timer for measuring elapsed time.
 */
export function createTimer(): { elapsed: () => number; elapsedStr: () => string } {
  const start = Date.now();
  return {
    elapsed: () => Date.now() - start,
    elapsedStr: () => {
      const ms = Date.now() - start;
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      return `${(ms / 60000).toFixed(1)}m`;
    },
  };
}

/**
 * Log debug information (single line, compact).
 */
export function logDebug(tag: string, message: string, data?: unknown): void {
  if (getLogLevel() !== 'debug') return;

  const timestamp = formatTimestamp();
  if (data === undefined) {
    console.log(`${timestamp} [${tag}][debug] ${message}`);
  } else {
    const formatted = typeof data === 'string' ? data : JSON.stringify(data);
    const truncated = formatted.length > 200 ? formatted.slice(0, 200) + '...' : formatted;
    console.log(`${timestamp} [${tag}][debug] ${message}: ${truncated}`);
  }
}

/**
 * Log debug information without truncation (for full prompts and responses).
 */
export function logDebugFull(tag: string, message: string, data?: string): void {
  if (getLogLevel() !== 'debug') return;

  const timestamp = formatTimestamp();
  if (data === undefined) {
    console.log(`${timestamp} [${tag}][debug] ${message}`);
  } else {
    console.log(`${timestamp} [${tag}][debug] ${message}:\n${data}`);
  }
}
