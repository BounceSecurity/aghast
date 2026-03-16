/**
 * Unit tests for the provider registry and AIProvider interface compliance.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  registerProvider,
  createProviderByName,
  getProviderNames,
  DEFAULT_PROVIDER_NAME,
} from '../src/provider-registry.js';
import { ClaudeCodeProvider } from '../src/claude-code-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Helper to dynamically import MockAIProvider (avoids tsc emitting stray .js files)
async function getMockProvider() {
  const mockModulePath = pathToFileURL(resolve(__dirname, 'mocks', 'mock-ai-provider.js')).href;
  const { MockAIProvider } = await import(mockModulePath);
  return MockAIProvider;
}

// ─── Provider registry ────────────────────────────────────────────────────────

describe('Provider registry', () => {
  it('getProviderNames() returns [\'claude-code\'] by default', () => {
    const names = getProviderNames();
    assert.ok(names.includes('claude-code'), `Expected 'claude-code' in ${JSON.stringify(names)}`);
  });

  it('createProviderByName(\'claude-code\') returns an object with all AIProvider methods', () => {
    const provider = createProviderByName('claude-code');
    assert.equal(typeof provider.initialize, 'function');
    assert.equal(typeof provider.executeCheck, 'function');
    assert.equal(typeof provider.validateConfig, 'function');
  });

  it('createProviderByName(\'unknown-xyz\') throws with message listing known providers', () => {
    assert.throws(
      () => createProviderByName('unknown-xyz'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('Unknown AI provider'), `message: ${err.message}`);
        assert.ok(err.message.includes('claude-code'), `should list claude-code: ${err.message}`);
        return true;
      },
    );
  });

  it('registerProvider adds a new provider that can be created by name', () => {
    // The registry is a module-level singleton. Cross-test contamination is avoided
    // because the Node.js test runner executes each test file in an isolated process,
    // and within this file unique names are used to prevent collisions.
    const testName = 'test-custom-registry-8a3f';
    registerProvider(testName, () => new ClaudeCodeProvider());
    const names = getProviderNames();
    assert.ok(names.includes(testName), `Expected '${testName}' in ${JSON.stringify(names)}`);
  });

  it('registered custom provider can be created and initialized', async () => {
    const testName = 'test-custom-init-9b2e';
    let factoryCalled = false;
    registerProvider(testName, () => {
      factoryCalled = true;
      return new ClaudeCodeProvider();
    });

    const provider = createProviderByName(testName);
    assert.ok(factoryCalled, 'Factory should have been called');
    assert.equal(typeof provider.initialize, 'function');
    assert.equal(typeof provider.executeCheck, 'function');
    assert.equal(typeof provider.validateConfig, 'function');
  });

  it('DEFAULT_PROVIDER_NAME is \'claude-code\'', () => {
    assert.equal(DEFAULT_PROVIDER_NAME, 'claude-code');
  });

  it('error from createProviderByName lists all registered providers', () => {
    const knownNames = getProviderNames();
    assert.throws(
      () => createProviderByName('does-not-exist-7c4d'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        for (const name of knownNames) {
          assert.ok(err.message.includes(name), `Error should list provider "${name}": ${err.message}`);
        }
        return true;
      },
    );
  });
});

// ─── AIProvider interface compliance — ClaudeCodeProvider ─────────────────────

describe('AIProvider interface compliance — ClaudeCodeProvider', () => {
  it('has initialize method', () => {
    const provider = new ClaudeCodeProvider();
    assert.equal(typeof provider.initialize, 'function');
  });

  it('has executeCheck method', () => {
    const provider = new ClaudeCodeProvider();
    assert.equal(typeof provider.executeCheck, 'function');
  });

  it('has validateConfig method', () => {
    const provider = new ClaudeCodeProvider();
    assert.equal(typeof provider.validateConfig, 'function');
  });

  it('has getModelName method', () => {
    const provider = new ClaudeCodeProvider();
    assert.equal(typeof provider.getModelName, 'function');
  });

  it('validateConfig() returns false before initialize (no key or local Claude set)', async () => {
    // Test the default state: apiKey=undefined, useLocalClaude=false
    // Note: initialize() would throw, so we test validateConfig on a fresh instance
    const originalLocalClaude = process.env.AGHAST_LOCAL_CLAUDE;
    delete process.env.AGHAST_LOCAL_CLAUDE;
    try {
      const provider = new ClaudeCodeProvider();
      const result = await provider.validateConfig();
      assert.equal(result, false, 'validateConfig should return false with no key and no local Claude');
    } finally {
      if (originalLocalClaude !== undefined) {
        process.env.AGHAST_LOCAL_CLAUDE = originalLocalClaude;
      }
    }
  });

  it('validateConfig() returns true after initialize with API key', async () => {
    const provider = new ClaudeCodeProvider();
    await provider.initialize({ apiKey: 'test-api-key-12345' });
    const result = await provider.validateConfig();
    assert.equal(result, true);
  });

  it('initialize() stores model correctly (getModelName returns configured model)', async () => {
    const provider = new ClaudeCodeProvider();
    await provider.initialize({ apiKey: 'test-key', model: 'claude-opus-4-6' });
    assert.equal(provider.getModelName(), 'claude-opus-4-6');
  });

  it('initialize() throws when no API key and no local Claude', async () => {
    const originalLocalClaude = process.env.AGHAST_LOCAL_CLAUDE;
    delete process.env.AGHAST_LOCAL_CLAUDE;
    try {
      const provider = new ClaudeCodeProvider();
      await assert.rejects(
        async () => provider.initialize({}),
        /ANTHROPIC_API_KEY/,
      );
    } finally {
      if (originalLocalClaude !== undefined) {
        process.env.AGHAST_LOCAL_CLAUDE = originalLocalClaude;
      }
    }
  });
});

// ─── AIProvider interface compliance — MockAIProvider ─────────────────────────

describe('AIProvider interface compliance — MockAIProvider', () => {
  it('has initialize method', async () => {
    const MockAIProvider = await getMockProvider();
    const provider = new MockAIProvider();
    assert.equal(typeof provider.initialize, 'function');
  });

  it('has executeCheck method', async () => {
    const MockAIProvider = await getMockProvider();
    const provider = new MockAIProvider();
    assert.equal(typeof provider.executeCheck, 'function');
  });

  it('has validateConfig method', async () => {
    const MockAIProvider = await getMockProvider();
    const provider = new MockAIProvider();
    assert.equal(typeof provider.validateConfig, 'function');
  });

  it('validateConfig() returns true by default', async () => {
    const MockAIProvider = await getMockProvider();
    const provider = new MockAIProvider();
    const result = await provider.validateConfig();
    assert.equal(result, true);
  });

  it('validateConfig() returns false when configured with validConfig: false', async () => {
    const MockAIProvider = await getMockProvider();
    const provider = new MockAIProvider({ validConfig: false });
    const result = await provider.validateConfig();
    assert.equal(result, false);
  });

  it('initialize() sets initialized flag', async () => {
    const MockAIProvider = await getMockProvider();
    const provider = new MockAIProvider();
    assert.equal(provider.initialized, false);
    await provider.initialize({});
    assert.equal(provider.initialized, true);
  });

  it('executeCheck() returns default empty issues response', async () => {
    const MockAIProvider = await getMockProvider();
    const provider = new MockAIProvider();
    await provider.initialize({});
    const response = await provider.executeCheck('test prompt', '/tmp');
    assert.ok(response.parsed, 'Should have parsed response');
    assert.deepEqual(response.parsed.issues, []);
  });
});
