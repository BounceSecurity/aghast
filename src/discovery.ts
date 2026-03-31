/**
 * Pluggable target discovery system.
 *
 * Separates "how targets are found" (discovery) from "what happens with them"
 * (execution). Each discovery mechanism implements the TargetDiscovery interface
 * and is registered in a central registry.
 */

import type { SecurityCheck } from './types.js';
import { ERROR_CODES, formatError } from './error-codes.js';

// --- Discovered Target ---

/**
 * A target discovered by a discovery mechanism, ready for AI analysis.
 * Contains location information plus optional discovery-specific enrichment.
 */
export interface DiscoveredTarget {
  /** File path relative to the repository root. */
  file: string;
  /** Start line number (1-based). */
  startLine: number;
  /** End line number (1-based). */
  endLine: number;
  /** Display label for logging (e.g. "[target 1/10]"). */
  label: string;
  /** Extra context appended to prompt per target (e.g. call graph for openant, finding details for sarif). */
  promptEnrichment?: string;
  /** Discovery-specific AI provider options (e.g. maxTurns for openant). */
  aiOptions?: { maxTurns?: number };
  /** Message from the discovery tool (e.g. Semgrep finding description). */
  message?: string;
  /** Code snippet from the discovery tool (e.g. Semgrep snippet). */
  snippet?: string;
}

// --- Discovery Options ---

/**
 * Options passed to a discovery implementation.
 */
export interface DiscoveryOptions {
  /** Path to the target repository. */
  repositoryPath: string;
}

// --- Target Discovery Interface ---

/**
 * Interface for pluggable target discovery mechanisms.
 * Each implementation knows how to find targets and enrich them with context.
 */
export interface TargetDiscovery {
  /** Discovery mechanism name (e.g. 'semgrep', 'openant', 'sarif'). */
  readonly name: string;
  /** Default generic prompt filename used for this discovery type. */
  readonly defaultGenericPrompt: string;
  /** Whether checks using this discovery require an instructions file. */
  readonly needsInstructions: boolean;
  /**
   * Discover targets in the repository for the given check.
   * Returns an array of targets with optional prompt enrichment.
   */
  discover(
    check: SecurityCheck,
    repoPath: string,
    options?: DiscoveryOptions,
  ): Promise<DiscoveredTarget[]>;
}

// --- Discovery Registry ---

const discoveryRegistry = new Map<string, TargetDiscovery>();

/**
 * Register a discovery implementation.
 */
export function registerDiscovery(discovery: TargetDiscovery): void {
  discoveryRegistry.set(discovery.name, discovery);
}

/**
 * Get a discovery implementation by name.
 * Throws if the discovery type is not registered.
 */
export function getDiscovery(name: string): TargetDiscovery {
  const discovery = discoveryRegistry.get(name);
  if (!discovery) {
    const available = [...discoveryRegistry.keys()].join(', ');
    throw new Error(
      formatError(ERROR_CODES.E2004, `Unknown discovery type: "${name}". Available: ${available || '(none registered)'}`),
    );
  }
  return discovery;
}

/**
 * Get all registered discovery type names.
 */
export function getRegisteredDiscoveries(): string[] {
  return [...discoveryRegistry.keys()];
}

/**
 * Clear all registered discoveries. For testing only.
 */
export function clearDiscoveryRegistry(): void {
  discoveryRegistry.clear();
}
