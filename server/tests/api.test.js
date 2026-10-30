/**
 * api.test.js - Automated tests for backend API routes, auth and input validation
 * Uses Node.js built-in test runner: `npm test`
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// Point to test environment
process.env.PORT = '3099';
process.env.GEMINI_API_KEY = 'test_key_for_unit_tests';
process.env.GEMINI_MODEL = 'gemini-2.5-flash';
process.env.API_SECRET = 'test-secret-123';
delete process.env.ALLOW_NO_AUTH;

const app = require('../server');

let server;
const BASE_URL = 'http://localhost:3099';
const AUTH = { 'X-API-Key': 'test-secret-123' };

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: body ? JSON.parse(body) : null
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              rawBody: body
            });
          }
        });
      }
    );

    req.on('error', reject);

    if (options.rawBody !== undefined) {
      req.write(options.rawBody);
    } else if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

describe('Backend Server API Tests', () => {
  before((done) => {
    server = app.listen(3099, done);
  });

  after((done) => {
    server.close(done);
  });

  test('GET /api/health should return 200 and health metadata', async () => {
    const res = await makeRequest('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'healthy');
    assert.strictEqual(res.body.model, 'gemini-2.5-flash');
    assert.strictEqual(typeof res.body.apiKeyConfigured, 'boolean');
    assert.strictEqual(typeof res.body.uptime, 'number');
  });

  test('POST /api/suggest without API key should return 401', async () => {
    const res = await makeRequest('/api/suggest', {
      method: 'POST',
      body: { questions: [{ id: 'q_1', title: 'x' }] }
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  test('POST /api/suggest with wrong API key should return 401', async () => {
    const res = await makeRequest('/api/suggest', {
      method: 'POST',
      headers: { 'X-API-Key': 'not-the-secret' },
      body: { questions: [{ id: 'q_1', title: 'x' }] }
    });
    assert.strictEqual(res.status, 401);
  });

  test('GET /api/auth-check accepts the right key and rejects a missing one', async () => {
    const ok = await makeRequest('/api/auth-check', { headers: AUTH });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.success, true);

    const denied = await makeRequest('/api/auth-check');
    assert.strictEqual(denied.status, 401);
  });

  test('Protected routes fail closed (503) when API_SECRET is not configured', async () => {
    const saved = process.env.API_SECRET;
    delete process.env.API_SECRET;
    try {
      const res = await makeRequest('/api/suggest', {
        method: 'POST',
        body: { questions: [{ id: 'q_1', title: 'x' }] }
      });
      assert.strictEqual(res.status, 503);
      assert.match(res.body.error, /API_SECRET/);
    } finally {
      process.env.API_SECRET = saved;
    }
  });

  test('POST /api/suggest without questions should return 400 Bad Request', async () => {
    const res = await makeRequest('/api/suggest', {
      method: 'POST',
      headers: AUTH,
      body: {}
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /questions.*must be an array/i);
  });

  test('POST /api/suggest with empty questions array should return 400', async () => {
    const res = await makeRequest('/api/suggest', {
      method: 'POST',
      headers: AUTH,
      body: { questions: [] }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /cannot be empty/i);
  });

  test('POST /api/suggest with more than 50 questions should return 400 (not 500)', async () => {
    const questions = Array.from({ length: 51 }, (_, i) => ({ id: `q_${i}`, title: `Q ${i}` }));
    const res = await makeRequest('/api/suggest', {
      method: 'POST',
      headers: AUTH,
      body: { questions }
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /Batch size limit exceeded/i);
  });

  test('POST /api/regenerate without question object should return 400', async () => {
    const res = await makeRequest('/api/regenerate', {
      method: 'POST',
      headers: AUTH,
      body: {}
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /question.*is required/i);
  });

  test('Malformed JSON body should return 400, not 500', async () => {
    const res = await makeRequest('/api/suggest', {
      method: 'POST',
      headers: AUTH,
      rawBody: '{ this is not json'
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /invalid json/i);
  });

  test('GET /unknown-route should return 404', async () => {
    const res = await makeRequest('/random-endpoint-xyz');
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.success, false);
  });
});
