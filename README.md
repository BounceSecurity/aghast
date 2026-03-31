# AI Guided Hybrid Application Static Testing (AGHAST) - ALPHA VERSION

![Status: Alpha](https://img.shields.io/badge/Status-Alpha-orange)
[![CI](https://github.com/BounceSecurity/aghast/actions/workflows/ci.yml/badge.svg)](https://github.com/BounceSecurity/aghast/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![By Bounce Security](https://img.shields.io/badge/By-Bounce_Security-f79421)](https://bouncesecurity.com/)

> **Warning**
> AGHAST is in **early alpha**. APIs, CLI flags, configuration formats, and output schemas may change between releases without notice. Use in production CI/CD pipelines at your own risk.

An open source tool that combines static scanning rules with AI prompts to find code-specific and company-specific security issues.

Define static rules, security checks as markdown instructions, point AGHAST at a repo, and get structured results (JSON or SARIF).

<p align="center">
  <img src="/assets/img/aghastbouncecaption.png" alt="AGHAST" width="50%">
</p>

## What AGHAST Does

You can read the full background to this tool in our blogpost [here](https://bouncesecurity.com/aghast) but, to cut to the chase, AGHAST uses three core mechanisms:

- **Repository-wide AI analysis** — let the LLM analyze the whole repo against your security check instructions
- **Targeted checks** — a pluggable discovery method (Semgrep rules, [OpenAnt](https://github.com/knostic/OpenAnt/) code units, or external SARIF findings) identifies specific code locations, then AI analyzes each independently. This is the sweet spot for most use cases
- **Static checks** — a discovery method (e.g., Semgrep) finds issues mapped directly to results with no AI involvement, for when a traditional static rule is all you need

The beauty of the approach is what you *don't* need:

- You don't need to modify the code
- You don't need to build something into the codebase
- You don't need to write code in the language of the codebase

All you need is:

- Access to the codebase
- An understanding of the problem you are trying to discover
- The ability to write some simple rules

There are almost certainly other ways of achieving this, but to our mind, this approach is both straightforward and deterministic.

## Prerequisites

- **Node.js 20+**
- **[Semgrep Community Edition](https://semgrep.dev/docs/getting-started/)** (LGPL-2.1, optional) — only needed for checks that use Semgrep discovery
- **[OpenAnt](https://github.com/knostic/OpenAnt/)** (Apache-2.0, optional) + **Python 3.11+** — only needed for checks that use OpenAnt discovery
- **Anthropic API key** — for AI-based checks (not needed for static checks)

## Installation

See the [Getting Started Guide](docs/getting-started.md) for full installation and setup instructions.

## Quick Start

Set your API key, create a check, and run a scan:

```bash
export ANTHROPIC_API_KEY=your-api-key
aghast new-check --config-dir ./my-checks
aghast scan /path/to/target-repo --config-dir ./my-checks
```

See the [Getting Started Guide](docs/getting-started.md) for a full walkthrough.

## Example Output

Results are structured JSON (or SARIF) with per-check status and detailed issues:

```json
{
  "checks": [
    { "checkId": "aghast-api-authz", "checkName": "API Authorization Check", "status": "FAIL", "issuesFound": 1 },
    { "checkId": "aghast-sql-injection", "checkName": "SQL Injection Prevention", "status": "PASS", "issuesFound": 0 }
  ],
  "issues": [
    {
      "checkId": "aghast-api-authz",
      "checkName": "API Authorization Check",
      "file": "src/api/users.ts",
      "startLine": 45,
      "endLine": 52,
      "description": "Missing authorization check on DELETE endpoint.",
      "codeSnippet": "router.delete('/users/:id', async (req, res) => {"
    }
  ],
  "summary": {
    "totalChecks": 2,
    "passedChecks": 1,
    "failedChecks": 1,
    "flaggedChecks": 0,
    "errorChecks": 0,
    "totalIssues": 1
  }
}
```

## Documentation

- [Getting Started](docs/getting-started.md) — installation, setup, and first scan
- [Trying It Out](docs/trying-it-out.md) — example checks walkthrough and first scan guide
- [Scanning](docs/scanning.md) — scan command options, environment variables, output formats
- [Creating Checks](docs/creating-checks.md) — scaffolding new security checks
- [Configuration Reference](docs/configuration.md) — check schemas, check types, runtime config
- [Development](docs/development.md) — setup, building, testing, releasing

## Contributing

We welcome bug reports and feature requests via [GitHub Issues](https://github.com/BounceSecurity/aghast/issues). We are not currently accepting pull requests.

## License

This project is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).

Copyright (C) 2026 [Bounce Consulting Ltd.](https://bouncesecurity.com/)
