/**
 * OpenAnt data loading, discovery, filtering, and prompt formatting.
 *
 * Reads OpenAnt dataset files (dataset.json) containing code units with
 * call graph context, and prepares them for security analysis. Enhanced
 * datasets (dataset_enhanced.json) are supported but not preferred — the
 * AI performs its own analysis and OpenAnt's classifications can introduce bias.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { OpenAntFilterConfig } from './types.js';

// --- OpenAnt Data Types ---

export interface OpenAntPrimaryOrigin {
  file_path: string;
  start_line: number;
  end_line: number;
  function_name: string;
  class_name: string | null;
  enhanced: boolean;
  files_included: string[];
  original_length: number;
  enhanced_length: number;
}

export interface OpenAntCode {
  primary_code: string;
  primary_origin: OpenAntPrimaryOrigin;
  dependencies: unknown[];
  dependency_metadata: {
    depth: number;
    total_upstream: number;
    total_downstream: number;
    direct_calls: number;
    direct_callers: number;
  };
}

export interface OpenAntAgentContext {
  include_functions: Array<{ id: string; reason: string }>;
  usage_context: string;
  security_classification: string;
  classification_reasoning: string;
  confidence: number;
  agent_metadata: { iterations: number; total_tokens: number };
  reachability: {
    is_entry_point: boolean;
    reachable_from_entry: boolean;
    entry_point_path: string[];
  };
}

export interface OpenAntUnit {
  id: string;
  unit_type: string;
  code: OpenAntCode;
  ground_truth: { status: string };
  metadata: {
    decorators: string[];
    is_async: boolean;
    parameters: string[];
    docstring: string | null;
    direct_calls: string[];
    direct_callers: string[];
  };
  reachable: boolean;
  is_entry_point: boolean;
  entry_point_reason: string;
  agent_context?: OpenAntAgentContext;
}

export interface OpenAntDataset {
  name: string;
  repository: string;
  units: OpenAntUnit[];
  statistics: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface OpenAntProject {
  name: string;
  repo_path: string;
  source: string;
  language: string;
  commit_sha: string;
  commit_sha_short: string;
  created_at: string;
}

// --- Loading ---

/**
 * Load and parse an OpenAnt dataset JSON file.
 */
export async function loadDatasetFromFile(filePath: string): Promise<OpenAntDataset> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`OpenAnt dataset file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`OpenAnt dataset is not valid JSON: ${filePath}`);
  }

  const dataset = parsed as Record<string, unknown>;
  if (!dataset || !Array.isArray(dataset.units)) {
    throw new Error(`OpenAnt dataset missing "units" array: ${filePath}`);
  }

  return dataset as unknown as OpenAntDataset;
}

// --- Discovery ---

const DEFAULT_OPENANT_BASE = join(homedir(), '.openant');

/**
 * Discover an OpenAnt dataset from a project name.
 * Reads project.json, finds the scan matching commit_sha_short, picks the language folder,
 * and resolves dataset.json. Enhanced datasets (dataset_enhanced.json) are not used because
 * the AI performs its own code analysis — OpenAnt's security classifications can introduce
 * bias and false positives.
 */
export async function discoverDataset(
  projectName: string,
  openantBasePath?: string,
): Promise<{ datasetPath: string; project: OpenAntProject }> {
  const basePath = openantBasePath ?? DEFAULT_OPENANT_BASE;
  const projectDir = join(basePath, 'projects', projectName);
  const projectJsonPath = join(projectDir, 'project.json');

  let projectContent: string;
  try {
    projectContent = await readFile(projectJsonPath, 'utf-8');
  } catch {
    throw new Error(`OpenAnt project not found: ${projectJsonPath}`);
  }

  let project: OpenAntProject;
  try {
    project = JSON.parse(projectContent) as OpenAntProject;
  } catch {
    throw new Error(`Invalid JSON in OpenAnt project file: ${projectJsonPath}`);
  }
  const scanDir = join(projectDir, 'scans', project.commit_sha_short);

  // Find the language folder — use project.language, or pick the first available
  let languageDir: string;
  try {
    const scanEntries = await readdir(scanDir);
    if (scanEntries.includes(project.language)) {
      languageDir = join(scanDir, project.language);
    } else if (scanEntries.length > 0) {
      languageDir = join(scanDir, scanEntries[0]);
    } else {
      throw new Error(`No language folders found in scan: ${scanDir}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('No language')) throw err;
    throw new Error(`OpenAnt scan directory not found: ${scanDir}`, { cause: err });
  }

  // Use dataset.json (base dataset). Enhanced datasets are not preferred because
  // OpenAnt's security classifications can bias the AI and cause false positives.
  const datasetPath = join(languageDir, 'dataset.json');

  try {
    await access(datasetPath);
    return { datasetPath: datasetPath, project };
  } catch {
    throw new Error(
      `No dataset file found in ${languageDir} (expected dataset.json)`,
    );
  }
}

