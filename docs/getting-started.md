<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="README.md">&uarr; Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="scanning.md">Scanning &rarr;</a>
</p>

---

# Getting Started with aghast

This guide walks you through setting up aghast and running your first security scan.

## Prerequisites

- **Node.js 20+**
- **[Semgrep Community Edition](https://semgrep.dev/docs/getting-started/)** (LGPL-2.1) — only required if your checks use Semgrep rules (`semgrep` or `semgrep-only` check types)
- **Anthropic API key** — required for AI-based checks (not needed for `semgrep-only` checks)

## 1. Install aghast

```bash
npm install -g @bouncesecurity/aghast@0.0.13
```

To uninstall:

```bash
npm uninstall -g @bouncesecurity/aghast
```

## 2. Set up your API key

```bash
export ANTHROPIC_API_KEY=your-api-key
```

## Try it out with example checks

The [aghast-bounce-checks-public](https://github.com/BounceSecurity/aghast-bounce-checks-public) repository contains example security checks and sample codebases you can use to try out aghast without writing any checks yourself.

Clone the example repo:

```bash
git clone https://github.com/BounceSecurity/aghast-bounce-checks-public.git
```

The repo includes two example checks:

| Check | Type | Description |
|-------|------|-------------|
| `aghast-importantvalidations-mc` | `semgrep` (multi-target) | Checks that important validations are performed before AI queries. Uses Semgrep to find targets, then AI analyzes each one. |
| `aghast-py-missing-token-decorator` | `semgrep-only` | Detects Flask endpoints missing an API token decorator. Semgrep-only — no AI or API key needed. |

It also includes matching test codebases in `test-codebases/` that are pre-configured as target repositories in `checks-config.json`.

### Run a semgrep-only check (no API key needed)

The `aghast-py-missing-token-decorator` check is `semgrep-only`, so it requires Semgrep but **not** an Anthropic API key:

```bash
aghast scan ./aghast-bounce-checks-public/test-codebases/test-7-missing-token-decorator \
  --config-dir ./aghast-bounce-checks-public
```

### Run an AI-powered check

The `aghast-importantvalidations-mc` check uses Semgrep to discover targets and then sends each to the AI for analysis. This requires both Semgrep and an API key:

```bash
aghast scan ./aghast-bounce-checks-public/test-codebases/test-2-importantvalidations-easy \
  --config-dir ./aghast-bounce-checks-public
```

### Run against your own code

The checks in `checks-config.json` include a `repositories` field that limits which repos each check runs against. To run the example checks against your own repository, add your repo's path or remote URL to the `repositories` array for the relevant check, or use `"*"` to match all repositories. See the [Configuration Reference](configuration.md) for details.

## 3. Create your first check

Use `aghast new-check` to bootstrap a config directory and create your first security check:

```bash
aghast new-check --config-dir ./my-checks
```

This will:
- Create `./my-checks/checks-config.json` (the check registry) if it doesn't exist
- Interactively prompt you for check details (name, description, pass/fail conditions, etc.)
- Create a check folder in `./my-checks/checks/<check-id>/` with the check definition and instructions

You can also provide all values via flags for non-interactive use:

```bash
aghast new-check --config-dir ./my-checks \
  --id xss --name "XSS Prevention" \
  --check-overview "Verify the application uses proper output encoding" \
  --check-items "HTML encoding,JavaScript encoding,URL encoding" \
  --pass-condition "All outputs are properly encoded" \
  --fail-condition "Unencoded user input found in HTML output"
```

Run `aghast new-check --help` for all available flags.

## 4. Run a scan

```bash
aghast scan /path/to/target-repo --config-dir ./my-checks
```

Results are written to `security_checks_results.json` in the target repo by default.

## 5. Review results

The output file contains structured results with:
- A summary showing total checks, pass/fail/flag/error counts, and total issues
- Detailed issues with file paths, line numbers, descriptions, and code snippets
- Token usage and execution time

Use `--output-format sarif` for SARIF 2.1.0 output compatible with GitHub Code Scanning.

## What's next

- [Scanning](scanning.md) — all scan options, output formats, and environment variables
- [Creating Checks](creating-checks.md) — detailed guide to scaffolding checks
- [Configuration Reference](configuration.md) — config directory structure, check schemas, and runtime config

---

<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="README.md">&uarr; Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="scanning.md">Scanning &rarr;</a>
</p>
