/**
 * Generic prompt template prepended to all check executions.
 * Based on SPECIFICATION.md Appendix C.1.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPTS_DIR = resolve(__dirname, '..', 'config', 'prompts');

function getGenericPromptPath(configDir?: string, genericPrompt?: string): string {
  const filename = genericPrompt ?? 'generic-instructions.md';
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error(
      `Invalid generic prompt filename: must not contain path separators or "..". Got: "${filename}"`,
    );
  }
  // Try config-dir prompts first, fall back to built-in prompts
  if (configDir) {
    const configPromptPath = resolve(configDir, 'prompts', filename);
    if (existsSync(configPromptPath)) {
      return configPromptPath;
    }
  }
  return resolve(DEFAULT_PROMPTS_DIR, filename);
}

/**
 * Build the full prompt by prepending generic instructions to check-specific markdown.
 * @param checkInstructions - The check-specific markdown content.
 * @param configDir - Optional config directory containing prompts/ subdirectory.
 * @param genericPrompt - Optional generic prompt template filename (default: 'generic-instructions.md').
 */
export async function buildPrompt(checkInstructions: string, configDir?: string, genericPrompt?: string): Promise<string> {
  const genericPromptContent = await readFile(getGenericPromptPath(configDir, genericPrompt), 'utf-8');
  return genericPromptContent + checkInstructions;
}
