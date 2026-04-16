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
npm install
```

Run this again after pulling changes to keep dependencies in sync with the lockfile.

During development, you can use the npm scripts directly:

```bash
npm run scan -- <repo-path> [options]
npm run new-check -- [options]
npm run build
npm test
npm run test:coverage  # Run the unit test suite with Node.js coverage enabled
npm run test:ci        # Run tests with spec and JUnit reporters (for CI)
npm run test:semgrep   # Run real Semgrep integration tests (requires Semgrep installed)
npm run lint
npm run lint:fix       # Run ESLint with auto-fix
```

`npm run test:coverage` uses Node.js built-in test coverage support (`--experimental-test-coverage`) so contributors can measure coverage without adding a separate coverage toolchain.

## Releasing

Releases are created via the **Release** GitHub Actions workflow (`workflow_dispatch`):

1. Go to **Actions > Release > Run workflow**
2. Enter the new version (e.g. `1.2.0`). Must be semver, strictly greater than the current version
3. The workflow automatically:
   - Updates `package.json` version and README install commands
   - Commits to main and creates a `v<version>` git tag
   - Builds and packs a tarball
   - Publishes to npmjs registry
   - Creates a GitHub Release with the tarball attached

If a release fixes a disclosed security vulnerability, update the generated GitHub Release notes to explicitly call out the fix. Include the CVE ID when one has been assigned.

---

<p align="center">
  <strong>AGHAST Documentation</strong><br>
  <a href="configuration.md">&larr; Configuration Reference</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="README.md">&uarr; Documentation Index</a>
</p>
