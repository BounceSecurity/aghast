/**
 * Semgrep-based target discovery.
 *
 * Runs Semgrep rules against the repository, parses SARIF output,
 * and returns discovered targets with inline prompt enrichment.
 */

import { runSemgrep } from '../semgrep-runner.js';
import { parseSARIF, deduplicateTargets } from '../sarif-parser.js';
import { logDebug } from '../logging.js';
import type { TargetDiscovery, DiscoveredTarget, DiscoveryOptions } from '../discovery.js';
import type { SecurityCheck } from '../types.js';

const TAG = 'semgrep-discovery';

function buildTargetPromptEnrichment(file: string, startLine: number, endLine: number): string {
  return `\n\nTARGET LOCATION:

You are analyzing a specific code location:
- File: ${file}
- Lines: ${startLine}-${endLine}

You MUST:
- Analyze ONLY this specific target location — do not search for or report issues at other locations
- You may read other files to understand context (e.g., imports, type definitions, data flow), but only report issues for this target
- If the code at this location is not vulnerable, return {"issues": []}
- Do NOT scan the broader repository for other instances of this vulnerability pattern
`;
}

export const semgrepDiscovery: TargetDiscovery = {
  name: 'semgrep',
  defaultGenericPrompt: 'generic-instructions.md',
  needsInstructions: true,

  async discover(
    check: SecurityCheck,
    repoPath: string,
    _options?: DiscoveryOptions,
  ): Promise<DiscoveredTarget[]> {
    const checkTarget = check.checkTarget!;

    logDebug(TAG, `Running Semgrep for check: ${check.id}`);

    const sarifContent = await runSemgrep({
      repositoryPath: repoPath,
      rules: checkTarget.rules,
      config: checkTarget.config,
    });

    let targets = parseSARIF(sarifContent);
    targets = deduplicateTargets(targets);

    logDebug(TAG, `Discovered ${targets.length} targets`);

    return targets.map((target, idx) => ({
      file: target.file,
      startLine: target.startLine,
      endLine: target.endLine,
      label: `[target ${idx + 1}/${targets.length}]`,
      message: target.message,
      snippet: target.snippet,
      promptEnrichment: buildTargetPromptEnrichment(target.file, target.startLine, target.endLine),
    }));
  },
};
