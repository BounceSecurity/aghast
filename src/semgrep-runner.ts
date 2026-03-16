/**
 * Semgrep runner.
 * Executes Semgrep against a repository and returns raw SARIF output.
 */

import { execFile } from 'node:child_process';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logProgress, logDebug } from './logging.js';

const TAG = 'semgrep';

export interface SemgrepOptions {
  repositoryPath: string;
  rules?: string | string[];
  config?: string;
}

/**
 * Build the Semgrep CLI arguments.
 */
export function buildSemgrepArgs(
  options: SemgrepOptions,
  outputFile: string,
): string[] {
  const args: string[] = [];

  if (options.config) {
    args.push('--config', options.config);
  } else if (options.rules) {
    const rulesList = Array.isArray(options.rules) ? options.rules : [options.rules];
    for (const rule of rulesList) {
      args.push('--config', rule);
    }
  }

  args.push('--sarif', '--output', outputFile, '.');

  return args;
}

/**
 * Verify that Semgrep is installed and available on PATH.
 * Resolves if found, rejects with a user-friendly error if not.
 * Skips the check when AGHAST_MOCK_SEMGREP is set.
 */
export async function verifySemgrepInstalled(): Promise<void> {
  if (process.env.AGHAST_MOCK_SEMGREP) return;
  return new Promise((resolve, reject) => {
    execFile('semgrep', ['--version'], (error) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(
          'Semgrep is required for the configured checks but was not found. Install it from https://semgrep.dev/docs/getting-started/',
        ));
        return;
      }
      resolve();
    });
  });
}

/**
 * Execute Semgrep and return raw SARIF string.
 * If AGHAST_MOCK_SEMGREP env var is set, reads and returns that file instead.
 */
export async function runSemgrep(options: SemgrepOptions): Promise<string> {
  const mockFile = process.env.AGHAST_MOCK_SEMGREP;
  if (mockFile) {
    logDebug(TAG, `Mock mode: reading SARIF from ${mockFile}`);
    try {
      return await readFile(mockFile, 'utf-8');
    } catch (err) {
      throw new Error(
        `Failed to read AGHAST_MOCK_SEMGREP file: ${mockFile}`,
        { cause: err },
      );
    }
  }

  logProgress(TAG, 'Running Semgrep...');

  const tmpDir = await mkdtemp(join(tmpdir(), 'aghast-semgrep-'));
  const outputFile = join(tmpDir, 'results.sarif');

  try {
    const args = buildSemgrepArgs(options, outputFile);
    logDebug(TAG, `Command: semgrep ${args.join(' ')}`);

    const { stderr: stderrContent, hadError } = await new Promise<{ stderr: string; hadError: boolean }>((resolve, reject) => {
      execFile(
        'semgrep',
        args,
        { cwd: options.repositoryPath, timeout: 300_000 },
        (error, _stdout, stderr) => {
          if (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              reject(
                new Error(
                  'Semgrep not found. Install it from https://semgrep.dev/docs/getting-started/',
                ),
              );
              return;
            }
            // Semgrep >= 1.0: exit code 0 means success (with or without findings),
            // exit code 1 means an error occurred. Resolve with stderr so the caller
            // can check whether the output file was actually produced.
            resolve({ stderr, hadError: true });
            return;
          }
          resolve({ stderr, hadError: false });
        },
      );
    });

    if (hadError) {
      throw new Error(
        `Semgrep execution failed${stderrContent.trim() ? `: ${stderrContent.trim()}` : ''}`,
      );
    }

    const outputFileExists = await access(outputFile).then(() => true, () => false);
    if (!outputFileExists) {
      throw new Error('Semgrep did not produce output');
    }

    const sarifContent = await readFile(outputFile, 'utf-8');
    logDebug(TAG, `SARIF output: ${sarifContent.length} chars`);
    return sarifContent;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch((err) => {
      logDebug(TAG, `Failed to clean up temp directory ${tmpDir}: ${err}`);
    });
  }
}
