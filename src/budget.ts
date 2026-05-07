/**
 * Budget controls: per-scan and per-period token/cost limits.
 *
 * `checkBudget` is called before each AI invocation in the scan runner with
 * the current accumulated cost. It returns one of:
 *   - `continue` — under the warn threshold, proceed silently.
 *   - `warn` — at or above the warn threshold but below the abort threshold.
 *   - `abort` — at or above the abort threshold; the scan should stop.
 *
 * Period limits are computed against historical scan records (from
 * scan-history.ts) plus the in-flight scan's accumulated cost.
 */

import type { ScanRecord } from './scan-history.js';

/** Per-scan limits applied to the in-flight scan only. */
export interface PerScanLimits {
  maxTokens?: number;
  maxCostUsd?: number;
}

/** Per-period limits applied to historical + current cost. */
export interface PerPeriodLimits {
  window: 'day' | 'week' | 'month';
  maxCostUsd: number;
}

export interface BudgetThresholds {
  /** Fraction of the limit at which a `warn` is emitted (default 0.8). */
  warnAt?: number;
  /** Fraction of the limit at which `abort` is returned (default 1.0). */
  abortAt?: number;
}

export interface BudgetLimits {
  perScan?: PerScanLimits;
  perPeriod?: PerPeriodLimits;
  thresholds?: BudgetThresholds;
}

export interface BudgetCheckInput {
  /** Accumulated USD cost of AI calls in the current scan. */
  currentScanCostUsd: number;
  /** Accumulated tokens of AI calls in the current scan. */
  currentScanTokens: number;
  /** Persisted history of past scans, used for period limits. */
  history?: ScanRecord[];
  /** Reference time (defaults to now). Useful for tests. */
  now?: Date;
}

export type BudgetAction = 'continue' | 'warn' | 'abort';

export interface BudgetStatus {
  ok: boolean;
  action: BudgetAction;
  reason?: string;
}

const DEFAULT_WARN_AT = 0.8;
const DEFAULT_ABORT_AT = 1.0;

/**
 * Compute the start of the current budget window for `now`.
 */
function windowStart(now: Date, window: PerPeriodLimits['window']): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  if (window === 'day') return d;
  if (window === 'week') {
    // ISO-style week: start on Monday (UTC).
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const offset = (day + 6) % 7; // days since Monday
    d.setUTCDate(d.getUTCDate() - offset);
    return d;
  }
  // month
  d.setUTCDate(1);
  return d;
}

/**
 * Sum costs of historical records whose startedAt falls within [start, now].
 *
 * The upper bound on `now` matters because clock-skewed CI machines can write
 * history records dated in the future. Without an upper bound, those records
 * would count toward every period until "now" surpasses them.
 */
function sumHistoryWithinWindow(history: ScanRecord[], start: Date, now: Date): number {
  const startIso = start.toISOString();
  const nowIso = now.toISOString();
  let total = 0;
  for (const r of history) {
    if (r.startedAt >= startIso && r.startedAt <= nowIso) {
      total += r.totalCost;
    }
  }
  return total;
}

/**
 * Evaluate the current scan against the configured budget limits.
 */
export function checkBudget(input: BudgetCheckInput, limits: BudgetLimits | undefined): BudgetStatus {
  if (!limits || (!limits.perScan && !limits.perPeriod)) {
    return { ok: true, action: 'continue' };
  }
  const warnAt = limits.thresholds?.warnAt ?? DEFAULT_WARN_AT;
  const abortAt = limits.thresholds?.abortAt ?? DEFAULT_ABORT_AT;

  let worst: BudgetStatus = { ok: true, action: 'continue' };

  const escalate = (status: BudgetStatus) => {
    if (status.action === 'abort' || (status.action === 'warn' && worst.action === 'continue')) {
      worst = status;
    }
  };

  // Per-scan token limit
  if (limits.perScan?.maxTokens !== undefined && limits.perScan.maxTokens > 0) {
    const ratio = input.currentScanTokens / limits.perScan.maxTokens;
    if (ratio >= abortAt) {
      escalate({
        ok: false,
        action: 'abort',
        reason: `Per-scan token limit reached: ${input.currentScanTokens} / ${limits.perScan.maxTokens}`,
      });
    } else if (ratio >= warnAt) {
      escalate({
        ok: true,
        action: 'warn',
        reason: `Per-scan token usage at ${(ratio * 100).toFixed(0)}% of limit (${input.currentScanTokens} / ${limits.perScan.maxTokens})`,
      });
    }
  }

  // Per-scan cost limit
  if (limits.perScan?.maxCostUsd !== undefined && limits.perScan.maxCostUsd > 0) {
    const ratio = input.currentScanCostUsd / limits.perScan.maxCostUsd;
    if (ratio >= abortAt) {
      escalate({
        ok: false,
        action: 'abort',
        reason: `Per-scan cost limit reached: ${input.currentScanCostUsd.toFixed(4)} / ${limits.perScan.maxCostUsd} USD`,
      });
    } else if (ratio >= warnAt) {
      escalate({
        ok: true,
        action: 'warn',
        reason: `Per-scan cost at ${(ratio * 100).toFixed(0)}% of limit (${input.currentScanCostUsd.toFixed(4)} / ${limits.perScan.maxCostUsd} USD)`,
      });
    }
  }

  // Per-period cost limit
  if (limits.perPeriod && limits.perPeriod.maxCostUsd > 0) {
    const now = input.now ?? new Date();
    const start = windowStart(now, limits.perPeriod.window);
    const historical = sumHistoryWithinWindow(input.history ?? [], start, now);
    const total = historical + input.currentScanCostUsd;
    const ratio = total / limits.perPeriod.maxCostUsd;
    if (ratio >= abortAt) {
      escalate({
        ok: false,
        action: 'abort',
        reason: `Per-${limits.perPeriod.window} cost limit reached: ${total.toFixed(4)} / ${limits.perPeriod.maxCostUsd} USD`,
      });
    } else if (ratio >= warnAt) {
      escalate({
        ok: true,
        action: 'warn',
        reason: `Per-${limits.perPeriod.window} cost at ${(ratio * 100).toFixed(0)}% of limit (${total.toFixed(4)} / ${limits.perPeriod.maxCostUsd} USD)`,
      });
    }
  }

  return worst;
}

/**
 * Sentinel error thrown by the scan runner when a budget abort fires mid-scan.
 * Distinct class so callers can detect budget aborts vs other failures.
 */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}
