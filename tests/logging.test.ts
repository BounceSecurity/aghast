/**
 * Unit tests for the pluggable logging system (src/logging.ts).
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { resolve, join } from 'node:path';
import { readFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  type LogHandler,
  ConsoleHandler,
  FileHandler,
  isValidLogLevel,
  createHandlerByType,
  getAvailableLogTypes,
  addHandler,
  removeHandler,
  closeAllHandlers,
  initFileHandler,
  setLogLevel,
  getLogLevel,
  logProgress,
  logDebug,
  logDebugFull,
  logWarn,
  logError,
  _resetHandlers,
  _getHandlerNames,
} from '../src/logging.js';

function tmpLogFile(): string {
  return resolve(tmpdir(), `aghast-test-${randomUUID()}.log`);
}

beforeEach(async () => {
  await _resetHandlers('info');
});

// --- isValidLogLevel ---

test('isValidLogLevel: accepts all standard levels', () => {
  for (const level of ['error', 'warn', 'info', 'debug', 'trace']) {
    assert.ok(isValidLogLevel(level), `Expected "${level}" to be valid`);
  }
});

test('isValidLogLevel: rejects invalid levels', () => {
  for (const level of ['silent', 'verbose', 'critical', '', 'INFO']) {
    assert.ok(!isValidLogLevel(level), `Expected "${level}" to be invalid`);
  }
});

// --- ConsoleHandler ---

test('ConsoleHandler: suppresses messages below threshold', () => {
  const handler = new ConsoleHandler('warn');
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(' '));

  try {
    handler.handle({ timestamp: '2025-01-01', level: 'error', tag: 'test', message: 'error msg' });
    handler.handle({ timestamp: '2025-01-01', level: 'warn', tag: 'test', message: 'warn msg' });
    handler.handle({ timestamp: '2025-01-01', level: 'info', tag: 'test', message: 'info msg' });
    handler.handle({ timestamp: '2025-01-01', level: 'debug', tag: 'test', message: 'debug msg' });

    assert.equal(logs.length, 2, 'Only error and warn should pass threshold');
    assert.ok(logs[0].includes('error msg'));
    assert.ok(logs[1].includes('warn msg'));
  } finally {
    console.log = origLog;
  }
});

test('ConsoleHandler: silent level suppresses all messages', () => {
  const handler = new ConsoleHandler('silent');
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(' '));

  try {
    handler.handle({ timestamp: '2025-01-01', level: 'error', tag: 'test', message: 'error msg' });
    assert.equal(logs.length, 0);
  } finally {
    console.log = origLog;
  }
});

test('ConsoleHandler: truncates debug data at 200 chars', () => {
  const handler = new ConsoleHandler('debug');
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(' '));

  try {
    const longData = 'x'.repeat(300);
    handler.handle({ timestamp: '2025-01-01', level: 'debug', tag: 'test', message: 'data', data: longData });

    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes('...'), 'Should truncate with ellipsis');
    assert.ok(!logs[0].includes('x'.repeat(300)), 'Should not contain full data');
  } finally {
    console.log = origLog;
  }
});

test('ConsoleHandler: trace data is base64-encoded', () => {
  const handler = new ConsoleHandler('trace');
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(' '));

  try {
    const longData = 'y'.repeat(300);
    handler.handle({ timestamp: '2025-01-01', level: 'trace', tag: 'test', message: 'data', data: longData });

    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes('[base64]'), 'Should contain base64 marker');
    // Verify the base64 decodes back to original data
    const b64Match = logs[0].match(/\[base64\] (.+)$/);
    assert.ok(b64Match, 'Should have base64 content');
    const decoded = Buffer.from(b64Match![1], 'base64').toString('utf-8');
    assert.equal(decoded, longData, 'Decoded base64 should match original');
  } finally {
    console.log = origLog;
  }
});

test('ConsoleHandler: setLevel changes threshold', () => {
  const handler = new ConsoleHandler('error');
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(' '));

  try {
    handler.handle({ timestamp: '2025-01-01', level: 'info', tag: 'test', message: 'before' });
    assert.equal(logs.length, 0);

    handler.setLevel('info');
    handler.handle({ timestamp: '2025-01-01', level: 'info', tag: 'test', message: 'after' });
    assert.equal(logs.length, 1);
  } finally {
    console.log = origLog;
  }
});

// --- FileHandler ---

test('FileHandler: writes all levels at trace threshold', async () => {
  const logPath = tmpLogFile();
  const handler = new FileHandler(logPath, 'trace');
  try {
    handler.handle({ timestamp: '2025-01-01', level: 'error', tag: 'test', message: 'err' });
    handler.handle({ timestamp: '2025-01-01', level: 'warn', tag: 'test', message: 'wrn' });
    handler.handle({ timestamp: '2025-01-01', level: 'info', tag: 'test', message: 'inf' });
    handler.handle({ timestamp: '2025-01-01', level: 'debug', tag: 'test', message: 'dbg' });
    handler.handle({ timestamp: '2025-01-01', level: 'trace', tag: 'test', message: 'trc' });

    await handler.close();

    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 5);
    assert.ok(lines[0].includes('[error]'));
    assert.ok(lines[1].includes('[warn]'));
    assert.ok(lines[2].includes('[info]'));
    assert.ok(lines[3].includes('[debug]'));
    assert.ok(lines[4].includes('[trace]'));
  } finally {
    await handler.close();
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});

test('FileHandler: respects level threshold', async () => {
  const logPath = tmpLogFile();
  const handler = new FileHandler(logPath, 'warn');
  try {
    handler.handle({ timestamp: '2025-01-01', level: 'error', tag: 'test', message: 'err' });
    handler.handle({ timestamp: '2025-01-01', level: 'warn', tag: 'test', message: 'wrn' });
    handler.handle({ timestamp: '2025-01-01', level: 'info', tag: 'test', message: 'inf' });

    await handler.close();

    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2);
  } finally {
    await handler.close();
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});

test('FileHandler: does not truncate data', async () => {
  const logPath = tmpLogFile();
  const handler = new FileHandler(logPath, 'trace');
  try {
    const longData = 'z'.repeat(500);

    handler.handle({ timestamp: '2025-01-01', level: 'debug', tag: 'test', message: 'data', data: longData });

    await handler.close();

    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.includes('z'.repeat(500)), 'File handler should not truncate');
  } finally {
    await handler.close();
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});

test('FileHandler: graceful degradation on invalid path', async () => {
  // Should warn but not throw
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warns.push(args.join(' '));

  // Use a path where mkdirSync will fail (read-only filesystem paths)
  const badPath = process.platform === 'win32'
    ? 'Z:\\nonexistent-drive-xyzzy\\impossible\\test.log'
    : '/dev/null/impossible/test.log';
  const handler = new FileHandler(badPath, 'trace');

  try {
    // Should not throw, but warn
    assert.ok(warns.length > 0, 'Should have logged a warning');
    assert.ok(warns[0].includes('Failed to open log file'));

    // Subsequent handle calls should be no-ops
    handler.handle({ timestamp: '2025-01-01', level: 'error', tag: 'test', message: 'test' });
  } finally {
    console.warn = origWarn;
    await handler.close();
  }
});

test('FileHandler: creates parent directories', async () => {
  const nestedDir = resolve(tmpdir(), `aghast-test-nested-${randomUUID()}`);
  const logPath = join(nestedDir, 'sub', 'test.log');
  const handler = new FileHandler(logPath, 'trace');
  try {
    handler.handle({ timestamp: '2025-01-01', level: 'info', tag: 'test', message: 'hello' });
    await handler.close();

    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.includes('hello'));
  } finally {
    await handler.close();
    try { await rm(nestedDir, { recursive: true }); } catch { /* ignore */ }
  }
});

