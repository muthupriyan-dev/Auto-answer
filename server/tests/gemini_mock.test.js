/**
 * gemini_mock.test.js - Unit tests for Gemini prompt logic, sanitization, and response transformation
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');

process.env.GEMINI_API_KEY = 'test_key_for_mock_tests';

const { getModelName } = require('../gemini');

describe('Gemini Module Unit Tests', () => {
  test('getModelName should default to gemini-2.5-flash if not specified', () => {
    delete process.env.GEMINI_MODEL;
    assert.strictEqual(getModelName(), 'gemini-2.5-flash');
  });

  test('getModelName should respect GEMINI_MODEL env var', () => {
    process.env.GEMINI_MODEL = 'gemini-1.5-pro';
    assert.strictEqual(getModelName(), 'gemini-1.5-pro');
    process.env.GEMINI_MODEL = 'gemini-2.5-flash'; // Reset
  });

  test('Sanitization should reject non-array questions', async () => {
    const { generateFormSuggestions } = require('../gemini');
    await assert.rejects(
      async () => {
        await generateFormSuggestions('invalid-not-array');
      },
      /questions must be a non-empty array/i
    );
  });

  test('Sanitization should reject empty array', async () => {
    const { generateFormSuggestions } = require('../gemini');
    await assert.rejects(
      async () => {
        await generateFormSuggestions([]);
      },
      /questions must be a non-empty array/i
    );
  });

  test('Sanitization should enforce 50-question batch limit', async () => {
    const { generateFormSuggestions } = require('../gemini');
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      id: `q_${i}`,
      title: `Question ${i}`
    }));

    await assert.rejects(
      async () => {
        await generateFormSuggestions(tooMany);
      },
      /Batch size limit exceeded/i
    );
  });
});
