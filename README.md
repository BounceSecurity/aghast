# AI Guided Hybrid Application Static Testing (AGHAST) - ALPHA VERSION

![Status: Alpha](https://img.shields.io/badge/Status-Alpha-orange)
[![CI](https://github.com/BounceSecurity/aghast/actions/workflows/ci.yml/badge.svg)](https://github.com/BounceSecurity/aghast/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![By Bounce Security](https://img.shields.io/badge/By-Bounce_Security-f79421)](https://bouncesecurity.com/)

> **Warning**
> AGHAST is in **early alpha**. APIs, CLI flags, configuration formats, and output schemas may change between releases without notice. Use in production CI/CD pipelines at your own risk.

You know what your key code security concerns are. But how do you check for them in a way that is automatable, repeatable and scalable? If generic SAST is doing this for you, feel free to stop reading now 😀.

For the rest of us, AGHAST is an open-source framework that lets you define and check for these concerns. It blends the advantages of static discovery and AI-powered analysis to efficiently find code-specific and company-specific security issues.

Define your checks, which repositories they relate to, and get accurate and structured results (JSON or SARIF).

<p align="center">
  <img src="/assets/img/aghastbouncecaption.png" alt="AGHAST" width="50%">
</p>

## What AGHAST Does

You can read the full background to this tool in our blogpost [here](https://bouncesecurity.com/aghast). For a conceptual walkthrough of how each check type works, see [How It Works](docs/how-it-works.md).

To cut to the chase, AGHAST uses three core mechanisms:

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

## Quick Start

See the [Getting Started guide](docs/getting-started.md) to install aghast and [Trying It Out](docs/trying-it-out.md) to run your first scan.

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

- [How It Works](docs/how-it-works.md) — conceptual overview of the three check types
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
