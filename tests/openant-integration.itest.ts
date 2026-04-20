/**
 * Real OpenAnt integration tests.
 * These tests actually invoke the `openant` binary to run `openant parse`.
 * Auto-skipped when openant is not on PATH.
 * Skip explicitly by setting AGHAST_SKIP_OPENANT_TESTS=true.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runOpenAnt } from '../src/openant-runner.js';
import { loadDatasetFromFile } from '../src/openant-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testCodebase = resolve(__dirname, 'fixtures', 'openant-test-codebase');

// Auto-detect whether openant is installed
const openant = process.platform === 'win32' ? 'openant.exe' : 'openant';
const opnResult = spawnSync(openant, ['--help'], { timeout: 10_000 });
const opnInstalled = opnResult.status === 0 || (opnResult.status !== null && opnResult.error === undefined);
const skip = !!process.env.AGHAST_SKIP_OPENANT_TESTS || !opnInstalled;

describe('OpenAnt integration tests', { skip }, () => {
  before(() => {
    // Ensure AGHAST_OPENANT_DATASET is not set
    delete process.env.AGHAST_OPENANT_DATASET;
  });

  it('runOpenAnt parses test codebase and produces dataset.json', async () => {
    const { datasetPath, cleanup } = await runOpenAnt(testCodebase);

    try {
      // Verify dataset.json was created
      assert.ok(datasetPath.endsWith('dataset.json'), `Expected dataset.json, got: ${datasetPath}`);

      // Verify it's valid and contains units
      const dataset = await loadDatasetFromFile(datasetPath);
      assert.ok(Array.isArray(dataset.units), 'Dataset should have units array');
      assert.ok(dataset.units.length > 0, 'Dataset should contain at least one unit');

      // Verify units have expected structure
      const unit = dataset.units[0];
      assert.ok(unit.id, 'Unit should have an id');
      assert.ok(unit.unit_type, 'Unit should have a unit_type');
      assert.ok(unit.code, 'Unit should have code');
      assert.ok(unit.code.primary_origin, 'Unit should have primary_origin');
      assert.ok(unit.code.primary_origin.file_path, 'Unit should have file_path');
    } finally {
      await cleanup();
    }
  });

  it('runOpenAnt cleans up temp directory after cleanup() is called', async () => {
    const { datasetPath, cleanup } = await runOpenAnt(testCodebase);
    const { access } = await import('node:fs/promises');

    // File should exist before cleanup
    await assert.doesNotReject(() => access(datasetPath), 'dataset.json should exist before cleanup');

    await cleanup();

    // File should not exist after cleanup
    await assert.rejects(() => access(datasetPath), 'dataset.json should be removed after cleanup');
  });
});
