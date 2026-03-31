/**
 * OpenAnt runner.
 * Executes `openant parse` against a repository and returns the path to the generated dataset.json.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, access, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { logProgress, logDebug } from './logging.js';
import { ERROR_CODES, formatError } from './error-codes.js';

const TAG = 'openant';

/**
 * Get the openant binary name for the current platform.
 */
function getOpenAntBinary(): string {
  return process.platform === 'win32' ? 'openant.exe' : 'openant';
}

/**
 * Verify that OpenAnt is installed and available on PATH.
 * Resolves if found, rejects with a user-friendly error if not.
 * Skips the check when AGHAST_MOCK_OPENANT is set.
 */
export async function verifyOpenAntInstalled(): Promise<void> {
  if (process.env.AGHAST_MOCK_OPENANT) return;
  const binary = getOpenAntBinary();
  return new Promise((resolve, reject) => {
    execFile(binary, ['--help'], (error) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(
          formatError(ERROR_CODES.E6001, 'OpenAnt is required for the configured checks but was not found. Install it from https://github.com/knostic/OpenAnt/'),
        ));
        return;
      }
      resolve();
    });
  });
}

/**
 * Execute `openant parse` and return the path to the generated dataset.json.
 * If AGHAST_MOCK_OPENANT env var is set, copies that file to a temp location instead.
 *
 * The caller is responsible for cleaning up the returned temp directory via
 * the cleanup function returned alongside the dataset path.
 */
export async function runOpenAnt(
  repositoryPath: string,
): Promise<{ datasetPath: string; cleanup: () => Promise<void> }> {
  const mockFile = process.env.AGHAST_MOCK_OPENANT;
  if (mockFile) {
    logDebug(TAG, `Mock mode: using dataset from ${mockFile}`);
    // Copy to temp dir so cleanup logic is consistent
    const tmpDir = await mkdtemp(join(tmpdir(), 'aghast-openant-mock-'));
    const datasetPath = join(tmpDir, 'dataset.json');
    await copyFile(mockFile, datasetPath);
    return {
      datasetPath,
      cleanup: async () => {
        await rm(tmpDir, { recursive: true, force: true }).catch((err) => {
          logDebug(TAG, `Failed to clean up mock temp directory ${tmpDir}: ${err}`);
        });
      },
    };
  }

  logProgress(TAG, 'Running OpenAnt parse...');

  const tmpDir = await mkdtemp(join(tmpdir(), 'aghast-openant-'));
  const binary = getOpenAntBinary();
  const args = ['parse', repositoryPath, '--output', tmpDir, '--language', 'auto', '--fresh', '--quiet'];

  logDebug(TAG, `Command: ${binary} ${args.join(' ')}`);

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        binary,
        args,
        { timeout: 600_000 }, // 10 minute timeout
        (error, _stdout, stderr) => {
          if (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              reject(new Error(
                formatError(ERROR_CODES.E6001, 'OpenAnt not found. Install it from https://github.com/knostic/OpenAnt/'),
              ));
              return;
            }
            reject(new Error(
              formatError(ERROR_CODES.E6002, `OpenAnt execution failed${stderr?.trim() ? `: ${stderr.trim()}` : ''}`),
            ));
            return;
          }
          resolve();
        },
      );
    });

    const datasetPath = join(tmpDir, 'dataset.json');
    const exists = await access(datasetPath).then(() => true, () => false);
    if (!exists) {
      throw new Error(formatError(ERROR_CODES.E6002, `OpenAnt did not produce dataset.json in ${tmpDir}`));
    }

    logDebug(TAG, `Dataset generated: ${datasetPath}`);

    return {
      datasetPath,
      cleanup: async () => {
        await rm(tmpDir, { recursive: true, force: true }).catch((err) => {
          logDebug(TAG, `Failed to clean up temp directory ${tmpDir}: ${err}`);
        });
      },
    };
  } catch (err) {
    // Clean up on error
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}
