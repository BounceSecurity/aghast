/**
 * Scan runner (orchestrator).
 * Runs security checks against a repository and produces ScanResults.
 * Implements the core workflow from spec Section 2.2.
 */

import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt } from './prompt-template.js';
import { parseAIResponse } from './response-parser.js';
import { extractSnippet } from './snippet-extractor.js';
import { analyzeRepository } from './repository-analyzer.js';
import { logProgress, logDebug, createTimer } from './logging.js';
import { CHECK_TYPE } from './check-types.js';
import { getDiscovery, registerDiscovery } from './discovery.js';
import { semgrepDiscovery } from './discoveries/semgrep-discovery.js';
import { openantDiscovery } from './discoveries/openant-discovery.js';
import { sarifDiscovery } from './discoveries/sarif-discovery.js';
import type { DiscoveredTarget } from './discovery.js';
import {
  DEFAULT_AI_MODEL,
  FatalProviderError,
  type AIProvider,
  type RepositoryInfo,
  type AIIssue,
  type SecurityIssue,
  type CheckExecutionSummary,
  type CheckDetails,
  type SecurityCheck,
  type ScanResults,
  type ScanSummary,
  type TokenUsage,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAG = 'scan';
const DEFAULT_CONCURRENCY = 5;

// --- Register built-in discovery implementations ---
registerDiscovery(semgrepDiscovery);
registerDiscovery(openantDiscovery);
registerDiscovery(sarifDiscovery);

/**
 * Sum multiple TokenUsage values into one aggregate.
 * Returns undefined if no inputs have token usage.
 */
function sumTokenUsage(usages: (TokenUsage | undefined)[]): TokenUsage | undefined {
  const defined = usages.filter((u): u is TokenUsage => u !== undefined);
  if (defined.length === 0) return undefined;
  return {
    inputTokens: defined.reduce((sum, u) => sum + u.inputTokens, 0),
    outputTokens: defined.reduce((sum, u) => sum + u.outputTokens, 0),
    totalTokens: defined.reduce((sum, u) => sum + u.totalTokens, 0),
  };
}

/**
 * Get the version from package.json.
 */
async function getVersion(): Promise<string> {
  try {
    const pkgPath = resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Handle for signaling abort to mapWithConcurrency workers. */
interface AbortHandle {
  aborted: boolean;
  reason?: Error;
}

/**
 * Run an async function over items with bounded concurrency.
 * Spawns min(concurrency, items.length) workers that pull from a shared index.
 * Results are written to a pre-allocated array to preserve input order.
 *
 * If abortHandle is provided, workers stop picking up new items once
 * abortHandle.aborted is set to true. In-flight items complete naturally.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  abortHandle?: AbortHandle,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      if (abortHandle?.aborted) break;
      // Safe without atomics: Node.js is single-threaded, so nextIndex++ is
      // not interleaved — each worker awaits before looping, yielding to the
      // event loop where the next worker reads and increments the same variable.
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(worker());
  }

  // Use allSettled so in-flight items complete before we propagate errors
  const settled = await Promise.allSettled(workers);
  const firstRejection = settled.find((r) => r.status === 'rejected');
  if (firstRejection && firstRejection.status === 'rejected') {
    throw firstRejection.reason;
  }

  return results;
}

export interface MultiScanOptions {
  repositoryPath: string;
  checks: Array<{ check: SecurityCheck; details: CheckDetails }>;
  aiProvider?: AIProvider;
  aiModelName?: string;
  aiProviderName?: string;
  concurrency?: number;
  repositoryInfo?: RepositoryInfo;
  configDir?: string;
  genericPrompt?: string;
}

/**
 * Generate a scanId in the format: scan-<timestamp>-<hash>
 */
export function generateScanId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').replace(/\..+/, '');
  const hash = randomBytes(3).toString('hex');
  return `scan-${ts}-${hash}`;
}

// --- Single check execution helper ---

interface CheckExecutionResult {
  summary: CheckExecutionSummary;
  issues: SecurityIssue[];
}

/**
 * Enrich a raw AI issue into a full SecurityIssue.
 * Extracts code snippets, applies check metadata, and normalizes paths.
 */
async function enrichIssue(
  aiIssue: AIIssue,
  checkId: string,
  checkName: string,
  repositoryPath: string,
  checkMetadata?: { severity?: string; confidence?: string },
): Promise<SecurityIssue> {
  const codeSnippet = await extractSnippet(
    repositoryPath,
    aiIssue.file,
    aiIssue.startLine,
    aiIssue.endLine,
  );

  const issue: SecurityIssue = {
    checkId,
    checkName,
    file: aiIssue.file.replace(/\\/g, '/'),
    startLine: aiIssue.startLine,
    endLine: aiIssue.endLine,
    description: aiIssue.description,
  };
  if (codeSnippet !== undefined) {
    issue.codeSnippet = codeSnippet;
  }
  if (checkMetadata?.severity !== undefined) {
    issue.severity = checkMetadata.severity;
  }
  if (checkMetadata?.confidence !== undefined) {
    issue.confidence = checkMetadata.confidence;
  }
  if (aiIssue.dataFlow !== undefined) {
    issue.dataFlow = aiIssue.dataFlow.map((step) => ({
      ...step,
      file: step.file.replace(/\\/g, '/'),
    }));
  }
  return issue;
}

/**
 * If the check specifies a per-check model, switch the provider to that model
 * and return the previous model name so it can be restored after execution.
 */
function applyPerCheckModel(
  check: SecurityCheck,
  aiProvider: AIProvider | undefined,
  globalModelName: string | undefined,
): string | undefined {
  if (!check.model || !aiProvider?.setModel) return undefined;
  const previousModel = aiProvider.getModelName?.() ?? globalModelName;
  aiProvider.setModel(check.model);
  logProgress(TAG, `Using per-check model: ${check.model} (check: ${check.id})`);
  return previousModel;
}

/**
 * Restore the provider's model to the previous value after per-check override.
 */
function restoreModel(
  aiProvider: AIProvider | undefined,
  previousModel: string | undefined,
): void {
  if (previousModel !== undefined && aiProvider?.setModel) {
    aiProvider.setModel(previousModel);
  }
}

/**
 * Map a discovered target directly to a SecurityIssue (for static checks).
 * Extracts code snippet from source file via extractSnippet().
 */
async function mapTargetToIssue(
  target: DiscoveredTarget,
  checkId: string,
  checkName: string,
  repositoryPath: string,
  checkMetadata?: { severity?: string; confidence?: string },
): Promise<SecurityIssue> {
  const codeSnippet = await extractSnippet(
    repositoryPath,
    target.file,
    target.startLine,
    target.endLine,
  );

  const issue: SecurityIssue = {
    checkId,
    checkName,
    file: target.file.replace(/\\/g, '/'),
    startLine: target.startLine,
    endLine: target.endLine,
    description: target.message || 'Static finding',
  };
  if (codeSnippet !== undefined) {
    issue.codeSnippet = codeSnippet;
  }
  if (checkMetadata?.severity !== undefined) {
    issue.severity = checkMetadata.severity;
  }
  if (checkMetadata?.confidence !== undefined) {
    issue.confidence = checkMetadata.confidence;
  }
  return issue;
}

/**
 * Execute a single check against a repository.
 * Routes to the appropriate execution path based on check type.
 */
async function executeSingleCheck(
  check: SecurityCheck,
  checkName: string,
  checkInstructions: string,
  repositoryPath: string,
  aiProvider: AIProvider | undefined,
  checkMetadata?: { severity?: string; confidence?: string },
  concurrency?: number,
  configDir?: string,
  genericPrompt?: string,
): Promise<CheckExecutionResult> {
  const checkId = check.id;

  // Route to targeted execution (discovery + AI analysis)
  if (check.checkTarget?.type === CHECK_TYPE.TARGETED) {
    if (!aiProvider) {
      throw new Error(`Check "${checkId}" requires an AI provider but none was configured`);
    }
    return executeTargetedCheck(
      check,
      checkName,
      checkInstructions,
      repositoryPath,
      aiProvider,
      checkMetadata,
      concurrency,
      configDir,
      genericPrompt,
    );
  }

  // Route to static execution (discovery + direct mapping, no AI)
  if (check.checkTarget?.type === CHECK_TYPE.STATIC) {
    return executeStaticCheck(check, checkName, repositoryPath, checkMetadata);
  }

  // Repository check (no discovery, AI analyzes whole repo)
  if (!aiProvider) {
    throw new Error(`Check "${checkId}" requires an AI provider but none was configured`);
  }

  logProgress(TAG, `Running check: ${checkName}`);

  const prompt = await buildPrompt(checkInstructions, configDir, genericPrompt);
  logDebug(TAG, `Prompt built: ${prompt.length} chars`);

  let issues: SecurityIssue[] = [];
  let summary: CheckExecutionSummary;

  const checkTimer = createTimer();

  try {
    const aiResponse = await aiProvider.executeCheck(prompt, repositoryPath);
    const executionTime = checkTimer.elapsed();

    logDebug(TAG, `AI response: ${aiResponse.raw.length} chars`);
    const parsed = aiResponse.parsed ?? parseAIResponse(aiResponse.raw);

    if (!parsed) {
      logProgress(TAG, 'Result: ERROR (malformed response)');
      summary = {
        checkId,
        checkName,
        status: 'ERROR',
        issuesFound: 0,
        executionTime,
        error: 'AI provider returned malformed response',
        rawAiResponse: aiResponse.raw,
        tokenUsage: aiResponse.tokenUsage,
      };
    } else if (parsed.issues.length > 0) {
      logProgress(TAG, `Result: FAIL (${parsed.issues.length} issues)`);

      issues = await Promise.all(
        parsed.issues.map((aiIssue) =>
          enrichIssue(aiIssue, checkId, checkName, repositoryPath, checkMetadata),
        ),
      );

      summary = {
        checkId,
        checkName,
        status: 'FAIL',
        issuesFound: issues.length,
        executionTime,
        tokenUsage: aiResponse.tokenUsage,
      };
    } else if (parsed.flagged) {
      logProgress(TAG, 'Result: FLAG (AI flagged for review)');
      summary = {
        checkId,
        checkName,
        status: 'FLAG',
        issuesFound: 0,
        executionTime,
        tokenUsage: aiResponse.tokenUsage,
      };
    } else {
      logProgress(TAG, 'Result: PASS');
      summary = {
        checkId,
        checkName,
        status: 'PASS',
        issuesFound: 0,
        executionTime,
        tokenUsage: aiResponse.tokenUsage,
      };
    }
  } catch (err) {
    // Fatal errors must propagate up to abort the entire scan
    if (err instanceof FatalProviderError) {
      throw err;
    }
    const executionTime = checkTimer.elapsed();
    const errorMsg = err instanceof Error ? err.message : String(err);
    logProgress(TAG, `Result: ERROR (${errorMsg})`);
    summary = {
      checkId,
      checkName,
      status: 'ERROR',
      issuesFound: 0,
      executionTime,
      error: errorMsg,
    };
  }

  return { summary, issues };
}

/**
 * Execute a targeted check: discovery finds targets, AI analyzes each.
 * The execution pipeline is generic — all discovery-specific behavior is
 * encapsulated in the DiscoveredTarget data from the discovery implementation.
 */
async function executeTargetedCheck(
  check: SecurityCheck,
  checkName: string,
  checkInstructions: string,
  repositoryPath: string,
  aiProvider: AIProvider,
  checkMetadata?: { severity?: string; confidence?: string },
  optionsConcurrency?: number,
  configDir?: string,
  genericPromptOverride?: string,
): Promise<CheckExecutionResult> {
  const checkId = check.id;
  const checkTarget = check.checkTarget!;

  const discoveryName = checkTarget.discovery;
  if (!discoveryName) {
    throw new Error(`Check "${checkId}" is targeted but has no "discovery" specified`);
  }

  const discovery = getDiscovery(discoveryName);

  logProgress(TAG, `Running targeted check: ${checkName} (discovery: ${discoveryName})`);
  const checkTimer = createTimer();

  try {
    // 1. Discover targets
    let targets = await discovery.discover(check, repositoryPath, { repositoryPath });

    // 2. Apply maxTargets limit
    if (checkTarget.maxTargets !== undefined && targets.length > checkTarget.maxTargets) {
      targets = targets.slice(0, checkTarget.maxTargets);
      logProgress(TAG, `Limited to ${targets.length} targets (maxTargets: ${checkTarget.maxTargets})`);
    }

    // 3. If no targets, return PASS
    if (targets.length === 0) {
      logProgress(TAG, 'Result: PASS (no targets found)');
      return {
        summary: {
          checkId,
          checkName,
          status: 'PASS',
          issuesFound: 0,
          executionTime: checkTimer.elapsed(),
          targetsAnalyzed: 0,
        },
        issues: [],
      };
    }

    // 4. Resolve effective concurrency: per-check > options > default
    const effectiveConcurrency =
      checkTarget.concurrency ?? optionsConcurrency ?? DEFAULT_CONCURRENCY;

    logProgress(TAG, `Found ${targets.length} targets to analyze (concurrency: ${effectiveConcurrency})`);

    // 5. Build base prompt using discovery's default generic prompt (or CLI override)
    const effectiveGenericPrompt = genericPromptOverride ?? discovery.defaultGenericPrompt;
    const basePrompt = await buildPrompt(checkInstructions, configDir, effectiveGenericPrompt);
    let completedCount = 0;
    const abortHandle: AbortHandle = { aborted: false };

    // 6. Analyze targets concurrently — pipeline is generic, no discovery conditionals
    const targetResults = await mapWithConcurrency(
      targets,
      effectiveConcurrency,
      async (target, _idx) => {
        try {
          const prompt = basePrompt + (target.promptEnrichment ?? '');

          logDebug(TAG, `${target.label} Analyzing: ${target.file}:${target.startLine}-${target.endLine}`);
          const aiResponse = await aiProvider.executeCheck(
            prompt,
            repositoryPath,
            target.label,
            target.aiOptions,
          );

          const parsed = aiResponse.parsed ?? parseAIResponse(aiResponse.raw);

          if (!parsed) {
            logDebug(TAG, `${target.label} Returned malformed response`);
            return { issues: [] as SecurityIssue[], error: true, flagged: false, tokenUsage: aiResponse.tokenUsage };
          }

          const issues = await Promise.all(
            parsed.issues.map((aiIssue) =>
              enrichIssue(aiIssue, checkId, checkName, repositoryPath, checkMetadata),
            ),
          );
          return { issues, error: false, flagged: parsed.flagged === true, tokenUsage: aiResponse.tokenUsage };
        } catch (err) {
          // Fatal errors: signal abort and re-throw to stop other workers
          if (err instanceof FatalProviderError) {
            abortHandle.aborted = true;
            abortHandle.reason = err;
            throw err;
          }
          const errorMsg = err instanceof Error ? err.message : String(err);
          logDebug(TAG, `${target.label} Error: ${errorMsg}`);
          return { issues: [] as SecurityIssue[], error: true, flagged: false, tokenUsage: undefined };
        } finally {
          completedCount++;
          logProgress(TAG, `Progress: ${completedCount}/${targets.length} targets analyzed`);
        }
      },
      abortHandle,
    );

    // 7. Aggregate results
    const allIssues: SecurityIssue[] = [];
    let hasErrors = false;
    let hasFlagged = false;
    const targetTokenUsages: (TokenUsage | undefined)[] = [];
    for (const result of targetResults) {
      allIssues.push(...result.issues);
      if (result.error) hasErrors = true;
      if (result.flagged) hasFlagged = true;
      targetTokenUsages.push(result.tokenUsage);
    }

    // 8. Determine status: FAIL > FLAG > ERROR > PASS
    const executionTime = checkTimer.elapsed();
    let status: 'PASS' | 'FAIL' | 'FLAG' | 'ERROR';
    if (allIssues.length > 0) {
      status = 'FAIL';
    } else if (hasFlagged) {
      status = 'FLAG';
    } else if (hasErrors) {
      status = 'ERROR';
    } else {
      status = 'PASS';
    }

    logProgress(TAG, `Result: ${status} (${allIssues.length} issues, ${targets.length} targets)`);

    return {
      summary: {
        checkId,
        checkName,
        status,
        issuesFound: allIssues.length,
        executionTime,
        targetsAnalyzed: targets.length,
        tokenUsage: sumTokenUsage(targetTokenUsages),
      },
      issues: allIssues,
    };
  } catch (err) {
    // Fatal errors must propagate up to abort the entire scan
    if (err instanceof FatalProviderError) {
      throw err;
    }
    const executionTime = checkTimer.elapsed();
    const errorMsg = err instanceof Error ? err.message : String(err);
    logProgress(TAG, `Result: ERROR (${errorMsg})`);
    return {
      summary: {
        checkId,
        checkName,
        status: 'ERROR',
        issuesFound: 0,
        executionTime,
        error: errorMsg,
      },
      issues: [],
    };
  }
}

/**
 * Execute a static check: discovery finds targets, mapped directly to issues (no AI).
 */
async function executeStaticCheck(
  check: SecurityCheck,
  checkName: string,
  repositoryPath: string,
  checkMetadata?: { severity?: string; confidence?: string },
): Promise<CheckExecutionResult> {
  const checkId = check.id;
  const checkTarget = check.checkTarget!;

  const discoveryName = checkTarget.discovery;
  if (!discoveryName) {
    throw new Error(`Check "${checkId}" is static but has no "discovery" specified`);
  }

  const discovery = getDiscovery(discoveryName);

  logProgress(TAG, `Running static check: ${checkName} (discovery: ${discoveryName})`);
  const checkTimer = createTimer();

  try {
    // 1. Discover targets
    let targets = await discovery.discover(check, repositoryPath, { repositoryPath });

    // 2. Apply maxTargets limit
    if (checkTarget.maxTargets !== undefined && targets.length > checkTarget.maxTargets) {
      targets = targets.slice(0, checkTarget.maxTargets);
    }

    // 3. If no targets, return PASS
    if (targets.length === 0) {
      logProgress(TAG, 'Result: PASS (no findings)');
      return {
        summary: {
          checkId,
          checkName,
          status: 'PASS',
          issuesFound: 0,
          executionTime: checkTimer.elapsed(),
          targetsAnalyzed: 0,
        },
        issues: [],
      };
    }

    // 4. Map each target directly to a SecurityIssue (no AI)
    const issues = await Promise.all(
      targets.map((target) =>
        mapTargetToIssue(target, checkId, checkName, repositoryPath, checkMetadata),
      ),
    );

    const executionTime = checkTimer.elapsed();
    logProgress(TAG, `Result: FAIL (${issues.length} findings, ${targets.length} targets)`);

    return {
      summary: {
        checkId,
        checkName,
        status: 'FAIL',
        issuesFound: issues.length,
        executionTime,
        targetsAnalyzed: targets.length,
      },
      issues,
    };
  } catch (err) {
    const executionTime = checkTimer.elapsed();
    const errorMsg = err instanceof Error ? err.message : String(err);
    logProgress(TAG, `Result: ERROR (${errorMsg})`);
    return {
      summary: {
        checkId,
        checkName,
        status: 'ERROR',
        issuesFound: 0,
        executionTime,
        error: errorMsg,
      },
      issues: [],
    };
  }
}

/**
 * Run multiple security checks and return aggregated ScanResults.
 */
export async function runMultiScan(options: MultiScanOptions): Promise<ScanResults> {
  const { repositoryPath, checks, aiProvider, aiModelName, aiProviderName, concurrency, configDir, genericPrompt } = options;
  const scanTimer = createTimer();
  const scanId = generateScanId();
  const startTime = new Date();
  const version = await getVersion();

  logProgress(TAG, `Starting scan ${scanId} (${checks.length} ${checks.length === 1 ? 'check' : 'checks'})`);
  logDebug(TAG, `Repository: ${repositoryPath}`);

  // Use pre-analyzed repository info if provided, otherwise analyze here
  let repositoryInfo: RepositoryInfo;
  if (options.repositoryInfo) {
    repositoryInfo = options.repositoryInfo;
  } else {
    const repoAnalysis = await analyzeRepository(repositoryPath);
    repositoryInfo = repoAnalysis.repository;
  }

  const allCheckSummaries: CheckExecutionSummary[] = [];
  const allIssues: SecurityIssue[] = [];

  // Track all models used during the scan
  const modelsUsed = new Set<string>();
  if (aiModelName) modelsUsed.add(aiModelName);

  // Execute checks sequentially
  for (let ci = 0; ci < checks.length; ci++) {
    const { check, details } = checks[ci];
    const checkMetadata = {
      severity: check.severity,
      confidence: check.confidence,
    };

    // Apply per-check model override if specified
    const previousModel = applyPerCheckModel(check, aiProvider, aiModelName);
    if (check.model) modelsUsed.add(check.model);

    try {
      const { summary: checkSummary, issues } = await executeSingleCheck(
        check,
        details.name,
        details.content,
        repositoryPath,
        aiProvider,
        checkMetadata,
        concurrency,
        configDir,
        genericPrompt,
      );

      allCheckSummaries.push(checkSummary);
      allIssues.push(...issues);
    } catch (err) {
      if (err instanceof FatalProviderError) {
        // Record the failing check as ERROR
        logProgress(TAG, `Fatal error during check "${check.id}": ${err.message}`);
        allCheckSummaries.push({
          checkId: check.id,
          checkName: details.name,
          status: 'ERROR',
          issuesFound: 0,
          executionTime: 0,
          error: err.message,
        });
        // Record remaining checks as ERROR (aborted)
        for (let ri = ci + 1; ri < checks.length; ri++) {
          const remaining = checks[ri];
          logProgress(TAG, `Skipping check "${remaining.check.id}" due to fatal error`);
          allCheckSummaries.push({
            checkId: remaining.check.id,
            checkName: remaining.details.name,
            status: 'ERROR',
            issuesFound: 0,
            executionTime: 0,
            error: `Scan aborted: ${err.message}`,
          });
        }
        logProgress(TAG, `Scan aborted due to fatal error: ${err.message}`);
        break;
      }
      // Non-fatal errors should not reach here (executeSingleCheck catches them),
      // but handle gracefully just in case.
      throw err;
    } finally {
      // Restore the global model after per-check override
      restoreModel(aiProvider, previousModel);
    }
  }

  const endTime = new Date();
  const executionTime = endTime.getTime() - startTime.getTime();

  const summary: ScanSummary = {
    totalChecks: allCheckSummaries.length,
    passedChecks: allCheckSummaries.filter((c) => c.status === 'PASS').length,
    failedChecks: allCheckSummaries.filter((c) => c.status === 'FAIL').length,
    flaggedChecks: allCheckSummaries.filter((c) => c.status === 'FLAG').length,
    errorChecks: allCheckSummaries.filter((c) => c.status === 'ERROR').length,
    totalIssues: allIssues.length,
  };

  logProgress(TAG, `Scan completed in ${scanTimer.elapsedStr()}`);

  // Aggregate token usage across all checks
  const aggregateTokenUsage = sumTokenUsage(allCheckSummaries.map((c) => c.tokenUsage));

  const results: ScanResults = {
    scanId,
    timestamp: startTime.toISOString(),
    version,
    repository: repositoryInfo,
    issues: allIssues,
    checks: allCheckSummaries,
    summary,
    executionTime,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    aiProvider: aiProvider
      ? { name: aiProviderName ?? 'claude-code', models: modelsUsed.size > 0 ? [...modelsUsed] : [DEFAULT_AI_MODEL] }
      : { name: 'none', models: [] },
    tokenUsage: aggregateTokenUsage,
  };

  return results;
}
