/**
 * AI Provider Registry.
 *
 * Allows providers to be registered by name and resolved at runtime.
 * Adding a new provider requires only implementing the AIProvider interface
 * and calling registerProvider.
 */

import type { AIProvider } from './types.js';
import { ClaudeCodeProvider } from './claude-code-provider.js';

export type ProviderFactory = () => AIProvider;

const registry = new Map<string, ProviderFactory>();

export function registerProvider(name: string, factory: ProviderFactory): void {
  registry.set(name, factory);
}

export function createProviderByName(name: string): AIProvider {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(
      `Unknown AI provider "${name}". Supported providers: ${[...registry.keys()].join(', ')}`,
    );
  }
  return factory();
}

export function getProviderNames(): string[] {
  return [...registry.keys()];
}

/** Default provider name — used as fallback in CLI when AI_PROVIDER / runtime config not set. */
export const DEFAULT_PROVIDER_NAME = 'claude-code';

// Register built-in providers
registerProvider(DEFAULT_PROVIDER_NAME, () => new ClaudeCodeProvider());
