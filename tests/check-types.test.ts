import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getCheckType, getValidCheckTypes, CHECK_TYPE } from '../src/check-types.js';

describe('check-types', () => {
  describe('getValidCheckTypes', () => {
    it('returns all registered check type strings', () => {
      const types = getValidCheckTypes();
      assert.ok(types.includes('repository'));
      assert.ok(types.includes('targeted'));
      assert.ok(types.includes('static'));
      assert.equal(types.length, 3);
    });
  });

  describe('CHECK_TYPE constants', () => {
    it('has correct string values', () => {
      assert.equal(CHECK_TYPE.REPOSITORY, 'repository');
      assert.equal(CHECK_TYPE.TARGETED, 'targeted');
      assert.equal(CHECK_TYPE.STATIC, 'static');
    });
  });

  describe('getCheckType', () => {
    it('returns conservative defaults for undefined type', () => {
      const desc = getCheckType(undefined);
      assert.equal(desc.needsAI, true);
      assert.equal(desc.needsInstructions, true);
    });

    it('returns conservative defaults for unknown type', () => {
      const desc = getCheckType('unknown-type');
      assert.equal(desc.needsAI, true);
      assert.equal(desc.needsInstructions, true);
    });

    it('repository: needs AI and instructions, no maxTargets', () => {
      const desc = getCheckType('repository');
      assert.equal(desc.needsAI, true);
      assert.equal(desc.needsInstructions, true);
      assert.equal(desc.supportsMaxTargets, false);
    });

    it('targeted: needs AI and instructions, supports maxTargets', () => {
      const desc = getCheckType('targeted');
      assert.equal(desc.needsAI, true);
      assert.equal(desc.needsInstructions, true);
      assert.equal(desc.supportsMaxTargets, true);
    });

    it('static: no AI or instructions, supports maxTargets', () => {
      const desc = getCheckType('static');
      assert.equal(desc.needsAI, false);
      assert.equal(desc.needsInstructions, false);
      assert.equal(desc.supportsMaxTargets, true);
    });
  });
});
