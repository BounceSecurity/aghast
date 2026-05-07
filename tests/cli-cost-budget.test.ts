/**
 * CLI integration tests for cost dashboards and budget controls (issue #120).
 *
 * - `aghast stats` subcommand
 * - `--budget-limit-cost` and `--budget-limit-tokens` on `scan`
 *
 * Each test isolates the history file via AGHAST_HISTORY_FILE so the user's
 * real `~/.aghast/history.json` is never touched.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import {
  fixtureRepo,
  singleCheckConfigDir,
  multiCheckConfigDir,
  createScopedHelpers,
} from './cli-test-helpers.js';
import type { ScanRecord } from '../src/scan-history.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(__dirname, '..', 'src', 'cli.ts');

const { runCLI, cleanupOutput } = createScopedHelpers('cost-budget');

let tmpDir: string;
let historyFile: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'aghast-cli-history-'));
  historyFile = join(tmpDir, 'history.json');
});

afterEach(async () => {
  await cleanupOutput();
  await rm(tmpDir, { recursive: true, force: true });
});

interface RawResult { stdout: string; stderr: string; exitCode: number }

function execAghast(args: string[], env: Record<string, string | undefined>): Promise<RawResult> {
  return new Promise((resolveP) => {
    const child = execFile(
      process.execPath,
      ['--import', 'tsx', cliEntry, ...args],
      {
        env: { ...process.env, NO_COLOR: '1', ...env } as NodeJS.ProcessEnv,
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        resolveP({ stdout, stderr, exitCode: error ? (child.exitCode ?? 1) : 0 });
      },
    );
  });
}

describe('CLI: scan saves history record', () => {
  it('writes a record to AGHAST_HISTORY_FILE on success', async () => {
    const result = await runCLI({
      AGHAST_MOCK_AI: 'true',
      AGHAST_MOCK_TOKENS: '100,50',
      AGHAST_HISTORY_FILE: historyFile,
    });
    assert.equal(result.exitCode, 0);

    const raw = await readFile(historyFile, 'utf-8');
    const file = JSON.parse(raw) as { records: ScanRecord[] };
    assert.equal(file.records.length, 1, 'one record written');
    const rec = file.records[0];
    assert.match(rec.scanId, /^scan-/);
    assert.equal(rec.tokenUsage?.totalTokens, 150);
    assert.ok(rec.startedAt);
    assert.ok(rec.endedAt);
    assert.equal(rec.currency, 'USD');
  });

  it('cost is non-zero when --model matches a known pricing entry', async () => {
    const result = await runCLI({
      AGHAST_MOCK_AI: 'true',
      AGHAST_MOCK_TOKENS: '1000000,0',
      AGHAST_HISTORY_FILE: historyFile,
    }, [
      fixtureRepo, '--config-dir', singleCheckConfigDir,
      '--model', 'claude-haiku-4-5',
    ]);
    assert.equal(result.exitCode, 0);

    const raw = await readFile(historyFile, 'utf-8');
    const file = JSON.parse(raw) as { records: ScanRecord[] };
    assert.equal(file.records.length, 1);
    // 1M input tokens at haiku rate ($1/M) → $1.00
    assert.ok(file.records[0].totalCost > 0, `expected non-zero cost, got ${file.records[0].totalCost}`);
    assert.equal(file.records[0].totalCost, 1.0);
  });

  it('summary banner prints estimated cost when > 0', async () => {
    const result = await runCLI({
      AGHAST_MOCK_AI: 'true',
      AGHAST_MOCK_TOKENS: '1000000,0',
      AGHAST_HISTORY_FILE: historyFile,
    }, [
      fixtureRepo, '--config-dir', singleCheckConfigDir,
      '--model', 'claude-haiku-4-5',
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Cost:\s+\$\d/);
  });
});

describe('CLI: --budget-limit-cost', () => {
  it('aborts the scan when the cost limit is exceeded across multiple checks', async () => {
    // Each AI call records 1M input tokens at $1/M = $1.00. After the first
    // check, accumulated cost is $1.00 — preflight before the second check
    // aborts (limit $0.5). The remaining check is recorded as ERROR.
    const result = await runCLI({
      AGHAST_MOCK_AI: 'true',
      AGHAST_MOCK_TOKENS: '1000000,0',
      AGHAST_HISTORY_FILE: historyFile,
    }, [
      fixtureRepo, '--config-dir', multiCheckConfigDir,
      '--model', 'claude-haiku-4-5',
      '--budget-limit-cost', '0.5',
      '--fail-on-check-failure',
    ]);
    assert.equal(result.exitCode, 1, `expected exit 1, got ${result.exitCode}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    // Output should mention budget exceeded
    const combined = result.stdout + result.stderr;
    assert.match(combined, /[Bb]udget/, 'output should mention budget');
  });

  it('rejects negative or non-numeric budget values', async () => {
    const result = await runCLI({
      AGHAST_MOCK_AI: 'true',
      AGHAST_HISTORY_FILE: historyFile,
    }, [
      fixtureRepo, '--config-dir', singleCheckConfigDir,
      '--budget-limit-cost', '-5',
    ]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /budget-limit-cost/);
  });

  it('exits non-zero on budget abort even WITHOUT --fail-on-check-failure', async () => {
    // Regression guard for F1: a budget abort is a deliberate failure mode
    // the user opted into via --budget-limit-cost. The CLI must signal it via
    // exit code regardless of --fail-on-check-failure, otherwise CI pipelines
    // that use the budget as a guardrail will silently let aborted scans pass.
    const result = await runCLI({
      AGHAST_MOCK_AI: 'true',
      AGHAST_MOCK_TOKENS: '1000000,0',
      AGHAST_HISTORY_FILE: historyFile,
    }, [
      fixtureRepo, '--config-dir', multiCheckConfigDir,
      '--model', 'claude-haiku-4-5',
      '--budget-limit-cost', '0.5',
      // Note: NO --fail-on-check-failure flag.
    ]);
    assert.equal(
      result.exitCode,
      1,
      `expected exit 1 from budget abort alone, got ${result.exitCode}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    // E7001 must reach stderr so the trackable error code is visible.
    assert.match(result.stderr, /E7001/, 'stderr should include E7001 budget error code');
  });
});

describe('CLI: AGHAST_LOCAL_CLAUDE=true (subscription mode)', () => {
  it('banner shows "equivalent" and subscription label', async () => {
    const result = await runCLI({
      AGHAST_MOCK_AI: 'true',
      AGHAST_MOCK_TOKENS: '1000000,0',
      AGHAST_LOCAL_CLAUDE: 'true',
      AGHAST_HISTORY_FILE: historyFile,
    }, [
      fixtureRepo, '--config-dir', singleCheckConfigDir,
      '--model', 'claude-haiku-4-5',
    ]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /\$[\d.]+ equivalent/);
    assert.match(result.stdout, /covered by subscription/);
  });

  it('logs budget warning when --budget-limit-cost and AGHAST_LOCAL_CLAUDE=true coincide', async () => {
    const result = await runCLI({
      AGHAST_MOCK_AI: 'true',
      AGHAST_MOCK_TOKENS: '100,50',
      AGHAST_LOCAL_CLAUDE: 'true',
      AGHAST_HISTORY_FILE: historyFile,
    }, [
      fixtureRepo, '--config-dir', singleCheckConfigDir,
      '--budget-limit-cost', '1000',
    ]);
    assert.equal(result.exitCode, 0);
    const combined = result.stdout + result.stderr;
    assert.match(combined, /equivalent API cost/i);
  });
});

describe('CLI: --budget-limit-tokens', () => {
  it('rejects non-integer token values', async () => {
    const result = await runCLI({
      AGHAST_MOCK_AI: 'true',
      AGHAST_HISTORY_FILE: historyFile,
    }, [
      fixtureRepo, '--config-dir', singleCheckConfigDir,
      '--budget-limit-tokens', '1.5',
    ]);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /budget-limit-tokens/);
  });
});

describe('CLI: aghast stats', () => {
  async function seedHistory(records: Partial<ScanRecord>[]): Promise<void> {
    const full: ScanRecord[] = records.map((r, i) => ({
      scanId: `scan-${i}`,
      startedAt: new Date(2026, 0, 1 + i, 0, 0, 0).toISOString(),
      endedAt: new Date(2026, 0, 1 + i, 0, 0, 1).toISOString(),
      durationMs: 1000,
      repository: '/repo',
      models: ['claude-haiku-4-5'],
      totalCost: 0.0123,
      currency: 'USD',
      checks: 1,
      issues: 0,
      tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      ...r,
    }));
    await mkdir(dirname(historyFile), { recursive: true });
    await writeFile(historyFile, JSON.stringify({ version: 1, records: full }, null, 2), 'utf-8');
  }

  it('prints "No scan history found" when history is empty', async () => {
    const result = await execAghast(['stats'], { AGHAST_HISTORY_FILE: historyFile });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /No scan history found/);
  });

  it('reads the history file and prints a summary table', async () => {
    await seedHistory([
      { scanId: 'a', repository: '/repos/alpha', models: ['claude-haiku-4-5'], totalCost: 0.5 },
      { scanId: 'b', repository: '/repos/beta', models: ['claude-sonnet-4-6'], totalCost: 1.5 },
    ]);
    const result = await execAghast(['stats'], { AGHAST_HISTORY_FILE: historyFile });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /AGHAST Scan Statistics/);
    assert.match(result.stdout, /Scans:\s+2/);
    assert.match(result.stdout, /By repository/);
    assert.match(result.stdout, /By model/);
    assert.match(result.stdout, /alpha/);
    assert.match(result.stdout, /beta/);
  });

  it('filters by --repo substring', async () => {
    await seedHistory([
      { scanId: 'a', repository: '/repos/alpha' },
      { scanId: 'b', repository: '/repos/beta' },
    ]);
    const result = await execAghast(['stats', '--repo', 'alpha'], { AGHAST_HISTORY_FILE: historyFile });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Scans:\s+1/);
    assert.match(result.stdout, /alpha/);
    // No "beta" line in the table since it was filtered out
    const noBeta = !/beta/.test(result.stdout);
    assert.ok(noBeta, 'beta should be filtered out');
  });

  it('emits raw JSON with --json', async () => {
    await seedHistory([{ scanId: 'a' }]);
    const result = await execAghast(['stats', '--json'], { AGHAST_HISTORY_FILE: historyFile });
    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout) as { records: ScanRecord[] };
    assert.ok(Array.isArray(parsed.records));
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.records[0].scanId, 'a');
  });

  it('--help shows usage', async () => {
    const result = await execAghast(['stats', '--help'], { AGHAST_HISTORY_FILE: historyFile });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage: aghast stats/);
  });

  it('--history-file flag overrides the env var', async () => {
    const altFile = join(tmpDir, 'alt-history.json');
    await mkdir(dirname(altFile), { recursive: true });
    await writeFile(altFile, JSON.stringify({
      version: 1,
      records: [{
        scanId: 'unique-marker',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:00:01.000Z',
        durationMs: 1000,
        repository: '/r',
        models: ['m'],
        totalCost: 0.1,
        currency: 'USD',
        checks: 1,
        issues: 0,
      }],
    }), 'utf-8');
    const result = await execAghast(
      ['stats', '--history-file', altFile, '--json'],
      { AGHAST_HISTORY_FILE: historyFile }, // points to empty file
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /unique-marker/);
  });
});
