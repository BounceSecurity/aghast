/**
 * SARIF 2.1.0 parser for Semgrep output.
 * Extracts CheckTarget[] from SARIF results.
 */

import type { CheckTarget } from './types.js';

interface SARIFPhysicalLocation {
  artifactLocation?: { uri?: string };
  region?: {
    startLine?: number;
    endLine?: number;
    snippet?: { text?: string };
  };
}

interface SARIFResult {
  message?: { text?: string };
  locations?: Array<{ physicalLocation?: SARIFPhysicalLocation }>;
}

interface SARIFRun {
  results?: SARIFResult[];
}

interface SARIFDocument {
  version?: string;
  runs?: SARIFRun[];
}

/**
 * Parse SARIF 2.1.0 JSON content into CheckTarget[].
 * Skips results with missing location fields.
 * Throws on invalid JSON or missing SARIF structure.
 */
export function parseSARIF(sarifContent: string): CheckTarget[] {
  let doc: SARIFDocument;
  try {
    doc = JSON.parse(sarifContent) as SARIFDocument;
  } catch {
    throw new Error('Invalid SARIF: malformed JSON');
  }

  if (!doc.runs || !Array.isArray(doc.runs)) {
    throw new Error('Invalid SARIF: missing "runs" array');
  }

  const targets: CheckTarget[] = [];

  for (const run of doc.runs) {
    if (!run.results || !Array.isArray(run.results)) {
      continue;
    }

    for (const result of run.results) {
      if (!result.locations || result.locations.length === 0) {
        continue;
      }

      const loc = result.locations[0];
      const phys = loc?.physicalLocation;
      if (!phys) continue;

      const file = phys.artifactLocation?.uri;
      const startLine = phys.region?.startLine;

      // Skip results missing required location fields
      if (!file || startLine === undefined) {
        continue;
      }

      const endLine = phys.region?.endLine ?? startLine;

      const target: CheckTarget = {
        file,
        startLine,
        endLine,
        message: result.message?.text ?? '',
      };

      if (phys.region?.snippet?.text) {
        target.snippet = phys.region.snippet.text;
      }

      targets.push(target);
    }
  }

  return targets;
}

/**
 * Deduplicate targets by file:startLine:endLine key.
 */
export function deduplicateTargets(targets: CheckTarget[]): CheckTarget[] {
  const seen = new Set<string>();
  const result: CheckTarget[] = [];

  for (const target of targets) {
    const key = `${target.file}:${target.startLine}:${target.endLine}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(target);
    }
  }

  return result;
}

/**
 * Limit the number of targets to a maximum.
 */
export function limitTargets(targets: CheckTarget[], maxTargets: number): CheckTarget[] {
  return targets.slice(0, maxTargets);
}
