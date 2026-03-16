/**
 * Mock AI Provider for testing.
 *
 * Implements the AIProvider interface with configurable responses
 * for use in unit and integration tests. Never calls a real AI API.
 */

import type {
  AIProvider,
  AIResponse,
  CheckResponse,
  ProviderConfig,
  TokenUsage,
} from '../../src/types.js';
import { FatalProviderError } from '../../src/types.js';

export interface MockProviderOptions {
  /** Predefined response to return from executeCheck. */
  response?: CheckResponse;
  /** Raw string to return (overrides response if set). */
  rawResponse?: string;
  /** If set, executeCheck will reject with this error. */
  error?: Error;
  /** Delay in ms before returning response (simulates latency). */
  delay?: number;
  /** Whether validateConfig should return true. */
  validConfig?: boolean;
  /** Token usage to include in AIResponse. */
  tokenUsage?: TokenUsage;
}

export class MockAIProvider implements AIProvider {
  public callHistory: Array<{
    instructions: string;
    repositoryPath: string;
  }> = [];

  public initialized = false;

  private options: MockProviderOptions;
  private responseQueue: CheckResponse[] = [];

  constructor(options: MockProviderOptions = {}) {
    this.options = {
      response: { issues: [] },
      validConfig: true,
      delay: 0,
      ...options,
    };
  }

  async initialize(_config: ProviderConfig): Promise<void> {
    this.initialized = true;
  }

  async executeCheck(
    instructions: string,
    repositoryPath: string,
    _logPrefix?: string,
  ): Promise<AIResponse> {
    this.callHistory.push({ instructions, repositoryPath });

    if (this.options.delay && this.options.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delay));
    }

    if (this.options.error) {
      throw this.options.error;
    }

    // If response queue has entries, use the next one
    if (this.responseQueue.length > 0) {
      const response = this.responseQueue.shift()!;
      const raw = JSON.stringify(response);
      return { raw, parsed: response, tokenUsage: this.options.tokenUsage };
    }

    if (this.options.rawResponse !== undefined) {
      return {
        raw: this.options.rawResponse,
        parsed: undefined,
        tokenUsage: this.options.tokenUsage,
      };
    }

    const raw = JSON.stringify(this.options.response);
    return {
      raw,
      parsed: this.options.response,
      tokenUsage: this.options.tokenUsage,
    };
  }

  async validateConfig(): Promise<boolean> {
    return this.options.validConfig ?? true;
  }

  enableDebug(): void {
    // No-op for mock provider
  }

  /** Update response configuration between calls. */
  setResponse(response: CheckResponse): void {
    this.options.response = response;
    this.options.rawResponse = undefined;
    this.options.error = undefined;
  }

  /** Configure to return a raw (unparseable) response. */
  setRawResponse(raw: string): void {
    this.options.rawResponse = raw;
    this.options.error = undefined;
  }

  /** Configure to throw an error on next executeCheck call. */
  setError(error: Error): void {
    this.options.error = error;
  }

  /** Set a queue of responses for successive calls. */
  setResponseQueue(responses: CheckResponse[]): void {
    this.responseQueue = [...responses];
  }

  /** Reset call history and response queue. */
  reset(): void {
    this.callHistory = [];
    this.responseQueue = [];
  }
}

// --- Pre-configured factory functions ---

/** Provider that always returns PASS (no issues). */
export function createPassProvider(): MockAIProvider {
  return new MockAIProvider({
    response: { issues: [] },
  });
}

/** Provider that returns FAIL with predefined issues. */
export function createFailProvider(): MockAIProvider {
  return new MockAIProvider({
    response: {
      issues: [
        {
          file: 'src/api/users.ts',
          startLine: 45,
          endLine: 52,
          description: 'Missing authorization check on DELETE endpoint.',
        },
      ],
    },
  });
}

/** Provider that returns malformed (non-JSON) response. */
export function createMalformedProvider(): MockAIProvider {
  return new MockAIProvider({
    rawResponse: 'This is not valid JSON. The code looks fine to me.',
  });
}

/** Provider that throws a timeout error. */
export function createTimeoutProvider(): MockAIProvider {
  return new MockAIProvider({
    error: new Error('AI provider request timed out after 60000ms'),
  });
}

/** Provider that throws an authentication error. */
export function createAuthErrorProvider(): MockAIProvider {
  return new MockAIProvider({
    error: new Error('Invalid API key: authentication failed'),
    validConfig: false,
  });
}

/** Provider with configurable delay (for concurrency testing). */
export function createDelayedProvider(delayMs: number): MockAIProvider {
  return new MockAIProvider({
    response: { issues: [] },
    delay: delayMs,
  });
}

/** Provider that always returns PASS with token usage. */
export function createPassProviderWithTokens(tokenUsage?: TokenUsage): MockAIProvider {
  return new MockAIProvider({
    response: { issues: [] },
    tokenUsage: tokenUsage ?? { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  });
}

/** Provider that throws a FatalProviderError (unrecoverable, aborts scan). */
export function createFatalErrorProvider(message?: string): MockAIProvider {
  return new MockAIProvider({
    error: new FatalProviderError(message ?? 'AI provider authentication failed (401)'),
  });
}
