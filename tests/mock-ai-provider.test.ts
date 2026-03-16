import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MockAIProvider,
  createPassProvider,
  createFailProvider,
  createMalformedProvider,
  createTimeoutProvider,
  createAuthErrorProvider,
  createDelayedProvider,
} from './mocks/mock-ai-provider.js';

describe('MockAIProvider', () => {
  it('implements AIProvider interface', async () => {
    const provider = new MockAIProvider();
    assert.equal(typeof provider.initialize, 'function');
    assert.equal(typeof provider.executeCheck, 'function');
    assert.equal(typeof provider.validateConfig, 'function');
  });

  it('tracks initialization state', async () => {
    const provider = new MockAIProvider();
    assert.equal(provider.initialized, false);
    await provider.initialize({ apiKey: 'test-key' });
    assert.equal(provider.initialized, true);
  });

  it('records call history', async () => {
    const provider = createPassProvider();
    await provider.executeCheck('test instructions', '/repo');
    await provider.executeCheck('more instructions', '/other-repo');

    assert.equal(provider.callHistory.length, 2);
    assert.equal(provider.callHistory[0].instructions, 'test instructions');
    assert.equal(provider.callHistory[0].repositoryPath, '/repo');
    assert.equal(provider.callHistory[1].repositoryPath, '/other-repo');
  });

  it('resets call history', async () => {
    const provider = createPassProvider();
    await provider.executeCheck('test', '/repo');
    assert.equal(provider.callHistory.length, 1);
    provider.reset();
    assert.equal(provider.callHistory.length, 0);
  });
});

describe('factory: createPassProvider', () => {
  it('returns empty issues', async () => {
    const provider = createPassProvider();
    const result = await provider.executeCheck('instructions', '/repo');
    assert.ok(result.parsed);
    assert.deepEqual(result.parsed.issues, []);
  });
});

describe('factory: createFailProvider', () => {
  it('returns issues', async () => {
    const provider = createFailProvider();
    const result = await provider.executeCheck('instructions', '/repo');
    assert.ok(result.parsed);
    assert.ok(result.parsed.issues.length > 0);
    assert.equal(result.parsed.issues[0].file, 'src/api/users.ts');
  });
});

describe('factory: createMalformedProvider', () => {
  it('returns unparseable raw response', async () => {
    const provider = createMalformedProvider();
    const result = await provider.executeCheck('instructions', '/repo');
    assert.equal(result.parsed, undefined);
    assert.ok(typeof result.raw === 'string');
    assert.throws(() => JSON.parse(result.raw), SyntaxError);
  });
});

describe('factory: createTimeoutProvider', () => {
  it('throws timeout error', async () => {
    const provider = createTimeoutProvider();
    await assert.rejects(
      () => provider.executeCheck('instructions', '/repo'),
      { message: /timed out/ },
    );
  });
});

describe('factory: createAuthErrorProvider', () => {
  it('throws auth error', async () => {
    const provider = createAuthErrorProvider();
    await assert.rejects(
      () => provider.executeCheck('instructions', '/repo'),
      { message: /authentication failed/ },
    );
  });

  it('reports invalid config', async () => {
    const provider = createAuthErrorProvider();
    const valid = await provider.validateConfig();
    assert.equal(valid, false);
  });
});

describe('factory: createDelayedProvider', () => {
  it('delays response', async () => {
    const provider = createDelayedProvider(50);
    const start = Date.now();
    await provider.executeCheck('instructions', '/repo');
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `Expected at least 40ms delay, got ${elapsed}ms`);
  });
});

describe('MockAIProvider.setResponse', () => {
  it('changes response between calls', async () => {
    const provider = createPassProvider();

    const result1 = await provider.executeCheck('instructions', '/repo');
    assert.ok(result1.parsed);
    assert.equal(result1.parsed.issues.length, 0);

    provider.setResponse({
      issues: [
        { file: 'a.ts', startLine: 1, endLine: 2, description: 'issue' },
      ],
    });

    const result2 = await provider.executeCheck('instructions', '/repo');
    assert.ok(result2.parsed);
    assert.equal(result2.parsed.issues.length, 1);
  });
});

describe('MockAIProvider.setRawResponse', () => {
  it('switches to raw mode', async () => {
    const provider = createPassProvider();
    provider.setRawResponse('garbage');
    const result = await provider.executeCheck('instructions', '/repo');
    assert.equal(result.raw, 'garbage');
    assert.equal(result.parsed, undefined);
  });
});

describe('MockAIProvider.setError', () => {
  it('switches to error mode', async () => {
    const provider = createPassProvider();
    provider.setError(new Error('boom'));
    await assert.rejects(
      () => provider.executeCheck('instructions', '/repo'),
      { message: 'boom' },
    );
  });
});
