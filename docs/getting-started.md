<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="how-it-works.md">&larr; How It Works</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">&uarr; Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="trying-it-out.md">Trying It Out &rarr;</a>
</p>

---

# Getting Started with aghast

This guide walks you through installing aghast and setting up your environment.

## Prerequisites

- **Node.js 20+**
- **[Semgrep Community Edition](https://semgrep.dev/docs/getting-started/)** (LGPL-2.1) - only required if your checks use `semgrep` discovery
- **[OpenAnt](https://github.com/knostic/OpenAnt)** + **Python 3.11+** + **Go** (for building) - only required if your checks use `openant` discovery
- **Anthropic API key** - required for AI-based checks (`repository` and `targeted` types; not needed for `static` checks)

## 1. Install aghast

```bash
npm install -g @bouncesecurity/aghast@0.3.2
```

To uninstall:

```bash
npm uninstall -g @bouncesecurity/aghast
```

## 2. Set up your API key

```bash
export ANTHROPIC_API_KEY=your-api-key
```

This is required for `repository` and `targeted` checks. You can skip this step if you only plan to run `static` checks.

## What's next

Head to [Trying It Out](trying-it-out.md) to run your first scan, either using pre-built example checks or by creating your own.

---

<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="how-it-works.md">&larr; How It Works</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">&uarr; Documentation Index</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="trying-it-out.md">Trying It Out &rarr;</a>
</p>
