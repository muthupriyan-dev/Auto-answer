/**
 * popup.js - Handles extension configuration and backend connectivity testing.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const backendUrlInput = document.getElementById('backendUrl');
  const dotCornerSelect = document.getElementById('dotCorner');
  const overwriteCheckbox = document.getElementById('overwriteExisting');
  const testBtn = document.getElementById('testBtn');
  const saveBtn = document.getElementById('saveBtn');
  const connectionStatus = document.getElementById('connectionStatus');
  const statusText = document.getElementById('statusText');
  const modelInfo = document.getElementById('modelInfo');
  const detectedModel = document.getElementById('detectedModel');
  const saveFeedback = document.getElementById('saveFeedback');

  // Load saved settings
  const config = await chrome.storage.sync.get({
    backendUrl: 'http://localhost:3000',
    dotCorner: 'bottom-right',
    overwriteExisting: false
  });

  backendUrlInput.value = config.backendUrl;
  dotCornerSelect.value = config.dotCorner;
  overwriteCheckbox.checked = config.overwriteExisting;

  // Run initial health check
  await checkHealth(config.backendUrl);

  // Test button click
  testBtn.addEventListener('click', async () => {
    const url = backendUrlInput.value.trim().replace(/\/+$/, '');
    await checkHealth(url);
  });

  // Save button click
  saveBtn.addEventListener('click', async () => {
    let url = backendUrlInput.value.trim().replace(/\/+$/, '');
    if (!url) {
      showFeedback('Please enter a valid Backend URL', false);
      return;
    }

    const newConfig = {
      backendUrl: url,
      dotCorner: dotCornerSelect.value,
      overwriteExisting: overwriteCheckbox.checked
    };

    await chrome.storage.sync.set(newConfig);
    showFeedback('Settings saved successfully!', true);
    await checkHealth(url);
  });

  // Health check helper function
  async function checkHealth(baseUrl) {
    setStatus('checking', 'Checking...');
    modelInfo.style.display = 'none';

    try {
      const cleanUrl = baseUrl.replace(/\/+$/, '');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`${cleanUrl}/api/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.status === 'healthy') {
        setStatus('online', 'Online');
        if (data.model) {
          detectedModel.textContent = data.model;
          modelInfo.style.display = 'block';
        }
      } else {
        setStatus('offline', 'Unhealthy');
      }
    } catch (err) {
      setStatus('offline', 'Offline');
      console.warn('Backend connection error:', err.message);
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
    }, 3000);
  }
});
