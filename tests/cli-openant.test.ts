/**
 * CLI integration tests for the openant check type.
 * Spawns the real CLI process with AGHAST_MOCK_AI=true and --openant-dataset.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fixtureRepo,
  failFixtureRepo,
  singleCheckConfigDir,
  cli3TargetsSarif,
  createScopedHelpers,
} from './cli-test-helpers.js';
import { runCLI as rawRunCLI } from './cli-test-helpers.js';

const testDir = dirname(fileURLToPath(import.meta.url));

const openantConfigDir = resolve(testDir, 'fixtures', 'cli-configs', 'openant-check');
const openantDataset = resolve(testDir, 'fixtures', 'openant', 'dataset_enhanced.json');
const openantBaseDataset = resolve(testDir, 'fixtures', 'openant', 'dataset.json');

const { runCLI, cleanupOutput, readResults } = createScopedHelpers('openant');

describe('CLI: openant check type', () => {
  before(async () => {
    await cleanupOutput();
  });
  after(async () => {
    await cleanupOutput();
  });

  it('should PASS with default mock AI response (empty issues)', async () => {
    const result = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [
        fixtureRepo,
        '--config-dir', openantConfigDir,
        '--openant-dataset', openantDataset,
      ],
    );

    assert.equal(result.exitCode, 0, `CLI failed: ${result.stderr}`);
    assert.ok(result.stdout.includes('PASS'), `Expected PASS in output: ${result.stdout}`);

    const results = await readResults();
    const checks = results.checks as Array<{ status: string; targetsAnalyzed?: number }>;
    assert.equal(checks.length, 1);
    assert.equal(checks[0].status, 'PASS');
    // All 4 units in the fixture should be analyzed
    assert.equal(checks[0].targetsAnalyzed, 4);
  });

  it('should FAIL when mock AI returns issues', async () => {
    const result = await runCLI(
      { AGHAST_MOCK_AI: failFixtureRepo },
      [
        fixtureRepo,
        '--config-dir', openantConfigDir,
        '--openant-dataset', openantDataset,
      ],
    );

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('FAIL'), `Expected FAIL in output: ${result.stdout}`);

    const results = await readResults();
    const checks = results.checks as Array<{ status: string; issuesFound: number }>;
    assert.equal(checks[0].status, 'FAIL');
    assert.ok(checks[0].issuesFound > 0);

    // Issues should be enriched with checkId
    const issues = results.issues as Array<{ checkId: string; checkName: string }>;
    assert.ok(issues.length > 0);
    assert.equal(issues[0].checkId, 'aghast-openant-test');
    assert.equal(issues[0].checkName, 'OpenAnt Security Test');
  });

  it('should ERROR when no --openant-dataset or --openant-project provided', async () => {
    const result = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [
        fixtureRepo,
        '--config-dir', openantConfigDir,
      ],
    );

    assert.equal(result.exitCode, 0);

    const results = await readResults();
    const checks = results.checks as Array<{ status: string; error?: string }>;
    assert.equal(checks[0].status, 'ERROR');
    assert.ok(checks[0].error?.includes('openant-units'));
  });

  it('should PASS with base (non-enhanced) dataset', async () => {
    const result = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [
        fixtureRepo,
        '--config-dir', openantConfigDir,
        '--openant-dataset', openantBaseDataset,
      ],
    );

    assert.equal(result.exitCode, 0, `CLI failed: ${result.stderr}`);
    assert.ok(result.stdout.includes('PASS'), `Expected PASS in output: ${result.stdout}`);

    const results = await readResults();
    const checks = results.checks as Array<{ status: string; targetsAnalyzed?: number }>;
    assert.equal(checks[0].status, 'PASS');
    // Base dataset has 1 unit (no agent_context)
    assert.equal(checks[0].targetsAnalyzed, 1);
  });

  it('should include scan metadata in output', async () => {
    const result = await runCLI(
      { AGHAST_MOCK_AI: 'true' },
      [
        fixtureRepo,
        '--config-dir', openantConfigDir,
        '--openant-dataset', openantDataset,
      ],
    );

    assert.equal(result.exitCode, 0);

    const results = await readResults();
    assert.ok(results.scanId, 'Should have scanId');
    assert.ok(results.timestamp, 'Should have timestamp');
    const summary = results.summary as { totalChecks: number };
    assert.equal(summary.totalChecks, 1);
  });
});

describe('CLI: incompatible flag validation', () => {
  it('should reject --sarif-file combined with --openant-dataset', async () => {
    const result = await rawRunCLI(
      { AGHAST_MOCK_AI: 'true' },
      [
        fixtureRepo,
        '--config-dir', singleCheckConfigDir,
        '--sarif-file', cli3TargetsSarif,
        '--openant-dataset', openantDataset,
      ],
    );

    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr.includes('--sarif-file cannot be combined with --openant-project or --openant-dataset'),
      `Expected incompatibility error in stderr: ${result.stderr}`,
    );
  });

  it('should reject --sarif-file combined with --openant-project', async () => {
    const result = await rawRunCLI(
      { AGHAST_MOCK_AI: 'true' },
      [
        fixtureRepo,
        '--config-dir', singleCheckConfigDir,
        '--sarif-file', cli3TargetsSarif,
        '--openant-project', 'some-project',
      ],
    );

    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr.includes('--sarif-file cannot be combined with --openant-project or --openant-dataset'),
      `Expected incompatibility error in stderr: ${result.stderr}`,
    );
  });

  it('should reject --openant-project combined with --openant-dataset', async () => {
    const result = await rawRunCLI(
      { AGHAST_MOCK_AI: 'true' },
      [
        fixtureRepo,
        '--config-dir', singleCheckConfigDir,
        '--openant-project', 'some-project',
        '--openant-dataset', openantDataset,
      ],
    );

    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr.includes('--openant-project and --openant-dataset cannot be combined'),
      `Expected incompatibility error in stderr: ${result.stderr}`,
    );
  });
});
