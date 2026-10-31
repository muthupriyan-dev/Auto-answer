/**
 * background.js - Service Worker for Gemini AI Google Forms Assistant
 * - Initializes default settings
 * - Proxies backend API calls for the content script. Requests made here carry the
 *   chrome-extension:// origin (not docs.google.com), so server CORS rules work,
 *   and the API key never touches the web page context.
 */

const DEFAULT_BACKEND_URL = 'https://auto-answer-ini7.onrender.com';
const OLD_DEFAULT_BACKEND_URL = 'http://localhost:3000';

const DEFAULT_CONFIG = {
  backendUrl: DEFAULT_BACKEND_URL,
  dotCorner: 'bottom-right',
  overwriteExisting: false
};

const ALLOWED_API_PATHS = new Set(['/api/suggest', '/api/regenerate']);
const REQUEST_TIMEOUT_MS = 60000; // Render free tier can take ~50s to wake up
const FORMS_URL_RE = /^https?:\/\/docs\.google\.com\/forms\//;

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Gemini Forms Assistant] Extension installed/updated:', details.reason);

  try {
    // Populate defaults if not already set
    const current = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
    const toSet = {};

    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      if (current[key] === undefined) {
        toSet[key] = value;
      }
    }

    // Older versions saved http://localhost:3000 as the default. On an update,
    // move that old default to the deployed backend (custom URLs are kept).
    if (details.reason === 'update' && current.backendUrl === OLD_DEFAULT_BACKEND_URL) {
      toSet.backendUrl = DEFAULT_BACKEND_URL;
    }

    if (Object.keys(toSet).length > 0) {
      await chrome.storage.sync.set(toSet);
      console.log('[Gemini Forms Assistant] Initialized default configuration:', toSet);
    }
  } catch (err) {
    console.error('[Gemini Forms Assistant] Failed to initialize storage:', err);
  }
});

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

async function handleApiRequest(message) {
  const path = message && message.path;
  if (!ALLOWED_API_PATHS.has(path)) {
    return { ok: false, status: 400, error: 'Unsupported API path.' };
  }

  const { backendUrl } = await chrome.storage.sync.get({ backendUrl: DEFAULT_CONFIG.backendUrl });
  // The API key lives in local storage only (never synced to other devices)
  const { apiKey } = await chrome.storage.local.get({ apiKey: '' });

  let base;
  try {
    const parsed = new URL(String(backendUrl).trim());
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalHost(parsed.hostname))) {
      return {
        ok: false,
        status: 0,
        error: 'Backend URL must use https:// (http:// is allowed only for localhost).'
      };
    }
    base = parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch (e) {
    return { ok: false, status: 0, error: 'Backend URL is invalid. Check the extension settings.' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(base + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(message.body || {}),
      signal: controller.signal
    });

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    if (!res.ok || !data || data.success === false) {
      let error = (data && data.error) || `Server responded with HTTP ${res.status}`;
      if (res.status === 401) error = 'Wrong or missing API key. Set it in the extension popup.';
      return { ok: false, status: res.status, error };
    }

    return { ok: true, status: res.status, data };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, status: 0, error: 'Backend timed out. It may be waking up, try again in a minute.' };
    }
    return { ok: false, status: 0, error: `Could not reach the backend (${err && err.message ? err.message : 'network error'}).` };
  } finally {
    clearTimeout(timeoutId);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', version: chrome.runtime.getManifest().version });
    return true;
  }

  if (message.type === 'API_REQUEST') {
    // Only accept requests coming from our own content script on Google Forms pages
    if (sender.id !== chrome.runtime.id || !sender.url || !FORMS_URL_RE.test(sender.url)) {
      sendResponse({ ok: false, status: 403, error: 'Request rejected: invalid sender.' });
      return false;
    }

    handleApiRequest(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, status: 0, error: err && err.message ? err.message : 'Unexpected error' }));
    return true; // keep the channel open for the async response
  }

  return false;
});
