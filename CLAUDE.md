# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**aghast** — AI Guided Hybrid Application Static Testing. An automated security analysis system that uses LLMs to perform security audits on source code repositories. Licensed under GNU AGPL v3.

## Toolchain

- **Language**: TypeScript (Node.js)
- **Package Manager**: pnpm
- **AI SDK**: `@anthropic-ai/claude-agent-sdk`
- **Test Framework**: `node:test` with `node:assert` (Node.js built-in)

## Architecture

Five core components orchestrated by the Security Scanner:

1. **Security Scanner** — Orchestrator that coordinates the scan workflow, executes checks, and aggregates results
2. **Check Library** — Two-layer config: loads check registry from `checks-config.json` (Layer 1: id, repositories, enabled) and per-check definitions from `checks/<id>/<id>.json` (Layer 2: name, instructions, severity, checkTarget) within a config directory specified via `--config-dir`. Merges layers, filters by repository, loads markdown instructions from each check folder.
3. **AI Provider** — Abstraction layer over LLM APIs (reference impl: Claude Code)
4. **Repository Analyzer** — Extracts Git metadata (remote URL, branch, commit) from target repos
5. **Report Generator** — Produces `security_checks_results.json` (or `.sarif`) conforming to the `ScanResults` schema

**Scan workflow**: User initiates → repo metadata extracted → checks filtered for repo → for each check: load instructions (if applicable), discover targets (Semgrep for multi-target/semgrep-only), AI analyzes (or map findings directly for semgrep-only), results parsed → aggregate → JSON report → exit code.

**Check types**: Repository-wide (AI analyzes whole repo), multi-target (Semgrep discovers specific code locations, AI analyzes each independently), or semgrep-only (Semgrep findings mapped directly to issues, no AI involvement).

## Key Data Flow

- Check instructions are markdown files prepended with a generic prompt template
- AI returns `{"issues": [...]}` JSON — parsed into `SecurityIssue[]`
- Issues enriched with `checkId`, `checkName`, `codeSnippet` by the scanner
- Final status per check: PASS (no issues), FAIL (issues found), ERROR (execution failed)

## Testing

- All tests use `node:test` and `node:assert` — no external test dependencies
- AI provider must be mocked/stubbed in all tests — never depend on live API access
- Tests must pass without `ANTHROPIC_API_KEY` set
- Test fixtures live alongside tests: sample configs, markdown checks, AI responses, SARIF output
- GitHub Actions CI runs on push to main and all PRs
- The CLI supports `AGHAST_MOCK_AI=true` to use a mock AI provider (no API key needed), or `AGHAST_MOCK_AI=<path>` to supply a custom response fixture file
- `AGHAST_MOCK_SEMGREP=<path>` — Provide a SARIF file to use instead of running Semgrep (for testing multi-target checks without Semgrep installed)
- `AGHAST_SKIP_SEMGREP_TESTS=true` — Skip real Semgrep integration tests (used in CI main job; Semgrep tests run in a separate CI job)
- **When adding new functionality, always add CLI-level integration tests** in `tests/cli-mock-mode.test.ts` that spawn the real CLI process with `AGHAST_MOCK_AI=true`. These tests exercise the full pipeline (prompt building, response parsing, snippet extraction, issue enrichment, report generation) end-to-end. Include tests for PASS, FAIL, and ERROR scenarios as appropriate.

## CLI

The `aghast` binary provides subcommands:

- `aghast scan <repo-path> --config-dir <path> [options]` — Run security checks against a repository
- `aghast new-check --config-dir <path> [options]` — Scaffold a new security check (bootstraps config dir if needed)
- `aghast --help` — Show usage
- `aghast --version` — Print version from package.json

The unified entry point is `src/cli.ts` which routes to `runScan()` (from `src/index.ts`) or `runNewCheck()` (from `src/new-check.ts`). Both functions accept `args: string[]` and are exported for programmatic use.

## Commands

