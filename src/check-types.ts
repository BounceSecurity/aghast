/**
 * Check type descriptor system.
 *
 * Each check type declares its characteristics (needs AI, needs Semgrep, etc.)
 * in one place. Code throughout the codebase queries these descriptors instead
 * of comparing raw type strings.
 */

/** Characteristics of a check type. */
export interface CheckTypeDescriptor {
  /** The string value used in check definitions. */
  readonly type: string;
  /** Whether the check requires an AI provider. Default: true. */
  readonly needsAI: boolean;
  /** Whether the check requires Semgrep to be installed. Default: false. */
  readonly needsSemgrep: boolean;
  /** Whether the check requires an instructions markdown file. Default: true. */
  readonly needsInstructions: boolean;
  /** Whether the check supports maxTargets (multi-unit/target checks). Default: false. */
  readonly supportsMaxTargets: boolean;
}

// --- Check Type Definitions ---

const REPOSITORY: CheckTypeDescriptor = {
  type: 'repository',
  needsAI: true,
  needsSemgrep: false,
  needsInstructions: true,
  supportsMaxTargets: false,
};

const SEMGREP: CheckTypeDescriptor = {
  type: 'semgrep',
  needsAI: true,
  needsSemgrep: true,
  needsInstructions: true,
  supportsMaxTargets: true,
};

const SEMGREP_ONLY: CheckTypeDescriptor = {
  type: 'semgrep-only',
  needsAI: false,
  needsSemgrep: true,
  needsInstructions: false,
  supportsMaxTargets: true,
};

const SARIF_VERIFY: CheckTypeDescriptor = {
  type: 'sarif-verify',
  needsAI: true,
  needsSemgrep: false,
  needsInstructions: false,
  supportsMaxTargets: true,
};

const OPENANT_UNITS: CheckTypeDescriptor = {
  type: 'openant-units',
  needsAI: true,
  needsSemgrep: false,
  needsInstructions: false,
  supportsMaxTargets: true,
};

/** All registered check types, keyed by their type string. */
const CHECK_TYPES: ReadonlyMap<string, CheckTypeDescriptor> = new Map([
  [REPOSITORY.type, REPOSITORY],
  [SEMGREP.type, SEMGREP],
  [SEMGREP_ONLY.type, SEMGREP_ONLY],
  [SARIF_VERIFY.type, SARIF_VERIFY],
  [OPENANT_UNITS.type, OPENANT_UNITS],
]);

/**
 * Default descriptor used when the type is unknown or undefined.
 * Conservative defaults: requires AI and instructions (the common case).
 */
const DEFAULT_DESCRIPTOR: CheckTypeDescriptor = {
  type: '',
  needsAI: true,
  needsSemgrep: false,
  needsInstructions: true,
  supportsMaxTargets: false,
};

// --- Public API ---

/**
 * Get the descriptor for a check type string.
 * Returns conservative defaults for unknown/undefined types.
 */
export function getCheckType(type: string | undefined): CheckTypeDescriptor {
  if (!type) return DEFAULT_DESCRIPTOR;
  return CHECK_TYPES.get(type) ?? DEFAULT_DESCRIPTOR;
}

/** All valid check type strings. */
export function getValidCheckTypes(): string[] {
  return [...CHECK_TYPES.keys()];
}

/** Check type string constants for use in routing (scan-runner switch). */
export const CHECK_TYPE = {
  REPOSITORY: REPOSITORY.type,
  SEMGREP: SEMGREP.type,
  SEMGREP_ONLY: SEMGREP_ONLY.type,
  SARIF_VERIFY: SARIF_VERIFY.type,
  OPENANT_UNITS: OPENANT_UNITS.type,
} as const;
