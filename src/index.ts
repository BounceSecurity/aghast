/**
 * CLI entry point for aghast.
 * Usage: aghast scan <repository-path> --config-dir <path> [options]
 */

import 'dotenv/config';
import { readFile, writeFile, stat, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { runMultiScan } from './scan-runner.js';
import { createProviderByName, getProviderNames, DEFAULT_PROVIDER_NAME } from './provider-registry.js';
import {
  loadCheckRegistry,
  discoverCheckFolders,
  resolveChecks,
  filterChecksForRepository,
  validateCheck,
  loadCheckDetails,
} from './check-library.js';
import { analyzeRepository } from './repository-analyzer.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { logProgress, logDebug, setLogLevel, createTimer, isValidLogLevel, initFileHandler, closeAllHandlers, getAvailableLogTypes } from './logging.js';
import type { LogLevel } from './logging.js';
import { MOCK_MODEL_NAME, DEFAULT_AI_MODEL, type AIProvider } from './types.js';
import { getFormatter } from './formatters/index.js';
import { verifySemgrepInstalled } from './semgrep-runner.js';
import { verifyOpenAntInstalled } from './openant-runner.js';
import { MockAIProvider } from './mock-ai-provider.js';
import { ERROR_CODES, formatError, formatFatalError } from './error-codes.js';
import { colorStatus } from './colors.js';
import { getCheckType } from './check-types.js';
import { createRequire } from 'node:module';

const TAG = 'aghast';

async function createMockProvider(): Promise<AIProvider> {
  // AGHAST_MOCK_AI='true' → default empty response; AGHAST_MOCK_AI=<path> → read from that file
  const mockAiValue = process.env.AGHAST_MOCK_AI;
  let rawResponse = '{"issues": []}';
  if (mockAiValue && mockAiValue !== 'true') {
    try {
      rawResponse = await readFile(resolve(mockAiValue), 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read AGHAST_MOCK_AI response file: ${mockAiValue}`, { cause: err });
    }
  }

  const provider = new MockAIProvider({ rawResponse });
  await provider.initialize({});
  return provider;
}

const SCAN_HELP = `Usage: aghast scan <repo-path> --config-dir <path> [options]

Run security checks against a repository.

Arguments:
  <repo-path>                Path to the repository to scan

General options:
  --config-dir <path>        Config directory containing checks-config.json,
                             checks/ folder, and optionally runtime-config.json.
                             Required unless AGHAST_CONFIG_DIR is set.
  --output <path>            Output file path for results
                             (default: <repo-path>/security_checks_results.<ext>)
  --output-format json|sarif Output format (default: json)
  --fail-on-check-failure    Exit with code 1 if any check FAILs or ERRORs
  --debug                    Shorthand for --log-level debug
  --log-level <level>        Console log level: error, warn, info, debug, trace
                             (default: info)
  --log-file <path>          Write all log output to a file (always at trace level
                             unless overridden by --log-type)
  --log-type <type>          Log file handler type (default: file).
                             Available types: file
  --model <model>            AI model override (e.g. claude-sonnet-4-20250514)
  --ai-provider <name>       AI provider name (default: claude-code)
  --generic-prompt <file>    Generic prompt template filename in prompts/ dir

Environment variables:
  ANTHROPIC_API_KEY           API key for Claude (required for AI-based checks)
  AGHAST_CONFIG_DIR           Default config directory (CLI --config-dir takes precedence)
  AGHAST_AI_MODEL             AI model override (CLI --model takes precedence)
  AGHAST_GENERIC_PROMPT       Generic prompt template filename (CLI --generic-prompt takes precedence)
  AGHAST_DEBUG                Set to "true" to enable debug output (same as --debug)
  AGHAST_LOG_LEVEL            Console log level (CLI --log-level takes precedence)
  AGHAST_LOG_FILE             Log file path (CLI --log-file takes precedence)
  AGHAST_LOG_TYPE             Log file handler type (CLI --log-type takes precedence)

Examples:
  aghast scan ./my-repo --config-dir ./my-checks
  aghast scan ./my-repo --config-dir ./my-checks --output results.sarif --output-format sarif
  aghast scan ./my-repo --config-dir ./my-checks --fail-on-check-failure --debug
  aghast scan ./my-repo --config-dir ./my-checks --log-file scan.log --log-level warn
  aghast scan ./my-repo --config-dir ./my-checks --model claude-sonnet-4-20250514`;

function parseArgs(args: string[]): {
  repositoryPath?: string;
  configDir?: string;
  outputFormat?: string;
  outputPath?: string;
  failOnCheckFailure: boolean;
  debug: boolean;
  logLevel?: string;
  logFile?: string;
  logType?: string;
  runtimeConfigPath?: string;
  model?: string;
  aiProvider?: string;
  genericPrompt?: string;
} {
  if (args.length < 1 || args[0] === '--help' || args[0] === '-h') {
    console.log(SCAN_HELP);
    process.exit(0);
  }

  // First positional arg is repo-path
  const firstArg = args[0];
  const repositoryPath = firstArg && !firstArg.startsWith('--') ? resolve(firstArg) : undefined;
  const startIdx = repositoryPath ? 1 : 0;

  let configDir: string | undefined;
  let outputFormat: string | undefined;
  let outputPath: string | undefined;
  const failOnCheckFailure = args.includes('--fail-on-check-failure');
  const debug = args.includes('--debug');
  let logLevel: string | undefined;
  let logFile: string | undefined;
  let logType: string | undefined;
  let runtimeConfigPath: string | undefined;
  let model: string | undefined;
  let aiProvider: string | undefined;
  let genericPrompt: string | undefined;

  for (let i = startIdx; i < args.length; i++) {
    switch (args[i]) {
      case '--config-dir': {
        configDir = args[i + 1];
        if (!configDir) {
          console.error(formatError(ERROR_CODES.E1001, '--config-dir requires a path argument'));
          process.exit(1);
        }
        configDir = resolve(configDir);
        i++;
        break;
      }
      case '--output': {
        outputPath = args[i + 1];
        if (!outputPath) {
          console.error(formatError(ERROR_CODES.E1001, '--output requires a path argument'));
          process.exit(1);
        }
        outputPath = resolve(outputPath);
        i++;
        break;
      }
      case '--output-format': {
        outputFormat = args[i + 1];
        if (!outputFormat) {
          console.error(formatError(ERROR_CODES.E1001, '--output-format requires a format argument'));
          process.exit(1);
        }
        i++;
        break;
      }
      case '--runtime-config': {
        runtimeConfigPath = args[i + 1];
        if (!runtimeConfigPath) {
          console.error(formatError(ERROR_CODES.E1001, '--runtime-config requires a path argument'));
          process.exit(1);
        }
        runtimeConfigPath = resolve(runtimeConfigPath);
        i++;
        break;
      }
      case '--model': {
        model = args[i + 1];
        if (!model) {
          console.error(formatError(ERROR_CODES.E1001, '--model requires a model name argument'));
          process.exit(1);
        }
        i++;
        break;
      }
      case '--ai-provider': {
        aiProvider = args[i + 1];
        if (!aiProvider) {
          console.error(formatError(ERROR_CODES.E1001, '--ai-provider requires a provider name argument'));
          process.exit(1);
        }
        i++;
        break;
      }
      case '--generic-prompt': {
        genericPrompt = args[i + 1];
        if (!genericPrompt) {
          console.error(formatError(ERROR_CODES.E1001, '--generic-prompt requires a filename argument'));
          process.exit(1);
        }
        i++;
        break;
      }
      case '--log-level': {
        logLevel = args[i + 1];
        if (!logLevel) {
          console.error(formatError(ERROR_CODES.E1001, '--log-level requires a level argument (error, warn, info, debug, trace)'));
          process.exit(1);
        }
        i++;
        break;
      }
      case '--log-file': {
        logFile = args[i + 1];
        if (!logFile) {
          console.error(formatError(ERROR_CODES.E1001, '--log-file requires a path argument'));
          process.exit(1);
        }
        logFile = resolve(logFile);
        i++;
        break;
      }
      case '--log-type': {
        logType = args[i + 1];
        if (!logType) {
          console.error(formatError(ERROR_CODES.E1001, '--log-type requires a type argument'));
          process.exit(1);
        }
        i++;
        break;
      }
      // --fail-on-check-failure and --debug are handled above via includes()
    }
  }

  return {
    repositoryPath, configDir, outputPath, outputFormat,
    failOnCheckFailure, debug, logLevel, logFile, logType,
    runtimeConfigPath, model, aiProvider, genericPrompt,
  };
}

async function createProvider(
  useMock: boolean,
  aiProviderName: string,
  modelOverride?: string,
): Promise<{ provider: AIProvider; modelName: string }> {
  if (useMock) {
    logProgress(TAG, `MOCK AI provider enabled via AGHAST_MOCK_AI=${process.env.AGHAST_MOCK_AI}`);
    return { provider: await createMockProvider(), modelName: MOCK_MODEL_NAME };
  }

  const provider = createProviderByName(aiProviderName);
  await provider.initialize({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: modelOverride,
  });
  const modelName = provider.getModelName?.() ?? DEFAULT_AI_MODEL;
  return { provider, modelName };
}

/**
 * Validate that the config directory has the required structure.
 * Returns early with a clear error message if anything is missing.
 */
async function validateConfigDir(configDir: string): Promise<void> {
  // Check checks-config.json exists
  const registryPath = resolve(configDir, 'checks-config.json');
  try {
    await stat(registryPath);
  } catch {
    console.error(formatError(ERROR_CODES.E2002, `Config directory is missing checks-config.json: ${registryPath}`));
    console.error(`  Use 'aghast new-check --config-dir ${configDir}' to bootstrap a config directory.`);
    process.exit(1);
  }

  // Check checks/ directory exists
  const checksPath = resolve(configDir, 'checks');
  try {
    const checksStat = await stat(checksPath);
    if (!checksStat.isDirectory()) {
      console.error(formatError(ERROR_CODES.E2002, `${checksPath} exists but is not a directory`));
      process.exit(1);
    }
  } catch {
    console.error(formatError(ERROR_CODES.E2002, `Config directory is missing checks/ folder: ${checksPath}`));
    console.error(`  Use 'aghast new-check --config-dir ${configDir}' to add checks.`);
    process.exit(1);
  }

  // Check that checks/ has at least one subfolder
  const entries = await readdir(checksPath);
  if (entries.length === 0) {
    console.error(formatError(ERROR_CODES.E2003, `No checks found in ${checksPath}`));
    console.error(`  Use 'aghast new-check --config-dir ${configDir}' to add checks.`);
    process.exit(1);
  }
}

export async function runScan(args: string[]): Promise<void> {
  const globalTimer = createTimer();
  const parsed = parseArgs(args);

  // --config-dir is required (CLI flag > AGHAST_CONFIG_DIR env var)
  const rawConfigDir = parsed.configDir || process.env.AGHAST_CONFIG_DIR;
  if (!rawConfigDir) {
    console.error(formatError(ERROR_CODES.E2001, "--config-dir is required (or set AGHAST_CONFIG_DIR). Use 'aghast new-check --config-dir <path>' to create a config directory."));
    process.exit(1);
  }
  const configDir = resolve(rawConfigDir);

  // Validate config directory structure
  await validateConfigDir(configDir);

  // Load runtime configuration
  let runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>>;
  try {
    runtimeConfig = await loadRuntimeConfig(configDir, parsed.runtimeConfigPath);
  } catch (err: unknown) {
    console.error(formatError(ERROR_CODES.E2005, err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  // Resolve log level: --log-level > AGHAST_LOG_LEVEL > runtime config > --debug/AGHAST_DEBUG > default
  const debug = parsed.debug || process.env.AGHAST_DEBUG === 'true';
  const resolvedLogLevel = parsed.logLevel ?? (process.env.AGHAST_LOG_LEVEL || undefined) ?? runtimeConfig.logging?.level ?? (debug ? 'debug' : 'info');
  if (resolvedLogLevel !== 'silent' && !isValidLogLevel(resolvedLogLevel)) {
    console.error(formatError(ERROR_CODES.E1001, `Invalid log level "${resolvedLogLevel}". Valid levels: error, warn, info, debug, trace`));
    process.exit(1);
  }
  setLogLevel(resolvedLogLevel as LogLevel | 'silent');

  // Resolve log file: --log-file > AGHAST_LOG_FILE > runtime config
  const resolvedLogFile = parsed.logFile ?? (process.env.AGHAST_LOG_FILE || undefined) ?? (runtimeConfig.logging?.logFile ? resolve(runtimeConfig.logging.logFile) : undefined);
  if (resolvedLogFile) {
    const resolvedLogType = parsed.logType ?? (process.env.AGHAST_LOG_TYPE || undefined) ?? runtimeConfig.logging?.logType ?? 'file';
    const availableTypes = getAvailableLogTypes();
    if (!availableTypes.includes(resolvedLogType)) {
      console.error(formatError(ERROR_CODES.E1001, `Unknown log type "${resolvedLogType}". Available types: ${availableTypes.join(', ')}`));
      process.exit(1);
    }
    initFileHandler(resolve(resolvedLogFile), resolvedLogType);
  }

  // Resolve repository path — required
  if (!parsed.repositoryPath) {
    console.error(formatError(ERROR_CODES.E1003, '<repo-path> is required'));
    process.exit(1);
  }

  // Validate repository path exists and is a directory
  try {
    const repoStat = await stat(parsed.repositoryPath);
    if (!repoStat.isDirectory()) {
      console.error(formatError(ERROR_CODES.E4001, `Repository path is not a directory: ${parsed.repositoryPath}`));
      process.exit(1);
    }
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(formatError(ERROR_CODES.E4001, `Repository path does not exist: ${parsed.repositoryPath}`));
      process.exit(1);
    }
    throw err;
  }

  // Resolve output format: CLI > runtime config > default
  const resolvedOutputFormat = parsed.outputFormat ?? runtimeConfig.reporting?.outputFormat ?? 'json';

  // Resolve formatter early — fail fast on unknown format
  const formatter = getFormatter(resolvedOutputFormat);

  // Treat AGHAST_MOCK_AI=false (or empty) as disabled; any other truthy value enables mock mode
  const mockAiEnv = process.env.AGHAST_MOCK_AI;
  const useMock = !!(mockAiEnv && mockAiEnv !== 'false');

  // ─── Load and filter checks BEFORE AI validation ───

  // Checks always live in <config-dir>/checks/
  const checksDirs = [resolve(configDir, 'checks')];

  // Resolve generic prompt: CLI > env > runtime config > default (handled in buildPrompt)
  const genericPrompt = parsed.genericPrompt ?? process.env.AGHAST_GENERIC_PROMPT ?? runtimeConfig.genericPrompt;

  logDebug(TAG, `Config dir: ${configDir}, checks dir: ${checksDirs[0]}`);

  // Two-layer config loading
  const registry = await loadCheckRegistry(configDir);
  const checkFolders = await discoverCheckFolders(checksDirs);

  if (checkFolders.size === 0) {
    console.error(formatError(ERROR_CODES.E2003, `No valid checks found in ${checksDirs[0]}. Each check needs a <id>/<id>.json file.`));
    process.exit(1);
  }

  const allChecks = await resolveChecks(registry, checkFolders);

  // Analyze repository to get remote URL for check filtering
  const effectiveRepoPath = parsed.repositoryPath;
  const repoAnalysis = await analyzeRepository(effectiveRepoPath);
  const repoUrl = repoAnalysis?.repository.remoteUrl ?? effectiveRepoPath;

  const matchingChecks = filterChecksForRepository(allChecks, repoUrl);
  logProgress(TAG, `Found ${matchingChecks.length} matching checks (of ${allChecks.length} total)`);

  if (matchingChecks.length === 0) {
    logProgress(TAG, 'No matching checks found for this repository');
  }

  // Validate and load check details
  const checksWithDetails: Array<{ check: typeof matchingChecks[0]; details: Awaited<ReturnType<typeof loadCheckDetails>> }> = [];
  for (const check of matchingChecks) {
    // instructionsFile is already absolute from resolveChecks — validate against ''
    const validation = await validateCheck(check, '');
    if (!validation.valid) {
      logProgress(TAG, `Skipping invalid check "${check.id}": ${validation.errors.join(', ')}`);
      continue;
    }

    // checkTarget rules already resolved by resolveChecks — no additional path resolution needed

    // Checks that don't require instructions use synthetic details (unless they provided one optionally).
    // Built-in analysis modes (false-positive-validation, general-vuln-discovery) also don't need instructions.
    const builtInMode = check.checkTarget?.analysisMode === 'false-positive-validation'
      || check.checkTarget?.analysisMode === 'general-vuln-discovery';
    if ((!getCheckType(check.checkTarget?.type).needsInstructions || builtInMode) && !check.instructionsFile) {
      checksWithDetails.push({
        check,
        details: { id: check.id, name: check.name, overview: '', content: '' },
      });
      continue;
    }

    const details = await loadCheckDetails(check, '');
    // Fall back to JSON definition name if markdown has no ### heading
    if (details.name === 'Unknown Check') {
      details.name = check.name;
    }
    checksWithDetails.push({ check, details });
  }

  // ─── Validate --generic-prompt with mixed discovery types ───
  if (genericPrompt) {
    const discoveryTypes = new Set<string>();
    for (const c of checksWithDetails) {
      const d = c.check.checkTarget?.discovery;
      if (d) discoveryTypes.add(d);
    }
    if (discoveryTypes.size > 1) {
      console.error(formatError(
        ERROR_CODES.E2004,
        `--generic-prompt cannot be used when checks have different discovery types (found: ${[...discoveryTypes].join(', ')}). Each discovery type uses its own default generic prompt.`,
      ));
      process.exit(1);
    }
  }

  // ─── Determine which prerequisites are needed ───
  const needsAI = checksWithDetails.some(c => getCheckType(c.check.checkTarget?.type).needsAI);
  const needsSemgrep = checksWithDetails.some(c => c.check.checkTarget?.discovery === 'semgrep');
  const needsOpenant = checksWithDetails.some(c => c.check.checkTarget?.discovery === 'openant');

  // ─── Conditional AI provider setup ───
  const aiProviderName = parsed.aiProvider ?? runtimeConfig.aiProvider?.name ?? DEFAULT_PROVIDER_NAME;

  if (needsAI && !useMock) {
    // Validate AI provider name before checking credentials (config errors before auth errors)
    if (!getProviderNames().includes(aiProviderName)) {
      console.error(
        formatError(ERROR_CODES.E3002, `Unknown AI provider "${aiProviderName}". Supported providers: ${getProviderNames().join(', ')}`),
      );
      process.exit(1);
    }

    // Validate ANTHROPIC_API_KEY (not needed when using mock or local Claude)
    if (!process.env.ANTHROPIC_API_KEY && process.env.AGHAST_LOCAL_CLAUDE !== 'true') {
      console.error(formatError(ERROR_CODES.E3001, 'ANTHROPIC_API_KEY environment variable is required'));
      process.exit(1);
    }
  }

  // Resolve model precedence: CLI --model > env AGHAST_AI_MODEL > runtime config > default
  const modelOverride = parsed.model ?? process.env.AGHAST_AI_MODEL ?? runtimeConfig.aiProvider?.model;

  let provider: AIProvider | undefined;
  let modelName: string | undefined;
  if (needsAI) {
    ({ provider, modelName } = await createProvider(useMock, aiProviderName, modelOverride));
    if (resolvedLogLevel === 'debug' || resolvedLogLevel === 'trace') {
      provider.enableDebug?.();
    }
    logProgress(TAG, `Using model: ${modelName}`);
  }

  // ─── Conditional Semgrep verification ───
  if (needsSemgrep && !process.env.AGHAST_MOCK_SEMGREP) {
    try {
      await verifySemgrepInstalled();
    } catch (err) {
      console.error(formatError(ERROR_CODES.E5001, err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  }

  // ─── Conditional OpenAnt verification ───
  if (needsOpenant && !process.env.AGHAST_OPENANT_DATASET) {
    try {
      await verifyOpenAntInstalled();
    } catch (err) {
      console.error(formatError(ERROR_CODES.E6001, err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  }

  const results = await runMultiScan({
    repositoryPath: effectiveRepoPath,
    checks: checksWithDetails,
    aiProvider: provider,
    aiModelName: needsAI ? modelName : undefined,
    repositoryInfo: repoAnalysis?.repository,
    aiProviderName: needsAI ? (useMock ? 'mock' : aiProviderName) : undefined,
    configDir,
    genericPrompt,
  });

  // Resolve output path: --output flag > runtime config dir > default
  let resolvedOutputPath: string;
  if (parsed.outputPath) {
    resolvedOutputPath = parsed.outputPath;
  } else if (runtimeConfig.reporting?.outputDirectory) {
    const dir = resolve(runtimeConfig.reporting.outputDirectory);
    resolvedOutputPath = resolve(dir, 'security_checks_results' + formatter.fileExtension);
  } else {
    resolvedOutputPath = resolve(effectiveRepoPath, 'security_checks_results' + formatter.fileExtension);
  }
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, formatter.format(results), 'utf-8');

  // Summary output
  const statusIcon =
    results.summary.failedChecks > 0
      ? 'FAIL'
      : results.summary.flaggedChecks > 0
        ? 'FLAG'
        : results.summary.errorChecks > 0
          ? 'ERROR'
          : 'PASS';

  console.log('');
  console.log('='.repeat(60));
  console.log(`AGHAST Scan Complete: ${colorStatus(statusIcon)}`);
  console.log('='.repeat(60));
  console.log(`  Total checks:  ${results.summary.totalChecks}`);
  console.log(`  Passed:        ${results.summary.passedChecks}`);
  console.log(`  Failed:        ${results.summary.failedChecks}`);
  console.log(`  Flagged:       ${results.summary.flaggedChecks}`);
  console.log(`  Errors:        ${results.summary.errorChecks}`);
  console.log(`  Total issues:  ${results.summary.totalIssues}`);
  if (results.tokenUsage) {
    console.log(`  Tokens:        ${results.tokenUsage.totalTokens.toLocaleString()} (in: ${results.tokenUsage.inputTokens.toLocaleString()}, out: ${results.tokenUsage.outputTokens.toLocaleString()})`);
  }
  console.log(`  Duration:      ${globalTimer.elapsedStr()}`);
  console.log(`  Results:       ${resolvedOutputPath}`);
  console.log('='.repeat(60));

  // Exit code based on --fail-on-check-failure flag or runtime config (spec Section 9.3)
  const failOnCheckFailure = parsed.failOnCheckFailure || runtimeConfig.failOnCheckFailure === true;
  const shouldFail =
    failOnCheckFailure && (results.summary.failedChecks > 0 || results.summary.errorChecks > 0);
  await closeAllHandlers();
  process.exit(shouldFail ? 1 : 0);
}

// Auto-run when executed directly (npm run scan / tsx src/index.ts), but not when imported by cli.ts.
if (!process.env._AGHAST_CLI) {
  runScan(process.argv.slice(2)).catch(async (err) => {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    console.error('');
    console.error(formatFatalError(err instanceof Error ? err.message : String(err), pkg.version));
    logDebug(TAG, 'Error details', err);
    await closeAllHandlers();
    process.exit(1);
  });
}
