/**
 * Lightweight mock agent provider for CLI `AGHAST_MOCK_AI` mode.
 *
 * Returns a fixed raw response without calling any AI API.
 * This is shipped with the package (unlike the full test mock in tests/mocks/).
 */

import type { AgentProvider, AgentResponse, ProviderConfig, TokenUsage } from './types.js';

export class MockAgentProvider implements AgentProvider {
  private rawResponse: string;
  private model: string = 'mock';
  private tokenUsage: TokenUsage | undefined;

  constructor(options: { rawResponse: string; tokenUsage?: TokenUsage }) {
    this.rawResponse = options.rawResponse;
    this.tokenUsage = options.tokenUsage;
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
    const response: AgentResponse = {
      raw: this.rawResponse,
      parsed: undefined,
    };
    if (this.tokenUsage) {
      response.tokenUsage = { ...this.tokenUsage };
    }
    return response;
  }

  async validateConfig(): Promise<boolean> {
    return true;
  }

  getModelName(): string {
    return this.model;
  }

  setModel(model: string): void {
    this.model = model;
  }

}
