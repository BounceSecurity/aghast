import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

async function loadFixture(relativePath: string): Promise<string> {
  return readFile(resolve(fixturesDir, relativePath), 'utf-8');
}

async function loadJsonFixture<T = unknown>(relativePath: string): Promise<T> {
  const content = await loadFixture(relativePath);
  return JSON.parse(content) as T;
}

describe('test fixtures', () => {
  describe('config fixtures', () => {
    it('loads valid config', async () => {
      const config = await loadJsonFixture<{ checks: unknown[] }>(
        'config/valid-config.json',
      );
      assert.ok(Array.isArray(config.checks));
      assert.equal(config.checks.length, 2);
    });

    it('loads empty checks config', async () => {
      const config = await loadJsonFixture<{ checks: unknown[] }>(
        'config/empty-checks-config.json',
      );
      assert.deepEqual(config.checks, []);
    });

    it('invalid config is not parseable', async () => {
      const raw = await loadFixture('config/invalid-config.json');
      assert.throws(() => JSON.parse(raw), SyntaxError);
    });
  });

  describe('ai-checks fixtures', () => {
    it('valid check has expected markdown structure', async () => {
      const content = await loadFixture('ai-checks/valid-check.md');
      assert.ok(content.includes('### SQL Injection Prevention'));
      assert.ok(content.includes('#### Overview'));
      assert.ok(content.includes('#### What to Check'));
      assert.ok(content.includes('#### Result'));
    });

    it('malformed check lacks expected structure', async () => {
      const content = await loadFixture('ai-checks/malformed-check.md');
      assert.ok(!content.includes('#### Overview'));
    });
  });

  describe('ai-response fixtures', () => {
    it('pass response has empty issues array', async () => {
      const response = await loadJsonFixture<{ issues: unknown[] }>(
        'ai-responses/pass-response.json',
      );
      assert.deepEqual(response.issues, []);
    });

    it('fail response has issues with required fields', async () => {
      const response = await loadJsonFixture<{
        issues: Array<{
          file: string;
          startLine: number;
          endLine: number;
          description: string;
        }>;
      }>('ai-responses/fail-response.json');
      assert.ok(response.issues.length > 0);
      for (const issue of response.issues) {
        assert.ok(typeof issue.file === 'string');
        assert.ok(typeof issue.description === 'string');
      }
    });

    it('malformed response is not valid JSON', async () => {
      const raw = await loadFixture('ai-responses/malformed-response.txt');
      assert.throws(() => JSON.parse(raw), SyntaxError);
    });

    it('missing-fields response lacks issues array', async () => {
      const response = await loadJsonFixture<Record<string, unknown>>(
        'ai-responses/missing-fields-response.json',
      );
      assert.equal(response.issues, undefined);
      assert.ok(Array.isArray(response.findings));
    });
  });

  describe('sarif fixtures', () => {
    it('semgrep results has valid SARIF structure', async () => {
      const sarif = await loadJsonFixture<{
        version: string;
        runs: Array<{ results: unknown[] }>;
      }>('sarif/semgrep-results.sarif');
      assert.equal(sarif.version, '2.1.0');
      assert.ok(sarif.runs.length > 0);
      assert.ok(sarif.runs[0].results.length > 0);
    });

    it('empty results SARIF has no results', async () => {
      const sarif = await loadJsonFixture<{
        runs: Array<{ results: unknown[] }>;
      }>('sarif/empty-results.sarif');
      assert.deepEqual(sarif.runs[0].results, []);
    });
  });

  describe('scan-results fixtures', () => {
    it('pass scan has correct summary', async () => {
      const scan = await loadJsonFixture<{
        summary: { totalChecks: number; passedChecks: number; totalIssues: number };
      }>('scan-results/pass-scan.json');
      assert.equal(scan.summary.totalChecks, 1);
      assert.equal(scan.summary.passedChecks, 1);
      assert.equal(scan.summary.totalIssues, 0);
    });

    it('fail scan has issues and correct summary', async () => {
      const scan = await loadJsonFixture<{
        issues: unknown[];
        summary: { failedChecks: number; totalIssues: number };
      }>('scan-results/fail-scan.json');
      assert.ok(scan.issues.length > 0);
      assert.equal(scan.summary.failedChecks, 1);
      assert.equal(scan.summary.totalIssues, 1);
    });

    it('error scan has error check with details', async () => {
      const scan = await loadJsonFixture<{
        checks: Array<{ status: string; error?: string; rawAiResponse?: string }>;
      }>('scan-results/error-scan.json');
      const errorCheck = scan.checks.find((c) => c.status === 'ERROR');
      assert.ok(errorCheck);
      assert.ok(typeof errorCheck.error === 'string');
      assert.ok(typeof errorCheck.rawAiResponse === 'string');
    });
  });
});
