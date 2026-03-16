import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSARIF, deduplicateTargets, limitTargets } from '../src/sarif-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, 'fixtures', 'sarif');

describe('parseSARIF', () => {
  it('parses valid SARIF into correct targets', () => {
    const content = readFileSync(resolve(fixtureDir, 'semgrep-results.sarif'), 'utf-8');
    const targets = parseSARIF(content);

    assert.equal(targets.length, 3);

    assert.equal(targets[0].file, 'src/routes/users.ts');
    assert.equal(targets[0].startLine, 24);
    assert.equal(targets[0].endLine, 45);
    assert.equal(targets[0].message, 'Found API endpoint: GET /users');
    assert.equal(targets[0].snippet, "router.get('/users', async (req, res) => {");

    assert.equal(targets[1].file, 'src/routes/users.ts');
    assert.equal(targets[1].startLine, 47);
    assert.equal(targets[1].endLine, 92);

    assert.equal(targets[2].file, 'src/routes/orders.ts');
    assert.equal(targets[2].startLine, 10);
    assert.equal(targets[2].endLine, 35);
  });

  it('returns empty array for SARIF with no results', () => {
    const content = readFileSync(resolve(fixtureDir, 'empty-results.sarif'), 'utf-8');
    const targets = parseSARIF(content);
    assert.equal(targets.length, 0);
  });

  it('throws on malformed JSON', () => {
    assert.throws(
      () => parseSARIF('not valid json {'),
      /Invalid SARIF: malformed JSON/,
    );
  });

  it('throws on missing runs array', () => {
    assert.throws(
      () => parseSARIF('{"version": "2.1.0"}'),
      /Invalid SARIF: missing "runs" array/,
    );
  });

  it('skips results with no location', () => {
    const sarif = JSON.stringify({
      version: '2.1.0',
      runs: [{
        results: [
          { message: { text: 'no locations field' } },
          { message: { text: 'empty locations' }, locations: [] },
          {
            message: { text: 'valid' },
            locations: [{
              physicalLocation: {
                artifactLocation: { uri: 'src/app.ts' },
                region: { startLine: 1, endLine: 5 },
              },
            }],
          },
        ],
      }],
    });

    const targets = parseSARIF(sarif);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].file, 'src/app.ts');
  });

  it('skips results with missing file URI', () => {
    const sarif = JSON.stringify({
      version: '2.1.0',
      runs: [{
        results: [{
          message: { text: 'no uri' },
          locations: [{
            physicalLocation: {
              region: { startLine: 1, endLine: 5 },
            },
          }],
        }],
      }],
    });

    const targets = parseSARIF(sarif);
    assert.equal(targets.length, 0);
  });

  it('skips results with missing startLine', () => {
    const sarif = JSON.stringify({
      version: '2.1.0',
      runs: [{
        results: [
          {
            message: { text: 'no startLine' },
            locations: [{
              physicalLocation: {
                artifactLocation: { uri: 'src/a.ts' },
                region: { endLine: 5 },
              },
            }],
          },
        ],
      }],
    });

    const targets = parseSARIF(sarif);
    assert.equal(targets.length, 0);
  });

  it('defaults endLine to startLine when endLine is absent', () => {
    const sarif = JSON.stringify({
      version: '2.1.0',
      runs: [{
        results: [
          {
            message: { text: 'no endLine' },
            locations: [{
              physicalLocation: {
                artifactLocation: { uri: 'src/b.ts' },
                region: { startLine: 7 },
              },
            }],
          },
        ],
      }],
    });

    const targets = parseSARIF(sarif);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].file, 'src/b.ts');
    assert.equal(targets[0].startLine, 7);
    assert.equal(targets[0].endLine, 7);
    assert.equal(targets[0].message, 'no endLine');
  });

  it('handles result with no message gracefully', () => {
    const sarif = JSON.stringify({
      version: '2.1.0',
      runs: [{
        results: [{
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: 'src/app.ts' },
              region: { startLine: 1, endLine: 5 },
            },
          }],
        }],
      }],
    });

    const targets = parseSARIF(sarif);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].message, '');
  });
});

describe('deduplicateTargets', () => {
  it('removes duplicate targets by file:startLine:endLine', () => {
    const targets = [
      { file: 'a.ts', startLine: 1, endLine: 5, message: 'first' },
      { file: 'a.ts', startLine: 1, endLine: 5, message: 'second' },
      { file: 'b.ts', startLine: 1, endLine: 5, message: 'different file' },
      { file: 'a.ts', startLine: 2, endLine: 5, message: 'different line' },
    ];

    const deduped = deduplicateTargets(targets);
    assert.equal(deduped.length, 3);
    assert.equal(deduped[0].message, 'first'); // keeps first occurrence
    assert.equal(deduped[1].file, 'b.ts');
    assert.equal(deduped[2].startLine, 2);
  });

  it('returns empty array for empty input', () => {
    assert.equal(deduplicateTargets([]).length, 0);
  });
});

describe('limitTargets', () => {
  it('limits targets to maxTargets', () => {
    const targets = Array.from({ length: 5 }, (_, i) => ({
      file: `file${i}.ts`,
      startLine: 1,
      endLine: 10,
      message: `target ${i}`,
    }));

    const limited = limitTargets(targets, 2);
    assert.equal(limited.length, 2);
    assert.equal(limited[0].file, 'file0.ts');
    assert.equal(limited[1].file, 'file1.ts');
  });

  it('returns all targets if fewer than maxTargets', () => {
    const targets = [
      { file: 'a.ts', startLine: 1, endLine: 5, message: 'one' },
    ];
    const limited = limitTargets(targets, 10);
    assert.equal(limited.length, 1);
  });

  it('returns empty array for empty input', () => {
    assert.equal(limitTargets([], 5).length, 0);
  });
});
