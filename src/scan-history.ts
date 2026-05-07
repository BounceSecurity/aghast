/**
 * Scan history: persisted record of completed scans for cost dashboards
 * and budget controls.
 *
 * Storage: `~/.aghast/history.json` by default (one file per user). When the
 * home directory cannot be resolved, falls back to project-local
 * `.aghast-history.json`. The path can be overridden in tests via the
 * `AGHAST_HISTORY_FILE` env var or by passing `historyFile` to the helpers.
 *
 * Format: a single JSON document `{ "records": [...] }`. We keep this simple
 * (no SQLite) so the file is human-readable and can be edited / pruned by
 * hand. Corrupt files are logged and rebuilt to avoid blocking scans on a
 * malformed history file.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { logProgress } from './logging.js';
import type { TokenUsage } from './types.js';

const TAG = 'scan-history';
const DEFAULT_FILENAME = 'history.json';
const FALLBACK_FILENAME = '.aghast-history.json';
const SCHEMA_VERSION = 1;

/** A single completed-scan record. */
export interface ScanRecord {
  scanId: string;
  /** ISO timestamp of scan start. */
  startedAt: string;
  /** ISO timestamp of scan end. */
  endedAt: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Repository path or remote URL. */
  repository: string;
  /** Repository remote URL when known. */
  repositoryUrl?: string;
  /** Models used during the scan. */
  models: string[];
  /** Aggregate token usage across the scan. */
  tokenUsage?: TokenUsage;
  /** Estimated total cost (in `currency`). */
  totalCost: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** How the cost was determined. Absent on records written before this feature. */
  costSource?: 'reported' | 'estimated' | 'estimated-unpriced' | 'legacy';
  /** Which provider reported the cost when costSource === 'reported'. */
  costReportedBy?: 'claude-agent-sdk' | 'opencode';
  /** true when the scan ran with AGHAST_LOCAL_CLAUDE=true */
  costCoveredBySubscription?: boolean;
  /** Number of checks executed. */
  checks: number;
  /** Number of issues reported. */
  issues: number;
}

interface HistoryFile {
  version: number;
  records: ScanRecord[];
}

/** Filters for queryScanHistory(). */
export interface HistoryFilters {
  repository?: string;
  /** Substring match against any element of `models`. */
  model?: string;
  /** Inclusive ISO timestamp lower bound on `startedAt`. */
  since?: string;
  /** Inclusive ISO timestamp upper bound on `startedAt`. */
  until?: string;
}

/**
 * Resolve the history file path.
 *
 * Precedence:
 *   1. explicit `historyFile` argument
 *   2. AGHAST_HISTORY_FILE env var
 *   3. ~/.aghast/history.json when homedir is available
 *   4. project-local `.aghast-history.json`
 */
export function resolveHistoryFilePath(historyFile?: string): string {
  if (historyFile) return resolve(historyFile);
  const envOverride = process.env.AGHAST_HISTORY_FILE;
  if (envOverride && envOverride.length > 0) return resolve(envOverride);
  let home: string | undefined;
  try {
    home = homedir();
  } catch {
    home = undefined;
  }
  if (home && home.length > 0) {
    return resolve(home, '.aghast', DEFAULT_FILENAME);
  }
  return resolve(process.cwd(), FALLBACK_FILENAME);
}

async function readHistoryFile(path: string): Promise<HistoryFile> {
  let content: string;
  try {
    content = await readFile(path, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: SCHEMA_VERSION, records: [] };
    }
    throw err;
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    const obj = parsed as Record<string, unknown>;
    const records = Array.isArray(obj.records) ? (obj.records as ScanRecord[]) : [];
    const version = typeof obj.version === 'number' ? obj.version : SCHEMA_VERSION;
    return { version, records };
  } catch (err) {
    // Corrupt history: log and rebuild, never block a scan.
    logProgress(TAG, `History file at ${path} is corrupt (${err instanceof Error ? err.message : String(err)}); rebuilding.`);
    return { version: SCHEMA_VERSION, records: [] };
  }
}

async function writeHistoryFile(path: string, file: HistoryFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 2) + '\n', 'utf-8');
}

/**
 * Append a record to the scan history, deduplicating by scanId.
 * If a record with the same scanId already exists, it is replaced.
 */
export async function saveScanRecord(record: ScanRecord, options: { historyFile?: string } = {}): Promise<void> {
  const path = resolveHistoryFilePath(options.historyFile);
  const file = await readHistoryFile(path);
  const existingIdx = file.records.findIndex((r) => r.scanId === record.scanId);
  if (existingIdx >= 0) {
    file.records[existingIdx] = record;
  } else {
    file.records.push(record);
  }
  await writeHistoryFile(path, file);
}

/**
 * Load all scan records, applying optional filters.
 * Records are returned newest-first (descending startedAt).
 */
export async function queryScanHistory(
  filters: HistoryFilters = {},
  options: { historyFile?: string } = {},
): Promise<ScanRecord[]> {
  const path = resolveHistoryFilePath(options.historyFile);
  const file = await readHistoryFile(path);
  let out = file.records.slice();

  if (filters.repository) {
    const needle = filters.repository;
    out = out.filter(
      (r) =>
        r.repository === needle ||
        r.repositoryUrl === needle ||
        r.repository.includes(needle) ||
        (r.repositoryUrl ?? '').includes(needle),
    );
  }
  if (filters.model) {
    const needle = filters.model;
    out = out.filter((r) => r.models.some((m) => m.includes(needle)));
  }
  if (filters.since) {
    const since = filters.since;
    out = out.filter((r) => r.startedAt >= since);
  }
  if (filters.until) {
    const until = filters.until;
    out = out.filter((r) => r.startedAt <= until);
  }

  out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return out;
}
