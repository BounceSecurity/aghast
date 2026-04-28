/**
 * OpenCode agent provider implementation.
 * Uses @opencode-ai/sdk v2 API to delegate to any LLM provider supported by OpenCode.
 *
 * Progress logging: at trace level, a 1-second poller fetches session messages to
 * log tool calls and text parts in real-time while session.prompt() blocks.
 */

import { exec } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { rm as rmAsync } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentProvider, AgentResponse, ProviderConfig, CheckResponse, ProviderModelInfo, TokenUsage } from './types.js';
import { FatalProviderError } from './types.js';
import { parseAgentResponse } from './response-parser.js';
import { OUTPUT_SCHEMA } from './provider-utils.js';
import { logProgress, logDebug, logDebugFull, createTimer, getLogLevel } from './logging.js';

const execAsync = promisify(exec);

const TAG = 'opencode-provider';
const DEFAULT_OPENCODE_MODEL = 'opencode/minimax-m2.5-free';
const HEARTBEAT_INTERVAL_MS = 15000;
const TRACE_POLL_MS = 1000;
const CLOSE_TIMEOUT_MS = 5000;

/**
 * Parse a "providerID/modelID" string into its components.
 * Falls back to the default if not provided.
 */
function parseModelString(model?: string): { providerID: string; modelID: string } {
  const raw = model ?? DEFAULT_OPENCODE_MODEL;
  const slashIdx = raw.indexOf('/');
  if (slashIdx === -1) {
    throw new Error(
      `Invalid model format "${raw}" for opencode provider. Expected "providerID/modelID" (e.g. "anthropic/claude-sonnet-4-20250514").`,
    );
  }
  return { providerID: raw.slice(0, slashIdx), modelID: raw.slice(slashIdx + 1) };
}

/** Verify that the opencode binary is installed and runnable. */
function verifyOpenCodeInstalled(): Promise<void> {
  // Use `exec` (single command string, always uses shell) instead of `execFile` with
  // shell:true + args array. The latter triggers DEP0190 on Node 22+; the former does not.
  // Shell is required on Windows to invoke opencode's .cmd wrapper — spawning .cmd
  // directly is blocked by the CVE-2024-27980 mitigation. No user input is interpolated
  // into the command, so there is no injection surface.
  return new Promise((resolve, reject) => {
    exec('opencode --version', (error, stdout, stderr) => {
      if (error) {
        // `exec` routes both "spawn failed" (binary not on PATH) and "ran but exited
        // non-zero" (e.g. corrupt config, permission issue) through the same error
        // callback. We can't tell the two apart reliably cross-platform, so the
        // message has to cover both possibilities — otherwise a user with a broken
        // install is sent on a wild goose chase reinstalling an already-present binary.
        const detail = (stderr || stdout || error.message).toString().trim();
        const suffix = detail ? ` Details: ${detail}` : '';
        reject(new Error(
          `OpenCode is required for the 'opencode' agent provider but \`opencode --version\` failed. ` +
          `Either OpenCode is not installed (get it from https://opencode.ai) or the installed binary returned an error.${suffix}`,
        ));
        return;
      }
      resolve();
    });
  });
}

// SDK client type alias
type OpenCodeClient = InstanceType<(typeof import('@opencode-ai/sdk/v2'))['OpencodeClient']>;

/** Options for constructor dependency injection (testing). */
export interface OpenCodeProviderOptions {
  /** Inject a mock client for testing. Skips server startup. */
  _client?: OpenCodeClient;
}

export class OpenCodeProvider implements AgentProvider {
  private providerID: string = '';
  private modelID: string = '';
  private _client: OpenCodeClient | undefined;
  private _server: { url: string; close(): void } | undefined;
  private debugEnabled: boolean = false;
  private cleanedUp: boolean = false;
  private signalHandler: (() => void) | undefined;
  /** Refcount of project markers we created, keyed by absolute repositoryPath.
   *  An entry exists ONLY when we created the marker — we never track pre-existing `.git`. */
  private createdMarkers = new Map<string, number>();
  /** FIFO async mutex serializing mutations to createdMarkers. Guards against races
   *  between the N parallel executeCheck calls that share one repositoryPath. */
  private markerMutex: Promise<void> = Promise.resolve();
  /** Skip project-marker logic when a mock client was injected (tests use fake paths). */
  private skipProjectMarker: boolean;

