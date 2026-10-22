/**
 * background.js - Service Worker for Gemini AI Google Forms Assistant
 * Initializes default settings and handles extension lifecycle events.
 */

const DEFAULT_CONFIG = {
  backendUrl: 'http://localhost:3000',
  dotCorner: 'bottom-right',
  overwriteExisting: false,
  confidenceThreshold: 'medium'
};

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

    if (Object.keys(toSet).length > 0) {
      await chrome.storage.sync.set(toSet);
      console.log('[Gemini Forms Assistant] Initialized default configuration:', toSet);
    }
  } catch (err) {
    console.error('[Gemini Forms Assistant] Failed to initialize storage:', err);
  }
});

// Optional message listener for cross-context communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', version: '1.0.0' });
    return true;
  }
});