- `pnpm test` — Run all tests
- `pnpm test:ci` — Run all tests with spec and JUnit reporters (for CI)
- `pnpm test:semgrep` — Run real Semgrep integration tests (requires Semgrep installed)
- `pnpm build` — Compile TypeScript
- `pnpm lint` — Run ESLint on src/ and tests/
- `pnpm lint:fix` — Run ESLint with auto-fix on src/ and tests/
- `pnpm scan -- <repo-path> --config-dir <path> [--output <path>] [--output-format json|sarif] [--fail-on-check-failure] [--debug] [--model <model>] [--ai-provider <name>] [--generic-prompt <file>] [--runtime-config <path>]` — Run checks (`--config-dir` required, default format: `json`, default output: `<repo-path>/security_checks_results.<ext>`, exit 1 on FAIL/ERROR with `--fail-on-check-failure`, `--debug` enables verbose output). Precedence: CLI flags > env vars > runtime config > defaults.
- `pnpm new-check -- --config-dir <path> [--id <id> --name <name> ...]` — Interactive CLI to scaffold a new check (creates check folder with `<id>.json`, `<id>.md`, optional `<id>.yaml` Semgrep rule + tests; appends to `checks-config.json`). Bootstraps config directory if it doesn't exist.

## Check Definitions (External)

Security check definitions and test codebases are maintained in a separate config directory (not in this repo). Use `--config-dir` to point the scanner at your checks:

```bash
pnpm scan -- /path/to/target-repo --config-dir /path/to/checks-config
```

For local development, clone your checks repo as `checks-config/` (gitignored) inside this repo:

```bash
git clone <checks-repo-url> checks-config
pnpm scan -- /path/to/target --config-dir checks-config
```

## Environment Variables

- `ANTHROPIC_API_KEY` — Required for Claude Code AI provider (unless `AGHAST_LOCAL_CLAUDE=true`)
- `AGHAST_CONFIG_DIR` — Default config directory (CLI `--config-dir` takes precedence)
- `AGHAST_AI_MODEL` — AI model override (CLI `--model` takes precedence)
- `AGHAST_GENERIC_PROMPT` — Generic prompt template filename (CLI `--generic-prompt` takes precedence)
- `AGHAST_DEBUG` — Set to `true` to enable debug output (same as `--debug`)
- `AGHAST_LOCAL_CLAUDE` — Set to `true` to use local Claude instead of API
- `AGHAST_MOCK_AI` — Enables mock AI provider. Set to `true` for default `{"issues":[]}` response, or set to a file path
- `AGHAST_MOCK_SEMGREP` — Path to SARIF file for mock Semgrep output
- `AGHAST_DEBUG_PRINTPROMPT` — Print full prompts (requires `--debug`)
- `NO_COLOR` — Set to `1` to disable colored CLI output (standard; respected automatically by `picocolors`)

## Runtime Configuration

An optional `runtime-config.json` in the config directory (or via `--runtime-config`) sets defaults. See [docs/configuration.md](docs/configuration.md) for the full schema.

Precedence: CLI flags > environment variables > runtime config > built-in defaults.

## Key Files

