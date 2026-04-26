/**
 * Shared utilities for agent providers.
 */

// JSON schema for structured output (matches spec Section 4.4).
// Shared across providers to ensure consistent output format.
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
          description: { type: 'string' },
          dataFlow: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                lineNumber: { type: 'integer' },
                label: { type: 'string' },
              },
              required: ['file', 'lineNumber', 'label'],
              additionalProperties: false,
            },
          },
        },
        required: ['file', 'startLine', 'endLine', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['issues'],
  additionalProperties: false,
} as const;
