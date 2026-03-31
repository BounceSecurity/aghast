<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="configuration.md">&larr; Configuration Reference</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">&uarr; Documentation Index</a>
</p>

---

# Development

## Setup

Clone the repo and install dependencies:

```bash
git clone https://github.com/BounceSecurity/aghast.git
cd aghast
pnpm install
```

Run this again after pulling changes to keep dependencies in sync with the lockfile.

During development, you can use the pnpm scripts directly:

```bash
pnpm scan -- <repo-path> [options]
pnpm new-check -- [options]
pnpm build
pnpm test
pnpm test:ci        # Run tests with spec and JUnit reporters (for CI)
pnpm test:semgrep   # Run real Semgrep integration tests (requires Semgrep installed)
pnpm lint
pnpm lint:fix       # Run ESLint with auto-fix
```

## Releasing

Releases are created via the **Release** GitHub Actions workflow (`workflow_dispatch`):

1. Go to **Actions > Release > Run workflow**
2. Enter the new version (e.g. `1.2.0`) — must be semver, strictly greater than the current version
3. The workflow automatically:
   - Updates `package.json` version and README install commands
   - Commits to main and creates a `v<version>` git tag
   - Builds and packs a tarball
   - Publishes to npmjs registry
   - Creates a GitHub Release with the tarball attached

---

<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="configuration.md">&larr; Configuration Reference</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">&uarr; Documentation Index</a>
</p>
