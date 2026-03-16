/**
 * Unit tests for runtime config loading (src/runtime-config.ts).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../src/runtime-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('loadRuntimeConfig: valid config file', async () => {
  const validDir = resolve(__dirname, 'fixtures', 'runtime-config', 'valid-dir');
  const config = await loadRuntimeConfig(validDir);
  assert.equal(config.aiProvider?.name, 'claude-code');
  assert.equal(config.aiProvider?.model, 'claude-opus-4-6');
});

test('loadRuntimeConfig: file absent returns empty object', async () => {
  const absentDir = resolve(__dirname, 'fixtures', 'runtime-config', 'nonexistent-dir');
  const config = await loadRuntimeConfig(absentDir);
  assert.deepEqual(config, {});
});

test('loadRuntimeConfig: malformed JSON throws error', async () => {
  const malformedDir = resolve(__dirname, 'fixtures', 'runtime-config', 'malformed-dir');
  await assert.rejects(
    async () => {
      await loadRuntimeConfig(malformedDir);
    },
    (err: unknown) => {
      const error = err as Error;
      return error.message.includes('Invalid JSON in runtime config file');
    },
  );
});

test('loadRuntimeConfig: explicitPath parameter overrides default', async () => {
  const validPath = resolve(__dirname, 'fixtures', 'runtime-config', 'valid.json');
  const config = await loadRuntimeConfig('/unused', validPath);
  assert.equal(config.aiProvider?.name, 'claude-code');
});

test('loadRuntimeConfig: rejects aiProvider as a non-object', async () => {
  const badTypesPath = resolve(__dirname, 'fixtures', 'runtime-config', 'bad-types.json');
  await assert.rejects(
    async () => {
      await loadRuntimeConfig('/unused', badTypesPath);
    },
    (err: unknown) => {
      const error = err as Error;
      return error.message.includes('"aiProvider" must be an object');
    },
  );
});

test('loadRuntimeConfig: rejects failOnCheckFailure as a non-boolean', async () => {
  const badTypesDir = resolve(__dirname, 'fixtures', 'runtime-config', 'bad-types-dir');
  await assert.rejects(
    async () => {
      await loadRuntimeConfig(badTypesDir);
    },
    (err: unknown) => {
      const error = err as Error;
      return error.message.includes('"failOnCheckFailure" must be a boolean');
    },
  );
});

test('loadRuntimeConfig: rejects non-object root (e.g., array)', async () => {
  // Create an inline test by passing explicit path to a temp file
  const { writeFile: writeFileSync, unlink: unlinkSync } = await import('node:fs/promises');
  const tmpPath = resolve(__dirname, 'fixtures', 'runtime-config', 'array-root.json');
  await writeFileSync(tmpPath, '[]', 'utf-8');
  try {
    await assert.rejects(
      async () => {
        await loadRuntimeConfig('/unused', tmpPath);
      },
      (err: unknown) => {
        const error = err as Error;
        return error.message.includes('must contain a JSON object');
      },
    );
  } finally {
    await unlinkSync(tmpPath);
  }
});
