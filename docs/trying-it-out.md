<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="getting-started.md">&larr; Getting Started</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">&uarr; Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="scanning.md">Scanning &rarr;</a>
</p>

---

# Trying It Out

Once you've [installed aghast](getting-started.md), you can either create your own check or try it out with pre-built examples.

## Option A: Create your own check

Use `aghast new-check` to scaffold a check tailored to your own codebase:

```bash
aghast new-check --config-dir ./my-checks
```

This will:
- Create the config directory and `checks-config.json` if they don't exist
- Prompt you for check details (name, description, pass/fail conditions, check type)
- Create a check folder with the definition file, instructions markdown, and optionally a Semgrep rule

You can also provide all values via flags for non-interactive use:

```bash
aghast new-check --config-dir ./my-checks \
  --id xss --name "XSS Prevention" \
  --check-overview "Verify the application uses proper output encoding" \
  --check-items "HTML encoding,JavaScript encoding,URL encoding" \
  --pass-condition "All outputs are properly encoded" \
  --fail-condition "Unencoded user input found in HTML output"
```

Run `aghast new-check --help` for all available options, or see [Creating Checks](creating-checks.md) for the full reference.

Then run your check:

```bash
aghast scan /path/to/target-repo --config-dir ./my-checks
```

Results are written to `security_checks_results.json` in the target repo by default. Use `--output-format sarif` for SARIF 2.1.0 output compatible with GitHub Code Scanning.

## Option B: Use the example checks

The [aghast-bounce-checks-public](https://github.com/BounceSecurity/aghast-bounce-checks-public) repository contains ready-to-run security checks with matching sample codebases. Clone it to get started:

```bash
git clone https://github.com/BounceSecurity/aghast-bounce-checks-public.git
```

The repo includes three example checks — one of each check type — with test codebases pre-configured in `checks-config.json`. Each example is described in detail below.

### Example 1: Business Logic Bypass (`repository` type)

**Check type**: `repository` — analyzes the whole codebase with AI. No Semgrep needed.

**What it does**: Looks for endpoints that process financial operations (orders, payments, refunds, coupons) without properly validating client-supplied values. For example, it flags endpoints that accept negative quantities, use client-supplied prices instead of database lookups, allow duplicate coupon applications, or permit refunds exceeding the original order total.

**Check definition** (`aghast-js-business-logic-bypass.json`):

```json
{
  "id": "aghast-js-business-logic-bypass",
  "name": "Business Logic Bypass",
  "instructionsFile": "aghast-js-business-logic-bypass.md",
  "severity": "high",
  "confidence": "medium"
}
```

Since there is no `checkTarget` field, this is a `repository` check — the AI receives the entire codebase and analyzes it according to the instructions in the markdown file. This is the simplest check type to create: you only need a JSON definition and a markdown instructions file.

**Test codebase**: `test-codebases/test-8-business-logic-bypass/` — a Node.js Express app with order and payment routes containing intentional business logic flaws.

**Run it** (requires API key, no Semgrep):

```bash
aghast scan ./aghast-bounce-checks-public/test-codebases/test-8-business-logic-bypass \
  --config-dir ./aghast-bounce-checks-public
```

---

### Example 2: Important Validations before AI Queries (`semgrep` multi-target type)

**Check type**: `semgrep` (multi-target) — Semgrep discovers specific code locations, then the AI analyzes each one independently.

**What it does**: Finds Python endpoints that call `send_ai_query()` and checks whether each one performs all four required validations before dispatching the query: role check (JWT manager role), query length check (< 1000 chars), business hours check (9–17 Mon–Fri), and malicious prompt check.

**Check definition** (`aghast-importantvalidations-mc.json`):

```json
{
  "id": "aghast-importantvalidations-mc",
  "name": "Important Validations before performing an AI query (Multi Target)",
  "instructionsFile": "aghast-importantvalidations-mc.md",
  "severity": "high",
  "confidence": "medium",
  "checkTarget": {
    "type": "semgrep",
    "rules": "aghast-importantvalidations-mc.yaml",
    "maxTargets": 9999
  }
}
```

The `checkTarget.type` of `semgrep` makes this a multi-target check. The Semgrep rule finds all functions containing a `send_ai_query()` call:

```yaml
rules:
  - id: aghast-importantvalidations-mc
    languages:
      - python
    severity: ERROR
    message: |
      API endpoint which communicates with the AI backend detected
    pattern: |
      def $FUNC_NAME():
        ...
        send_ai_query($DATA)
        ...
```

Each Semgrep match becomes a separate target. The AI then analyzes each target individually using the instructions from the markdown file, which describe what validations to look for.

**Test codebase**: `test-codebases/test-2-importantvalidations-easy/` — a Python Flask app with multiple route handlers that call the AI backend, some missing required validations.

**Run it** (requires API key + Semgrep):

```bash
aghast scan ./aghast-bounce-checks-public/test-codebases/test-2-importantvalidations-easy \
  --config-dir ./aghast-bounce-checks-public
```

---

### Example 3: Missing API Token Decorator (`semgrep-only` type)

**Check type**: `semgrep-only` — Semgrep findings are mapped directly to issues with no AI involvement.

**What it does**: Detects Flask route handlers that are missing the `@require_api_token` decorator, which would allow unauthenticated access. Health/status endpoints are excluded via a regex filter.

**Check definition** (`aghast-py-missing-token-decorator.json`):

```json
{
  "id": "aghast-py-missing-token-decorator",
  "name": "Missing API Token Decorator on Flask Endpoints",
  "severity": "high",
  "confidence": "high",
  "checkTarget": {
    "type": "semgrep-only",
    "rules": "aghast-py-missing-token-decorator.yaml"
  }
}
```

With `checkTarget.type` set to `semgrep-only`, there is no instructions file — the Semgrep rule does all the work:

```yaml
rules:
  - id: aghast-py-missing-token-decorator
    patterns:
      - pattern: |
          @$BP.route($PATH, ...)
          def $FUNC(...):
              ...
      - pattern-not: |
          @$BP.route($PATH, ...)
          @require_api_token
          def $FUNC(...):
              ...
      - metavariable-regex:
          metavariable: $PATH
          regex: ^(?!.*(health|ready|readiness|liveness|alive|ping|status))
    message: >
      Flask endpoint '$FUNC' is missing the @require_api_token decorator,
      allowing unauthenticated access to this API endpoint.
    languages: [python]
    severity: ERROR
```

Each Semgrep match is mapped directly to a `SecurityIssue` — no API key needed.

**Test codebase**: `test-codebases/test-7-missing-token-decorator/` — a Python Flask app with several route handlers, some missing the required decorator.

**Run it** (requires Semgrep, no API key):

```bash
aghast scan ./aghast-bounce-checks-public/test-codebases/test-7-missing-token-decorator \
  --config-dir ./aghast-bounce-checks-public
```

---

### Running example checks against your own code

The checks in `checks-config.json` include a `repositories` field that limits which repos each check runs against. To run the example checks against your own repository, add your repo's path or remote URL to the `repositories` array for the relevant check, or use `"*"` to match all repositories. See the [Configuration Reference](configuration.md) for details.

## What's next

- [Scanning](scanning.md) — all scan options, output formats, and environment variables
- [Creating Checks](creating-checks.md) — detailed reference for the `new-check` command
- [Configuration Reference](configuration.md) — config directory structure, check schemas, and runtime config

---

<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="getting-started.md">&larr; Getting Started</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">&uarr; Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="scanning.md">Scanning &rarr;</a>
</p>
