import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getCheckType, getValidCheckTypes, CHECK_TYPE } from '../src/check-types.js';

describe('check-types', () => {
  describe('getValidCheckTypes', () => {
    it('returns all registered check type strings', () => {
      const types = getValidCheckTypes();
      assert.ok(types.includes('repository'));
      assert.ok(types.includes('semgrep'));
      assert.ok(types.includes('semgrep-only'));
      assert.ok(types.includes('sarif-verify'));
      assert.ok(types.includes('openant-units'));
      assert.equal(types.length, 5);
    });
  });

  describe('CHECK_TYPE constants', () => {
    it('has correct string values', () => {
      assert.equal(CHECK_TYPE.REPOSITORY, 'repository');
      assert.equal(CHECK_TYPE.SEMGREP, 'semgrep');
      assert.equal(CHECK_TYPE.SEMGREP_ONLY, 'semgrep-only');
      assert.equal(CHECK_TYPE.SARIF_VERIFY, 'sarif-verify');
      assert.equal(CHECK_TYPE.OPENANT_UNITS, 'openant-units');
    });
  });

  describe('getCheckType', () => {
    it('returns conservative defaults for undefined type', () => {
      const desc = getCheckType(undefined);
      assert.equal(desc.needsAI, true);
      assert.equal(desc.needsInstructions, true);
      assert.equal(desc.needsSemgrep, false);
    });

    it('returns conservative defaults for unknown type', () => {
      const desc = getCheckType('unknown-type');
      assert.equal(desc.needsAI, true);
      assert.equal(desc.needsInstructions, true);
    });

    it('repository: needs AI and instructions, no Semgrep', () => {
      const desc = getCheckType('repository');
      assert.equal(desc.needsAI, true);
      assert.equal(desc.needsInstructions, true);
      assert.equal(desc.needsSemgrep, false);
      assert.equal(desc.supportsMaxTargets, false);
    });

    it('semgrep: needs AI, Semgrep, and instructions', () => {
      const desc = getCheckType('semgrep');
      assert.equal(desc.needsAI, true);
      assert.equal(desc.needsInstructions, true);
      assert.equal(desc.needsSemgrep, true);
      assert.equal(desc.supportsMaxTargets, true);
    });

    it('semgrep-only: needs Semgrep, no AI or instructions', () => {
      const desc = getCheckType('semgrep-only');
      assert.equal(desc.needsAI, false);
      assert.equal(desc.needsInstructions, false);
      assert.equal(desc.needsSemgrep, true);
      assert.equal(desc.supportsMaxTargets, true);
    });

    it('sarif-verify: needs AI, no Semgrep or instructions', () => {
      const desc = getCheckType('sarif-verify');
      assert.equal(desc.needsAI, true);
      assert.equal(desc.needsInstructions, false);
      assert.equal(desc.needsSemgrep, false);
      assert.equal(desc.supportsMaxTargets, true);
    });

    it('openant-units: needs AI, no Semgrep or instructions', () => {
      const desc = getCheckType('openant-units');
      assert.equal(desc.needsAI, true);
      assert.equal(desc.needsInstructions, false);
      assert.equal(desc.needsSemgrep, false);
      assert.equal(desc.supportsMaxTargets, true);
    });
  });
});
