/**
 * Tests for the production mock agent provider (src/mock-agent-provider.ts).
 *
 * This tests the lightweight mock that ships with the package and is used
 * by the CLI when AGHAST_MOCK_AI is set. It must NOT reference tests/mocks/.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgentProvider } from '../src/mock-agent-provider.js';

describe('Production MockAgentProvider', () => {
  it('implements AgentProvider interface', () => {
    const provider = new MockAgentProvider({ rawResponse: '{}' });
    assert.equal(typeof provider.initialize, 'function');
    assert.equal(typeof provider.executeCheck, 'function');
    assert.equal(typeof provider.validateConfig, 'function');

  });

  it('initialize succeeds without error', async () => {
    const provider = new MockAgentProvider({ rawResponse: '{}' });
    await provider.initialize({});
  });

  it('executeCheck returns the configured raw response', async () => {
    const rawResponse = '{"issues": [{"file": "test.ts", "description": "test issue"}]}';
    const provider = new MockAgentProvider({ rawResponse });
    const result = await provider.executeCheck('instructions', '/repo');

    assert.equal(result.raw, rawResponse);
    assert.equal(result.parsed, undefined);
  });

  it('executeCheck returns default empty issues response', async () => {
    const provider = new MockAgentProvider({ rawResponse: '{"issues": []}' });
    const result = await provider.executeCheck('instructions', '/repo');

    assert.equal(result.raw, '{"issues": []}');
  });

  it('validateConfig always returns true', async () => {
    const provider = new MockAgentProvider({ rawResponse: '{}' });
    const valid = await provider.validateConfig();
    assert.equal(valid, true);
  });

  it('returns same response on multiple calls', async () => {
    const rawResponse = '{"issues": []}';
    const provider = new MockAgentProvider({ rawResponse });

    const result1 = await provider.executeCheck('instructions1', '/repo1');
    const result2 = await provider.executeCheck('instructions2', '/repo2');

    assert.equal(result1.raw, rawResponse);
    assert.equal(result2.raw, rawResponse);
  });
});
