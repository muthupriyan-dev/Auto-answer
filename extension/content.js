/**
 * content.js - Gemini AI Google Forms Assistant
 * Content script running strictly on docs.google.com/forms/*
 *
 * Mandate:
 * 1. Default UI consists ONLY of one single colored circular dot (8-12px) in a discreet corner.
 * 2. Menu stays hidden until clicked.
 * 3. Answers are ONLY filled after explicit user approval.
 * 4. NEVER clicks Submit or submits forms automatically.
 *
 * Backend calls go through background.js (message type API_REQUEST) so the API key
 * and CORS origin are handled by the extension, not by the web page.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__GFA_INITIALIZED__) return;
  window.__GFA_INITIALIZED__ = true;

  // --- STATE MANAGEMENT ---
  const state = {
    status: 'gray', // 'gray' | 'blue' | 'green' | 'red'
    dotCorner: 'bottom-right',
    overwriteExisting: false,
    formTitle: '',
    scannedQuestions: [],
    suggestions: [],
    approvedMap: new Map(), // questionId -> boolean (default false)
    editedAnswers: new Map() // questionId -> string | array
  };

  const INTERACTIVE_SELECTOR =
    'input, textarea, div[role="radiogroup"], div[role="group"], div[role="listbox"], div[role="radio"], div[role="checkbox"]';
  const OPTION_AREA_SELECTOR =
    'div[role="radiogroup"], div[role="group"], div[role="listbox"], div[role="radio"], div[role="checkbox"], div[role="option"]';
  const OVERWRITE_SKIP_REASON = 'Field already contains an answer (overwrite disabled)';

  // --- DOM CACHE & ELEMENTS ---
  let dotElement = null;
  let menuElement = null;
  let reviewOverlay = null;
  let toastElement = null;
  let liveRegion = null;
  let suggestionsBusy = false;

  // --- SMALL HELPERS ---
  function normalizeText(value) {
    return String(value === undefined || value === null ? '' : value)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(fn, timeoutMs = 1500, intervalMs = 50) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = fn();
      if (result) return result;
      await sleep(intervalMs);
    }
    return fn() || null;
  }

  function toAnswerList(answer) {
    const list = Array.isArray(answer) ? answer : String(answer || '').split(',');
    return list.map((a) => String(a).trim()).filter(Boolean);
  }

  function isEmptyAnswer(answer) {
    if (Array.isArray(answer)) return toAnswerList(answer).length === 0;
    return String(answer === undefined || answer === null ? '' : answer).trim() === '';
  }

  function optionLabel(el) {
    return (el.getAttribute('data-value') || el.getAttribute('aria-label') || el.textContent || '').trim();
  }

  function dispatchMouseSequence(el) {
    ['mousedown', 'mouseup', 'click'].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
  }

  // --- BACKEND ACCESS (via background service worker) ---
  function apiRequest(path, body) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'API_REQUEST', path, body }, (response) => {
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            reject(new Error(lastErr.message || 'Extension background is not reachable. Reload this page.'));
            return;
          }
          if (!response) {
            reject(new Error('No response from the extension background. Reload this page.'));
            return;
          }
          if (!response.ok) {
            reject(new Error(response.error || `Server responded with HTTP ${response.status}`));
            return;
          }
          resolve(response.data);
        });
      } catch (e) {
        reject(new Error('The extension was updated or reloaded. Please refresh this page.'));
      }
    });
  }

  // --- INITIALIZATION ---
  async function init() {
    await loadSettings();
    createAccessibleLiveRegion();
    createStatusDot();
    createActionMenu();
    createReviewModal();
    createToast();
    setupGlobalShortcuts();

    // Listen for storage changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' || area === 'local') {
        if (changes.dotCorner) {
          state.dotCorner = changes.dotCorner.newValue;
          updateDotPosition();
        }
        if (changes.overwriteExisting !== undefined) {
          state.overwriteExisting = changes.overwriteExisting.newValue;
        }
      }
    });

    console.log('[Gemini Forms Assistant] Initialized successfully with discreet status dot.');
  }

  async function loadSettings() {
    try {
      const config = await chrome.storage.sync.get({
        dotCorner: 'bottom-right',
        overwriteExisting: false
      });
      state.dotCorner = config.dotCorner;
      state.overwriteExisting = config.overwriteExisting;
    } catch (e) {
      console.warn('[Gemini Forms Assistant] Could not load sync storage, using defaults:', e);
    }
  }

  // --- ACCESSIBILITY LIVE REGION ---
  function createAccessibleLiveRegion() {
    liveRegion = document.createElement('div');
    liveRegion.id = 'gfa-live-region';
    liveRegion.className = 'gfa-sr-only';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    document.body.appendChild(liveRegion);
  }

  function announce(message) {
    if (liveRegion) {
      liveRegion.textContent = '';
      setTimeout(() => {
        liveRegion.textContent = message;
      }, 50);
    }
  }

  // --- 1. SINGLE STATUS DOT ---
  function createStatusDot() {
    dotElement = document.createElement('button');
    dotElement.id = 'gfa-status-dot';
    dotElement.type = 'button';
    dotElement.tabIndex = 0;
    dotElement.setAttribute('aria-label', 'Google Forms Assistant: Idle (Click to open menu)');
    dotElement.setAttribute('aria-haspopup', 'menu');
    dotElement.setAttribute('aria-expanded', 'false');
    dotElement.title = 'Gemini Forms Assistant (Idle)';

    updateDotPosition();
    setStatus('gray', 'Idle');

    // Click opens action menu
    dotElement.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleActionMenu();
    });

    // Keyboard support: Enter or Space opens menu
    dotElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleActionMenu();
      }
    });

    document.body.appendChild(dotElement);
  }

  function updateDotPosition() {
    if (!dotElement) return;
    dotElement.className = `gfa-status-${state.status} gfa-pos-${state.dotCorner}`;
    if (menuElement) {
      menuElement.className = `${menuElement.classList.contains('gfa-open') ? 'gfa-open' : ''} gfa-pos-${state.dotCorner}`;
    }
  }

  function setStatus(statusColor, statusDescription) {
    state.status = statusColor;
    if (dotElement) {
      dotElement.className = `gfa-status-${statusColor} gfa-pos-${state.dotCorner}`;
      dotElement.setAttribute('aria-label', `Google Forms Assistant: ${statusDescription}`);
      dotElement.title = `Gemini Forms Assistant: ${statusDescription}`;
    }
    const pill = document.getElementById('gfa-menu-status-pill');
    if (pill) {
      pill.className = `gfa-status-pill gfa-pill-${statusColor}`;
      pill.textContent = statusDescription;
    }
    announce(`Assistant status: ${statusDescription}`);
  }

  // --- 2. ACTION MENU ---
  function createActionMenu() {
    menuElement = document.createElement('div');
    menuElement.id = 'gfa-action-menu';
    menuElement.className = `gfa-pos-${state.dotCorner}`;
    menuElement.setAttribute('role', 'menu');
    menuElement.setAttribute('aria-label', 'Google Forms Assistant Actions');

    menuElement.innerHTML = `
      <div class="gfa-menu-header">
        <span class="gfa-menu-title">
          <span>✨ Gemini Assistant</span>
          <span id="gfa-menu-status-pill" class="gfa-status-pill gfa-pill-gray">Idle</span>
        </span>
        <button type="button" class="gfa-menu-close" id="gfa-menu-close-btn" aria-label="Close menu">&times;</button>
      </div>
      <ul class="gfa-menu-list">
        <li>
          <button type="button" class="gfa-menu-item" id="gfa-act-scan" role="menuitem">
            <span class="gfa-menu-icon">🔍</span>
            <span>1. Scan Form &amp; Auto Fill</span>
          </button>
        </li>
        <li>
          <button type="button" class="gfa-menu-item" id="gfa-act-suggest" role="menuitem">
            <span class="gfa-menu-icon">✨</span>
            <span>2. Get Gemini Suggestions (manual)</span>
          </button>
        </li>
        <li>
          <button type="button" class="gfa-menu-item" id="gfa-act-review" role="menuitem">
            <span class="gfa-menu-icon">📝</span>
            <span>3. Review Answers (optional)</span>
          </button>
        </li>
        <li>
          <button type="button" class="gfa-menu-item" id="gfa-act-fill" role="menuitem">
            <span class="gfa-menu-icon">✍️</span>
            <span>4. Fill Approved Answers (manual)</span>
          </button>
        </li>
        <li>
          <button type="button" class="gfa-menu-item" id="gfa-act-settings" role="menuitem">
            <span class="gfa-menu-icon">⚙️</span>
            <span>5. Settings</span>
          </button>
        </li>
      </ul>
      <div class="gfa-menu-footer">
        🔒 Manual submit required. Privacy-first.
      </div>
    `;

    // Event Listeners for menu items
    menuElement.querySelector('#gfa-menu-close-btn').addEventListener('click', closeActionMenu);

    menuElement.querySelector('#gfa-act-scan').addEventListener('click', () => {
      closeActionMenu();
      handleScanAndAutoFill();
    });

    menuElement.querySelector('#gfa-act-suggest').addEventListener('click', () => {
      closeActionMenu();
      handleGetSuggestions({ autoFill: false });
    });

    menuElement.querySelector('#gfa-act-review').addEventListener('click', () => {
      closeActionMenu();
      openReviewModal();
    });

    menuElement.querySelector('#gfa-act-fill').addEventListener('click', () => {
      closeActionMenu();
      handleFillApprovedAnswers().catch(reportFillError);
    });

    menuElement.querySelector('#gfa-act-settings').addEventListener('click', () => {
      closeActionMenu();
      showToast('Open the extension popup in your browser toolbar to change settings.');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (menuElement && menuElement.classList.contains('gfa-open')) {
        if (!menuElement.contains(e.target) && e.target !== dotElement) {
          closeActionMenu();
        }
      }
    });

    document.body.appendChild(menuElement);
  }

  function toggleActionMenu() {
    if (!menuElement) return;
    const isOpen = menuElement.classList.contains('gfa-open');
    if (isOpen) {
      closeActionMenu();
    } else {
      openActionMenu();
    }
  }

  function openActionMenu() {
    menuElement.classList.add('gfa-open');
    dotElement.setAttribute('aria-expanded', 'true');
    const firstItem = menuElement.querySelector('.gfa-menu-item');
    if (firstItem) firstItem.focus();
  }

  function closeActionMenu() {
    if (menuElement) {
      menuElement.classList.remove('gfa-open');
      dotElement.setAttribute('aria-expanded', 'false');
    }
  }

  function reportFillError(err) {
    console.error('[Gemini Forms Assistant] Fill failed:', err);
    setStatus('red', 'Fill failed');
    showToast(`Fill failed: ${err && err.message ? err.message : 'unexpected error'}`);
  }

  // --- 3. FORM SCANNER ---
  function findQuestionTitle(container) {
    const heading = container.querySelector('div[role="heading"], .M7eMe, .HoLXfc');
    if (heading && heading.textContent.trim()) return heading.textContent.trim();

    // Fallback: first text span that is NOT part of the answer options
    const spans = container.querySelectorAll('span[dir="auto"]');
    for (const span of spans) {
      const wrapper = span.closest(OPTION_AREA_SELECTOR);
      const insideOptions = wrapper && wrapper !== container && container.contains(wrapper);
      if (!insideOptions && span.textContent.trim()) return span.textContent.trim();
    }
    return '';
  }

  function scanForm() {
    const questions = [];

    // Detect Form Title
    const titleEl = document.querySelector('div[role="heading"][aria-level="1"], .freebirdFormviewerViewHeaderTitle, .F9vfv');
    state.formTitle = titleEl ? titleEl.textContent.trim() : document.title || 'Google Form';

    // Find all question containers
    // Google Forms uses role="listitem" or .Qr7Oae or .geS5n
    const candidates = Array.from(document.querySelectorAll('div[role="listitem"], .Qr7Oae, .geS5n')).filter((c) => {
      if (c.closest('#gfa-review-overlay, #gfa-action-menu')) return false;
      return c.querySelector(INTERACTIVE_SELECTOR);
    });

    // Drop nested duplicates: keep only the outermost container of each question
    const uniqueContainers = candidates.filter((c) => !candidates.some((other) => other !== c && other.contains(c)));

    uniqueContainers.forEach((container, idx) => {
      const qId = `q_${idx + 1}`;
      container.setAttribute('data-gfa-id', qId);

      // Question Title (keep raw text to detect the required asterisk)
      const rawTitle = findQuestionTitle(container);
      const title = (rawTitle || `Question ${idx + 1}`).replace(/\s*\*\s*$/, '').trim();

      // Required flag: explicit ARIA markers or a trailing asterisk on the title
      const isRequired =
        Boolean(container.querySelector('[aria-required="true"], [aria-label="Required question"]')) ||
        /\*\s*$/.test(rawTitle);

      // Description/Help text
      const descEl = container.querySelector('.gfh2eb, .AgroKb, [id*="desc"]');
      const description = descEl ? descEl.textContent.trim() : '';

      // Determine Question Type & Options
      let type = 'SHORT_ANSWER';
      const options = [];

      const radioGroup = container.querySelector('div[role="radiogroup"]') || container.querySelector('div[role="radio"]');
      const checkboxGroup = container.querySelector('div[role="checkbox"]');
      const listbox = container.querySelector('div[role="listbox"]');
      const textarea = container.querySelector('textarea');
      const textInput = container.querySelector('input[type="text"]:not([role="combobox"]), input:not([type])');

      if (radioGroup) {
        type = 'MULTIPLE_CHOICE';
        container.querySelectorAll('div[role="radio"]').forEach((r) => {
          const label = optionLabel(r);
          if (label && !options.includes(label)) options.push(label);
        });
      } else if (checkboxGroup) {
        type = 'CHECKBOX';
        container.querySelectorAll('div[role="checkbox"]').forEach((cb) => {
          const label = optionLabel(cb);
          if (label && !options.includes(label)) options.push(label);
        });
      } else if (listbox) {
        type = 'DROPDOWN';
        container.querySelectorAll('div[role="option"], option').forEach((opt) => {
          const label = (opt.getAttribute('data-value') || opt.textContent || '').trim();
          if (label && label !== 'Choose' && !options.includes(label)) options.push(label);
        });
      } else if (textarea) {
        type = 'PARAGRAPH';
      } else if (textInput) {
        type = 'SHORT_ANSWER';
      }

      questions.push({
        id: qId,
        type,
        title,
        description,
        required: isRequired,
        options,
        containerRef: container
      });
    });

    state.scannedQuestions = questions;
    return questions;
  }

  function handleScanForm(userInitiated = false) {
    const questions = scanForm();
    if (questions.length === 0) {
      setStatus('red', 'No questions found');
      showToast('No supported form questions found on this page.');
      return;
    }

    setStatus('gray', `${questions.length} questions detected`);
    if (userInitiated) {
      showToast(`Scanned ${questions.length} form questions.`);
    }
  }

  // One-tap flow: scan -> Gemini -> auto approve -> auto fill (never submits the form)
  async function handleScanAndAutoFill() {
    const questions = scanForm();
    if (questions.length === 0) {
      setStatus('red', 'No questions found');
      showToast('No supported form questions found on this page.');
      return;
    }
    setStatus('blue', `${questions.length} questions found`);
    showToast(`Scanned ${questions.length} questions. Getting answers...`);
    try {
      await handleGetSuggestions({ autoFill: true });
    } catch (err) {
      reportFillError(err);
    }
  }

  // --- 4. COMMUNICATE WITH GEMINI API (VIA BACKGROUND -> BACKEND) ---
  async function handleGetSuggestions(options = {}) {
    const autoFill = options.autoFill === true;
    if (suggestionsBusy) {
      showToast('Still waiting for Gemini. Please wait...');
      return;
    }

    const questions = scanForm();
    if (questions.length === 0) {
      setStatus('red', 'No questions detected');
      showToast('Please open an active Google Form before requesting suggestions.');
      return;
    }

    suggestionsBusy = true;
    setStatus('blue', 'Querying Gemini...');
    showToast(`Sending ${questions.length} questions to Gemini...`);

    try {
      const payload = {
        formTitle: state.formTitle,
        questions: questions.map((q) => ({
          id: q.id,
          type: q.type,
          title: q.title,
          description: q.description,
          required: q.required,
          options: q.options
        }))
      };

      const data = await apiRequest('/api/suggest', payload);
      if (!data || !Array.isArray(data.suggestions)) {
        throw new Error('Invalid response structure received from backend.');
      }

      state.suggestions = data.suggestions;

      // Approval state: manual mode needs explicit approval, auto mode approves every non-empty answer
      state.approvedMap.clear();
      state.editedAnswers.clear();

      data.suggestions.forEach((s) => {
        const hasAnswer = !isEmptyAnswer(s.suggestedAnswer);
        state.approvedMap.set(s.questionId, autoFill && hasAnswer);
        state.editedAnswers.set(s.questionId, s.suggestedAnswer);
      });

      if (autoFill) {
        setStatus('blue', 'Auto filling...');
        suggestionsBusy = false;
        await handleFillApprovedAnswers();
        return;
      }

      setStatus('green', 'Suggestions ready');
      showToast(`✨ Received ${data.suggestions.length} suggestions. Click Review to inspect.`);
      openReviewModal();
    } catch (err) {
      console.error('[Gemini Forms Assistant Error]', err);
      setStatus('red', 'Error occurred');
      showToast(`Error: ${err.message}`);
    } finally {
      suggestionsBusy = false;
    }
  }

  // --- 5. REVIEW MODAL ---
  function createReviewModal() {
    reviewOverlay = document.createElement('div');
    reviewOverlay.id = 'gfa-review-overlay';
    reviewOverlay.setAttribute('role', 'dialog');
    reviewOverlay.setAttribute('aria-modal', 'true');
    reviewOverlay.setAttribute('aria-labelledby', 'gfa-modal-title');

    reviewOverlay.innerHTML = `
      <div class="gfa-review-modal">
        <header class="gfa-modal-header">
          <div>
            <h2 class="gfa-modal-title" id="gfa-modal-title">Review Suggested Answers</h2>
            <p class="gfa-modal-subtitle">Review, edit, and approve suggestions before filling into form.</p>
          </div>
          <button type="button" class="gfa-menu-close" id="gfa-review-close" aria-label="Close review">&times;</button>
        </header>

        <div class="gfa-modal-body" id="gfa-modal-cards-container">
          <!-- Dynamically populated question cards -->
        </div>

        <footer class="gfa-modal-footer">
          <div class="gfa-modal-disclaimer">
            <span>🔒 Form will NOT be submitted automatically.</span>
          </div>
          <div class="gfa-modal-actions">
            <button type="button" class="gfa-btn gfa-btn-cancel" id="gfa-modal-close-btn">Close</button>
            <button type="button" class="gfa-btn gfa-btn-fill" id="gfa-modal-fill-btn">Fill Approved (0)</button>
          </div>
        </footer>
      </div>
    `;

    reviewOverlay.querySelector('#gfa-review-close').addEventListener('click', closeReviewModal);
    reviewOverlay.querySelector('#gfa-modal-close-btn').addEventListener('click', closeReviewModal);

    reviewOverlay.querySelector('#gfa-modal-fill-btn').addEventListener('click', () => {
      closeReviewModal();
      handleFillApprovedAnswers().catch(reportFillError);
    });

    // Close on overlay backdrop click
    reviewOverlay.addEventListener('click', (e) => {
      if (e.target === reviewOverlay) closeReviewModal();
    });

    document.body.appendChild(reviewOverlay);
  }

  function openReviewModal() {
    if (!state.suggestions || state.suggestions.length === 0) {
      showToast('No suggestions available yet. Click "Get Gemini Suggestions" first.');
      return;
    }

    renderReviewCards();
    updateFillButtonState();
    reviewOverlay.classList.add('gfa-open');
    const firstInput = reviewOverlay.querySelector('input, textarea, button');
    if (firstInput) firstInput.focus();
  }

  function closeReviewModal() {
    if (reviewOverlay) {
      reviewOverlay.classList.remove('gfa-open');
    }
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderReviewCards() {
    const container = document.getElementById('gfa-modal-cards-container');
    if (!container) return;
    container.innerHTML = '';

    const questionMap = new Map(state.scannedQuestions.map((q) => [q.id, q]));

    state.suggestions.forEach((s, idx) => {
      const originalQ = questionMap.get(s.questionId) || {};
      const qType = s.questionType || originalQ.type;
      const card = document.createElement('div');
      card.className = `gfa-q-card ${state.approvedMap.get(s.questionId) ? 'gfa-approved' : ''}`;
      card.id = `gfa-card-${s.questionId}`;

      const isApproved = state.approvedMap.get(s.questionId) || false;
      const storedAnswer = state.editedAnswers.has(s.questionId) ? state.editedAnswers.get(s.questionId) : s.suggestedAnswer;
      const currentAnswerText = Array.isArray(storedAnswer) ? storedAnswer.join(', ') : String(storedAnswer || '');

      card.innerHTML = `
        <div class="gfa-q-header">
          <div class="gfa-q-title">
            ${idx + 1}. ${escapeHtml(s.questionText || originalQ.title || 'Question')}
          </div>
          <div class="gfa-q-badges">
            <span class="gfa-badge gfa-badge-type">${escapeHtml(qType || 'TEXT')}</span>
            <span class="gfa-badge gfa-badge-conf-${escapeHtml(s.confidence || 'medium')}">${escapeHtml(s.confidence || 'MED')}</span>
          </div>
        </div>

        ${s.warning ? `<div class="gfa-q-warning">⚠️ <strong>Notice:</strong> ${escapeHtml(s.warning)}</div>` : ''}

        <div class="gfa-q-explanation">
          💡 <strong>Explanation:</strong> ${escapeHtml(s.explanation || 'No explanation provided.')}
        </div>

        <div class="gfa-q-input-wrap">
          <label class="gfa-q-input-label" for="gfa-input-${s.questionId}">Suggested / Editable Answer:</label>
          ${
            qType === 'PARAGRAPH'
              ? `<textarea class="gfa-input-textarea" id="gfa-input-${s.questionId}">${escapeHtml(currentAnswerText)}</textarea>`
              : `<input type="text" class="gfa-input-text" id="gfa-input-${s.questionId}" value="${escapeHtml(currentAnswerText)}">`
          }
        </div>

        <div class="gfa-q-input-wrap">
          <label class="gfa-q-input-label" for="gfa-ctx-${s.questionId}">Extra context for Regenerate (optional):</label>
          <input type="text" class="gfa-input-text" id="gfa-ctx-${s.questionId}" maxlength="500" placeholder="e.g. answer in one short sentence">
        </div>

        <div class="gfa-q-footer">
          <label class="gfa-approve-label">
            <input type="checkbox" id="gfa-chk-${s.questionId}" ${isApproved ? 'checked' : ''}>
            <span>Approve this answer for filling</span>
          </label>
          <button type="button" class="gfa-btn-regen" data-qid="${s.questionId}">
            <span>🔄 Regenerate</span>
          </button>
        </div>
      `;

      // Event listener for user editing the answer
      const inputEl = card.querySelector(`#gfa-input-${s.questionId}`);
      inputEl.addEventListener('input', (e) => {
        let val = e.target.value;
        if (qType === 'CHECKBOX') {
          val = val.split(',').map((item) => item.trim()).filter(Boolean);
        }
        state.editedAnswers.set(s.questionId, val);
      });

      // Event listener for approval checkbox
      const chkEl = card.querySelector(`#gfa-chk-${s.questionId}`);
      chkEl.addEventListener('change', (e) => {
        const approved = e.target.checked;
        state.approvedMap.set(s.questionId, approved);
        card.classList.toggle('gfa-approved', approved);
        updateFillButtonState();
      });

      // Event listener for single question regeneration
      const regenBtn = card.querySelector('.gfa-btn-regen');
      regenBtn.addEventListener('click', async () => {
        const ctxEl = card.querySelector(`#gfa-ctx-${s.questionId}`);
        const customContext = ctxEl ? ctxEl.value.trim() : '';
        await handleSingleRegenerate(s.questionId, originalQ, customContext);
      });

      container.appendChild(card);
    });
  }

  function updateFillButtonState() {
    const fillBtn = document.getElementById('gfa-modal-fill-btn');
    if (!fillBtn) return;

    let count = 0;
    state.approvedMap.forEach((isApproved) => {
      if (isApproved) count++;
    });

    fillBtn.textContent = `Fill Approved (${count})`;
    fillBtn.disabled = count === 0;
  }

  // --- 6. SINGLE QUESTION REGENERATION ---
  async function handleSingleRegenerate(qId, questionObj, customContext = '') {
    const card = document.getElementById(`gfa-card-${qId}`);
    if (!card) return;

    const regenBtn = card.querySelector('.gfa-btn-regen');
    if (regenBtn) regenBtn.textContent = '⏳ Thinking...';

    try {
      // Make sure we have the real question (with its options) to send
      let q = questionObj && questionObj.title ? questionObj : scanForm().find((x) => x.id === qId);
      if (!q) throw new Error('Could not find this question on the page.');

      const data = await apiRequest('/api/regenerate', {
        formTitle: state.formTitle,
        customContext,
        question: {
          id: q.id || qId,
          type: q.type || 'SHORT_ANSWER',
          title: q.title,
          description: q.description,
          required: q.required,
          options: q.options
        }
      });

      if (!data || !data.suggestion) {
        throw new Error('Regeneration failed');
      }

      // Update state
      const newSug = data.suggestion;
      const idx = state.suggestions.findIndex((s) => s.questionId === qId);
      if (idx !== -1) {
        state.suggestions[idx] = newSug;
      }
      state.editedAnswers.set(qId, newSug.suggestedAnswer);
      state.approvedMap.set(qId, false); // Require re-approval

      // Re-render
      renderReviewCards();
      updateFillButtonState();
      showToast('Suggestion regenerated. Please review and approve.');
    } catch (e) {
      showToast(`Regeneration failed: ${e.message}`);
      if (regenBtn) regenBtn.textContent = '🔄 Regenerate';
    }
  }

  // --- 7. FILL APPROVED ANSWERS SAFELY ---
  async function handleFillApprovedAnswers() {
    let approvedCount = 0;
    let filledCount = 0;
    let skippedCount = 0;
    const skippedReasons = [];

    // Re-scan so we act on the live DOM
    scanForm();
    const byId = new Map(state.scannedQuestions.map((q) => [q.id, q]));
    const byTitle = new Map(state.scannedQuestions.map((q) => [normalizeText(q.title), q]));

    for (const s of state.suggestions) {
      if (!state.approvedMap.get(s.questionId)) continue;

      approvedCount++;

      // Match by id, but verify the title still matches (multi-section forms can shift the DOM)
      const expectedTitle = normalizeText(s.questionText);
      let q = byId.get(s.questionId);
      if (expectedTitle && (!q || normalizeText(q.title) !== expectedTitle)) {
        q = byTitle.get(expectedTitle) || null;
      }

      if (!q || !q.containerRef) {
        skippedCount++;
        skippedReasons.push(`Could not safely locate "${s.questionText || s.questionId}" in the page DOM.`);
        continue;
      }

      const answerToFill = state.editedAnswers.has(s.questionId) ? state.editedAnswers.get(s.questionId) : s.suggestedAnswer;
      const result = await fillQuestionField(q, answerToFill);

      if (result.filled) {
        filledCount++;
      } else {
        skippedCount++;
        skippedReasons.push(`Question "${q.title}": ${result.reason}`);
      }
    }

    if (approvedCount === 0) {
      showToast('No answers approved yet. Open "Review Suggested Answers" to approve fields.');
      return;
    }

    // MANDATORY STATUS: Explicit notice that form will NOT be submitted
    let summaryMsg = `Filled ${filledCount} of ${approvedCount} approved answers.`;
    if (skippedCount > 0) {
      summaryMsg += ` (${skippedCount} skipped: check console for details)`;
      console.warn('[Gemini Forms Assistant] Skipped items:', skippedReasons);
    }
    summaryMsg += ' Please review and submit the form manually.';

    showToast(summaryMsg, 5000);
    announce(summaryMsg);

    if (filledCount > 0) {
      setStatus('green', `Filled ${filledCount} approved`);
    }
  }

  function getDropdownSelection(container) {
    const selected = container.querySelector('div[role="option"][aria-selected="true"]');
    if (!selected) return '';
    const raw = selected.hasAttribute('data-value') ? selected.getAttribute('data-value') : selected.textContent;
    const value = (raw || '').trim();
    return normalizeText(value) === 'choose' ? '' : value;
  }

  function findDropdownOption(container, target) {
    const matches = (opt) => normalizeText(opt.getAttribute('data-value') || opt.textContent) === target;

    // Options normally live inside the question's own listbox
    const local = Array.from(container.querySelectorAll('div[role="option"]')).find(matches);
    if (local) return local;

    // Fallback: a popup rendered elsewhere on the page (only visible options)
    return (
      Array.from(document.querySelectorAll('div[role="option"]')).find((opt) => opt.offsetParent !== null && matches(opt)) || null
    );
  }

  async function fillDropdown(container, answer) {
    const target = normalizeText(answer);
    const listbox = container.querySelector('div[role="listbox"]');
    if (!listbox) return { filled: false, reason: 'Dropdown container not found' };

    const current = getDropdownSelection(container);
    if (current && normalizeText(current) === target) return { filled: true, reason: 'Already selected' };
    if (current && !state.overwriteExisting) return { filled: false, reason: OVERWRITE_SKIP_REASON };

    // Open the dropdown, wait for the options to exist, then pick the match
    dispatchMouseSequence(listbox);
    const option = await waitFor(() => findDropdownOption(container, target), 1500);
    if (!option) {
      return { filled: false, reason: `Option "${answer}" was not found in the dropdown.` };
    }

    dispatchMouseSequence(option);
    await sleep(120);
    return { filled: true };
  }

  async function fillQuestionField(questionObj, answer) {
    const container = questionObj.containerRef;
    if (!container) return { filled: false, reason: 'DOM element not found' };

    if (isEmptyAnswer(answer)) {
      return { filled: false, reason: 'No answer provided (nothing to fill)' };
    }

    switch (questionObj.type) {
      case 'SHORT_ANSWER': {
        const input = container.querySelector('input[type="text"]:not([role="combobox"]), input:not([type])');
        if (!input) return { filled: false, reason: 'Text input element not found' };

        if (!state.overwriteExisting && input.value && input.value.trim() !== '') {
          return { filled: false, reason: OVERWRITE_SKIP_REASON };
        }

        setInputValue(input, String(answer || ''));
        return { filled: true };
      }

      case 'PARAGRAPH': {
        const textarea = container.querySelector('textarea');
        if (!textarea) return { filled: false, reason: 'Textarea element not found' };

        if (!state.overwriteExisting && textarea.value && textarea.value.trim() !== '') {
          return { filled: false, reason: OVERWRITE_SKIP_REASON };
        }

        setInputValue(textarea, String(answer || ''));
        return { filled: true };
      }

      case 'MULTIPLE_CHOICE': {
        const targetStr = normalizeText(answer);
        const radios = Array.from(container.querySelectorAll('div[role="radio"]'));
        if (radios.length === 0) return { filled: false, reason: 'Radio options not found' };

        const matchedRadio = radios.find((r) => normalizeText(optionLabel(r)) === targetStr);
        if (!matchedRadio) {
          return { filled: false, reason: `Option "${answer}" did not match any available radio choice.` };
        }

        if (matchedRadio.getAttribute('aria-checked') === 'true') {
          return { filled: true, reason: 'Already selected' };
        }

        const hasSelection = radios.some((r) => r.getAttribute('aria-checked') === 'true');
        if (!state.overwriteExisting && hasSelection) {
          return { filled: false, reason: OVERWRITE_SKIP_REASON };
        }

        matchedRadio.click();
        return { filled: true };
      }

      case 'CHECKBOX': {
        const targetList = toAnswerList(answer).map(normalizeText);
        const checkboxes = Array.from(container.querySelectorAll('div[role="checkbox"]'));
        if (checkboxes.length === 0) return { filled: false, reason: 'Checkboxes not found' };

        const isChecked = (cb) => cb.getAttribute('aria-checked') === 'true';
        const shouldBeChecked = (cb) => targetList.includes(normalizeText(optionLabel(cb)));

        if (!checkboxes.some(shouldBeChecked)) {
          return { filled: false, reason: 'No matching checkbox options found for provided values.' };
        }

        const hasSelection = checkboxes.some(isChecked);
        if (!state.overwriteExisting && hasSelection) {
          const alreadyExact = checkboxes.every((cb) => isChecked(cb) === shouldBeChecked(cb));
          return alreadyExact
            ? { filled: true, reason: 'Already selected' }
            : { filled: false, reason: OVERWRITE_SKIP_REASON };
        }

        // Bring every box to the desired state (with overwrite off nothing is checked yet, so this only checks)
        checkboxes.forEach((cb) => {
          if (isChecked(cb) !== shouldBeChecked(cb)) cb.click();
        });
        return { filled: true };
      }

      case 'DROPDOWN':
        return fillDropdown(container, answer);

      default:
        return { filled: false, reason: `Unsupported question type: ${questionObj.type}` };
    }
  }

  function setInputValue(el, value) {
    el.focus();
    el.value = value;
    // Dispatch events so Google Forms Closure/React architecture updates internal state
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  }

  // --- 8. TOAST NOTIFICATIONS ---
  function createToast() {
    toastElement = document.createElement('div');
    toastElement.id = 'gfa-toast';
    toastElement.setAttribute('role', 'status');
    toastElement.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastElement);
  }

  let toastTimeout = null;
  function showToast(message, duration = 3500) {
    if (!toastElement) return;
    toastElement.textContent = message;
    toastElement.classList.add('gfa-show');

    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastElement.classList.remove('gfa-show');
    }, duration);
  }

  // --- 9. KEYBOARD ACCESSIBILITY ---
  function setupGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (reviewOverlay && reviewOverlay.classList.contains('gfa-open')) {
          closeReviewModal();
        } else if (menuElement && menuElement.classList.contains('gfa-open')) {
          closeActionMenu();
        }
      }
    });
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