  constructor(options?: OpenCodeProviderOptions) {
    if (options?._client) {
      this._client = options._client;
    }
    this.skipProjectMarker = !!options?._client;
  }

  checkPrerequisites(): void {
    // OpenCode manages its own credentials — no env var prerequisites to check.
  }

  async initialize(config: ProviderConfig): Promise<void> {
    const parsed = parseModelString(config.model);
    this.providerID = parsed.providerID;
    this.modelID = parsed.modelID;

    // Skip server startup if a mock client was injected via constructor
    if (this._client) {
      logDebug(TAG, 'Using injected client (test mode)');
      await this.validateModel();
      logDebug(TAG, `Provider initialized with model ${this.providerID}/${this.modelID}`);
      return;
    }

    // Verify opencode binary is installed
    await verifyOpenCodeInstalled();

    const { createOpencode } = await import('@opencode-ai/sdk/v2');

    logProgress(TAG, 'Starting OpenCode server...');
    const opencode = await createOpencode({
      port: 0,
    });
    this._client = opencode.client as OpenCodeClient;
    this._server = opencode.server;
    logProgress(TAG, `OpenCode server started at ${this._server!.url}`);

    // Register signal handlers for cleanup on unexpected exit.
    // SIGHUP catches terminal-window-close (sent as SIGHUP on Unix; Node maps
    // Windows CTRL_CLOSE_EVENT to the same event) — critical for cleaning up the
    // transient .git marker when a user closes their terminal mid-scan.
    this.signalHandler = () => {
      this.cleanupSync();
      process.exit(1);
    };
    process.on('SIGINT', this.signalHandler);
    process.on('SIGTERM', this.signalHandler);
    process.on('SIGHUP', this.signalHandler);
    if (process.platform === 'win32') {
      process.on('SIGBREAK', this.signalHandler);
    }

    try {
      await this.validateModel();
    } catch (err) {
      this.cleanupSync();
      throw err;
    }
    logDebug(TAG, `Provider initialized with model ${this.providerID}/${this.modelID}`);
  }

  private async validateModel(): Promise<void> {
    type ProviderInfo = { id: string; name: string; models?: Record<string, { name?: string }> };

    const client = this._client!;
    const result = await client.config.providers();
    const data = result.data as { providers?: ProviderInfo[] } | undefined;
    const providers = data?.providers ?? [];

    const provider = providers.find(p => p.id === this.providerID);
    if (!provider) {
      const available = providers.map(p => p.id).join(', ') || '(none)';
      throw new FatalProviderError(
        `OpenCode provider "${this.providerID}" not found. Available providers: ${available}. Run 'opencode' and use /connect to configure providers.`,
      );
    }

    const models = provider.models ? Object.keys(provider.models) : [];
    if (models.length > 0 && !models.includes(this.modelID)) {
      const available = models.map(m => `${this.providerID}/${m}`).join(', ');
      throw new FatalProviderError(
        `Model "${this.modelID}" not found for provider "${this.providerID}". Available models: ${available}`,
      );
    }
  }

  async listModels(): Promise<readonly ProviderModelInfo[]> {
    type ProviderInfo = { id: string; name: string; models?: Record<string, { name?: string }> };

    if (!this._client) {
      throw new Error('OpenCode provider not initialized — call initialize() first');
    }
    const result = await this._client.config.providers();
    const data = result.data as { providers?: ProviderInfo[] } | undefined;
    const providers = data?.providers ?? [];

    const out: ProviderModelInfo[] = [];
    for (const provider of providers) {
      const models = provider.models ?? {};
      for (const [modelID, model] of Object.entries(models)) {
        out.push({
          id: `${provider.id}/${modelID}`,
          label: model.name ?? modelID,
          description: provider.name,
        });
      }
    }
    return out;
  }

