/**
 * Color helpers for CLI output.
 * Uses picocolors which automatically respects NO_COLOR env var and non-TTY.
 */

import pc from 'picocolors';

export function colorStatus(status: string): string {
  switch (status) {
    case 'NO ISSUES DETECTED': return pc.green(status);
    case 'ISSUES DETECTED': return pc.red(status);
    case 'REVIEW REQUIRED': return pc.yellow(status);
    case 'SCAN ERROR': return pc.red(status);
    default: return status;
  }
}

export function colorError(message: string): string {
  return pc.red(message);
}
