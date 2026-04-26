/**
 * Central registry of scanner defaults used when a value is absent from CLI flags,
 * environment variables, and runtime-config.json.
 *
 * These are surfaced to users by `aghast build-config`, and applied at runtime by
 * the scanner. Single source of truth — do not duplicate these literals elsewhere.
 *
 * (Provider and model defaults live alongside their respective registries:
 *  `DEFAULT_PROVIDER_NAME` in `provider-registry.ts`, `DEFAULT_AI_MODEL` in `types.ts`.)
 */

/** Default output format for scan reports. */
export const DEFAULT_OUTPUT_FORMAT = 'json';

/** Default console log level when none is specified. */
export const DEFAULT_LOG_LEVEL = 'info';

/** Default log file handler type when --log-file is set without --log-type. */
export const DEFAULT_LOG_TYPE = 'file';

/** Default generic prompt template filename prepended to check instructions. */
export const DEFAULT_GENERIC_PROMPT = 'generic-instructions.md';

/** Default for whether the scan should exit non-zero on FAIL/ERROR results. */
export const DEFAULT_FAIL_ON_CHECK_FAILURE = false;