  getModelName(): string {
    return `${this.providerID}/${this.modelID}`;
  }

  setModel(model: string): void {
    const parsed = parseModelString(model);
    this.providerID = parsed.providerID;
    this.modelID = parsed.modelID;
  }

  enableDebug(): void {
    this.debugEnabled = true;
  }

  /** Run `fn` under an async FIFO mutex so refcount mutations and fs ops don't race. */
  private async withMarkerLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.markerMutex;
    let release!: () => void;
    this.markerMutex = new Promise<void>((r) => { release = r; });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Ensure `.git` exists at repositoryPath so OpenCode treats it as the project root.
   *  No-op if a `.git` already exists (whether directory or file) — we never touch
   *  pre-existing markers. If we create it, track it via refcount so concurrent
   *  targets with the same path coordinate correctly. Non-fatal on failure:
   *  falls through to whatever OpenCode does by default (walk up to parent repo),
   *  which is what the user saw before this fix. */
  private async ensureProjectMarker(repositoryPath: string): Promise<void> {
    if (this.skipProjectMarker) return;
    await this.withMarkerLock(async () => {
      const existing = this.createdMarkers.get(repositoryPath);
      if (existing !== undefined) {
        this.createdMarkers.set(repositoryPath, existing + 1);
        return;
      }
      if (existsSync(join(repositoryPath, '.git'))) {
        // Pre-existing — not ours, no refcount. OpenCode will use this naturally.
        return;
      }
      const gitPath = join(repositoryPath, '.git');
      // Record BEFORE running git init. If SIGINT/SIGHUP fires while git init is
      // running — or in the race window between init completing and the set() call
      // — the sync cleanup handler iterates createdMarkers and rmSync's whatever's
      // at gitPath. rmSync with { force: true } is lenient on ENOENT, so recording
      // before a would-be-nonexistent path is safe.
      this.createdMarkers.set(repositoryPath, 1);
      try {
        await execAsync('git init -q', { cwd: repositoryPath });
        // Info-level: we are touching the user's filesystem. They should see it without --debug.
        logProgress(
          TAG,
          `Created transient ${gitPath} so OpenCode treats this directory as its project root. ` +
          `Will be removed when the scan finishes.`,
        );
      } catch (err) {
        // Init failed — remove the phantom refcount so release doesn't try to rm a
        // non-existent .git (harmless but produces a confusing warning log).
        this.createdMarkers.delete(repositoryPath);
        logProgress(
          TAG,
          `Warning: could not create project marker at ${gitPath}: ${err instanceof Error ? err.message : String(err)}. ` +
          `File reads may resolve against the nearest ancestor .git instead, which can cause ENOENT errors.`,
        );
      }
    });
  }

  /** Release one reference to a project marker. When refcount hits zero, remove it.
   *  Pre-existing (non-ours) markers are ignored. */
  private async releaseProjectMarker(repositoryPath: string): Promise<void> {
    if (this.skipProjectMarker) return;
    await this.withMarkerLock(async () => {
      const count = this.createdMarkers.get(repositoryPath);
      if (count === undefined) return;
      if (count > 1) {
        this.createdMarkers.set(repositoryPath, count - 1);
        return;
      }
      this.createdMarkers.delete(repositoryPath);
      const gitPath = join(repositoryPath, '.git');
      try {
        await rmAsync(gitPath, { recursive: true, force: true });
        // Removal is the symmetric cleanup — debug is fine, users don't need to see it at info.
        logDebug(TAG, `Removed transient project marker at ${gitPath}`);
      } catch (err) {
        // Failure to remove leaves state on the filesystem — surface at info.
        logProgress(
          TAG,
          `Warning: could not remove transient project marker at ${gitPath}: ${err instanceof Error ? err.message : String(err)}. ` +
          `You may need to remove it manually.`,
        );
      }
    });
  }

