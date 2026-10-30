/**
 * gemini_mock.test.js - Unit tests for Gemini prompt logic, sanitization, and response transformation
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

process.env.GEMINI_API_KEY = 'test_key_for_mock_tests';

const { getModelName, normalizeSuggestion, sanitizeQuestions, mapGeminiError, parseModelJson } = require('../gemini');

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

  test('Sanitization errors carry HTTP status 400', () => {
    try {
      sanitizeQuestions([]);
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.status, 400);
    }
  });

  test('Sanitization makes duplicate ids unique', () => {
    const result = sanitizeQuestions([{ id: 'a', title: 'one' }, { id: 'a', title: 'two' }]);
    assert.notStrictEqual(result[0].id, result[1].id);
  });
});

describe('normalizeSuggestion option enforcement', () => {
  const mc = { id: 'q_1', type: 'MULTIPLE_CHOICE', title: 'Pick one', options: ['QUIC', 'TCP', 'UDP'] };

  test('canonicalizes a case-insensitive match to the exact option string', () => {
    const out = normalizeSuggestion({ suggestedAnswer: ' quic ', confidence: 'high' }, mc);
    assert.strictEqual(out.suggestedAnswer, 'QUIC');
    assert.strictEqual(out.confidence, 'high');
    assert.strictEqual(out.warning, null);
  });

  test('blanks an answer that is not one of the options and lowers confidence', () => {
    const out = normalizeSuggestion({ suggestedAnswer: 'HTTP/2', confidence: 'high' }, mc);
    assert.strictEqual(out.suggestedAnswer, '');
    assert.strictEqual(out.confidence, 'low');
    assert.match(out.warning, /did not match any available option/i);
  });

  test('checkbox answers keep only real options', () => {
    const cb = { id: 'q_2', type: 'CHECKBOX', title: 'Langs', options: ['JavaScript', 'Python', 'Go'] };
    const out = normalizeSuggestion({ suggestedAnswer: ['javascript', 'COBOL', 'Go'] }, cb);
    assert.deepStrictEqual(out.suggestedAnswer, ['JavaScript', 'Go']);
    assert.match(out.warning, /removed/i);
  });

  test('placeholder personal-data answers are blanked, never filled', () => {
    const sa = { id: 'q_3', type: 'SHORT_ANSWER', title: 'Full name', options: [] };
    const out = normalizeSuggestion(
      { suggestedAnswer: '[Your personal details here]', confidence: 'low', warning: 'Requires your personal or private information.' },
      sa
    );
    assert.strictEqual(out.suggestedAnswer, '');
    assert.match(out.warning, /personal or private/i);
  });

  test('a missing model item still yields a safe low-confidence result', () => {
    const out = normalizeSuggestion(undefined, mc);
    assert.strictEqual(out.suggestedAnswer, '');
    assert.strictEqual(out.confidence, 'low');
    assert.match(out.warning, /No suggestion was returned/i);
  });
});

describe('mapGeminiError', () => {
  test('429 maps to quota error', () => {
    const err = mapGeminiError(new Error('[GoogleGenerativeAI Error]: Error fetching from https://x/models/gemini:generate: [429 Too Many Requests] quota'), 'm', 'k');
    assert.strictEqual(err.status, 429);
  });

  test('a 503 whose URL contains "models/" is NOT reported as model-not-found', () => {
    const err = mapGeminiError(new Error('Error fetching from https://x/v1beta/models/gemini-2.5-flash:generateContent: [503 Service Unavailable] overloaded'), 'm', 'k');
    assert.strictEqual(err.status, 503);
  });

  test('a real 404 maps to model-not-found', () => {
    const err = mapGeminiError(new Error('Error fetching from https://x/models/foo: [404 Not Found] model missing'), 'foo', 'k');
    assert.strictEqual(err.status, 404);
    assert.match(err.message, /foo/);
  });

  test('API key is redacted from error messages', () => {
    const err = mapGeminiError(new Error('weird failure for SECRETKEY123 at url?key=SECRETKEY123'), 'm', 'SECRETKEY123');
    assert.ok(!err.message.includes('SECRETKEY123'));
  });
});

describe('parseModelJson', () => {
  test('parses fenced JSON', () => {
    assert.deepStrictEqual(parseModelJson('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  });

  test('tolerates stray text around JSON', () => {
    assert.deepStrictEqual(parseModelJson('Here you go: {"a":1} thanks'), { a: 1 });
  });

  test('throws a 502 for non-JSON output', () => {
    try {
      parseModelJson('no json at all');
      assert.fail('should have thrown');
    } catch (err) {
      assert.strictEqual(err.status, 502);
    }
  });
});
