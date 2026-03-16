<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="creating-checks.md">&larr; Creating Checks</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">&uarr; Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="development.md">Development &rarr;</a>
</p>

---

# Configuration Reference

This document describes the full configuration schema for aghast security checks.

## Config Directory Structure

The config directory (specified via `--config-dir`) contains all check definitions and optional runtime configuration:

```
my-checks/
  checks-config.json          # Layer 1: which checks exist, per-repo filtering
  checks/
    aghast-xss/
      aghast-xss.json         # Layer 2: check definition (name, severity, type)
      aghast-xss.md           # AI instructions (not needed for semgrep-only)
    aghast-sqli/
      aghast-sqli.json
      aghast-sqli.md
      aghast-sqli.yaml        # Semgrep rule (for semgrep/semgrep-only checks)
      tests/                  # Semgrep rule test files
        aghast-sqli.py        # .py, .js, or .ts based on --language
  runtime-config.json          # (Optional) AI provider & reporting overrides
```

Use `aghast new-check --config-dir <path>` to bootstrap this structure. If the directory doesn't exist, it will be created automatically.

## Layer 1: checks-config.json

The check registry controls which checks are available and which repositories they apply to.

```json
{
  "checks": [
    {
      "id": "aghast-xss",
      "repositories": ["https://github.com/org/frontend-app"],
      "enabled": true
    },
    {
      "id": "aghast-sqli",
      "repositories": [],
      "enabled": true
    }
  ]
}
```

| Field          | Type       | Required | Description |
|----------------|------------|----------|-------------|
| `id`           | `string`   | Yes      | Unique check ID (must match the check folder name) |
| `repositories` | `string[]` | Yes      | Repository URLs this check applies to. Empty array `[]` means all repositories |
| `enabled`      | `boolean`  | No       | Set to `false` to disable a check (default: `true`) |

## Layer 2: Check Definition (`<id>.json`)

Each check folder contains a JSON definition file with the check's metadata.

**Repository check** (AI analyzes the whole repo):

```json
{
  "id": "aghast-xss",
  "name": "XSS Prevention",
  "instructionsFile": "aghast-xss.md",
  "severity": "high",
  "confidence": "medium"
}
```

**Multi-target check** (Semgrep finds code locations, AI analyzes each):

```json
{
  "id": "aghast-sqli",
  "name": "SQL Injection",
  "instructionsFile": "aghast-sqli.md",
  "severity": "critical",
  "confidence": "high",
  "checkTarget": {
    "type": "semgrep",
    "rules": "aghast-sqli.yaml",
    "maxTargets": 50,
    "concurrency": 3
  }
}
```

**Semgrep-only check** (Semgrep findings mapped directly, no AI):

```json
{
  "id": "aghast-hardcoded-secrets",
  "name": "Hardcoded Secrets",
  "severity": "critical",
  "confidence": "high",
  "checkTarget": {
    "type": "semgrep-only",
    "rules": "aghast-hardcoded-secrets.yaml"
  }
}
```

| Field              | Type                          | Required | Description |
|--------------------|-------------------------------|----------|-------------|
| `id`               | `string`                      | Yes      | Must match the Layer 1 registry ID and folder name |
| `name`             | `string`                      | Yes      | Human-readable check name |
| `instructionsFile`  | `string`                     | Yes*     | Markdown file with AI instructions (*not needed for semgrep-only) |
| `severity`         | `string`                      | No       | `critical`, `high`, `medium`, `low`, or `informational` |
| `confidence`       | `string`                      | No       | `high`, `medium`, or `low` |
| `checkTarget`      | `object`                      | No       | Semgrep target configuration (omit for repository checks) |
| `checkTarget.type` | `string`                      | Yes**    | `semgrep` or `semgrep-only` (**required if `checkTarget` present) |
| `checkTarget.rules`| `string` or `string[]`        | Yes**    | Semgrep rule file path(s) relative to check folder |
| `checkTarget.maxTargets` | `number`               | No       | Limit number of Semgrep targets to analyze |
| `checkTarget.concurrency` | `number`              | No       | Max parallel AI analyses for multi-target (default: 5) |
| `applicablePaths`  | `string[]`                    | No       | Glob patterns to include (e.g. `["src/**/*.ts"]`) |
| `excludedPaths`    | `string[]`                    | No       | Glob patterns to exclude (e.g. `["tests/**"]`) |

## Check Types

| Type | Semgrep Required? | AI Required? | Description |
|------|-------------------|--------------|-------------|
| `repository` | No | Yes | AI analyzes the entire repository against the instructions |
| `semgrep` | Yes | Yes | Semgrep discovers specific code locations, AI analyzes each one |
| `semgrep-only` | Yes | No | Semgrep findings are mapped directly to issues, no AI needed |

## Check Instructions (`<id>.md`)

The markdown file contains instructions for the AI. It is prepended with a generic prompt template before being sent. A typical structure:

```markdown
### Check Name

#### Overview
What this check looks for and why it matters.

#### What to Check
1. First thing to verify
2. Second thing to verify

#### Result
- **PASS**: When the code meets requirements
- **FAIL**: When the code has issues
- **FLAG**: When human review is needed (optional)
```

## Check Result Statuses

| Status | Meaning |
|--------|---------|
| `PASS` | No issues found — the code meets the check requirements |
| `FAIL` | Issues found — the code does not meet the check requirements |
| `FLAG` | AI is uncertain — human review is recommended |
| `ERROR` | The check could not be completed (e.g. AI provider error) |

When multiple targets are analyzed, the overall status is the worst: FAIL > FLAG > ERROR > PASS.

## Creating New Checks

Use the scaffolding CLI to create a new check in your config directory:

```bash
aghast new-check --config-dir /path/to/your-checks
```

If the config directory doesn't exist, it will be created with an empty registry. Run `aghast new-check --help` for all available flags.

## Runtime Configuration

An optional `runtime-config.json` file in the config directory (or specified via `--runtime-config`) sets defaults for scan options. All fields are optional — if the file is absent, built-in defaults are used.

```json
{
  "aiProvider": {
    "name": "claude-code",
    "model": "claude-sonnet-4-20250514"
  },
  "reporting": {
    "outputDirectory": "/path/to/results",
    "outputFormat": "json"
  },
  "genericPrompt": "generic-instructions.md",
  "failOnCheckFailure": false
}
```

| Field                           | Type       | Default | Description |
|---------------------------------|------------|---------|-------------|
| `aiProvider.name`               | `string`   | `claude-code` | AI provider name |
| `aiProvider.model`              | `string`   | (provider default) | Model ID override |
| `reporting.outputDirectory`     | `string`   | (target repo) | Directory for result files |
| `reporting.outputFormat`        | `string`   | `json` | Output format: `json` or `sarif` |
| `genericPrompt`                 | `string`   | `generic-instructions.md` | Generic prompt template filename |
| `failOnCheckFailure`            | `boolean`  | `false` | Exit with code 1 if any check FAILs or ERRORs |

**Precedence**: CLI flags > environment variables > runtime config > built-in defaults.

If the file is present but contains invalid JSON, the CLI exits with an error.

---

<p align="center">
  <a href="creating-checks.md">&larr; Creating Checks</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="development.md">Development &rarr;</a>
</p>