// --- Filtering ---

/**
 * Apply configured filters to OpenAnt units.
 * Gracefully handles missing agent_context (unenhanced datasets).
 */
export function filterUnits(units: OpenAntUnit[], filters?: OpenAntFilterConfig): OpenAntUnit[] {
  if (!filters) return units;

  let result = units;

  if (filters.unitTypes && filters.unitTypes.length > 0) {
    const allowed = new Set(filters.unitTypes);
    result = result.filter((u) => allowed.has(u.unit_type));
  }

  if (filters.excludeUnitTypes && filters.excludeUnitTypes.length > 0) {
    const excluded = new Set(filters.excludeUnitTypes);
    result = result.filter((u) => !excluded.has(u.unit_type));
  }

  if (filters.securityClassifications && filters.securityClassifications.length > 0) {
    const allowed = new Set(filters.securityClassifications);
    result = result.filter(
      (u) => u.agent_context && allowed.has(u.agent_context.security_classification),
    );
  }

  if (filters.reachableOnly) {
    result = result.filter((u) => u.reachable);
  }

  if (filters.entryPointsOnly) {
    result = result.filter((u) => u.is_entry_point);
  }

  if (filters.minConfidence !== undefined) {
    const threshold = filters.minConfidence;
    result = result.filter(
      (u) => u.agent_context && u.agent_context.confidence >= threshold,
    );
  }

  return result;
}

// --- Prompt Formatting ---

/**
 * Normalize file path to forward slashes (cross-platform).
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Build the per-unit prompt section appended to the base prompt.
 *
 * Designed for the agentic API: gives the agent a target location to navigate to,
 * investigation leads to follow (callers, callees), and a security hypothesis to
 * verify — rather than dumping all code into the prompt.
 */
export function formatUnitPromptSection(unit: OpenAntUnit): string {
  const origin = unit.code.primary_origin;
  const meta = unit.metadata;

  const lines: string[] = [
    '',
    'UNIT DETAILS:',
    '',
    'TARGET LOCATION (start your analysis by reading this file):',
    `- File: ${normalizePath(origin.file_path)}`,
    `- Lines: ${origin.start_line}-${origin.end_line}`,
    `- Function: ${origin.function_name}`,
    `- Class: ${origin.class_name ?? '(module level)'}`,
    `- Unit type: ${unit.unit_type}`,
  ];

  // Entry point / reachability context
  if (unit.is_entry_point) {
    lines.push(`- This is an ENTRY POINT receiving external input${unit.entry_point_reason ? ` (${unit.entry_point_reason})` : ''}`);
  } else if (unit.reachable) {
    lines.push('- This code is reachable from an entry point that receives external input');
  }

  // Investigation leads from call graph
  lines.push('', 'INVESTIGATION LEADS:');

  if (meta.direct_callers?.length > 0) {
    lines.push(
      `- Called by: ${meta.direct_callers.join(', ')}`,
      '  Investigate these callers to understand what input reaches this function and whether it is sanitized upstream.',
    );
  } else {
    lines.push('- No known callers in the call graph');
  }

  if (meta.direct_calls?.length > 0) {
    lines.push(
      `- Calls: ${meta.direct_calls.join(', ')}`,
      '  Investigate these callees to understand what happens with this function\'s output and whether dangerous operations are performed.',
    );
  }

  if (meta.parameters?.length > 0) {
    lines.push(`- Parameters: ${meta.parameters.join(', ')}`);
  }
  if (meta.decorators?.length > 0) {
    lines.push(`- Decorators: ${meta.decorators.join(', ')} — check whether these provide security controls (e.g. auth, input validation)`);
  }
  if (meta.is_async) {
    lines.push('- This is an async function');
  }

  // Security hypothesis from OpenAnt (if enhanced)
  // Note: OpenAnt's agent_context (security classifications, reasoning) is deliberately
  // excluded from the prompt. The AI performs its own independent analysis — including
  // OpenAnt's opinions was found to cause false positives by biasing the AI toward
  // confirming the hypothesis rather than evaluating the code objectively.

  // Include enhanced code context if OpenAnt inlined additional functions
  if (origin.enhanced && origin.files_included.length > 1) {
    lines.push(
      '',
      'ADDITIONAL CONTEXT (related functions from other files, for reference):',
      '```',
      unit.code.primary_code,
      '```',
      'Note: This is a snapshot from the time of analysis. Read the actual files to verify current state.',
    );
  }

  lines.push(
    '',
    'INSTRUCTIONS:',
    '- All file paths above are relative to your working directory. Use them directly with the Read tool (e.g., Read "routes/orders.js"), do NOT prepend "/" or use absolute paths.',
    '- Read the target file and analyze the function at the specified location',
    '- Read at most 1-2 additional files (direct callers/callees) if needed — then stop and report',
    '- Report issues ONLY for this specific code unit',
    '- If this code is not vulnerable, return {"issues": []} immediately',
  );

  return lines.join('\n');
}
