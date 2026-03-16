import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JsonFormatter } from '../src/formatters/json-formatter.js';
import type { ScanResults } from '../src/types.js';

const stubResults: ScanResults = {
  scanId: 'scan-20260101120000-abc123',
  timestamp: '2026-01-01T12:00:00.000Z',
  version: '0.1.0',
  repository: { path: '/tmp/repo', isGitRepository: true },
  issues: [],
  checks: [],
  summary: { totalChecks: 0, passedChecks: 0, failedChecks: 0, flaggedChecks: 0, errorChecks: 0, totalIssues: 0 },
  executionTime: 100,
  startTime: '2026-01-01T12:00:00.000Z',
  endTime: '2026-01-01T12:00:00.100Z',
  aiProvider: { name: 'mock', models: ['mock'] },
};

describe('JsonFormatter', () => {
  const formatter = new JsonFormatter();

  it('id is "json"', () => {
    assert.equal(formatter.id, 'json');
  });

  it('fileExtension is ".json"', () => {
    assert.equal(formatter.fileExtension, '.json');
  });

  it('output matches JSON.stringify(input, null, 2)', () => {
    const output = formatter.format(stubResults);
    assert.equal(output, JSON.stringify(stubResults, null, 2));
  });
});
