<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="trying-it-out.md">&larr; Trying It Out</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">&uarr; Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="creating-checks.md">Creating Checks &rarr;</a>
</p>

---

# Scanning

Run security checks against a target repository.

## Usage

```bash
aghast scan <repo-path> --config-dir <path> [options]
```

| Option | Description |
|--------|-------------|
| `--config-dir <path>` | **(Required)** Config directory containing `checks-config.json` and `checks/` folder |
| `--output <path>` | Output file path (default: `<repo-path>/security_checks_results.<ext>`) |
| `--output-format json\|sarif` | Output format (default: `json`) |
| `--fail-on-check-failure` | Exit with code 1 if any check FAILs or ERRORs |
| `--debug` | Enable verbose debug output |
| `--model <model>` | AI model override (e.g. `claude-sonnet-4-20250514`) |
| `--ai-provider <name>` | AI provider name (default: `claude-code`) |
| `--generic-prompt <file>` | Generic prompt template filename |
| `--runtime-config <path>` | Path to runtime config file. Useful for setting persistent defaults instead of repeating CLI flags |

Run `aghast scan --help` for the full list of options.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key for Claude (required for AI-based checks) |
| `AGHAST_CONFIG_DIR` | Default config directory (CLI `--config-dir` takes precedence) |
| `AGHAST_AI_MODEL` | AI model override (CLI `--model` takes precedence) |
| `AGHAST_GENERIC_PROMPT` | Generic prompt template filename (CLI `--generic-prompt` takes precedence) |
| `AGHAST_DEBUG` | Set to `true` to enable debug output (same as `--debug`) |
| `NO_COLOR` | Set to `1` to disable colored CLI output ([standard](https://no-color.org/)) |

## Runtime Configuration

An optional `runtime-config.json` in the config directory (or specified via `--runtime-config`) sets defaults for scan options. See the [Configuration Reference](configuration.md#runtime-configuration) for the full schema.

**Precedence**: CLI flags > environment variables > runtime config > built-in defaults.

## Output Formats

Results are written to `security_checks_results.<ext>` in the target repo by default (override with `--output`).

- **JSON** (default) — structured results with summary, per-check details, issues, and token usage
- **SARIF** — SARIF 2.1.0 output compatible with GitHub Code Scanning and other SARIF viewers

## Check Types

aghast supports three types of security checks:

| Type | Semgrep? | AI? | Description |
|------|----------|-----|-------------|
| `repository` | No | Yes | AI analyzes the entire repository against markdown instructions |
| `semgrep` | Yes | Yes | Semgrep discovers specific code locations, AI analyzes each one |
| `semgrep-only` | Yes | No | Semgrep findings are mapped directly to issues (no AI needed, no API key needed) |

See the [Configuration Reference](configuration.md) for check definition schemas and result statuses.

---

<p align="center">
  <a href="trying-it-out.md">&larr; Trying It Out</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="creating-checks.md">Creating Checks &rarr;</a>
</p>