// --- Handler Registry ---

test('addHandler and removeHandler manage the handler list', () => {
  const custom: LogHandler = {
    name: 'custom',
    level: 'info',
    handle: () => {},
  };

  addHandler(custom);
  assert.ok(_getHandlerNames().includes('custom'));

  removeHandler('custom');
  assert.ok(!_getHandlerNames().includes('custom'));
});

test('closeAllHandlers resets to default console handler', async () => {
  const custom: LogHandler = {
    name: 'custom',
    level: 'info',
    handle: () => {},
  };

  addHandler(custom);
  assert.ok(_getHandlerNames().includes('custom'));

  await closeAllHandlers();
  const names = _getHandlerNames();
  assert.equal(names.length, 1);
  assert.equal(names[0], 'console');
});

// --- createHandlerByType ---

test('createHandlerByType: creates file handler', async () => {
  const logPath = tmpLogFile();
  try {
    const handler = createHandlerByType('file', logPath, 'trace');
    assert.ok(handler instanceof FileHandler);
    await handler.close?.();
  } finally {
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});

test('createHandlerByType: throws on unknown type', () => {
  assert.throws(
    () => createHandlerByType('unknown-type', '/tmp/test.log'),
    (err: unknown) => {
      const error = err as Error;
      return error.message.includes('Unknown log type "unknown-type"') && error.message.includes('Available types:');
    },
  );
});

test('getAvailableLogTypes: returns at least file', () => {
  const types = getAvailableLogTypes();
  assert.ok(types.includes('file'));
});

// --- initFileHandler ---

test('initFileHandler: adds a file handler to the registry', async () => {
  const logPath = tmpLogFile();
  try {
    initFileHandler(logPath);
    assert.ok(_getHandlerNames().includes('file'));
  } finally {
    await closeAllHandlers();
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});

// --- closeAllHandlers error handling ---

test('closeAllHandlers: handler close failure is logged, not thrown', async () => {
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warns.push(args.join(' '));

  try {
    const failHandler: LogHandler = {
      name: 'fail-close',
      level: 'info',
      handle: () => {},
      close: () => Promise.reject(new Error('close boom')),
    };
    addHandler(failHandler);
    // Should not throw
    await closeAllHandlers();
    assert.ok(warns.some((w) => w.includes('close boom')), 'Should warn about close failure');
  } finally {
    console.warn = origWarn;
  }
});

// --- setLogLevel / getLogLevel backward compatibility ---

test('setLogLevel: accepts legacy level names', () => {
  setLogLevel('silent');
  assert.equal(getLogLevel(), 'silent');

  setLogLevel('info');
  assert.equal(getLogLevel(), 'info');

  setLogLevel('debug');
  assert.equal(getLogLevel(), 'debug');
});

test('setLogLevel: throws on invalid level', () => {
  assert.throws(
    () => setLogLevel('debg' as never),
    (err: unknown) => {
      const error = err as Error;
      return error.message.includes('Invalid log level');
    },
  );
});

test('setLogLevel: accepts standard level names', () => {
  setLogLevel('error');
  assert.equal(getLogLevel(), 'error');

  setLogLevel('warn');
  assert.equal(getLogLevel(), 'warn');

  setLogLevel('trace');
  assert.equal(getLogLevel(), 'trace');
});

// --- Convenience wrappers dispatch to handlers ---

test('logProgress dispatches to all handlers', async () => {
  const logPath = tmpLogFile();
  try {
    await _resetHandlers('silent'); // Suppress console
    initFileHandler(logPath);

    logProgress('test', 'hello world');

    await closeAllHandlers();
    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.includes('[info]'));
    assert.ok(content.includes('hello world'));
  } finally {
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});

test('logDebug dispatches to file handler even when console is at info level', async () => {
  const logPath = tmpLogFile();
  try {
    await _resetHandlers('info'); // Console won't show debug
    initFileHandler(logPath);

    logDebug('test', 'debug data', 'some-value');

    await closeAllHandlers();
    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.includes('[debug]'));
    assert.ok(content.includes('some-value'));
  } finally {
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});

test('logDebugFull dispatches as trace level', async () => {
  const logPath = tmpLogFile();
  try {
    await _resetHandlers('info'); // Console won't show trace
    initFileHandler(logPath);

    logDebugFull('test', 'full data', 'complete-string');

    await closeAllHandlers();
    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.includes('[trace]'));
    assert.ok(content.includes('complete-string'), 'Trace data should appear as plain text in file');
    assert.ok(content.includes('--- end ---'), 'Should have end marker after data');
  } finally {
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});

test('logWarn dispatches at warn level', async () => {
  const logPath = tmpLogFile();
  try {
    _resetHandlers('silent');
    initFileHandler(logPath);

    logWarn('test', 'warning message');

    await closeAllHandlers();
    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.includes('[warn]'));
    assert.ok(content.includes('warning message'));
  } finally {
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});

test('logError dispatches at error level', async () => {
  const logPath = tmpLogFile();
  try {
    _resetHandlers('silent');
    initFileHandler(logPath);

    logError('test', 'error message');

    await closeAllHandlers();
    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.includes('[error]'));
    assert.ok(content.includes('error message'));
  } finally {
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});

test('file handler captures untruncated data even when console truncates', async () => {
  const logPath = tmpLogFile();
  const consoleLogs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => consoleLogs.push(args.join(' '));

  try {
    await _resetHandlers('debug'); // Console at debug level (truncates)
    initFileHandler(logPath);

    const longData = 'A'.repeat(500);
    logDebug('test', 'long data', longData);

    await closeAllHandlers();

    // Console should have truncated
    assert.ok(consoleLogs.length > 0);
    assert.ok(consoleLogs[0].includes('...'));
    assert.ok(!consoleLogs[0].includes('A'.repeat(500)));

    // File should have full data
    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.includes('A'.repeat(500)));
  } finally {
    console.log = origLog;
    try { await unlink(logPath); } catch { /* ignore */ }
  }
});
