/**
 * Claude Code AI provider implementation.
 * Uses @anthropic-ai/claude-agent-sdk per spec Section 6.2 / Appendix C.8.
 */

import type { AIProvider, AIResponse, ProviderConfig, CheckResponse, TokenUsage } from './types.js';
import { DEFAULT_AI_MODEL, FatalProviderError } from './types.js';
// import { parseAIResponse } from './response-parser.js';
import { logProgress, logDebug, logDebugFull, createTimer } from './logging.js';

const TAG = 'ai-provider';
const HEARTBEAT_INTERVAL_MS = 15000; // Log heartbeat every 15s if no activity
const MAX_API_ERROR_RETRIES = 3; // Fail after this many consecutive API errors

/** Type for the SDK query function — injectable for testing. */
export type QueryFn = (params: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<Record<string, unknown>>;

// JSON schema for structured output (matches spec Section 4.4)
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          description: { type: 'string' },
          dataFlow: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                lineNumber: { type: 'integer' },
                label: { type: 'string' },
              },
              required: ['file', 'lineNumber', 'label'],
              additionalProperties: false,
            },
          },
        },
        required: ['file', 'startLine', 'endLine', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['issues'],
  additionalProperties: false,
} as const;

export class ClaudeCodeProvider implements AIProvider {
  private apiKey: string | undefined;
  private useLocalClaude: boolean = false;
  private model: string = DEFAULT_AI_MODEL;
  private _queryFn: QueryFn | undefined;
  private debugEnabled: boolean = false;

  constructor(options?: { _queryFn?: QueryFn }) {
    this._queryFn = options?._queryFn;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.useLocalClaude = process.env.AGHAST_LOCAL_CLAUDE === 'true';
    this.apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    // Model selection priority: config.model (from AGHAST_AI_MODEL env or runtime config) > DEFAULT_AI_MODEL
    if (config.model) {
      this.model = config.model;
    }
    if (!this.apiKey && !this.useLocalClaude) {
      throw new Error('ANTHROPIC_API_KEY is required');
    }
    if (this.useLocalClaude) {
      logProgress(TAG, 'Using local Claude Code session for authentication');
    } else {
      logDebug(TAG, 'Using API key for authentication');
    }
    logDebug(TAG, `Provider initialized with model ${this.model}`);
  }

  getModelName(): string {
    return this.model;
  }

  enableDebug(): void {
    this.debugEnabled = true;
  }

