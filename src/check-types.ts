/**
 * Check type descriptor system.
 *
 * Each check type declares its characteristics (needs AI, needs instructions, etc.)
 * in one place. Code throughout the codebase queries these descriptors instead
 * of comparing raw type strings.
 *
 * Check types describe *execution mode* (what happens with targets).
 * Discovery type (how targets are found) is a separate axis — see src/discovery.ts.
 */

/** Characteristics of a check type. */
export interface CheckTypeDescriptor {
  /** The string value used in check definitions. */
  readonly type: string;
  /** Whether the check requires AI analysis. */
  readonly needsAI: boolean;
  /** Whether the check requires an instructions markdown file. */
  readonly needsInstructions: boolean;
  /** Whether the check supports maxTargets (multi-target checks). */
  readonly supportsMaxTargets: boolean;
}

// --- Check Type Definitions ---

const REPOSITORY: CheckTypeDescriptor = {
  type: 'repository',
  needsAI: true,
  needsInstructions: true,
  supportsMaxTargets: false,
};

const TARGETED: CheckTypeDescriptor = {
  type: 'targeted',
  needsAI: true,
  needsInstructions: true,
  supportsMaxTargets: true,
};

const STATIC: CheckTypeDescriptor = {
  type: 'static',
  needsAI: false,
  needsInstructions: false,
  supportsMaxTargets: true,
};

/** All registered check types, keyed by their type string. */
const CHECK_TYPES: ReadonlyMap<string, CheckTypeDescriptor> = new Map([
  [REPOSITORY.type, REPOSITORY],
  [TARGETED.type, TARGETED],
  [STATIC.type, STATIC],
]);

/**
 * Default descriptor used when the type is unknown or undefined.
 * Conservative defaults: requires AI and instructions (the common case).
 */
const DEFAULT_DESCRIPTOR: CheckTypeDescriptor = {
  type: '',
  needsAI: true,
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
  TARGETED: TARGETED.type,
  STATIC: STATIC.type,
} as const;
