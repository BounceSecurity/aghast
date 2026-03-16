import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  sanitizeUrl,
  normalizeUrl,
  parseGitUrl,
  isGitRepository,
  analyzeRepository,
  getRemoteUrl,
  getCurrentBranch,
  getCommitHash,
} from '../src/repository-analyzer.js';

const execAsync = promisify(exec);

describe('sanitizeUrl', () => {
  it('removes credentials from HTTPS URL with user and password', () => {
    const url = 'https://user:password@github.com/org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'https://github.com/org/repo');
  });

  it('removes credentials from HTTPS URL with only username', () => {
    const url = 'https://user@github.com/org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'https://github.com/org/repo');
  });

  it('leaves clean HTTPS URL unchanged', () => {
    const url = 'https://github.com/org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'https://github.com/org/repo');
  });

  it('leaves SSH URL unchanged (no credentials)', () => {
    const url = 'git@github.com:org/repo.git';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'git@github.com:org/repo.git');
  });

  it('handles URLs with special characters in credentials', () => {
    const url = 'https://user:p%40ssw0rd@github.com/org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'https://github.com/org/repo');
  });

  it('handles malformed URLs gracefully', () => {
    const url = 'not-a-valid-url';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'not-a-valid-url');
  });

  it('removes credentials from ssh:// protocol URL', () => {
    const url = 'ssh://user:pass@github.com/org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'ssh://github.com/org/repo');
  });

  it('removes credentials from ssh:// URL with only username', () => {
    const url = 'ssh://user@github.com/org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'ssh://github.com/org/repo');
  });

  it('removes credentials from non-standard SSH-style URL with credentials', () => {
    const url = 'user:pass@github.com:org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'github.com:org/repo');
  });

  it('handles password containing colon', () => {
    const url = 'https://user:pass:word@github.com/org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'https://github.com/org/repo');
  });

  it('removes credentials from git+ssh:// protocol URL', () => {
    const url = 'git+ssh://user:pass@github.com/org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'git+ssh://github.com/org/repo');
  });

  it('removes credentials from URL with port number', () => {
    // Use non-default port (8443) since URL class normalizes default ports away
    const url = 'https://user:pass@github.com:8443/org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'https://github.com:8443/org/repo');
  });

  it('leaves URL with port but no credentials unchanged', () => {
    // Use non-default port since URL class normalizes default ports away
    const url = 'https://github.com:8443/org/repo';
    const sanitized = sanitizeUrl(url);
    assert.equal(sanitized, 'https://github.com:8443/org/repo');
  });
});

describe('normalizeUrl', () => {
  it('removes .git suffix from HTTPS URL', () => {
    const url = 'https://github.com/org/repo.git';
    const normalized = normalizeUrl(url);
    assert.equal(normalized, 'https://github.com/org/repo');
  });

  it('removes .git suffix from SSH URL', () => {
    const url = 'git@github.com:org/repo.git';
    const normalized = normalizeUrl(url);
    assert.equal(normalized, 'git@github.com:org/repo');
  });

  it('leaves URL without .git suffix unchanged', () => {
    const url = 'https://github.com/org/repo';
    const normalized = normalizeUrl(url);
    assert.equal(normalized, 'https://github.com/org/repo');
  });

  it('removes trailing slashes', () => {
    const url = 'https://github.com/org/repo/';
    const normalized = normalizeUrl(url);
    assert.equal(normalized, 'https://github.com/org/repo');
  });

  it('removes multiple trailing slashes', () => {
    const url = 'https://github.com/org/repo///';
    const normalized = normalizeUrl(url);
    assert.equal(normalized, 'https://github.com/org/repo');
  });
});