  async executeCheck(
    instructions: string,
    repositoryPath: string,
    logPrefix?: string,
  ): Promise<AIResponse> {
    const queryFn = this._queryFn ?? (await import('@anthropic-ai/claude-agent-sdk')).query;
    const timer = createTimer();
    const prefix = logPrefix ? `${logPrefix} ` : '';

    const prompt = instructions;

    logDebug(TAG, `${prefix}Starting query: model=${this.model}, cwd=${repositoryPath}, promptLen=${prompt.length}`);
    if (this.debugEnabled) {
      logDebugFull(TAG, `${prefix}Full prompt sent to AI`, prompt);
    }

    const conversation = queryFn({
      prompt,
      options: {
        model: this.model,
        cwd: repositoryPath,
        allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch'],
        maxTurns: 100,
        permissionMode: 'bypassPermissions',
        outputFormat: {
          type: 'json_schema',
          schema: OUTPUT_SCHEMA,
        },
      },
    });

    // Consume all messages from the async generator to get the result
    let resultText = '';
    let structuredOutput: CheckResponse | undefined;
    let errorMessage: string | undefined;
    let turnCount = 0;
    let toolCallCount = 0;
    let tokenUsage: TokenUsage | undefined;

    let consecutiveApiErrors = 0;
    let currentToolName: string | undefined;
    let lastActivityTime = Date.now();

    // Background heartbeat timer - logs if no activity for a while
    const heartbeatInterval = setInterval(() => {
      const silentSeconds = Math.round((Date.now() - lastActivityTime) / 1000);
      if (silentSeconds >= HEARTBEAT_INTERVAL_MS / 1000) {
        const status = currentToolName ? `running ${currentToolName}` : 'waiting';
        logProgress(TAG, `${prefix}Still ${status}... (${timer.elapsedStr()})`);
      }
    }, HEARTBEAT_INTERVAL_MS);

    try {
      for await (const message of conversation) {
        lastActivityTime = Date.now();
      // Tool progress events - emitted during long-running tool executions
      if (message.type === 'tool_progress') {
        const progress = message as { tool_name: string; elapsed_time_seconds: number };
        currentToolName = progress.tool_name;
        logProgress(TAG, `${prefix}Running ${progress.tool_name}... (${Math.round(progress.elapsed_time_seconds)}s)`);
      }

      if (message.type === 'assistant') {
        turnCount++;
        currentToolName = undefined;
        // Simple activity indicator at info level
        logProgress(TAG, `${prefix}Turn ${turnCount} (${timer.elapsedStr()})`);

        const content = (message as any).message?.content;
        if (Array.isArray(content)) {
          // Count and log tool calls at debug level (compact)
          for (const block of content) {
            if (block?.type === 'tool_use') {
              toolCallCount++;
              currentToolName = block.name;
              const inputStr = JSON.stringify(block.input);
              const inputPreview = inputStr.length > 100 ? inputStr.slice(0, 100) + '...' : inputStr;
              logDebug(TAG, `${prefix}Tool[${toolCallCount}]: ${block.name} ${inputPreview}`);
            }
          }

          // Log assistant text at debug level
          const textChunks = content
            .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
            .map((c: any) => c.text.trim())
            .filter(Boolean);
          if (textChunks.length > 0) {
            logDebug(TAG, `${prefix}Assistant: ${textChunks.join(' | ')}`);

            // Detect rate-limit messages — fail immediately since retrying won't help
            const rateLimitMatch = textChunks.find((t: string) =>
              /you've hit your limit|rate limit/i.test(t),
            );
            if (rateLimitMatch) {
              throw new FatalProviderError(`AI provider rate limit reached: ${rateLimitMatch}`);
            }

            // Detect authentication errors (401) — fail immediately, unrecoverable
            const authErrorMatch = textChunks.find((t: string) =>
              /API Error:\s*401/i.test(t),
            );
            if (authErrorMatch) {
              throw new FatalProviderError(`AI provider authentication failed (401): ${authErrorMatch}`);
            }

            // Detect API errors surfaced as assistant text by the SDK
            const apiErrorMatch = textChunks.find((t: string) => t.includes('API Error:'));
            if (apiErrorMatch) {
              consecutiveApiErrors++;
              if (consecutiveApiErrors >= MAX_API_ERROR_RETRIES) {
                throw new Error(`AI provider API error (after ${MAX_API_ERROR_RETRIES} attempts): ${apiErrorMatch}`);
              }
            } else {
              consecutiveApiErrors = 0;
            }
          }
        }
      }

      if (message.type === 'result') {
        if (message.subtype === 'success') {
          resultText = message.result as string;
          // Extract structured output if available
          const resultMsg = message as {
            result: string;
            structured_output?: CheckResponse;
            usage?: { input_tokens: number; output_tokens: number };
            modelUsage?: Record<string, { inputTokens: number; outputTokens: number }>;
          };
          if (resultMsg.structured_output) {
            structuredOutput = resultMsg.structured_output;
            logDebug(TAG, `${prefix}Structured output: ${structuredOutput.issues.length} issues`);
          }
          // Extract token usage if available.
          // Prefer modelUsage (camelCase, per-model breakdown) over usage (snake_case, raw API).
          if (resultMsg.modelUsage && Object.keys(resultMsg.modelUsage).length > 0) {
            let inputTokens = 0;
            let outputTokens = 0;
            for (const model of Object.values(resultMsg.modelUsage)) {
              inputTokens += model.inputTokens;
              outputTokens += model.outputTokens;
            }
            tokenUsage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
            logDebug(TAG, `${prefix}Token usage: ${tokenUsage.inputTokens} in, ${tokenUsage.outputTokens} out, ${tokenUsage.totalTokens} total`);
          } else if (resultMsg.usage) {
            tokenUsage = {
              inputTokens: resultMsg.usage.input_tokens,
              outputTokens: resultMsg.usage.output_tokens,
              totalTokens: resultMsg.usage.input_tokens + resultMsg.usage.output_tokens,
            };
            logDebug(TAG, `${prefix}Token usage: ${tokenUsage.inputTokens} in, ${tokenUsage.outputTokens} out, ${tokenUsage.totalTokens} total`);
          }
          logProgress(TAG, `${prefix}Completed in ${timer.elapsedStr()} (${turnCount} turns, ${toolCallCount} tool calls)`);
        } else {
          const errorResult = message as { subtype: string; errors?: string[] };
          errorMessage = errorResult.errors?.join('; ') ?? `AI provider error: ${errorResult.subtype}`;
          logProgress(TAG, `${prefix}Failed: ${errorResult.subtype} (${timer.elapsedStr()})`);
        }
      }
    }
    } finally {
      clearInterval(heartbeatInterval);
    }

    if (errorMessage) {
      logDebug(TAG, `${prefix}Error: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    if (!resultText && !structuredOutput && !errorMessage) {
      throw new Error('AI provider returned no result');
    }

    logDebug(TAG, `${prefix}Result: ${resultText.length} chars`);
    if (this.debugEnabled) {
      logDebugFull(TAG, `${prefix}Full AI response`, resultText);
    }

    // Structured output from SDK is required - we enforce JSON schema output mode.
    // The response parser (parseAIResponse) is kept in the codebase as a potential
    // fallback for future use cases (e.g., alternative AI providers that don't support
    // structured output), but this provider always requires structured output.
    if (structuredOutput) {
      return { raw: resultText, parsed: structuredOutput, tokenUsage };
    }

    // No fallback parsing - structured output is mandatory for this provider.
    // If needed in the future, uncomment:
    // const parsed = parseAIResponse(resultText);
    // return { raw: resultText, parsed: parsed ?? undefined };
    throw new Error('AI provider did not return structured output');
  }

  async validateConfig(): Promise<boolean> {
    return !!this.apiKey || this.useLocalClaude;
  }
}
