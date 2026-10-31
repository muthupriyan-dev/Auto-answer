/**
 * popup.js - Handles extension configuration and backend connectivity testing.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const backendUrlInput = document.getElementById('backendUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const dotCornerSelect = document.getElementById('dotCorner');
  const overwriteCheckbox = document.getElementById('overwriteExisting');
  const testBtn = document.getElementById('testBtn');
  const saveBtn = document.getElementById('saveBtn');
  const connectionStatus = document.getElementById('connectionStatus');
  const statusText = document.getElementById('statusText');
  const modelInfo = document.getElementById('modelInfo');
  const detectedModel = document.getElementById('detectedModel');
  const saveFeedback = document.getElementById('saveFeedback');

  const DEFAULT_BACKEND_URL = 'https://auto-answer-ini7.onrender.com';

  // A sleeping Render free-tier service can take ~50s to wake up
  const HEALTH_TIMEOUT_MS = 60000;
  const WAKING_HINT_MS = 8000;

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1';
  }

  // Returns a cleaned URL string, or null if it is not acceptable
  function normalizeBackendUrl(raw) {
    try {
      const parsed = new URL(String(raw || '').trim());
      const okProtocol = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalHost(parsed.hostname));
      if (!okProtocol) return null;
      return parsed.origin + parsed.pathname.replace(/\/+$/, '');
    } catch (e) {
      return null;
    }
  }

  // Best effort: ask the browser for access to the deployed backend origin.
  // Must be called directly from a click handler (user gesture).
  async function ensureHostPermission(url) {
    try {
      const parsed = new URL(url);
      if (isLocalHost(parsed.hostname)) return true;
      if (!chrome.permissions || !chrome.permissions.request) return true;
      const origins = [`${parsed.origin}/*`];
      if (await chrome.permissions.contains({ origins })) return true;
      return await chrome.permissions.request({ origins });
    } catch (e) {
      return true; // server-side CORS still allows the extension origin
    }
  }

  // Load saved settings (the API key is kept in local storage only, never synced)
  const config = await chrome.storage.sync.get({
    backendUrl: DEFAULT_BACKEND_URL,
    dotCorner: 'bottom-right',
    overwriteExisting: false
  });
  const secrets = await chrome.storage.local.get({ apiKey: '' });

  backendUrlInput.value = config.backendUrl;
  apiKeyInput.value = secrets.apiKey;
  dotCornerSelect.value = config.dotCorner;
  overwriteCheckbox.checked = config.overwriteExisting;

  // Run initial health check
  await checkHealth(config.backendUrl, secrets.apiKey);

  // Test button click
  testBtn.addEventListener('click', async () => {
    const url = normalizeBackendUrl(backendUrlInput.value);
    if (!url) {
      showFeedback('Use a valid https:// URL (http:// only for localhost)', false);
      return;
    }
    await checkHealth(url, apiKeyInput.value.trim());
  });

  // Save button click
  saveBtn.addEventListener('click', async () => {
    const url = normalizeBackendUrl(backendUrlInput.value);
    if (!url) {
      showFeedback('Use a valid https:// URL (http:// only for localhost)', false);
      return;
    }

    // Ask for host access FIRST so the click still counts as a user gesture
    const granted = await ensureHostPermission(url);

    const apiKey = apiKeyInput.value.trim();

    await chrome.storage.sync.set({
      backendUrl: url,
      dotCorner: dotCornerSelect.value,
      overwriteExisting: overwriteCheckbox.checked
    });
    await chrome.storage.local.set({ apiKey });

    backendUrlInput.value = url;
    showFeedback(granted ? 'Settings saved successfully!' : 'Saved (browser access to the backend was not granted)', granted);
    await checkHealth(url, apiKey);
  });

  // Health check helper function
  async function checkHealth(baseUrl, apiKey) {
    setStatus('checking', 'Checking...');
    modelInfo.style.display = 'none';

    const cleanUrl = String(baseUrl || '').replace(/\/+$/, '');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    // Still waiting after a few seconds: the backend is probably waking up
    const wakingId = setTimeout(() => setStatus('checking', 'Waking up server...'), WAKING_HINT_MS);

    try {
      const res = await fetch(`${cleanUrl}/api/health`, { signal: controller.signal });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.status !== 'healthy') {
        setStatus('offline', 'Unhealthy');
        return;
      }

      if (data.model) {
        detectedModel.textContent = data.model;
        modelInfo.style.display = 'block';
      }

      // Verify the API key is accepted by the backend
      const authRes = await fetch(`${cleanUrl}/api/auth-check`, {
        headers: apiKey ? { 'X-API-Key': apiKey } : {},
        signal: controller.signal
      });

      if (authRes.ok) {
        setStatus('online', 'Online');
      } else if (authRes.status === 401) {
        setStatus('offline', apiKey ? 'Wrong API key' : 'API key needed');
      } else if (authRes.status === 503) {
        setStatus('offline', 'Server API_SECRET not set');
      } else {
        setStatus('offline', `Auth error (HTTP ${authRes.status})`);
      }
    } catch (err) {
      setStatus('offline', 'Offline');
      console.warn('Backend connection error:', err.message);
    } finally {
      clearTimeout(timeoutId);
      clearTimeout(wakingId);
    }
  }

  function setStatus(type, text) {
    connectionStatus.className = `status-pill status-${type}`;
    statusText.textContent = text;
  }

  function showFeedback(msg, isSuccess) {
    saveFeedback.textContent = msg;
    saveFeedback.className = `feedback-msg ${isSuccess ? 'feedback-success' : 'feedback-error'}`;
    setTimeout(() => {
      saveFeedback.textContent = '';
      saveFeedback.className = 'feedback-msg';
    }, 3500);
  }
});
