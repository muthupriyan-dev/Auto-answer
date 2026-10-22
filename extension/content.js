/**
 * content.js - Gemini AI Google Forms Assistant
 * Content script running strictly on docs.google.com/forms/*
 *
 * Mandate:
 * 1. Default UI consists ONLY of one single colored circular dot (8-12px) in a discreet corner.
 * 2. Menu stays hidden until clicked.
 * 3. Answers are ONLY filled after explicit user approval.
 * 4. NEVER clicks Submit or submits forms automatically.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__GFA_INITIALIZED__) return;
  window.__GFA_INITIALIZED__ = true;

  // --- STATE MANAGEMENT ---
  const state = {
    status: 'gray', // 'gray' | 'blue' | 'green' | 'red'
    backendUrl: 'http://localhost:3000',
    dotCorner: 'bottom-right',
    overwriteExisting: false,
    formTitle: '',
    scannedQuestions: [],
    suggestions: [],
    approvedMap: new Map(), // questionId -> boolean (default false)
    editedAnswers: new Map() // questionId -> string | array
  };

  // --- DOM CACHE & ELEMENTS ---
  let dotElement = null;
  let menuElement = null;
  let reviewOverlay = null;
  let toastElement = null;
  let liveRegion = null;

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
        if (changes.backendUrl) state.backendUrl = changes.backendUrl.newValue;
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
        backendUrl: 'http://localhost:3000',
        dotCorner: 'bottom-right',
        overwriteExisting: false
      });
      state.backendUrl = config.backendUrl.replace(/\/+$/, '');
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
            <span>1. Scan Form</span>
          </button>
        </li>
        <li>
          <button type="button" class="gfa-menu-item" id="gfa-act-suggest" role="menuitem">
            <span class="gfa-menu-icon">✨</span>
            <span>2. Get Gemini Suggestions</span>
          </button>
        </li>
        <li>
          <button type="button" class="gfa-menu-item" id="gfa-act-review" role="menuitem">
            <span class="gfa-menu-icon">📝</span>
            <span>3. Review Suggested Answers</span>
          </button>
        </li>
        <li>
          <button type="button" class="gfa-menu-item" id="gfa-act-fill" role="menuitem">
            <span class="gfa-menu-icon">✍️</span>
            <span>4. Fill Approved Answers</span>
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
      handleScanForm(true);
    });

    menuElement.querySelector('#gfa-act-suggest').addEventListener('click', () => {
      closeActionMenu();
      handleGetSuggestions();
    });

    menuElement.querySelector('#gfa-act-review').addEventListener('click', () => {
      closeActionMenu();
      openReviewModal();
    });

    menuElement.querySelector('#gfa-act-fill').addEventListener('click', () => {
      closeActionMenu();
      handleFillApprovedAnswers();
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

  // --- 3. FORM SCANNER ---
  function scanForm() {
    const questions = [];

    // Detect Form Title
    const titleEl = document.querySelector('div[role="heading"][aria-level="1"], .freebirdFormviewerViewHeaderTitle, .F9vfv');
    state.formTitle = titleEl ? titleEl.textContent.trim() : document.title || 'Google Form';

    // Find all question containers
    // Google Forms uses role="listitem" or .Qr7Oae or .geS5n
    const containers = Array.from(document.querySelectorAll('div[role="listitem"], .Qr7Oae, .geS5n'));

    // Filter to containers that actually house a question
    const uniqueContainers = containers.filter(c => {
      return c.querySelector('input, textarea, div[role="radiogroup"], div[role="group"], div[role="listbox"], div[role="radio"], div[role="checkbox"]');
    });

    uniqueContainers.forEach((container, idx) => {
      const qId = `q_${idx + 1}`;
      container.setAttribute('data-gfa-id', qId);

      // Question Title
      const heading = container.querySelector('div[role="heading"], .M7eMe, .HoLXfc, span[dir="auto"]');
      let title = heading ? heading.textContent.trim() : `Question ${idx + 1}`;

      // Clean required asterisk indicator from title text
      title = title.replace(/\s*\*\s*$/, '').trim();

      // Required flag
      const isRequired = Boolean(
        container.querySelector('.vnumgf, [aria-label*="required"], span[aria-hidden="false"] > *') ||
        container.querySelector('span[aria-label="Required question"]') ||
        container.innerHTML.includes('*')
      );

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
        const radioEls = container.querySelectorAll('div[role="radio"]');
        radioEls.forEach(r => {
          const optLabel = r.getAttribute('data-value') || r.getAttribute('aria-label') || r.innerText.trim();
          if (optLabel && !options.includes(optLabel)) options.push(optLabel);
        });
      } else if (checkboxGroup) {
        type = 'CHECKBOX';
        const cbEls = container.querySelectorAll('div[role="checkbox"]');
        cbEls.forEach(cb => {
          const optLabel = cb.getAttribute('data-value') || cb.getAttribute('aria-label') || cb.innerText.trim();
          if (optLabel && !options.includes(optLabel)) options.push(optLabel);
        });
      } else if (listbox) {
        type = 'DROPDOWN';
        const optEls = container.querySelectorAll('div[role="option"], option');
        optEls.forEach(opt => {
          const optLabel = opt.innerText.trim();
          if (optLabel && optLabel !== 'Choose' && !options.includes(optLabel)) options.push(optLabel);
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

  // --- 4. COMMUNICATE WITH GEMINI API (VIA BACKEND) ---
  async function handleGetSuggestions() {
    const questions = scanForm();
    if (questions.length === 0) {
      setStatus('red', 'No questions detected');
      showToast('Please open an active Google Form before requesting suggestions.');
      return;
    }

    setStatus('blue', 'Querying Gemini...');
    showToast(`Sending ${questions.length} questions to Gemini...`);

    try {
      const payload = {
        formTitle: state.formTitle,
        questions: questions.map(q => ({
          id: q.id,
          type: q.type,
          title: q.title,
          description: q.description,
          required: q.required,
          options: q.options
        }))
      };

      const res = await fetch(`${state.backendUrl}/api/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.success || !Array.isArray(data.suggestions)) {
        throw new Error('Invalid response structure received from backend.');
      }

      state.suggestions = data.suggestions;

      // Initialize default approval state: ALWAYS DEFAULT TO FALSE
      state.approvedMap.clear();
      state.editedAnswers.clear();

      data.suggestions.forEach(s => {
        state.approvedMap.set(s.questionId, false); // Explicit human approval required!
        state.editedAnswers.set(s.questionId, s.suggestedAnswer);
      });

      setStatus('green', 'Suggestions ready');
      showToast(`✨ Received ${data.suggestions.length} suggestions. Click Review to inspect.`);

      // Prompt user or open review dialog
      openReviewModal();
    } catch (err) {
      console.error('[Gemini Forms Assistant Error]', err);
      setStatus('red', 'Error occurred');
      showToast(`Error: ${err.message}`);
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
      handleFillApprovedAnswers();
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

    const questionMap = new Map(state.scannedQuestions.map(q => [q.id, q]));

    state.suggestions.forEach((s, idx) => {
      const originalQ = questionMap.get(s.questionId) || {};
      const card = document.createElement('div');
      card.className = `gfa-q-card ${state.approvedMap.get(s.questionId) ? 'gfa-approved' : ''}`;
      card.id = `gfa-card-${s.questionId}`;

      const isApproved = state.approvedMap.get(s.questionId) || false;
      const currentAnswer = state.editedAnswers.get(s.questionId) || s.suggestedAnswer || '';

      card.innerHTML = `
        <div class="gfa-q-header">
          <div class="gfa-q-title">
            ${idx + 1}. ${escapeHtml(s.questionText || originalQ.title || 'Question')}
          </div>
          <div class="gfa-q-badges">
            <span class="gfa-badge gfa-badge-type">${escapeHtml(originalQ.type || 'TEXT')}</span>
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
            originalQ.type === 'PARAGRAPH'
              ? `<textarea class="gfa-input-textarea" id="gfa-input-${s.questionId}">${escapeHtml(currentAnswer)}</textarea>`
              : `<input type="text" class="gfa-input-text" id="gfa-input-${s.questionId}" value="${escapeHtml(Array.isArray(currentAnswer) ? currentAnswer.join(', ') : currentAnswer)}">`
          }
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
        if (originalQ.type === 'CHECKBOX') {
          val = val.split(',').map(item => item.trim()).filter(Boolean);
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
        await handleSingleRegenerate(s.questionId, originalQ);
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
  async function handleSingleRegenerate(qId, questionObj) {
    const card = document.getElementById(`gfa-card-${qId}`);
    if (!card) return;

    const regenBtn = card.querySelector('.gfa-btn-regen');
    if (regenBtn) regenBtn.textContent = '⏳ Thinking...';

    try {
      const res = await fetch(`${state.backendUrl}/api/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formTitle: state.formTitle,
          question: {
            id: questionObj.id || qId,
            type: questionObj.type || 'SHORT_ANSWER',
            title: questionObj.title,
            description: questionObj.description,
            required: questionObj.required,
            options: questionObj.options
          }
        })
      });

      const data = await res.json();
      if (!data.success || !data.suggestion) {
        throw new Error(data.error || 'Regeneration failed');
      }

      // Update state
      const newSug = data.suggestion;
      const idx = state.suggestions.findIndex(s => s.questionId === qId);
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
  function handleFillApprovedAnswers() {
    let approvedCount = 0;
    let filledCount = 0;
    let skippedCount = 0;
    const skippedReasons = [];

    // Map questions to DOM
    scanForm();
    const questionMap = new Map(state.scannedQuestions.map(q => [q.id, q]));

    state.suggestions.forEach(s => {
      const isApproved = state.approvedMap.get(s.questionId);
      if (!isApproved) return;

      approvedCount++;
      const q = questionMap.get(s.questionId);
      if (!q || !q.containerRef) {
        skippedCount++;
        skippedReasons.push(`Could not safely locate Question ${s.questionId} in the page DOM.`);
        return;
      }

      const answerToFill = state.editedAnswers.get(s.questionId) || s.suggestedAnswer;
      const success = fillQuestionField(q, answerToFill);

      if (success.filled) {
        filledCount++;
      } else {
        skippedCount++;
        skippedReasons.push(`Question "${q.title}": ${success.reason}`);
      }
    });

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

  function fillQuestionField(questionObj, answer) {
    const container = questionObj.containerRef;
    if (!container) return { filled: false, reason: 'DOM element not found' };

    switch (questionObj.type) {
      case 'SHORT_ANSWER': {
        const input = container.querySelector('input[type="text"]:not([role="combobox"]), input:not([type])');
        if (!input) return { filled: false, reason: 'Text input element not found' };

        if (!state.overwriteExisting && input.value && input.value.trim() !== '') {
          return { filled: false, reason: 'Field already contains an answer (overwrite disabled)' };
        }

        setInputValue(input, String(answer || ''));
        return { filled: true };
      }

      case 'PARAGRAPH': {
        const textarea = container.querySelector('textarea');
        if (!textarea) return { filled: false, reason: 'Textarea element not found' };

        if (!state.overwriteExisting && textarea.value && textarea.value.trim() !== '') {
          return { filled: false, reason: 'Field already contains an answer (overwrite disabled)' };
        }

        setInputValue(textarea, String(answer || ''));
        return { filled: true };
      }

      case 'MULTIPLE_CHOICE': {
        const targetStr = String(answer || '').trim().toLowerCase();
        const radios = container.querySelectorAll('div[role="radio"]');
        if (radios.length === 0) return { filled: false, reason: 'Radio options not found' };

        let matchedRadio = null;
        for (const r of radios) {
          const val = (r.getAttribute('data-value') || r.getAttribute('aria-label') || r.innerText || '').trim().toLowerCase();
          if (val === targetStr) {
            matchedRadio = r;
            break;
          }
        }

        if (!matchedRadio) {
          return { filled: false, reason: `Option "${answer}" did not match any available radio choice.` };
        }

        if (matchedRadio.getAttribute('aria-checked') === 'true') {
          return { filled: true, reason: 'Already selected' };
        }

        matchedRadio.click();
        return { filled: true };
      }

      case 'CHECKBOX': {
        const targetList = Array.isArray(answer)
          ? answer.map(a => String(a).trim().toLowerCase())
          : String(answer || '').split(',').map(a => a.trim().toLowerCase());

        const checkboxes = container.querySelectorAll('div[role="checkbox"]');
        if (checkboxes.length === 0) return { filled: false, reason: 'Checkboxes not found' };

        let anyChecked = false;
        checkboxes.forEach(cb => {
          const val = (cb.getAttribute('data-value') || cb.getAttribute('aria-label') || cb.innerText || '').trim().toLowerCase();
          const shouldCheck = targetList.includes(val);
          const isCurrentlyChecked = cb.getAttribute('aria-checked') === 'true';

          if (shouldCheck && !isCurrentlyChecked) {
            cb.click();
            anyChecked = true;
          }
        });

        return anyChecked
          ? { filled: true }
          : { filled: false, reason: 'No matching checkbox options found for provided values.' };
      }

      case 'DROPDOWN': {
        const targetStr = String(answer || '').trim().toLowerCase();
        const listbox = container.querySelector('div[role="listbox"]');
        if (!listbox) return { filled: false, reason: 'Dropdown container not found' };

        // Safe dropdown selection: Click listbox to expose options, match text, click option
        listbox.click();
        setTimeout(() => {
          const options = document.querySelectorAll('div[role="option"]');
          for (const opt of options) {
            const optVal = (opt.innerText || opt.textContent || '').trim().toLowerCase();
            if (optVal === targetStr) {
              opt.click();
              break;
            }
          }
        }, 80);

        return { filled: true };
      }

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