  /** Synchronously wipe all markers we created. Used by signal handlers where
   *  async cleanup is unsafe. Does NOT acquire the mutex — signal handlers run
   *  between event loop ticks, so we observe a consistent map snapshot. */
  private cleanupMarkersSync(): void {
    for (const [path] of this.createdMarkers) {
      try {
        rmSync(join(path, '.git'), { recursive: true, force: true });
      } catch {
        // Best-effort in signal handler — process is about to exit anyway.
      }
    }
    this.createdMarkers.clear();
  }

  async executeCheck(
    instructions: string,
    repositoryPath: string,
    logPrefix?: string,
    _options?: { maxTurns?: number },
  ): Promise<AgentResponse> {
    if (!this._client) {
      throw new Error('OpenCode provider not initialized — call initialize() first');
    }

    // Ensure OpenCode treats repositoryPath as its project root. Without this, when
    // repositoryPath is a subdirectory of some other git repo, OpenCode walks up to
    // the ancestor .git and resolves all Read-tool paths relative to THAT directory,
    // causing ENOENT for every target file. This creates a transient `.git` marker
    // we remove when the scan finishes (refcounted across parallel targets).
    await this.ensureProjectMarker(repositoryPath);
    try {
      return await this.executeCheckInner(instructions, repositoryPath, logPrefix);
    } finally {
      await this.releaseProjectMarker(repositoryPath);
    }
  }

