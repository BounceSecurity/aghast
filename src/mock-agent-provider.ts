/**
 * Lightweight mock agent provider for CLI `AGHAST_MOCK_AI` mode.
 *
 * Returns a fixed raw response without calling any AI API.
 * This is shipped with the package (unlike the full test mock in tests/mocks/).
 */

import type { AgentProvider, AgentResponse, ProviderConfig } from './types.js';

export class MockAgentProvider implements AgentProvider {
  private rawResponse: string;

  constructor(options: { rawResponse: string }) {
    this.rawResponse = options.rawResponse;
  }

  async initialize(_config: ProviderConfig): Promise<void> {
    // No-op
  }

  async executeCheck(
    _instructions: string,
    _repositoryPath: string,
    _logPrefix?: string,
    _options?: { maxTurns?: number },
  ): Promise<AgentResponse> {
    return {
      raw: this.rawResponse,
      parsed: undefined,
    };
  }

  async validateConfig(): Promise<boolean> {
    return true;
  }

  setModel(_model: string): void {
    // No-op for mock provider
  }

  enableDebug(): void {
    // No-op
  }
}
