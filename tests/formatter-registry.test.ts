import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getFormatter, getAvailableFormats } from '../src/formatters/index.js';

describe('Formatter registry', () => {
  it('getFormatter("json") returns a formatter with id "json"', () => {
    const f = getFormatter('json');
    assert.equal(f.id, 'json');
  });

  it('getFormatter("sarif") returns a formatter with id "sarif"', () => {
    const f = getFormatter('sarif');
    assert.equal(f.id, 'sarif');
  });

  it('getFormatter("unknown") throws with descriptive error', () => {
    assert.throws(
      () => getFormatter('unknown'),
      (err: Error) => {
        assert.ok(err.message.includes('Unknown output format "unknown"'));
        assert.ok(err.message.includes('json'));
        assert.ok(err.message.includes('sarif'));
        return true;
      },
    );
  });

  it('getAvailableFormats() returns both formats', () => {
    const formats = getAvailableFormats();
    assert.ok(formats.includes('json'));
    assert.ok(formats.includes('sarif'));
    assert.equal(formats.length, 2);
  });
});