- `src/cli.ts` — Unified CLI entry point with subcommand router (`scan`, `new-check`, `--help`, `--version`)
- `src/index.ts` — Scan CLI entry point and argument parsing (exports `runScan(args)`); validates config dir structure
- `src/scan-runner.ts` — Security Scanner orchestrator (`runMultiScan` for config-based multi-check; `executeMultiTargetCheck` for Semgrep-based checks with concurrent target analysis via `mapWithConcurrency`)
- `src/claude-code-provider.ts` — Claude Code AI provider implementation using `@anthropic-ai/claude-agent-sdk`
- `src/prompt-template.ts` — Prompt builder (prepends generic instructions to check markdown)
- `src/snippet-extractor.ts` — Code snippet extractor (extracts lines from source files for issue enrichment)
- `src/sarif-parser.ts` — SARIF 2.1.0 parser for Semgrep output (`parseSARIF`, `deduplicateTargets`, `limitTargets`)
- `src/semgrep-runner.ts` — Semgrep execution with mock support (`runSemgrep`, `buildSemgrepArgs`)
- `src/check-library.ts` — Check Library: two-layer config loading (`loadCheckRegistry`, `loadCheckDefinition`, `discoverCheckFolders`, `resolveChecks`), validation, repository matching, markdown parsing, path filtering
- `src/repository-analyzer.ts` — Git metadata extraction (remote URL, branch, commit)
- `src/response-parser.ts` — AI response JSON parser
- `src/types.ts` — Shared type definitions (ScanResults, RepositoryInfo, SecurityIssue, etc.); includes `RuntimeConfig`
- `src/error-codes.ts` — Trackable error codes and formatting helpers (`formatError`, `formatFatalError`)
- `src/colors.ts` — Color helpers for CLI output (wraps `picocolors`, respects `NO_COLOR`)
- `src/logging.ts` — Logging utilities
- `src/runtime-config.ts` — Runtime configuration loader (`loadRuntimeConfig`); supports `--runtime-config` CLI flag
- `src/new-check.ts` — Check scaffolding CLI utility (exports `runNewCheck(args)`); bootstraps config directory
- `src/formatters/index.ts` — Formatter registry
- `src/formatters/json-formatter.ts` — JSON output formatter
- `src/formatters/sarif-formatter.ts` — SARIF output formatter
- `src/formatters/types.ts` — Formatter type definitions
- `.github/workflows/release.yml` — Release workflow (version bump, README update, tag, build, GitHub release)
- `eslint.config.js` — ESLint flat config (TypeScript + recommended rules)
- `config/prompts/` — Generic prompt templates prepended to all check executions (selected via `--generic-prompt` or `AGHAST_GENERIC_PROMPT`)
- `docs/README.md` — Documentation index
- `docs/getting-started.md` — Getting started guide (installation, setup)
- `docs/trying-it-out.md` — Example checks walkthrough and first scan guide
- `docs/scanning.md` — Scan command reference (CLI options, env vars, output formats)
- `docs/creating-checks.md` — Creating checks reference (new-check CLI, what gets created)
- `docs/configuration.md` — Full configuration reference (check types, Layer 1/2 schemas, runtime config)
- `docs/development.md` — Development setup, building, testing, releasing
- `tests/` — All test files with fixtures in `tests/fixtures/`

## Conventions

- **Error codes**: All CLI error paths must use codes from `src/error-codes.ts` via `formatError()`. Numbering scheme: E1xxx=CLI parsing, E2xxx=configuration, E3xxx=AI provider, E4xxx=repository/target validation, E5xxx=Semgrep, E9xxx=internal/fatal.
- **Color output**: Use helpers from `src/colors.ts` for colored output, never raw ANSI codes. The `NO_COLOR` env var is respected automatically via `picocolors`.

## Development Workflow

### Release Workflow

Releases are created via the `release.yml` GitHub Actions workflow (triggered manually via `workflow_dispatch`):

1. Input a version (e.g. `1.2.0`) — must be semver, strictly greater than current
2. Workflow updates `package.json` version and README install command, commits to main
3. Creates git tag `v<version>`, builds, packs, publishes to GitHub Packages, creates GitHub Release with tarball

Users install via `npm install -g @bouncesecurity/aghast@<version>` (requires `~/.npmrc` with `@bouncesecurity` scope config).

## Documentation

Doc pages in `docs/` have navigation (index breadcrumb, previous/next links). When adding, removing, or reordering doc pages, update the navigation links in all affected pages and the index in `docs/README.md`. The page order is: Getting Started → Trying It Out → Scanning → Creating Checks → Configuration Reference → Development.

## Licensing
This project is licensed under AGPL v3. Copyright (C) 2026 Bounce Consulting Ltd.

When setting up or modifying this repository:
- Ensure a `LICENSE` file exists in the root containing the full AGPLv3 license text
- Ensure `README.md` includes a ## License section with the AGPLv3 badge and link to LICENSE file
- If a new package.json, pyproject.toml, Cargo.toml, or similar manifest is created, ensure the license field is set to "AGPL-3.0-or-later"
- Do NOT add copyright headers to individual source files