describe('parseGitUrl', () => {
  it('extracts org/repo from HTTPS GitHub URL', () => {
    const result = parseGitUrl('https://github.com/anthropics/claude-code.git');
    assert.deepEqual(result, { org: 'anthropics', repo: 'claude-code' });
  });

  it('extracts org/repo from SSH GitHub URL', () => {
    const result = parseGitUrl('git@github.com:anthropics/claude-code.git');
    assert.deepEqual(result, { org: 'anthropics', repo: 'claude-code' });
  });

  it('extracts org/repo from GitLab URL', () => {
    const result = parseGitUrl('https://gitlab.com/myorg/myproject');
    assert.deepEqual(result, { org: 'myorg', repo: 'myproject' });
  });

  it('extracts org/repo from Bitbucket URL', () => {
    const result = parseGitUrl('https://bitbucket.org/company/product.git');
    assert.deepEqual(result, { org: 'company', repo: 'product' });
  });

  it('handles self-hosted Git URLs', () => {
    const result = parseGitUrl('https://git.example.com/team/project');
    assert.deepEqual(result, { org: 'team', repo: 'project' });
  });

  it('handles URL with credentials (sanitizes first)', () => {
    const result = parseGitUrl('https://token:x-oauth@github.com/org/repo.git');
    assert.deepEqual(result, { org: 'org', repo: 'repo' });
  });

  it('returns undefined for invalid URL', () => {
    const result = parseGitUrl('not-a-url');
    assert.equal(result, undefined);
  });

  it('returns undefined for URL without org/repo', () => {
    const result = parseGitUrl('https://github.com/');
    assert.equal(result, undefined);
  });

  it('handles nested paths in HTTPS URL (takes last two segments)', () => {
    const result = parseGitUrl('https://gitlab.com/group/subgroup/project.git');
    assert.deepEqual(result, { org: 'subgroup', repo: 'project' });
  });

  it('handles nested paths in SSH URL (takes last two segments)', () => {
    const result = parseGitUrl('git@gitlab.com:group/subgroup/project.git');
    assert.deepEqual(result, { org: 'subgroup', repo: 'project' });
  });
});

describe('isGitRepository', () => {
  let tempDir: string;
  let gitDir: string;
  let nonGitDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'aghast-test-'));
    gitDir = join(tempDir, 'git-repo');
    nonGitDir = join(tempDir, 'non-git');

    // Create a git repository
    await mkdir(gitDir, { recursive: true });
    await execAsync('git init', { cwd: gitDir });

    // Create a non-git directory
    await mkdir(nonGitDir, { recursive: true });
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns true for a git repository', async () => {
    const result = await isGitRepository(gitDir);
    assert.equal(result, true);
  });

  it('returns false for a non-git directory', async () => {
    const result = await isGitRepository(nonGitDir);
    assert.equal(result, false);
  });

  it('returns false for a non-existent directory', async () => {
    const result = await isGitRepository('/does/not/exist/anywhere');
    assert.equal(result, false);
  });
});

describe('Git metadata extraction', () => {
  let tempDir: string;
  let gitDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'aghast-test-'));
    gitDir = join(tempDir, 'git-repo');

    // Create a git repository with a commit
    await mkdir(gitDir, { recursive: true });
    await execAsync('git init', { cwd: gitDir });
    await execAsync('git config user.email "test@example.com"', { cwd: gitDir });
    await execAsync('git config user.name "Test User"', { cwd: gitDir });
    await writeFile(join(gitDir, 'README.md'), '# Test');
    await execAsync('git add README.md', { cwd: gitDir });
    await execAsync('git commit -m "Initial commit"', { cwd: gitDir });

    // Add a remote
    await execAsync(
      'git remote add origin https://github.com/test-org/test-repo.git',
      { cwd: gitDir },
    );
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('extracts remote URL', async () => {
    const url = await getRemoteUrl(gitDir);
    assert.equal(url, 'https://github.com/test-org/test-repo.git');
  });

  it('extracts current branch', async () => {
    const branch = await getCurrentBranch(gitDir);
    // Git may default to 'master' or 'main' depending on configuration
    assert.ok(branch === 'master' || branch === 'main', `Expected master or main, got ${branch}`);
  });

  it('extracts commit hash', async () => {
    const commit = await getCommitHash(gitDir);
    assert.ok(commit);
    // Git commit hashes are 40 hex characters
    assert.match(commit, /^[a-f0-9]{40}$/);
  });

  it('returns undefined for missing remote', async () => {
    // Create a repo without a remote
    const noRemoteDir = join(tempDir, 'no-remote');
    await mkdir(noRemoteDir, { recursive: true });
    await execAsync('git init', { cwd: noRemoteDir });

    const url = await getRemoteUrl(noRemoteDir);
    assert.equal(url, undefined);
  });
});

