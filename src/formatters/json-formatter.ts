/**
 * JSON output formatter — reproduces current default behavior.
 */

import type { ScanResults } from '../types.js';
import type { OutputFormatter } from './types.js';

export class JsonFormatter implements OutputFormatter {
  readonly id = 'json';
  readonly fileExtension = '.json';

  format(results: ScanResults): string {
    return JSON.stringify(results, null, 2);
  }
}
