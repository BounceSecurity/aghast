<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="scanning.md">&larr; Scanning</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">&uarr; Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="configuration.md">Configuration Reference &rarr;</a>
</p>

---

# Creating Checks

Scaffold new security checks using the `aghast new-check` CLI.

## Usage

```bash
aghast new-check --config-dir <path> [options]
```

Scaffolds a new security check interactively. Any values not provided via flags are prompted for. If the config directory doesn't exist, it will be created with an empty registry.

| Option | Description |
|--------|-------------|
| `--config-dir <path>` | **(Required)** Config directory to create the check in |
| `--id <id>` | Check ID (auto-prefixed with `aghast-` if needed) |
| `--name <name>` | Human-readable check name |
| `--check-type <type>` | `repository` (default), `semgrep`, `semgrep-only`, `sarif-verify`, or `openant-units` |
| `--severity <level>` | `critical`, `high`, `medium`, `low`, or `informational` |
| `--confidence <level>` | `high`, `medium`, or `low` |

Run `aghast new-check --help` for the full list of flags including `--check-overview`, `--check-items`, `--pass-condition`, `--fail-condition`, `--flag-condition`, `--repositories`, `--semgrep-rules`, `--max-targets`, and `--language`.

## What gets created

Running `new-check` creates a check folder in `<config-dir>/checks/<check-id>/` containing:

- `<id>.json` — check definition (name, severity, type, target config)
- `<id>.md` — markdown instructions for AI analysis (not created for `semgrep-only`, `sarif-verify`, or `openant-units` checks)
- `<id>.yaml` — Semgrep rule file (for `semgrep` and `semgrep-only` check types only)
- `tests/` — Semgrep rule test files (for `semgrep` and `semgrep-only` check types only)

The check is also registered in `checks-config.json`.

## Check definition schema

See the [Configuration Reference](configuration.md#layer-2-check-definition-idjson) for the full check definition schema, including check types, severity levels, Semgrep target configuration, and path filtering.

---

<p align="center">
  <a href="scanning.md">&larr; Scanning</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="configuration.md">Configuration Reference &rarr;</a>
</p>
