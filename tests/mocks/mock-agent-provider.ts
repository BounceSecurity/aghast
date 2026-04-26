/**
 * Mock Agent Provider for testing.
 *
 * Implements the AgentProvider interface with configurable responses
 * for use in unit and integration tests. Never calls a real AI API.
 */

import type {
  AgentProvider,
  AgentResponse,
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
  /** Token usage to include in AgentResponse. */
  tokenUsage?: TokenUsage;
}

export class MockAgentProvider implements AgentProvider {
  public callHistory: Array<{
    instructions: string;
    repositoryPath: string;
    options?: { maxTurns?: number };
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
    options?: { maxTurns?: number },
  ): Promise<AgentResponse> {
    this.callHistory.push({ instructions, repositoryPath, options });

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
export function createPassProvider(): MockAgentProvider {
  return new MockAgentProvider({
    response: { issues: [] },
  });
}

/** Provider that returns FAIL with predefined issues. */
export function createFailProvider(): MockAgentProvider {
  return new MockAgentProvider({
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
export function createMalformedProvider(): MockAgentProvider {
  return new MockAgentProvider({
    rawResponse: 'This is not valid JSON. The code looks fine to me.',
  });
}

/** Provider that throws a timeout error. */
export function createTimeoutProvider(): MockAgentProvider {
  return new MockAgentProvider({
    error: new Error('Agent provider request timed out after 60000ms'),
  });
}

/** Provider that throws an authentication error. */
export function createAuthErrorProvider(): MockAgentProvider {
  return new MockAgentProvider({
    error: new Error('Invalid API key: authentication failed'),
    validConfig: false,
  });
}

/** Provider with configurable delay (for concurrency testing). */
export function createDelayedProvider(delayMs: number): MockAgentProvider {
  return new MockAgentProvider({
    response: { issues: [] },
    delay: delayMs,
  });
}

/** Provider that always returns PASS with token usage. */
export function createPassProviderWithTokens(tokenUsage?: TokenUsage): MockAgentProvider {
  return new MockAgentProvider({
    response: { issues: [] },
    tokenUsage: tokenUsage ?? { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  });
}

/** Provider that throws a FatalProviderError (unrecoverable, aborts scan). */
export function createFatalErrorProvider(message?: string): MockAgentProvider {
  return new MockAgentProvider({
    error: new FatalProviderError(message ?? 'Agent provider authentication failed (401)'),
  });
}
