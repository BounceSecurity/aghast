/**
 * Runtime configuration loader.
 * Loads runtime-config.json from the config directory to override AI provider and reporting settings.
 * Spec Section 8.1 & Appendix C.10.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RuntimeConfig } from './types.js';

/**
 * Load runtime configuration from file.
 * @param configDir - Directory containing runtime-config.json.
 * @param explicitPath - Explicit path to the runtime config file (from --runtime-config CLI flag).
 * @returns Parsed RuntimeConfig object, or empty object if file absent
 * @throws Error if file exists but contains invalid JSON
 */
export async function loadRuntimeConfig(configDir: string, explicitPath?: string): Promise<RuntimeConfig> {
  const pathToLoad = explicitPath ?? resolve(configDir, 'runtime-config.json');
  let content: string;
  try {
    content = await readFile(pathToLoad, 'utf-8');
  } catch (err: unknown) {
    // File absent: silently return defaults
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }

  // File exists but may have invalid JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in runtime config file: ${pathToLoad}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Runtime config file "${pathToLoad}" must contain a JSON object`);
  }

  // Validate field types
  const obj = parsed as Record<string, unknown>;
  if (obj.aiProvider !== undefined) {
    if (typeof obj.aiProvider !== 'object' || obj.aiProvider === null || Array.isArray(obj.aiProvider)) {
      throw new Error(`Runtime config "${pathToLoad}": "aiProvider" must be an object`);
    }
    const ap = obj.aiProvider as Record<string, unknown>;
    if (ap.name !== undefined && typeof ap.name !== 'string') {
      throw new Error(`Runtime config "${pathToLoad}": "aiProvider.name" must be a string`);
    }
    if (ap.model !== undefined && typeof ap.model !== 'string') {
      throw new Error(`Runtime config "${pathToLoad}": "aiProvider.model" must be a string`);
    }
  }
  if (obj.reporting !== undefined) {
    if (typeof obj.reporting !== 'object' || obj.reporting === null || Array.isArray(obj.reporting)) {
      throw new Error(`Runtime config "${pathToLoad}": "reporting" must be an object`);
    }
    const rpt = obj.reporting as Record<string, unknown>;
    if (rpt.outputDirectory !== undefined && typeof rpt.outputDirectory !== 'string') {
      throw new Error(`Runtime config "${pathToLoad}": "reporting.outputDirectory" must be a string`);
    }
    if (rpt.outputFormat !== undefined && typeof rpt.outputFormat !== 'string') {
      throw new Error(`Runtime config "${pathToLoad}": "reporting.outputFormat" must be a string`);
    }
  }
  if (obj.genericPrompt !== undefined && typeof obj.genericPrompt !== 'string') {
    throw new Error(`Runtime config "${pathToLoad}": "genericPrompt" must be a string`);
  }
  if (obj.failOnCheckFailure !== undefined && typeof obj.failOnCheckFailure !== 'boolean') {
    throw new Error(`Runtime config "${pathToLoad}": "failOnCheckFailure" must be a boolean`);
  }
  if (obj.logging !== undefined) {
    if (typeof obj.logging !== 'object' || obj.logging === null || Array.isArray(obj.logging)) {
      throw new Error(`Runtime config "${pathToLoad}": "logging" must be an object`);
    }
    const log = obj.logging as Record<string, unknown>;
    if (log.logFile !== undefined && typeof log.logFile !== 'string') {
      throw new Error(`Runtime config "${pathToLoad}": "logging.logFile" must be a string`);
    }
    if (log.logType !== undefined && typeof log.logType !== 'string') {
      throw new Error(`Runtime config "${pathToLoad}": "logging.logType" must be a string`);
    }
    if (log.level !== undefined && typeof log.level !== 'string') {
      throw new Error(`Runtime config "${pathToLoad}": "logging.level" must be a string`);
    }
  }

  return parsed as RuntimeConfig;
}
