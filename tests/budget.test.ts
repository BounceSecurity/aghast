/**
 * Tests for src/budget.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkBudget, BudgetExceededError, type BudgetLimits } from '../src/budget.js';
import type { ScanRecord } from '../src/scan-history.js';

function makeRecord(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    scanId: 'r',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    repository: '/repo',
    models: ['m'],
    totalCost: 0,
    currency: 'USD',
    checks: 1,
    issues: 0,
    ...overrides,
  };
}

describe('checkBudget — no limits', () => {
  it('continues when limits is undefined', () => {
    const status = checkBudget({ currentScanCostUsd: 1000, currentScanTokens: 1e9 }, undefined);
    assert.equal(status.action, 'continue');
    assert.equal(status.ok, true);
  });

  it('continues when limits object is empty', () => {
    const status = checkBudget(
      { currentScanCostUsd: 1000, currentScanTokens: 1e9 },
      {},
    );
    assert.equal(status.action, 'continue');
  });
});

describe('checkBudget — per-scan token limits', () => {
  const limits: BudgetLimits = { perScan: { maxTokens: 1000 } };

  it('continues below 80%', () => {
    const status = checkBudget({ currentScanCostUsd: 0, currentScanTokens: 700 }, limits);
    assert.equal(status.action, 'continue');
  });

  it('warns at 80%', () => {
    const status = checkBudget({ currentScanCostUsd: 0, currentScanTokens: 800 }, limits);
    assert.equal(status.action, 'warn');
    assert.equal(status.ok, true);
  });

  it('aborts at 100%', () => {
    const status = checkBudget({ currentScanCostUsd: 0, currentScanTokens: 1000 }, limits);
    assert.equal(status.action, 'abort');
    assert.equal(status.ok, false);
    assert.match(status.reason ?? '', /token limit/);
  });

  it('aborts above 100%', () => {
    const status = checkBudget({ currentScanCostUsd: 0, currentScanTokens: 5000 }, limits);
    assert.equal(status.action, 'abort');
  });
});

describe('checkBudget — per-scan cost limits', () => {
  const limits: BudgetLimits = { perScan: { maxCostUsd: 1.0 } };

  it('warns at 80% of cost', () => {
    const status = checkBudget({ currentScanCostUsd: 0.85, currentScanTokens: 0 }, limits);
    assert.equal(status.action, 'warn');
  });

  it('aborts at 100% of cost', () => {
    const status = checkBudget({ currentScanCostUsd: 1.0, currentScanTokens: 0 }, limits);
    assert.equal(status.action, 'abort');
    assert.match(status.reason ?? '', /cost limit/);
  });
});

describe('checkBudget — configurable thresholds', () => {
  it('respects custom warnAt and abortAt', () => {
    const limits: BudgetLimits = {
      perScan: { maxCostUsd: 10 },
      thresholds: { warnAt: 0.5, abortAt: 0.9 },
    };
    assert.equal(
      checkBudget({ currentScanCostUsd: 4, currentScanTokens: 0 }, limits).action,
      'continue',
    );
    assert.equal(
      checkBudget({ currentScanCostUsd: 5, currentScanTokens: 0 }, limits).action,
      'warn',
    );
    assert.equal(
      checkBudget({ currentScanCostUsd: 9, currentScanTokens: 0 }, limits).action,
      'abort',
    );
  });
});

describe('checkBudget — abort takes precedence over warn', () => {
  it('returns abort even if another rule only warns', () => {
    const limits: BudgetLimits = {
      perScan: { maxTokens: 1000, maxCostUsd: 1.0 },
    };
    const status = checkBudget(
      { currentScanCostUsd: 0.85, currentScanTokens: 1500 }, // cost warns, tokens abort
      limits,
    );
    assert.equal(status.action, 'abort');
  });
});

describe('checkBudget — per-period limits', () => {
  it('aborts when daily cost (history + current) exceeds limit', () => {
    const now = new Date('2026-05-04T12:00:00.000Z');
    const history: ScanRecord[] = [
      makeRecord({ scanId: 'today-1', startedAt: '2026-05-04T01:00:00.000Z', totalCost: 0.4 }),
      makeRecord({ scanId: 'today-2', startedAt: '2026-05-04T05:00:00.000Z', totalCost: 0.4 }),
    ];
    const limits: BudgetLimits = {
      perPeriod: { window: 'day', maxCostUsd: 1.0 },
    };
    const status = checkBudget(
      { currentScanCostUsd: 0.3, currentScanTokens: 0, history, now },
      limits,
    );
    // 0.4 + 0.4 + 0.3 = 1.1 → over
    assert.equal(status.action, 'abort');
  });

  it('ignores history records outside the daily window', () => {
    const now = new Date('2026-05-04T12:00:00.000Z');
    const history: ScanRecord[] = [
      makeRecord({ scanId: 'yesterday', startedAt: '2026-05-03T23:00:00.000Z', totalCost: 5 }),
    ];
    const limits: BudgetLimits = {
      perPeriod: { window: 'day', maxCostUsd: 1.0 },
    };
    const status = checkBudget(
      { currentScanCostUsd: 0.1, currentScanTokens: 0, history, now },
      limits,
    );
    assert.equal(status.action, 'continue');
  });

  it('aggregates over a week window', () => {
    // Monday 2026-05-04 → window starts Monday 2026-05-04 UTC
    const now = new Date('2026-05-08T12:00:00.000Z'); // Friday
    const history: ScanRecord[] = [
      makeRecord({ scanId: 'mon', startedAt: '2026-05-04T01:00:00.000Z', totalCost: 1 }),
      makeRecord({ scanId: 'tue', startedAt: '2026-05-05T01:00:00.000Z', totalCost: 1 }),
      makeRecord({ scanId: 'last-week', startedAt: '2026-04-28T01:00:00.000Z', totalCost: 100 }),
    ];
    const limits: BudgetLimits = {
      perPeriod: { window: 'week', maxCostUsd: 5 },
    };
    const status = checkBudget(
      { currentScanCostUsd: 0.5, currentScanTokens: 0, history, now },
      limits,
    );
    // 1 + 1 + 0.5 = 2.5 (last-week excluded) → continue
    assert.equal(status.action, 'continue');
  });

  it('ignores history records with timestamps in the future (clock skew safety)', () => {
    // F6: a record dated in the future (clock-skewed CI machine) must not
    // contribute to the current period's total — otherwise it would inflate
    // every subsequent period until "now" surpasses the future timestamp.
    const now = new Date('2026-05-04T12:00:00.000Z');
    const history: ScanRecord[] = [
      makeRecord({ scanId: 'normal', startedAt: '2026-05-04T01:00:00.000Z', totalCost: 0.4 }),
      makeRecord({ scanId: 'future', startedAt: '2030-01-01T00:00:00.000Z', totalCost: 100 }),
    ];
    const limits: BudgetLimits = {
      perPeriod: { window: 'day', maxCostUsd: 1.0 },
    };
    const status = checkBudget(
      { currentScanCostUsd: 0.1, currentScanTokens: 0, history, now },
      limits,
    );
    // 0.4 + 0.1 = 0.5 (future record excluded) → continue
    assert.equal(status.action, 'continue');
  });

  it('aggregates over a month window', () => {
    const now = new Date('2026-05-15T12:00:00.000Z');
    const history: ScanRecord[] = [
      makeRecord({ scanId: 'this-month', startedAt: '2026-05-01T00:00:00.000Z', totalCost: 8 }),
      makeRecord({ scanId: 'last-month', startedAt: '2026-04-30T00:00:00.000Z', totalCost: 100 }),
    ];
    const limits: BudgetLimits = {
      perPeriod: { window: 'month', maxCostUsd: 10 },
    };
    const status = checkBudget(
      { currentScanCostUsd: 1, currentScanTokens: 0, history, now },
      limits,
    );
    // 8 + 1 = 9 → warns at 90%
    assert.equal(status.action, 'warn');
  });
});

describe('BudgetExceededError', () => {
  it('preserves the message and is instanceof Error', () => {
    const err = new BudgetExceededError('over $1');
    assert.equal(err.name, 'BudgetExceededError');
    assert.equal(err.message, 'over $1');
    assert.ok(err instanceof Error);
  });
});
