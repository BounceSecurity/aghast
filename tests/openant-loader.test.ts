import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadDatasetFromFile,
  filterUnits,
  formatUnitPromptSection,
  type OpenAntUnit,
} from '../src/openant-loader.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const enhancedFixture = resolve(testDir, 'fixtures', 'openant', 'dataset_enhanced.json');
const unenhancedFixture = resolve(testDir, 'fixtures', 'openant', 'dataset.json');

describe('openant-loader', () => {
  describe('loadDatasetFromFile', () => {
    it('should load an enhanced dataset', async () => {
      const dataset = await loadDatasetFromFile(enhancedFixture);
      assert.equal(dataset.name, 'test-project');
      assert.equal(dataset.units.length, 4);
      assert.equal(dataset.units[0].id, 'app/views.py:handle_login');
      assert.equal(dataset.units[0].agent_context?.security_classification, 'exploitable');
    });

    it('should load an unenhanced dataset', async () => {
      const dataset = await loadDatasetFromFile(unenhancedFixture);
      assert.equal(dataset.units.length, 1);
      assert.equal(dataset.units[0].agent_context, undefined);
    });

    it('should throw for missing file', async () => {
      await assert.rejects(
        loadDatasetFromFile('/nonexistent/dataset.json'),
        /OpenAnt dataset file not found/,
      );
    });

    it('should throw for invalid JSON', async () => {
      // Use a non-JSON file as input
      const badFile = resolve(testDir, 'fixtures', 'ai-responses', 'malformed-response.txt');
      await assert.rejects(
        loadDatasetFromFile(badFile),
        /OpenAnt dataset is not valid JSON/,
      );
    });
  });

  describe('filterUnits', () => {
    let units: OpenAntUnit[];

    it('should load units for filtering tests', async () => {
      const dataset = await loadDatasetFromFile(enhancedFixture);
      units = dataset.units;
      assert.equal(units.length, 4);
    });

    it('should return all units when no filters', () => {
      const result = filterUnits(units);
      assert.equal(result.length, 4);
    });

    it('should filter by unitTypes', () => {
      const result = filterUnits(units, { unitTypes: ['view_function', 'function'] });
      assert.equal(result.length, 2);
      assert.ok(result.every(u => u.unit_type === 'view_function' || u.unit_type === 'function'));
    });

    it('should filter by excludeUnitTypes', () => {
      const result = filterUnits(units, { excludeUnitTypes: ['test', 'constructor'] });
      assert.equal(result.length, 2);
      assert.ok(result.every(u => u.unit_type !== 'test' && u.unit_type !== 'constructor'));
    });

    it('should filter by securityClassifications', () => {
      const result = filterUnits(units, { securityClassifications: ['exploitable'] });
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'app/views.py:handle_login');
    });

    it('should filter by securityClassifications with multiple values', () => {
      const result = filterUnits(units, { securityClassifications: ['exploitable', 'security_control'] });
      assert.equal(result.length, 2);
    });

    it('should filter by reachableOnly', () => {
      const result = filterUnits(units, { reachableOnly: true });
      assert.equal(result.length, 3);
      assert.ok(result.every(u => u.reachable));
    });

    it('should filter by entryPointsOnly', () => {
      const result = filterUnits(units, { entryPointsOnly: true });
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'app/views.py:handle_login');
    });

    it('should filter by minConfidence', () => {
      const result = filterUnits(units, { minConfidence: 0.9 });
      assert.equal(result.length, 3);
      assert.ok(result.every(u => u.agent_context!.confidence >= 0.9));
    });

    it('should combine multiple filters', () => {
      const result = filterUnits(units, {
        securityClassifications: ['exploitable', 'security_control'],
        reachableOnly: true,
      });
      assert.equal(result.length, 2);
    });
  });

  describe('formatUnitPromptSection', () => {
    it('should include target location for navigation', async () => {
      const dataset = await loadDatasetFromFile(enhancedFixture);
      const unit = dataset.units[0]; // handle_login
      const prompt = formatUnitPromptSection(unit);

      assert.ok(prompt.includes('TARGET LOCATION'));
      assert.ok(prompt.includes('- File: app/views.py'));
      assert.ok(prompt.includes('- Lines: 10-16'));
      assert.ok(prompt.includes('- Function: handle_login'));
      assert.ok(prompt.includes('- Class: (module level)'));
      assert.ok(prompt.includes('- Unit type: view_function'));
    });

    it('should flag entry points prominently', async () => {
      const dataset = await loadDatasetFromFile(enhancedFixture);
      const unit = dataset.units[0]; // handle_login is an entry point
      const prompt = formatUnitPromptSection(unit);

      assert.ok(prompt.includes('ENTRY POINT'));
      assert.ok(prompt.includes('input_pattern:request.POST'));
    });

    it('should include investigation leads from call graph', async () => {
      const dataset = await loadDatasetFromFile(enhancedFixture);
      const unit = dataset.units[0]; // handle_login
      const prompt = formatUnitPromptSection(unit);

      assert.ok(prompt.includes('INVESTIGATION LEADS'));
      assert.ok(prompt.includes('cursor.execute'));
      assert.ok(prompt.includes('url_patterns'));
      assert.ok(prompt.includes('- Decorators: @login_required'));
      assert.ok(prompt.includes('- Parameters: request'));
    });

    it('should not include security hypothesis even for enhanced units', async () => {
      const dataset = await loadDatasetFromFile(enhancedFixture);
      const unit = dataset.units[0]; // handle_login - has agent_context
      const prompt = formatUnitPromptSection(unit);

      // Security classifications are deliberately excluded to avoid biasing the AI
      assert.ok(!prompt.includes('SECURITY HYPOTHESIS'));
      assert.ok(!prompt.includes('exploitable'));
      assert.ok(!prompt.includes('security_classification'));
    });

    it('should include enhanced code only when extra context was inlined', async () => {
      const dataset = await loadDatasetFromFile(enhancedFixture);
      // handle_login is NOT enhanced (enhanced: false, 1 file) — should NOT include code block
      const unit = dataset.units[0];
      const prompt = formatUnitPromptSection(unit);

      assert.ok(!prompt.includes('ADDITIONAL CONTEXT'));
    });

    it('should format a unit with class name', async () => {
      const dataset = await loadDatasetFromFile(enhancedFixture);
      const unit = dataset.units[2]; // User.__init__
      const prompt = formatUnitPromptSection(unit);

      assert.ok(prompt.includes('- Class: User'));
    });

    it('should not include security hypothesis for unenhanced units', async () => {
      const dataset = await loadDatasetFromFile(unenhancedFixture);
      const unit = dataset.units[0];
      const prompt = formatUnitPromptSection(unit);

      assert.ok(!prompt.includes('SECURITY HYPOTHESIS'));
      assert.ok(prompt.includes('UNIT DETAILS:'));
      assert.ok(prompt.includes('TARGET LOCATION'));
    });

    it('should instruct agent to read actual files', async () => {
      const dataset = await loadDatasetFromFile(enhancedFixture);
      const unit = dataset.units[0];
      const prompt = formatUnitPromptSection(unit);

      assert.ok(prompt.includes('Read the target file'));
      assert.ok(prompt.includes('Read at most 1-2 additional files'));
    });
  });
});