describe('analyzeRepository', () => {
  let tempDir: string;
  let gitDir: string;
  let nonGitDir: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'aghast-test-'));
    gitDir = join(tempDir, 'git-repo');
    nonGitDir = join(tempDir, 'non-git');

    // Create a git repository with a commit and remote
    await mkdir(gitDir, { recursive: true });
    await execAsync('git init', { cwd: gitDir });
    await execAsync('git config user.email "test@example.com"', { cwd: gitDir });
    await execAsync('git config user.name "Test User"', { cwd: gitDir });
    await writeFile(join(gitDir, 'README.md'), '# Test');
    await execAsync('git add README.md', { cwd: gitDir });
    await execAsync('git commit -m "Initial commit"', { cwd: gitDir });
    await execAsync(
      'git remote add origin https://user:pass@github.com/test-org/test-repo.git',
      { cwd: gitDir },
    );

    // Create a non-git directory
    await mkdir(nonGitDir, { recursive: true });
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns complete analysis for git repository', async () => {
    const analysis = await analyzeRepository(gitDir);

    assert.equal(analysis.repository.path, gitDir);
    assert.equal(analysis.repository.isGitRepository, true);
    // URL should be sanitized (no credentials) and normalized (no .git suffix)
    assert.equal(analysis.repository.remoteUrl, 'https://github.com/test-org/test-repo');
    assert.ok(
      analysis.repository.branch === 'master' || analysis.repository.branch === 'main',
      `Expected master or main, got ${analysis.repository.branch}`,
    );
    assert.ok(analysis.branch);
    assert.ok(analysis.commit);
    assert.match(analysis.commit!, /^[a-f0-9]{40}$/);
    // Commit should also be stored in repository object (F9/F10 fix)
    assert.equal(analysis.repository.commit, analysis.commit);
  });

  it('returns isGitRepository: false for non-git directory', async () => {
    const analysis = await analyzeRepository(nonGitDir);

    assert.equal(analysis.repository.path, nonGitDir);
    assert.equal(analysis.repository.isGitRepository, false);
    assert.equal(analysis.repository.remoteUrl, undefined);
    assert.equal(analysis.repository.branch, undefined);
    assert.equal(analysis.repository.commit, undefined);
    assert.equal(analysis.branch, undefined);
    assert.equal(analysis.commit, undefined);
  });

  it('does not crash for non-existent directory', async () => {
    const analysis = await analyzeRepository('/does/not/exist/anywhere');

    assert.equal(analysis.repository.path, '/does/not/exist/anywhere');
    assert.equal(analysis.repository.isGitRepository, false);
  });

  it('handles repository without remote gracefully', async () => {
    const noRemoteDir = join(tempDir, 'no-remote');
    await mkdir(noRemoteDir, { recursive: true });
    await execAsync('git init', { cwd: noRemoteDir });
    await execAsync('git config user.email "test@example.com"', { cwd: noRemoteDir });
    await execAsync('git config user.name "Test User"', { cwd: noRemoteDir });
    await writeFile(join(noRemoteDir, 'test.txt'), 'test');
    await execAsync('git add test.txt', { cwd: noRemoteDir });
    await execAsync('git commit -m "Initial"', { cwd: noRemoteDir });

    const analysis = await analyzeRepository(noRemoteDir);

    assert.equal(analysis.repository.path, noRemoteDir);
    assert.equal(analysis.repository.isGitRepository, true);
    assert.equal(analysis.repository.remoteUrl, undefined);
    assert.ok(analysis.branch);
    assert.ok(analysis.commit);
  });

  it('sanitizes credentials from remote URL in analysis result', async () => {
    // The gitDir setup uses https://user:pass@github.com/test-org/test-repo.git
    const analysis = await analyzeRepository(gitDir);

    // Verify credentials are NOT present in the result
    assert.ok(analysis.repository.remoteUrl, 'remoteUrl should be defined');
    assert.ok(
      !analysis.repository.remoteUrl.includes('user'),
      'remoteUrl should not contain username',
    );
    assert.ok(
      !analysis.repository.remoteUrl.includes('pass'),
      'remoteUrl should not contain password',
    );
    assert.ok(
      !analysis.repository.remoteUrl.includes('@'),
      'remoteUrl should not contain @ from credentials',
    );
    // Verify URL is properly sanitized and normalized
    assert.equal(analysis.repository.remoteUrl, 'https://github.com/test-org/test-repo');
  });
});
