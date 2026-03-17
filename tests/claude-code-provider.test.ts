import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeCodeProvider, type QueryFn } from '../src/claude-code-provider.js';
import { FatalProviderError } from '../src/types.js';

/**
 * Build a fake SDK query function that yields the given messages as an async iterable.
 */
function createFakeQueryFn(messages: Record<string, unknown>[]): QueryFn {
  return function* fakeQuery() {
    yield* messages;
  } as unknown as QueryFn;
}

/** Helper: build an assistant message with text content (mimics SDK format). */
function assistantMsg(text: string): Record<string, unknown> {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text }],
    },
  };
}

/** Helper: build a successful result message with structured output. */
function successResult(): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    result: '{"issues":[]}',
    structured_output: { issues: [] },
  };
}

describe('ClaudeCodeProvider: API error handling', () => {
  it('throws after 3 consecutive API error turns', async () => {
    const errorText =
      'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"workspace limits reached"}}';

    const messages = [
      assistantMsg(errorText),
      assistantMsg(errorText),
      assistantMsg(errorText),
      // Should never reach these
      assistantMsg(errorText),
      successResult(),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    await assert.rejects(
      () => provider.executeCheck('test prompt', '/tmp/repo'),
      (err: Error) => {
        assert.match(err.message, /AI provider API error \(after 3 attempts\)/);
        assert.match(err.message, /workspace limits reached/);
        return true;
      },
    );
  });

  it('resets error counter on successful turn and completes normally', async () => {
    const errorText = 'API Error: 500 internal server error';

    const messages = [
      assistantMsg(errorText), // error 1
      assistantMsg(errorText), // error 2
      assistantMsg('Analyzing the codebase...'), // success — resets counter
      assistantMsg(errorText), // error 1 again (counter reset)
      successResult(),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    const result = await provider.executeCheck('test prompt', '/tmp/repo');
    assert.deepStrictEqual(result.parsed, { issues: [] });
  });

  it('throws after exactly 3 consecutive non-auth API error turns', async () => {
    const errorText = 'API Error: 500 internal server error';

    // Only 3 error messages — should throw on the 3rd
    const messages = [
      assistantMsg(errorText),
      assistantMsg(errorText),
      assistantMsg(errorText),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    await assert.rejects(
      () => provider.executeCheck('test prompt', '/tmp/repo'),
      (err: Error) => {
        assert.match(err.message, /AI provider API error/);
        assert.match(err.message, /500 internal server error/);
        return true;
      },
    );
  });

  it('throws FatalProviderError immediately on rate limit message', async () => {
    const messages = [
      assistantMsg("You've hit your limit · resets 10pm (Asia/Jerusalem)"),
      // Should never reach these
      assistantMsg('Analyzing the codebase...'),
      successResult(),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    await assert.rejects(
      () => provider.executeCheck('test prompt', '/tmp/repo'),
      (err: Error) => {
        assert.ok(err instanceof FatalProviderError, 'Should be FatalProviderError');
        assert.match(err.message, /rate limit reached/i);
        assert.match(err.message, /hit your limit/i);
        return true;
      },
    );
  });

  it('throws FatalProviderError on rate limit message (case-insensitive)', async () => {
    const messages = [
      assistantMsg('Rate limit exceeded, please try again later'),
      successResult(),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    await assert.rejects(
      () => provider.executeCheck('test prompt', '/tmp/repo'),
      (err: Error) => {
        assert.ok(err instanceof FatalProviderError, 'Should be FatalProviderError');
        assert.match(err.message, /rate limit reached/i);
        return true;
      },
    );
  });

  it('does not treat non-API-error text as an error', async () => {
    const messages = [
      assistantMsg('Looking at the code...'),
      assistantMsg('Found some potential issues'),
      successResult(),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    const result = await provider.executeCheck('test prompt', '/tmp/repo');
    assert.deepStrictEqual(result.parsed, { issues: [] });
  });
});

// --- Token usage extraction ---

/** Helper: build a successful result message with modelUsage (camelCase, per-model). */
function successResultWithModelUsage(
  inputTokens: number,
  outputTokens: number,
  model = 'claude-sonnet-4-20250514',
): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    result: '{"issues":[]}',
    structured_output: { issues: [] },
    usage: { input_tokens: 0, output_tokens: 0 },
    modelUsage: {
      [model]: { inputTokens, outputTokens },
    },
  };
}

/** Helper: build a successful result message with only usage (snake_case, raw API). */
function successResultWithUsageOnly(
  input_tokens: number,
  output_tokens: number,
): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    result: '{"issues":[]}',
    structured_output: { issues: [] },
    usage: { input_tokens, output_tokens },
  };
}

describe('ClaudeCodeProvider: token usage extraction', () => {
  it('extracts token usage from modelUsage (preferred, camelCase)', async () => {
    const messages = [
      assistantMsg('Analyzing...'),
      successResultWithModelUsage(500, 200),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    const result = await provider.executeCheck('test prompt', '/tmp/repo');
    assert.ok(result.tokenUsage, 'Should have tokenUsage');
    assert.equal(result.tokenUsage!.inputTokens, 500);
    assert.equal(result.tokenUsage!.outputTokens, 200);
    assert.equal(result.tokenUsage!.totalTokens, 700);
  });

  it('sums token usage across multiple models in modelUsage', async () => {
    const messages = [
      assistantMsg('Analyzing...'),
      {
        type: 'result',
        subtype: 'success',
        result: '{"issues":[]}',
        structured_output: { issues: [] },
        usage: { input_tokens: 0, output_tokens: 0 },
        modelUsage: {
          'claude-sonnet-4-20250514': { inputTokens: 300, outputTokens: 100 },
          'claude-haiku-3-20240307': { inputTokens: 200, outputTokens: 50 },
        },
      },
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    const result = await provider.executeCheck('test prompt', '/tmp/repo');
    assert.ok(result.tokenUsage, 'Should have tokenUsage');
    assert.equal(result.tokenUsage!.inputTokens, 500);
    assert.equal(result.tokenUsage!.outputTokens, 150);
    assert.equal(result.tokenUsage!.totalTokens, 650);
  });

  it('falls back to usage (snake_case) when modelUsage is absent', async () => {
    const messages = [
      assistantMsg('Analyzing...'),
      successResultWithUsageOnly(500, 200),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    const result = await provider.executeCheck('test prompt', '/tmp/repo');
    assert.ok(result.tokenUsage, 'Should have tokenUsage');
    assert.equal(result.tokenUsage!.inputTokens, 500);
    assert.equal(result.tokenUsage!.outputTokens, 200);
    assert.equal(result.tokenUsage!.totalTokens, 700);
  });

  it('tokenUsage is undefined when SDK result has no usage field', async () => {
    const messages = [
      assistantMsg('Analyzing...'),
      successResult(), // no usage field
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    const result = await provider.executeCheck('test prompt', '/tmp/repo');
    assert.equal(result.tokenUsage, undefined, 'Should not have tokenUsage');
  });
});

describe('ClaudeCodeProvider: fatal error handling (401 auth)', () => {
  it('throws FatalProviderError immediately on 401 auth error', async () => {
    const errorText = 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';

    const messages = [
      assistantMsg(errorText),
      // Should never reach these
      assistantMsg(errorText),
      successResult(),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    await assert.rejects(
      () => provider.executeCheck('test prompt', '/tmp/repo'),
      (err: Error) => {
        assert.ok(err instanceof FatalProviderError, 'Should be FatalProviderError');
        assert.match(err.message, /authentication failed.*401/i);
        return true;
      },
    );
  });

  it('throws FatalProviderError on 401 even with prefix text (realistic SDK format)', async () => {
    const errorText =
      'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired. Please obtain a new token or refresh your existing token."}}';

    const messages = [
      assistantMsg(errorText),
      // Should never reach these
      assistantMsg(errorText),
      successResult(),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    await assert.rejects(
      () => provider.executeCheck('test prompt', '/tmp/repo'),
      (err: Error) => {
        assert.ok(err instanceof FatalProviderError, 'Should be FatalProviderError');
        assert.match(err.message, /authentication failed.*401/i);
        assert.match(err.message, /OAuth token has expired/);
        return true;
      },
    );
  });

  it('non-401 API errors with prefix text are detected via includes', async () => {
    const errorText = 'Something went wrong. API Error: 500 internal server error';

    const messages = [
      assistantMsg(errorText),
      assistantMsg(errorText),
      assistantMsg(errorText),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    await assert.rejects(
      () => provider.executeCheck('test prompt', '/tmp/repo'),
      (err: Error) => {
        // Should be a regular Error (not FatalProviderError) since it's not a 401
        assert.ok(!(err instanceof FatalProviderError), 'Should NOT be FatalProviderError for 500');
        assert.match(err.message, /AI provider API error \(after 3 attempts\)/);
        assert.match(err.message, /500 internal server error/);
        return true;
      },
    );
  });
});

describe('ClaudeCodeProvider: fatal error handling (not logged in)', () => {
  it('throws FatalProviderError immediately on "Not logged in" message', async () => {
    const messages = [
      assistantMsg('Not logged in · Please run /login'),
      // Should never reach these
      assistantMsg('This should not be reached'),
      successResult(),
    ];

    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn(messages) });
    await provider.initialize({ apiKey: 'test-key' });

    await assert.rejects(
      () => provider.executeCheck('test prompt', '/tmp/repo'),
      (err: Error) => {
        assert.ok(err instanceof FatalProviderError, 'Should be FatalProviderError');
        assert.match(err.message, /not logged in/i);
        return true;
      },
    );
  });
});

describe('ClaudeCodeProvider: enableDebug', () => {
  it('enableDebug method exists and does not throw', async () => {
    const provider = new ClaudeCodeProvider({ _queryFn: createFakeQueryFn([successResult()]) });
    await provider.initialize({ apiKey: 'test-key' });

    assert.equal(typeof provider.enableDebug, 'function');
    assert.doesNotThrow(() => provider.enableDebug());
  });
});
