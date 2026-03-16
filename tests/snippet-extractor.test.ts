import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSnippet, isPathWithinRepository } from '../src/snippet-extractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureRepo = resolve(__dirname, 'fixtures', 'git-repo');

describe('extractSnippet', () => {
  it('extracts a single line from a file', async () => {
    const snippet = await extractSnippet(fixtureRepo, 'src/example.ts', 4, 4);
    assert.ok(snippet);
    assert.ok(snippet.includes('SELECT * FROM users'));
  });

  it('extracts a range of lines', async () => {
    const snippet = await extractSnippet(fixtureRepo, 'src/example.ts', 2, 5);
    assert.ok(snippet);
    const lines = snippet.split('\n');
    assert.equal(lines.length, 4);
  });

  it('extracts to end of file when endLine exceeds file length', async () => {
    const snippet = await extractSnippet(fixtureRepo, 'src/example.ts', 8, 999);
    assert.ok(snippet);
    assert.ok(snippet.includes('deleteUser'));
  });

  it('returns undefined for non-existent file', async () => {
    const snippet = await extractSnippet(fixtureRepo, 'nonexistent.ts', 1, 5);
    assert.equal(snippet, undefined);
  });

  it('returns undefined when startLine exceeds file length', async () => {
    const snippet = await extractSnippet(fixtureRepo, 'src/example.ts', 9999, 10000);
    assert.equal(snippet, undefined);
  });

  it('returns undefined when both startLine and endLine are undefined', async () => {
    const snippet = await extractSnippet(fixtureRepo, 'src/example.ts');
    assert.equal(snippet, undefined);
  });

  it('uses startLine as endLine when only startLine is provided', async () => {
    const snippet = await extractSnippet(fixtureRepo, 'src/example.ts', 4);
    assert.ok(snippet);
    // Should be a single line
    assert.ok(!snippet.includes('\n'));
    assert.ok(snippet.includes('SELECT'));
  });

  it('handles startLine of 0 by clamping to 1', async () => {
    const snippet = await extractSnippet(fixtureRepo, 'src/example.ts', 0, 2);
    assert.ok(snippet);
    const lines = snippet.split('\n');
    assert.equal(lines.length, 2);
  });
});

// --- Path traversal prevention ---

describe('isPathWithinRepository', () => {
  it('allows a file inside the repository', () => {
    const repo = resolve('/repo');
    const file = resolve('/repo/src/app.ts');
    assert.ok(isPathWithinRepository(repo, file));
  });

  it('rejects a file outside the repository via ../', () => {
    const repo = resolve('/repo');
    const file = resolve('/repo/../etc/passwd');
    assert.ok(!isPathWithinRepository(repo, file));
  });

  it('rejects a file at an unrelated absolute path', () => {
    const repo = resolve('/repo');
    const file = resolve('/etc/passwd');
    assert.ok(!isPathWithinRepository(repo, file));
  });

  it('rejects a path that is a prefix but not a child (repo-evil vs repo)', () => {
    const repo = resolve('/repo');
    const file = resolve('/repo-evil/malicious.ts');
    assert.ok(!isPathWithinRepository(repo, file));
  });

  it('allows nested subdirectories within repo', () => {
    const repo = resolve('/repo');
    const file = resolve('/repo/a/b/c/deep.ts');
    assert.ok(isPathWithinRepository(repo, file));
  });
});

describe('extractSnippet (path traversal)', () => {
  it('returns undefined for path traversal via ../../../', async () => {
    const snippet = await extractSnippet(fixtureRepo, '../../../package.json', 1, 5);
    assert.equal(snippet, undefined);
  });

  it('returns undefined for absolute path outside repo', async () => {
    const snippet = await extractSnippet(fixtureRepo, resolve(__dirname, '..', 'package.json'), 1, 5);
    assert.equal(snippet, undefined);
  });

  it('still works for legitimate relative paths within repo', async () => {
    const snippet = await extractSnippet(fixtureRepo, 'src/example.ts', 4, 4);
    assert.ok(snippet);
    assert.ok(snippet.includes('SELECT'));
  });
});
