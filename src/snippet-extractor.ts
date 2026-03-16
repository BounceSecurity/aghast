/**
 * Code snippet extractor.
 * Extracts code snippets from source files at reported line ranges.
 * Used to enrich SecurityIssue with codeSnippet (spec Appendix C.4).
 */

import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/**
 * Check that a resolved file path is contained within the repository directory.
 * Prevents path traversal attacks where AI-returned file paths like
 * "../../../../etc/passwd" could read files outside the repository.
 */
export function isPathWithinRepository(repositoryPath: string, absolutePath: string): boolean {
  const normalizedRepo = resolve(repositoryPath) + sep;
  const normalizedFile = resolve(absolutePath);
  return normalizedFile.startsWith(normalizedRepo);
}

/**
 * Extract lines from a file at the given line range (1-based, inclusive).
 * Returns undefined if the file cannot be read or the range is invalid.
 *
 * Security: Refuses to read files that resolve outside the repository directory
 * to prevent path traversal via AI-returned file paths.
 *
 * Edge case behavior:
 * - If both startLine and endLine are undefined: returns undefined (no snippet)
 * - If only startLine is provided: endLine defaults to startLine (single line)
 * - If only endLine is provided: startLine defaults to 1
 */
export async function extractSnippet(
  repositoryPath: string,
  filePath: string,
  startLine?: number,
  endLine?: number,
): Promise<string | undefined> {
  // When both are undefined, we have no line information to extract
  if (startLine === undefined && endLine === undefined) {
    return undefined;
  }

  const absolutePath = resolve(repositoryPath, filePath);

  // Prevent path traversal — refuse to read files outside the repository
  if (!isPathWithinRepository(repositoryPath, absolutePath)) {
    return undefined;
  }

  let content: string;
  try {
    content = await readFile(absolutePath, 'utf-8');
  } catch {
    return undefined;
  }

  const lines = content.split('\n');

  const start = Math.max(1, startLine ?? 1);
  const end = Math.min(lines.length, endLine ?? start);

  if (start > lines.length || start > end) {
    return undefined;
  }

  // Lines are 1-based in the spec, arrays are 0-based
  return lines.slice(start - 1, end).join('\n');
}