  private async executeCheckInner(
    instructions: string,
    repositoryPath: string,
    logPrefix?: string,
  ): Promise<AgentResponse> {
    const client = this._client!;
    const timer = createTimer();
    const prefix = logPrefix ? `${logPrefix} ` : '';

    // Create an isolated session for this check
    logDebug(TAG, `${prefix}Creating session for check (cwd=${repositoryPath})`);
    const sessionResult = await client.session.create({
      title: 'aghast security check',
      directory: repositoryPath,
    });

    const sessionId = sessionResult.data?.id;
    if (!sessionId) {
      throw new Error('Failed to create OpenCode session — no session ID returned');
    }
    logDebug(TAG, `${prefix}Session created: ${sessionId}`);

    logDebug(TAG, `${prefix}Starting query: model=${this.providerID}/${this.modelID}, promptLen=${instructions.length}`);
    if (this.debugEnabled) {
      logDebugFull(TAG, `${prefix}Full prompt sent to AI`, instructions);
    }

    // At trace level, poll session messages every second for real-time progress.
    // session.prompt() blocks, but setInterval callbacks run during the await.
    let toolCallCount = 0;
    let lastLoggedPartCount = 0;
    let lastActivityTime = Date.now();
    const logLevel = getLogLevel();
    const isDebugOrTrace = logLevel === 'debug' || logLevel === 'trace';

    const progressInterval = isDebugOrTrace ? setInterval(async () => {
      try {
        const messagesResult = await client.session.messages({
          sessionID: sessionId,
          directory: repositoryPath,
        });
        const messages = messagesResult.data ?? [];
        const assistantMsg = [...messages].reverse().find(
          (m: { info: { role: string } }) => m.info.role === 'assistant',
        );
        if (!assistantMsg) return;

        const parts = assistantMsg.parts as Array<{
          type: string; tool?: string; text?: string;
          state?: {
            status: string;
            input?: Record<string, unknown>;
            error?: string;
            output?: string;
          };
        }>;
        if (parts.length <= lastLoggedPartCount) return;

        for (let i = lastLoggedPartCount; i < parts.length; i++) {
          const part = parts[i];
          lastActivityTime = Date.now();

          if (part.type === 'tool') {
            const state = part.state;
            const toolName = part.tool ?? 'unknown';
            const inputPreview = previewJSON(state?.input, 200);
            if (state?.status === 'running') {
              toolCallCount++;
              logDebug(TAG, `${prefix}Tool[${toolCallCount}]: ${toolName} ${inputPreview} (${timer.elapsedStr()})`);
            } else if (state?.status === 'completed') {
              logDebug(TAG, `${prefix}Tool done: ${toolName} (${timer.elapsedStr()})`);
            } else if (state?.status === 'error') {
              // Tools can transition running → error between polls, so the "running" log
              // line may never fire for this tool. Always include the input so the user
              // can see what was being attempted, plus the error message from the SDK.
              const errorMsg = state.error ?? '(no error message)';
              const errorPreview = errorMsg.length > 300 ? errorMsg.slice(0, 300) + '...' : errorMsg;
              logDebug(
                TAG,
                `${prefix}Tool error: ${toolName} ${inputPreview} → ${errorPreview} (${timer.elapsedStr()})`,
              );
            }
          } else if (part.type === 'text' && part.text) {
            const preview = part.text.length > 150 ? part.text.slice(0, 150) + '...' : part.text;
            logDebug(TAG, `${prefix}Text: ${preview}`);
          }
        }
        lastLoggedPartCount = parts.length;
      } catch {
        // Polling failure is non-fatal
      }
    }, TRACE_POLL_MS) : undefined;

    // Heartbeat timer (all log levels)
    const heartbeatInterval = setInterval(() => {
      const silentSeconds = Math.round((Date.now() - lastActivityTime) / 1000);
      if (silentSeconds >= HEARTBEAT_INTERVAL_MS / 1000) {
        logDebug(TAG, `${prefix}Still waiting... (${timer.elapsedStr()})`);
      }
    }, HEARTBEAT_INTERVAL_MS);

    let promptResult;
    try {
      promptResult = await client.session.prompt({
        sessionID: sessionId,
        model: { providerID: this.providerID, modelID: this.modelID },
        parts: [{ type: 'text' as const, text: instructions }],
        format: {
          type: 'json_schema' as const,
          schema: OUTPUT_SCHEMA,
        },
        directory: repositoryPath,
      });
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      clearInterval(heartbeatInterval);
    }

    const info = promptResult.data?.info;
    const parts = promptResult.data?.parts;

    // Check for errors on the assistant message
    if (info?.error) {
      const err = info.error;
      const errName = err.name;
      const errMsg = 'data' in err && err.data && typeof err.data === 'object' && 'message' in err.data
        ? String((err.data as { message: unknown }).message)
        : errName;

      // StructuredOutputError: model doesn't support JSON schema output.
      // Fall through to text-based parsing instead of failing.
      if (errName === 'StructuredOutputError') {
        logDebug(TAG, `${prefix}Model does not support structured output — falling back to text parsing`);
      } else {
        if (errName === 'ProviderAuthError') {
          throw new FatalProviderError(`OpenCode authentication failed: ${errMsg}. Run 'opencode' and use /connect to configure credentials.`);
        }
        if (errName === 'APIError' && /rate.?limit|429/i.test(errMsg)) {
          throw new FatalProviderError(`OpenCode rate limit reached: ${errMsg}`);
        }
        throw new Error(`OpenCode AI error (${errName}): ${errMsg}`);
      }
    }

    // Extract token usage
    let tokenUsage: TokenUsage | undefined;
    if (!info?.tokens) {
      logDebug(TAG, `${prefix}Token usage not reported by provider`);
    } else {
      const tokens = info.tokens;
      const inputTokens = tokens.input ?? 0;
      const outputTokens = tokens.output ?? 0;
      tokenUsage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
      logDebug(TAG, `${prefix}Token usage: ${tokenUsage.inputTokens} in, ${tokenUsage.outputTokens} out`);
    }

    // Try structured output first (v2 API: info.structured)
    if (info?.structured) {
      const structuredOutput = info.structured as CheckResponse;
      logDebug(TAG, `${prefix}Structured output: ${structuredOutput.issues?.length ?? 0} issues`);
      logProgress(TAG, `${prefix}Completed in ${timer.elapsedStr()} (${toolCallCount} tool calls)`);
      const rawText = extractTextFromParts(parts);
      return { raw: rawText, parsed: structuredOutput, tokenUsage };
    }

    // Fallback: extract text from response parts and parse with response-parser
    const rawText = extractTextFromParts(parts);
    logDebug(TAG, `${prefix}No structured output — falling back to text parsing (${rawText.length} chars)`);

    if (this.debugEnabled) {
      logDebugFull(TAG, `${prefix}Full AI response`, rawText);
    }

    if (!rawText) {
      throw new Error('OpenCode AI returned no text response');
    }

    const parsed = parseAgentResponse(rawText);
    if (parsed) {
      logDebug(TAG, `${prefix}Parsed ${parsed.issues.length} issues from text response`);
    }

    logProgress(TAG, `${prefix}Completed in ${timer.elapsedStr()} (${toolCallCount} tool calls)`);
    return { raw: rawText, parsed: parsed ?? undefined, tokenUsage };
  }

