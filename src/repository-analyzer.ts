/**
 * Repository Analyzer component.
 * Extracts Git metadata from target repositories.
 * Implements spec Appendix B.4.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { logDebug, logProgress } from './logging.js';
import type { RepositoryInfo } from './types.js';

const execFileAsync = promisify(execFile);
const TAG = 'repo-analyzer';

/**
 * Result of repository analysis including branch and commit.
 */
export interface RepositoryAnalysis {
  repository: RepositoryInfo;
  branch?: string;
  commit?: string;
}

/**
 * Check if a directory is a Git repository.
 */
export async function isGitRepository(path: string): Promise<boolean> {
  try {
    const gitDir = join(path, '.git');
    await access(gitDir, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a git command in the specified directory.
 * Returns the trimmed stdout, or undefined if the command fails.
 *
 * Note: 10 second timeout is sufficient for most git metadata commands.
 * Commands like rev-parse are fast even on large repositories.
 *
 * Security: Uses execFile with argument array to prevent command injection.
 * The args parameter is split on whitespace and passed as separate arguments.
 */
async function gitCommand(
  path: string,
  args: string,
): Promise<string | undefined> {
  try {
    const argArray = args.split(/\s+/).filter(Boolean);
    const { stdout } = await execFileAsync('git', argArray, {
      cwd: path,
      timeout: 10000,
    });
    return stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDebug(TAG, `Git command failed (git ${args}): ${message}`);
    return undefined;
  }
}

/**
 * Get the Git remote URL for 'origin'.
 * Returns undefined if no origin remote is configured.
 */
export async function getRemoteUrl(path: string): Promise<string | undefined> {
  const url = await gitCommand(path, 'config --get remote.origin.url');
  if (!url) {
    logDebug(TAG, 'No origin remote configured');
    return undefined;
  }
  return url;
}

/**
 * Get the current Git branch name.
 * Returns undefined if HEAD is detached or not on a branch.
 */
export async function getCurrentBranch(
  path: string,
): Promise<string | undefined> {
  const branch = await gitCommand(path, 'rev-parse --abbrev-ref HEAD');
  if (!branch || branch === 'HEAD') {
    logDebug(TAG, 'Detached HEAD or no branch');
    return undefined;
  }
  return branch;
}

/**
 * Get the current commit hash (full SHA).
 */
export async function getCommitHash(path: string): Promise<string | undefined> {
  return gitCommand(path, 'rev-parse HEAD');
}

/**
 * Sanitize a Git URL by removing embedded credentials.
 * Handles URLs like:
 * - https://user:pass@github.com/org/repo
 * - ssh://user:pass@github.com/org/repo
 */
export function sanitizeUrl(url: string): string {
  try {
    // Handle standard SSH URLs (git@github.com:org/repo.git)
    // These use key-based auth, not embedded credentials
    if (url.startsWith('git@') && !url.includes('://')) {
      return url;
    }

    // Handle other non-URL SSH formats (user@host:path without protocol)
    // But only if there's no colon before the @ (which would indicate credentials)
    if (url.includes('@') && !url.includes('://')) {
      const atIndex = url.indexOf('@');
      const colonBeforeAt = url.lastIndexOf(':', atIndex);
      // If there's a colon before @, it's likely credentials (user:pass@host)
      // Standard SSH format is user@host:path (colon after @)
      if (colonBeforeAt === -1) {
        return url;
      }
      // Has credentials in SSH-style URL, strip them
      return url.slice(atIndex + 1);
    }

    // Handle URLs with protocol (https://, ssh://, etc.)
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
    return url;
  } catch {
    // If URL parsing fails, try a regex-based approach
    // Matches protocol://user:pass@host or protocol://user@host
    return url.replace(/^([a-z]+:\/\/)[^@]+@/, '$1');
  }
}

/**
 * Normalize a Git URL by removing the .git suffix and cleaning up the URL.
 * Extracts org/repo path for common providers.
 */
export function normalizeUrl(url: string): string {
  let normalized = url;

  // Remove trailing .git suffix
  if (normalized.endsWith('.git')) {
    normalized = normalized.slice(0, -4);
  }

  // Remove trailing slashes
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Parse a Git URL and extract the organization and repository name.
 * Returns { org, repo } or undefined if parsing fails.
 *
 * For URLs with nested paths (e.g., org/suborg/repo), returns the last
 * two path segments as org and repo respectively.
 */
export function parseGitUrl(url: string): { org: string; repo: string } | undefined {
  const normalized = normalizeUrl(sanitizeUrl(url));

  // SSH format: git@github.com:org/repo or git@github.com:org/suborg/repo
  // Match host:path where path contains at least one slash
  const sshMatch = normalized.match(/^git@[^:]+:(.+)$/);
  if (sshMatch) {
    const pathPart = sshMatch[1];
    const segments = pathPart.split('/').filter(Boolean);
    if (segments.length >= 2) {
      // Take last segment as repo, second-to-last as org
      return { org: segments[segments.length - 2], repo: segments[segments.length - 1] };
    }
    return undefined;
  }

  // HTTPS format: https://github.com/org/repo
  try {
    const parsed = new URL(normalized);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2) {
      // Take last segment as repo, second-to-last as org
      return { org: pathParts[pathParts.length - 2], repo: pathParts[pathParts.length - 1] };
    }
  } catch {
    // Not a valid URL
  }

  return undefined;
}

/**
 * Normalize a repository path/URL for matching purposes.
 * 1. Remove .git suffix (via normalizeUrl)
 * 2. Replace backslashes with forward slashes
 * 3. Convert to lowercase
 */
export function normalizeRepoPath(repoPathOrUrl: string): string {
  let normalized = normalizeUrl(repoPathOrUrl);
  normalized = normalized.replace(/\\/g, '/');
  normalized = normalized.toLowerCase();
  return normalized;
}

/**
 * Analyze a repository and extract all Git metadata.
 * For non-Git directories, returns a RepositoryInfo with isGitRepository: false.
 */
export async function analyzeRepository(
  path: string,
): Promise<RepositoryAnalysis> {
  const isGit = await isGitRepository(path);

  if (!isGit) {
    logProgress(TAG, `Warning: ${path} is not a Git repository`);
    return {
      repository: {
        path,
        isGitRepository: false,
      },
    };
  }

  logDebug(TAG, `Analyzing Git repository: ${path}`);

  const [rawRemoteUrl, branch, commit] = await Promise.all([
    getRemoteUrl(path),
    getCurrentBranch(path),
    getCommitHash(path),
  ]);

  // Sanitize and normalize the remote URL
  const remoteUrl = rawRemoteUrl
    ? normalizeUrl(sanitizeUrl(rawRemoteUrl))
    : undefined;

  const repository: RepositoryInfo = {
    path,
    isGitRepository: true,
  };

  if (remoteUrl) {
    repository.remoteUrl = remoteUrl;
  }

  if (branch) {
    repository.branch = branch;
  }

  if (commit) {
    repository.commit = commit;
  }

  logDebug(
    TAG,
    `Repository analysis complete: branch=${branch ?? 'none'}, commit=${commit?.slice(0, 7) ?? 'none'}`,
  );

  return {
    repository,
    branch,
    commit,
  };
}
