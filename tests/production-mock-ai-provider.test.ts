/**
 * Tests for the production mock AI provider (src/mock-ai-provider.ts).
 *
 * This tests the lightweight mock that ships with the package and is used
 * by the CLI when AGHAST_MOCK_AI is set. It must NOT reference tests/mocks/.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockAIProvider } from '../src/mock-ai-provider.js';

describe('Production MockAIProvider', () => {
  it('implements AIProvider interface', () => {
    const provider = new MockAIProvider({ rawResponse: '{}' });
    assert.equal(typeof provider.initialize, 'function');
    assert.equal(typeof provider.executeCheck, 'function');
    assert.equal(typeof provider.validateConfig, 'function');
    assert.equal(typeof provider.enableDebug, 'function');
  });

  it('initialize succeeds without error', async () => {
    const provider = new MockAIProvider({ rawResponse: '{}' });
    await provider.initialize({});
  });

  it('executeCheck returns the configured raw response', async () => {
    const rawResponse = '{"issues": [{"file": "test.ts", "description": "test issue"}]}';
    const provider = new MockAIProvider({ rawResponse });
    const result = await provider.executeCheck('instructions', '/repo');

    assert.equal(result.raw, rawResponse);
    assert.equal(result.parsed, undefined);
  });

  it('executeCheck returns default empty issues response', async () => {
    const provider = new MockAIProvider({ rawResponse: '{"issues": []}' });
    const result = await provider.executeCheck('instructions', '/repo');

    assert.equal(result.raw, '{"issues": []}');
  });

  it('validateConfig always returns true', async () => {
    const provider = new MockAIProvider({ rawResponse: '{}' });
    const valid = await provider.validateConfig();
    assert.equal(valid, true);
  });

  it('enableDebug is a no-op', () => {
    const provider = new MockAIProvider({ rawResponse: '{}' });
    // Should not throw
    provider.enableDebug();
  });

  it('returns same response on multiple calls', async () => {
    const rawResponse = '{"issues": []}';
    const provider = new MockAIProvider({ rawResponse });

    const result1 = await provider.executeCheck('instructions1', '/repo1');
    const result2 = await provider.executeCheck('instructions2', '/repo2');

    assert.equal(result1.raw, rawResponse);
    assert.equal(result2.raw, rawResponse);
  });
});