  async validateConfig(): Promise<boolean> {
    return !!this._client;
  }

  /** Synchronous cleanup for signal handlers (best-effort). */
  private cleanupSync(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    // Remove signal handlers so cleanup() (called later via build-config's finally,
    // or by a caller after initialize() throws) doesn't no-op and leave them installed.
    if (this.signalHandler) {
      process.removeListener('SIGINT', this.signalHandler);
      process.removeListener('SIGTERM', this.signalHandler);
      process.removeListener('SIGHUP', this.signalHandler);
      if (process.platform === 'win32') {
        process.removeListener('SIGBREAK', this.signalHandler);
      }
      this.signalHandler = undefined;
    }
    // Wipe any transient .git markers we created before exiting.
    this.cleanupMarkersSync();
    if (this._server) {
      try {
        this._server.close();
      } catch {
        // Best-effort in signal handler
      }
    }
  }

  async cleanup(): Promise<void> {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    // Remove signal handlers
    if (this.signalHandler) {
      process.removeListener('SIGINT', this.signalHandler);
      process.removeListener('SIGTERM', this.signalHandler);
      process.removeListener('SIGHUP', this.signalHandler);
      if (process.platform === 'win32') {
        process.removeListener('SIGBREAK', this.signalHandler);
      }
      this.signalHandler = undefined;
    }

    // Force-remove any markers still tracked (normally refcount already brought them
    // to zero via releaseProjectMarker; this covers the case where executeCheck threw
    // before reaching its finally block).
    for (const [path] of this.createdMarkers) {
      try {
        await rmAsync(join(path, '.git'), { recursive: true, force: true });
      } catch (err) {
        logDebug(TAG, `Failed to remove marker at ${path} during cleanup: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.createdMarkers.clear();

    if (this._server) {
      logProgress(TAG, 'Stopping OpenCode server...');
      try {
        await Promise.race([
          Promise.resolve(this._server.close()),
          new Promise<void>((resolve) => setTimeout(() => {
            logDebug(TAG, `Server close timed out after ${CLOSE_TIMEOUT_MS}ms`);
            resolve();
          }, CLOSE_TIMEOUT_MS)),
        ]);
      } catch (err) {
        logDebug(TAG, `Error stopping OpenCode server: ${err}`);
      }
      this._server = undefined;
      this._client = undefined;
    }
  }
}

/**
 * Extract text content from an array of response parts.
 */
/** JSON-stringify a value and truncate to `maxLen` characters for log output. */
function previewJSON(value: unknown, maxLen: number): string {
  if (value === undefined) return '';
  const str = JSON.stringify(value);
  if (str === undefined) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

function extractTextFromParts(parts: Array<{ type: string; text?: string }> | undefined): string {
  if (!parts) return '';
  return parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text!)
    .join('\n');
}
