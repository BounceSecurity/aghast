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
      aghast-xss.md           # AI instructions (not needed for static, openant, or sarif checks)
    aghast-sqli/
      aghast-sqli.json
      aghast-sqli.md
      aghast-sqli.yaml        # Semgrep rule (for checks with semgrep discovery)
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

**Targeted check with Semgrep discovery** (Semgrep finds code locations, AI analyzes each):

```json
{
  "id": "aghast-sqli",
  "name": "SQL Injection",
  "instructionsFile": "aghast-sqli.md",
  "severity": "critical",
  "confidence": "high",
  "checkTarget": {
    "type": "targeted",
    "discovery": "semgrep",
    "rules": "aghast-sqli.yaml",
    "maxTargets": 50,
    "concurrency": 3
  }
}
```

**Static check with Semgrep discovery** (Semgrep findings mapped directly, no AI):

```json
{
  "id": "aghast-hardcoded-secrets",
  "name": "Hardcoded Secrets",
  "severity": "critical",
  "confidence": "high",
  "checkTarget": {
    "type": "static",
    "discovery": "semgrep",
    "rules": "aghast-hardcoded-secrets.yaml"
  }
}
```

**Targeted check with SARIF discovery** (external SARIF findings validated by AI):

```json
{
  "id": "aghast-sast-verify",
  "name": "SAST Finding Verification",
  "instructionsFile": "aghast-sast-verify.md",
  "severity": "high",
  "confidence": "medium",
  "checkTarget": {
    "type": "targeted",
    "discovery": "sarif",
    "sarifFile": "./example-findings.sarif"
  }
}
```

**Targeted check with OpenAnt discovery** (code units analyzed by AI):

```json
{
  "id": "aghast-openant-review",
  "name": "OpenAnt Security Review",
  "instructionsFile": "aghast-openant-review.md",
  "severity": "high",
  "confidence": "medium",
  "checkTarget": {
    "type": "targeted",
    "discovery": "openant",
    "maxTargets": 50,
    "concurrency": 3,
    "openant": {
      "securityClassifications": ["exploitable", "vulnerable_internal"],
      "excludeUnitTypes": ["test", "dunder_method"]
    }
  }
}
```

| Field              | Type                          | Required | Description |
|--------------------|-------------------------------|----------|-------------|
| `id`               | `string`                      | Yes      | Must match the Layer 1 registry ID and folder name |
| `name`             | `string`                      | Yes      | Human-readable check name |
| `instructionsFile`  | `string`                     | Yes*     | Markdown file with AI instructions (*not needed for `static` checks or `targeted` checks with `openant`/`sarif` discovery — these have self-contained generic prompts) |
| `severity`         | `string`                      | No       | `critical`, `high`, `medium`, `low`, or `informational` |
| `confidence`       | `string`                      | No       | `high`, `medium`, or `low` |
| `model`            | `string`                      | No       | AI model override for this check (e.g. `claude-sonnet-4-20250514`). Takes precedence over CLI `--model` and runtime config |
| `checkTarget`      | `object`                      | No       | Target configuration (omit for repository checks) |
| `checkTarget.type` | `string`                      | Yes**    | `repository`, `targeted`, or `static` (**required if `checkTarget` present) |
| `checkTarget.discovery` | `string`                 | Yes***   | Discovery method: `semgrep`, `sarif`, or `openant` (***required for `targeted` and `static` types) |
| `checkTarget.rules`| `string` or `string[]`        | Yes****  | Semgrep rule file path(s) relative to check folder (****only for `semgrep` discovery) |
| `checkTarget.sarifFile` | `string`                 | Yes***** | Path to SARIF file relative to check folder (*****only for `sarif` discovery) |
| `checkTarget.maxTargets` | `number`               | No       | Limit number of targets/units to analyze |
| `checkTarget.concurrency` | `number`              | No       | Max parallel AI analyses for targeted checks (default: 5) |
| `checkTarget.openant` | `object`                  | No       | OpenAnt unit filter config (only for `openant` discovery). See below |
| `checkTarget.openant.unitTypes` | `string[]`       | No       | Include only these unit types (e.g. `["function", "method"]`) |
| `checkTarget.openant.excludeUnitTypes` | `string[]` | No      | Exclude these unit types (e.g. `["test", "dunder_method"]`) |
| `checkTarget.openant.securityClassifications` | `string[]` | No | Filter by OpenAnt classification (e.g. `["exploitable", "vulnerable_internal"]`) |
| `checkTarget.openant.reachableOnly` | `boolean`    | No       | Only include units reachable from entry points |
| `checkTarget.openant.entryPointsOnly` | `boolean`  | No       | Only include entry point units |
| `checkTarget.openant.minConfidence` | `number`     | No       | Minimum classification confidence (0-1) |
| `applicablePaths`  | `string[]`                    | No       | Glob patterns to include (e.g. `["src/**/*.ts"]`) |
| `excludedPaths`    | `string[]`                    | No       | Glob patterns to exclude (e.g. `["tests/**"]`) |

## Check Types

| Type | AI Required? | Description |
|------|--------------|-------------|
| `repository` | Yes | AI analyzes the entire repository against the instructions |
| `targeted` | Yes | A discovery method finds specific code locations, AI analyzes each one |
| `static` | No | A discovery method finds code locations, findings are mapped directly to issues (no AI needed) |

### Discovery Methods

The `discovery` field on `checkTarget` specifies how targets are found for `targeted` and `static` checks:

| Discovery | Requires | Description |
|-----------|----------|-------------|
| `semgrep` | Semgrep installed | Runs Semgrep rules to discover specific code locations |
| `sarif` | SARIF file in check definition (`sarifFile`) | Reads findings from an external SARIF file |
| `openant` | OpenAnt + Python 3.11+ | Runs `openant parse` on the target repo to extract code units with call graph context |

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
  "logging": {
    "logFile": "/path/to/scan.log",
    "logType": "file",
    "level": "info"
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
| `logging.logFile`               | `string`   | (none) | Path to log file. When set, all log output is written to this file |
| `logging.logType`               | `string`   | `file` | Log file handler type. Pluggable — currently only `file` is supported |
| `logging.level`                 | `string`   | `info` | Console log level: `error`, `warn`, `info`, `debug`, `trace` |
| `genericPrompt`                 | `string`   | `generic-instructions.md` | Generic prompt template filename |
| `failOnCheckFailure`            | `boolean`  | `false` | Exit with code 1 if any check FAILs or ERRORs |

**Precedence**: CLI flags > environment variables > runtime config > built-in defaults.

If the file is present but contains invalid JSON, the CLI exits with an error.

---

<p align="center">
  <a href="creating-checks.md">&larr; Creating Checks</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="development.md">Development &rarr;</a>
</p>
