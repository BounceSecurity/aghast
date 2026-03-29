/**
 * Core type definitions for aghast.
 * Based on SPECIFICATION.md Appendix A.
 */

// --- Default AI Model ---

export const DEFAULT_AI_MODEL = 'haiku';
export const MOCK_MODEL_NAME = 'mock';

// --- Token Usage ---

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// --- A.1a Check Registry Entry (Layer 1) ---

export interface CheckRegistryEntry {
  id: string;
  repositories: string[];
  enabled?: boolean;
}

// --- A.1b Check Definition (Layer 2) ---

export interface CheckDefinition {
  id: string;
  name: string;
  instructionsFile?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  confidence?: 'high' | 'medium' | 'low';
  checkTarget?: CheckTargetDefinition;
  applicablePaths?: string[];
  excludedPaths?: string[];
}

// --- A.1 Security Check (merged from Layer 1 + Layer 2) ---

export interface SecurityCheck {
  id: string;
  name: string;
  repositories: string[];
  checkTarget?: CheckTargetDefinition;
  instructionsFile?: string;
  applicablePaths?: string[];
  excludedPaths?: string[];
  enabled?: boolean;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  confidence?: 'high' | 'medium' | 'low';
  /** Path to the check folder (set during resolution). */
  checkDir?: string;
}

// --- A.2 Check Target Definition ---

export interface CheckTargetDefinition {
  type: 'semgrep' | 'semgrep-only' | 'repository' | 'sarif-verify';
  rules?: string | string[];
  config?: string;
  maxTargets?: number;
  concurrency?: number;
}

// --- A.2b Check Target (discovered location) ---

export interface CheckTarget {
  file: string;
  startLine: number;
  endLine: number;
  message: string;
  snippet?: string;
}

// --- A.3 Data Flow Step ---

export interface DataFlowStep {
  file: string;
  lineNumber: number;
  label: string;
}

// --- A.3 Security Issue ---

export interface SecurityIssue {
  checkId: string;
  checkName: string;
  file: string;
  startLine: number; // Required - AI must always provide line numbers
  endLine: number; // Required - AI must always provide line numbers
  description: string;
  codeSnippet?: string;
  severity?: string;
  confidence?: string;
  recommendation?: string;
  dataFlow?: DataFlowStep[];
}

// --- A.3b AI Check Response ---

export interface CheckResponse {
  issues: AIIssue[];
  flagged?: boolean;
  summary?: string;
  analysisNotes?: string;
}

/** Raw issue as returned by the AI (before enrichment). */
export interface AIIssue {
  file: string;
  startLine: number; // Required - enforced via JSON schema in AI provider
  endLine: number; // Required - enforced via JSON schema in AI provider
  description: string;
  dataFlow?: DataFlowStep[];
}

// --- A.4 Check Execution Summary ---

export interface CheckExecutionSummary {
  checkId: string;
  checkName: string;
  status: 'PASS' | 'FAIL' | 'FLAG' | 'ERROR';
  issuesFound: number;
  executionTime: number;
  targetsAnalyzed?: number;
  error?: string;
  rawAiResponse?: string;
  tokenUsage?: TokenUsage;
}

// --- A.5 Complete Scan Results ---

export interface ScanResults {
  scanId: string;
  timestamp: string;
  version: string;
  repository: RepositoryInfo;
  issues: SecurityIssue[];
  checks: CheckExecutionSummary[];
  summary: ScanSummary;
  executionTime: number;
  startTime: string;
  endTime: string;
  aiProvider: {
    name: string;
    models: string[];
  };
  tokenUsage?: TokenUsage;
  metadata?: Record<string, unknown>;
}

export interface RepositoryInfo {
  path: string;
  remoteUrl?: string;
  branch?: string;
  commit?: string;
  isGitRepository: boolean;
}

export interface ScanSummary {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  flaggedChecks: number;
  errorChecks: number;
  totalIssues: number;
}

// --- Runtime Configuration (spec Section 8.1) ---

export interface RuntimeConfig {
  aiProvider?: {
    name?: string;
    model?: string;
  };
  reporting?: {
    outputDirectory?: string;
    outputFormat?: string;
  };
  genericPrompt?: string;
  failOnCheckFailure?: boolean;
}

// --- A.6 Aggregated Report ---

export interface AggregatedReport {
  timestamp: string;
  projectsScanned: number;
  repositories: string[];
  issues: AggregatedIssue[];
  checks: AggregatedCheckSummary[];
  projectSummaries: ProjectSummary[];
  summary: ScanSummary;
}

export interface AggregatedIssue extends SecurityIssue {
  projectName: string;
  repositoryUrl?: string;
}

export interface AggregatedCheckSummary extends CheckExecutionSummary {
  projectName: string;
  timestamp: string;
  jobUrl?: string;
  branch?: string;
  pipelineSource?: string;
}

export interface ProjectSummary {
  projectName: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  errorChecks: number;
  issuesFound: number;
  timestamp: string;
  jobUrl?: string;
  branch?: string;
  pipelineSource?: string;
}

// --- A.7 Check Details ---

export interface CheckDetails {
  id: string;
  name: string;
  overview: string;
  content: string;
}

// --- C.5 AI Provider Interface ---

export interface ProviderConfig {
  apiKey?: string;
  model?: string;
  [key: string]: unknown;
}

export interface AIResponse {
  raw: string;
  parsed?: CheckResponse;
  tokenUsage?: TokenUsage;
}

export interface AIProvider {
  initialize(config: ProviderConfig): Promise<void>;
  executeCheck(
    instructions: string,
    repositoryPath: string,
    logPrefix?: string,
  ): Promise<AIResponse>;
  validateConfig(): Promise<boolean>;
  getModelName?(): string;
  enableDebug?(): void;
}

/**
 * Error thrown by AI providers for unrecoverable failures (e.g. 401 auth, rate limits).
 * When caught by the scan runner, this signals that the entire scan should abort —
 * no further checks or targets should be attempted.
 */
export class FatalProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalProviderError';
  }
}
