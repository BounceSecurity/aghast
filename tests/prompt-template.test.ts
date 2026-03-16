import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/prompt-template.js';

describe('buildPrompt', () => {
  it('different genericPrompt values produce different results', async () => {
    const result1 = await buildPrompt('check-instructions', undefined, 'generic-instructions.md');
    const result2 = await buildPrompt('check-instructions', undefined, 'test-cheaper-instructions.md');

    assert.notEqual(result1, result2, 'buildPrompt should reflect different genericPrompt values');
  });

  it('appends check instructions to the generic prompt', async () => {
    const checkInstructions = 'MY CHECK INSTRUCTIONS';
    const result = await buildPrompt(checkInstructions, undefined, 'generic-instructions.md');
    assert.ok(result.endsWith(checkInstructions), 'result should end with the check instructions');
  });
});
