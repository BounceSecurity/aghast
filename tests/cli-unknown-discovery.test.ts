/**
 * Tests for graceful handling of unknown discovery types.
 *
 * A check with an unrecognized discovery type should be skipped
 * (not crash the scan) when it matches the target repository.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fixtureRepo,
  unknownDiscoveryConfigDir,
  createScopedHelpers,
} from './cli-test-helpers.js';

describe('CLI: unknown discovery type handling', () => {
  const { runCLI, cleanupOutput, readResults } = createScopedHelpers('unknown-discovery');
  afterEach(cleanupOutput);

  it('skips check with unknown discovery type instead of crashing', async () => {
    const { exitCode, stdout, stderr } = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [fixtureRepo, '--config-dir', unknownDiscoveryConfigDir],
    );

    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}. stderr: ${stderr}`);
    const combined = stdout + stderr;
    assert.ok(
      combined.includes('Skipping invalid check'),
      'Should log that the check was skipped',
    );
    assert.ok(
      combined.includes('Unknown discovery type'),
      'Should mention the unknown discovery type',
    );

    // Scan should complete with 0 checks (the only check was skipped)
    const results = await readResults();
    const checks = results.checks as Array<Record<string, unknown>>;
    assert.equal(checks.length, 0, 'No checks should have run');
  });
});
