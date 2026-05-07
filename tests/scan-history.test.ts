/**
 * Tests for src/scan-history.ts.
 *
 * All tests use a temp file path passed via the `historyFile` option, so
 * `~/.aghast` is never touched.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  saveScanRecord,
  queryScanHistory,
  resolveHistoryFilePath,
  type ScanRecord,
} from '../src/scan-history.js';

let tmpDir: string;
let historyFile: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'aghast-history-'));
  historyFile = join(tmpDir, 'history.json');
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeRecord(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    scanId: 'scan-test-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:10.000Z',
    durationMs: 10_000,
    repository: '/path/to/repo',
    repositoryUrl: 'https://github.com/org/repo',
    models: ['claude-haiku-4-5'],
    tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    totalCost: 0.0005,
    currency: 'USD',
    checks: 3,
    issues: 1,
    ...overrides,
  };
}

describe('resolveHistoryFilePath', () => {
  it('returns explicit path when provided', () => {
    const p = resolveHistoryFilePath('/explicit/path.json');
    assert.match(p, /explicit/);
    assert.match(p, /path\.json$/);
  });

  it('uses AGHAST_HISTORY_FILE env override when set', () => {
    const original = process.env.AGHAST_HISTORY_FILE;
    process.env.AGHAST_HISTORY_FILE = historyFile;
    try {
      const p = resolveHistoryFilePath();
      assert.equal(p, historyFile);
    } finally {
      if (original !== undefined) process.env.AGHAST_HISTORY_FILE = original;
      else delete process.env.AGHAST_HISTORY_FILE;
    }
  });
});

describe('saveScanRecord + queryScanHistory', () => {
  it('writes a record and reads it back (round-trip)', async () => {
    const record = makeRecord();
    await saveScanRecord(record, { historyFile });
    const records = await queryScanHistory({}, { historyFile });
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], record);
  });

  it('appends multiple records sorted newest-first', async () => {
    await saveScanRecord(makeRecord({ scanId: 'a', startedAt: '2026-01-01T00:00:00.000Z' }), { historyFile });
    await saveScanRecord(makeRecord({ scanId: 'b', startedAt: '2026-02-01T00:00:00.000Z' }), { historyFile });
    await saveScanRecord(makeRecord({ scanId: 'c', startedAt: '2026-01-15T00:00:00.000Z' }), { historyFile });
    const records = await queryScanHistory({}, { historyFile });
    assert.equal(records.length, 3);
    assert.equal(records[0].scanId, 'b');
    assert.equal(records[1].scanId, 'c');
    assert.equal(records[2].scanId, 'a');
  });

  it('replaces records with duplicate scanId rather than creating two entries', async () => {
    await saveScanRecord(makeRecord({ scanId: 'dup', issues: 1 }), { historyFile });
    await saveScanRecord(makeRecord({ scanId: 'dup', issues: 5 }), { historyFile });
    const records = await queryScanHistory({}, { historyFile });
    assert.equal(records.length, 1);
    assert.equal(records[0].issues, 5);
  });

  it('returns empty array when history file does not exist', async () => {
    const records = await queryScanHistory({}, { historyFile });
    assert.deepEqual(records, []);
  });

  it('rebuilds history when the file is corrupt', async () => {
    await writeFile(historyFile, 'this is not valid json', 'utf-8');
    // Should not throw, should return []
    const records = await queryScanHistory({}, { historyFile });
    assert.deepEqual(records, []);
    // saveScanRecord must overwrite the corrupt file with a valid one
    await saveScanRecord(makeRecord(), { historyFile });
    const after = await queryScanHistory({}, { historyFile });
    assert.equal(after.length, 1);
  });

  it('treats valid JSON without "records" array as empty', async () => {
    await writeFile(historyFile, JSON.stringify({ unrelated: true }), 'utf-8');
    const records = await queryScanHistory({}, { historyFile });
    assert.deepEqual(records, []);
  });

  it('persists JSON in a human-readable form', async () => {
    await saveScanRecord(makeRecord(), { historyFile });
    const raw = await readFile(historyFile, 'utf-8');
    // Pretty-printed (contains newlines)
    assert.ok(raw.includes('\n'));
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed.records));
  });
});

describe('queryScanHistory filters', () => {
  beforeEach(async () => {
    await saveScanRecord(makeRecord({
      scanId: 'a', startedAt: '2026-01-01T00:00:00.000Z',
      repository: '/repos/alpha', repositoryUrl: 'https://github.com/x/alpha',
      models: ['claude-haiku-4-5'],
    }), { historyFile });
    await saveScanRecord(makeRecord({
      scanId: 'b', startedAt: '2026-02-01T00:00:00.000Z',
      repository: '/repos/beta', repositoryUrl: 'https://github.com/x/beta',
      models: ['claude-sonnet-4-6'],
    }), { historyFile });
    await saveScanRecord(makeRecord({
      scanId: 'c', startedAt: '2026-03-01T00:00:00.000Z',
      repository: '/repos/alpha', repositoryUrl: 'https://github.com/x/alpha',
      models: ['claude-opus-4-7'],
    }), { historyFile });
  });

  it('filters by repository (substring)', async () => {
    const records = await queryScanHistory({ repository: 'alpha' }, { historyFile });
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((r) => r.scanId).sort(), ['a', 'c']);
  });

  it('filters by model substring', async () => {
    const records = await queryScanHistory({ model: 'sonnet' }, { historyFile });
    assert.equal(records.length, 1);
    assert.equal(records[0].scanId, 'b');
  });

  it('filters by since timestamp', async () => {
    const records = await queryScanHistory({ since: '2026-02-01T00:00:00.000Z' }, { historyFile });
    assert.deepEqual(records.map((r) => r.scanId), ['c', 'b']);
  });

  it('filters by until timestamp', async () => {
    const records = await queryScanHistory({ until: '2026-02-01T00:00:00.000Z' }, { historyFile });
    assert.deepEqual(records.map((r) => r.scanId), ['b', 'a']);
  });

  it('combines multiple filters with AND semantics', async () => {
    const records = await queryScanHistory(
      { repository: 'alpha', since: '2026-02-01T00:00:00.000Z' },
      { historyFile },
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].scanId, 'c');
  });
});
