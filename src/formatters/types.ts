/**
 * Output formatter interface for scan results.
 * Follows the AgentProvider interface pattern from src/types.ts.
 */

import type { ScanResults } from '../types.js';

export interface OutputFormatter {
  readonly id: string;
  readonly fileExtension: string;
  format(results: ScanResults): string;
}
