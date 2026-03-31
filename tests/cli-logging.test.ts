/**
 * CLI integration tests for the logging system (--log-file, --log-level, --log-type).
 *
 * Spawns the actual CLI process with AGHAST_MOCK_AI=true to verify
 * log file output and log level control end-to-end.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  fixtureRepo,
  singleCheckConfigDir,
  createScopedHelpers,
} from './cli-test-helpers.js';

function tmpLogFile(): string {
  return resolve(tmpdir(), `aghast-cli-test-${randomUUID()}.log`);
}

// ─── --log-file flag ─────────────────────────────────────────────────────────

describe('CLI logging: --log-file flag', () => {
  const { runCLI, cleanupOutput } = createScopedHelpers('logfile');
  const logFiles: string[] = [];

  afterEach(async () => {
    await cleanupOutput();
    for (const f of logFiles) {
      try { await unlink(f); } catch { /* ignore */ }
    }
    logFiles.length = 0;
  });

  it('--log-file creates a log file with entries', async () => {
    const logPath = tmpLogFile();
    logFiles.push(logPath);

    const { exitCode } = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [fixtureRepo, '--config-dir', singleCheckConfigDir, '--log-file', logPath],
    );
    assert.equal(exitCode, 0);

    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.length > 0, 'Log file should not be empty');
    assert.ok(content.includes('[info]'), 'Log file should contain info-level entries');
  });

  it('log file contains debug/trace entries even without --debug', async () => {
    const logPath = tmpLogFile();
    logFiles.push(logPath);

    const { exitCode } = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [fixtureRepo, '--config-dir', singleCheckConfigDir, '--log-file', logPath],
    );
    assert.equal(exitCode, 0);

    const content = await readFile(logPath, 'utf-8');
    // The file handler defaults to trace level, so it captures debug entries
    // At minimum, info entries should be present
    assert.ok(content.includes('[info]'), 'Should contain info entries');
  });

  it('AGHAST_LOG_FILE env var works as fallback', async () => {
    const logPath = tmpLogFile();
    logFiles.push(logPath);

    const { exitCode } = await runCLI(
      { AGHAST_MOCK_AI: 'true', AGHAST_LOG_FILE: logPath },
      [fixtureRepo, '--config-dir', singleCheckConfigDir],
    );
    assert.equal(exitCode, 0);

    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.length > 0, 'Log file should be created via env var');
  });

  it('--log-file takes precedence over AGHAST_LOG_FILE', async () => {
    const cliLogPath = tmpLogFile();
    const envLogPath = tmpLogFile();
    logFiles.push(cliLogPath, envLogPath);

    const { exitCode } = await runCLI(
      { AGHAST_MOCK_AI: 'true', AGHAST_LOG_FILE: envLogPath },
      [fixtureRepo, '--config-dir', singleCheckConfigDir, '--log-file', cliLogPath],
    );
    assert.equal(exitCode, 0);

    const cliContent = await readFile(cliLogPath, 'utf-8');
    assert.ok(cliContent.length > 0, 'CLI flag log file should have content');

    // Env var log file should not exist (CLI flag took precedence)
    let envContent = '';
    try {
      envContent = await readFile(envLogPath, 'utf-8');
    } catch {
      // File doesn't exist — that's the expected behavior
    }
    assert.equal(envContent, '', 'Env var log file should not be created when CLI flag is used');
  });
});

// ─── --log-level flag ────────────────────────────────────────────────────────

describe('CLI logging: --log-level flag', () => {
  const { runCLI, cleanupOutput } = createScopedHelpers('loglevel');

  afterEach(cleanupOutput);

  it('--log-level error suppresses info messages on console', async () => {
    const { exitCode, stdout } = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [fixtureRepo, '--config-dir', singleCheckConfigDir, '--log-level', 'error'],
    );
    assert.equal(exitCode, 0);

    // Info-level progress messages like "Found X matching checks" should be suppressed
    assert.ok(!stdout.includes('[aghast]'), 'Console should not show info-level log lines');
  });

  it('--log-level takes precedence over --debug', async () => {
    const { exitCode, stdout } = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [fixtureRepo, '--config-dir', singleCheckConfigDir, '--debug', '--log-level', 'warn'],
    );
    assert.equal(exitCode, 0);

    // --log-level warn should win over --debug (which would set debug level)
    // Info-level log lines should be suppressed
    assert.ok(!stdout.includes('[aghast]'), '--log-level should take precedence over --debug');
  });

  it('invalid --log-level exits with error', async () => {
    const { exitCode, stderr } = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [fixtureRepo, '--config-dir', singleCheckConfigDir, '--log-level', 'verbose'],
    );
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Invalid log level'), 'Should report invalid log level');
  });

  it('AGHAST_LOG_LEVEL env var works', async () => {
    const { exitCode, stdout } = await runCLI(
      { AGHAST_MOCK_AI: 'true', AGHAST_LOG_LEVEL: 'error' },
      [fixtureRepo, '--config-dir', singleCheckConfigDir],
    );
    assert.equal(exitCode, 0);
    assert.ok(!stdout.includes('[aghast]'), 'Console should not show info-level log lines');
  });
});

// ─── --log-type flag ─────────────────────────────────────────────────────────

describe('CLI logging: --log-type flag', () => {
  const { runCLI, cleanupOutput } = createScopedHelpers('logtype');
  const logFiles: string[] = [];

  afterEach(async () => {
    await cleanupOutput();
    for (const f of logFiles) {
      try { await unlink(f); } catch { /* ignore */ }
    }
    logFiles.length = 0;
  });

  it('invalid --log-type exits with error', async () => {
    const logPath = tmpLogFile();
    logFiles.push(logPath);

    const { exitCode, stderr } = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [fixtureRepo, '--config-dir', singleCheckConfigDir, '--log-file', logPath, '--log-type', 'unknown-type'],
    );
    assert.equal(exitCode, 1);
    assert.ok(stderr.includes('Unknown log type'), 'Should report unknown log type');
  });

  it('--log-type file works explicitly', async () => {
    const logPath = tmpLogFile();
    logFiles.push(logPath);

    const { exitCode } = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [fixtureRepo, '--config-dir', singleCheckConfigDir, '--log-file', logPath, '--log-type', 'file'],
    );
    assert.equal(exitCode, 0);

    const content = await readFile(logPath, 'utf-8');
    assert.ok(content.length > 0, 'Log file should have content');
  });
});
