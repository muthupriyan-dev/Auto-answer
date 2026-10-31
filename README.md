# Gemini AI Google Forms Assistant 🤖📝

A modern, privacy-first Chrome Extension and Express backend powered by Google Gemini AI that assists users with Google Forms questionnaires.

Designed with an ultra-minimal footprint: when browsing Google Forms, it displays **only a single discreet 10px colored status dot** in the corner. The assistant analyzes questions, generates context-aware answer suggestions with explanations and confidence warnings, and fills the form for you, either in one tap or after you review and approve each answer.

> [!IMPORTANT]
> **Safety Guarantee**: The extension **NEVER automatically submits a form**. You always review the filled form and click the Submit button yourself.

---

## 📑 Table of Contents

1. [Features & Design Philosophy](#-features--design-philosophy)
2. [Supported Question Types](#-supported-question-types)
3. [Repository Structure](#-repository-structure)
4. [Prerequisites](#-prerequisites)
5. [Local Development Setup](#-local-development-setup)
6. [Extension Installation Guide](#-extension-installation-guide)
7. [Production Deployment Guide](#-production-deployment-guide)
8. [Testing & Verification Plan](#-testing--verification-plan)
9. [Privacy & Security](#-privacy--security)
10. [Known Limitations](#-known-limitations)
11. [Troubleshooting & FAQ](#-troubleshooting--faq)
12. [License](#-license)

---

## ✨ Features & Design Philosophy

- **Single Status Dot UI**:
  - No large floating panels, sidebars, banners, or obstructive overlays.
  - Exactly 10px circular indicator in a discreet corner (bottom-right by default).
  - Four status colors:
    - ⚪ **Gray**: Idle / Ready.
    - 🔵 **Blue**: Scanning the form, querying Gemini AI or filling.
    - 🟢 **Green**: Suggestions ready for review or answers filled.
    - 🔴 **Red**: Warning or error (e.g. backend offline or no questions found).
- **Action Menu on Demand**: clicking the dot reveals a 5-item menu:
  1. 🔍 **Scan Form & Auto Fill**: one-tap flow. Scans the questions, asks Gemini, and fills every non-empty answer. It never submits the form.
  2. ✨ **Get Gemini Suggestions (manual)**: sends the questions to the backend and opens the review dialog.
  3. 📝 **Review Answers (optional)**: inspect explanations, edit answers, and approve selections.
  4. ✍️ **Fill Approved Answers (manual)**: fills only the answers you approved.
  5. ⚙️ **Settings**: points you to the toolbar popup (backend URL, API key, corner position, overwrite policy).
- **Two ways to work**:
  - **One-tap**: *Scan Form & Auto Fill* approves every non-empty answer and fills it straight away.
  - **Manual / human-in-the-loop**: suggestions are never approved by default. Each review card has an approval checkbox that starts unchecked, and *Fill Approved* stays disabled until you approve at least one answer. You can edit any answer and regenerate it with extra context (a regenerated answer needs re-approval).
- **Personal data is never invented**: questions asking for names, emails, phone numbers and similar details are flagged with a low-confidence warning and left empty, so nothing is filled for them.
- **Overwrite Protection**: will not overwrite fields that already contain an answer unless you enable it in the settings.

---

## 🎯 Supported Question Types

| Question Type | DOM Identification | Filling Mechanism |
| :--- | :--- | :--- |
| **Short Answer** | `input[type="text"]:not([role="combobox"])` | Direct input simulation with dispatched `input`, `change`, and `blur` events |
| **Paragraph** | `textarea` | Value assignment with standard event dispatch |
| **Multiple Choice** | `div[role="radiogroup"]`, `div[role="radio"]` | Exact match on option text, `data-value` or `aria-label`, followed by a click |
| **Checkboxes** | `div[role="checkbox"]` | Array matching against the options, toggled by clicks |
| **Dropdown** | `div[role="listbox"]`, `div[role="option"]` | Opens the listbox, waits for the options, then clicks the matching one |

See [Known Limitations](#-known-limitations) for question types that are not supported yet.

---

## 📁 Repository Structure

```
Auto-answer/
├── LICENSE                          # MIT Open Source License
├── README.md                        # Project documentation
├── MASTER_PROMPT.md                 # System prompt reference for LLMs
├── .gitignore                       # Root git ignore (node_modules, .env, logs)
│
├── extension/                       # Chrome Extension (Manifest V3)
│   ├── manifest.json                # Extension manifest configuration
│   ├── background.js                # Service worker: default settings + API proxy (adds the API key)
│   ├── content.js                   # DOM scanner, dot UI, review modal, and safe filling logic
│   ├── content.css                  # Isolated CSS styles for dot, menu, and modal
│   ├── popup.html                   # Extension toolbar settings popup
│   ├── popup.js                     # Settings management, backend health and API key check
│   ├── popup.css                    # Popup styling
│   ├── icons/                       # Extension icons (16, 32, 48, 128 px)
│   └── test/
│       └── mock_form.html           # Standalone verification test form
│
└── server/                          # Backend Service (Node.js & Express)
    ├── package.json                 # Backend dependencies and scripts
    ├── server.js                    # Express server: API key auth, rate limiting, CORS, Helmet
    ├── gemini.js                    # Google Gemini API integration & prompt engineering
    ├── generate_icons.js            # Utility script to generate PNG icons
    ├── .env.example                 # Example environment variables template
    ├── .gitignore                   # Backend git ignore
    └── tests/                       # Automated test suite
        ├── api.test.js              # REST endpoints, API key auth & validation tests
        ├── gemini_mock.test.js      # Gemini module sanitization tests
        └── dom_simulation.test.js   # Safety, approval rules, dot UI and accessibility checks
```

---

## 🔧 Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v8.0.0 or higher
- **Google Gemini API Key**: free tier or paid key from [Google AI Studio](https://aistudio.google.com/apikey)
- **Browser**: any Chromium-based browser with extension support (Chrome, Edge, Brave, Kiwi)

---

## 💻 Local Development Setup

### 1. Backend Setup

```bash
cd server
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Server Port
PORT=3000

# Google Gemini API Key from Google AI Studio
GEMINI_API_KEY=AIzaSy...your_actual_key_here

# Recommended model
GEMINI_MODEL=gemini-2.5-flash

# Shared secret the extension sends in the X-API-Key header.
# Use a long random string. Without it the API answers 503.
API_SECRET=change-me-to-a-long-random-string

# CORS: leave empty to allow only chrome-extension:// origins (recommended)
ALLOWED_ORIGINS=

# Rate limit: max requests per 15 minutes per IP
RATE_LIMIT_MAX=100
```

Optional variables:

- `TRUST_PROXY`: number of reverse-proxy hops in front of the app (default `1`, right for Render).
- `ALLOW_NO_AUTH=true`: disables the API key check. **Local testing only.**

> [!CAUTION]
> Never commit `.env` or expose your `GEMINI_API_KEY` / `API_SECRET` in git repositories or client-side code!

### 3. Run the Backend

```bash
# Production mode
npm start

# Development mode (auto restart)
npm run dev
```

Verify backend health:

```bash
curl http://localhost:3000/api/health
```

Expected output:
```json
{
  "status": "healthy",
  "service": "Gemini AI Google Forms Assistant Backend",
  "version": "1.1.0",
  "model": "gemini-2.5-flash",
  "apiKeyConfigured": true,
  "uptime": 12
}
```

Check that your API key is accepted:

```bash
curl -H "X-API-Key: <your API_SECRET>" http://localhost:3000/api/auth-check
```

### 4. Run Automated Tests

The tests use Node's native runner (`node:test`):

```bash
npm test
```

They validate:
- API endpoints (`GET /api/health`, `GET /api/auth-check`, `POST /api/suggest`, `POST /api/regenerate`, 404 handler)
- API key auth (401 for a missing or wrong key, 503 when `API_SECRET` is not configured)
- Gemini input sanitization and the 50-question batch limit
- Non-submission guarantee (`submitFormBtn.click()` and `form.submit()` checks)
- Approval rules (manual suggestions default to unapproved, regenerated answers need re-approval)
- Overwrite protection
- Status dot sizing (strictly 8-12px) and Escape key accessibility

---

## 🌐 Extension Installation Guide

### Desktop Chromium Browsers

Compatible with **Google Chrome**, **Microsoft Edge**, **Brave**, **Vivaldi**, and **Arc**:

1. Open the Extensions page (`chrome://extensions`, `edge://extensions` or `brave://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` directory of this repository.
4. Click the extension icon in the toolbar and:
   - check the **Backend Service URL**. It is prefilled with the author's deployed service (`https://auto-answer-ini7.onrender.com`). For local development change it to `http://localhost:3000`, or to your own deployment,
   - set the **API Key** to the same value as `API_SECRET` on that backend,
   - click **Test**: the status must show **Online**,
   - adjust the dot corner and overwrite policy if needed, then **Save Settings**.
5. Open any Google Form (or the local file `extension/test/mock_form.html`) and look for the tiny status dot in the corner.

### Android Mobile Browsers

> [!NOTE]
> Standard Google Chrome for Android does not support Chrome Extensions. Chromium-based mobile browsers with extension support do.

1. **Recommended browsers**: Kiwi Browser, Lemur Browser, Yandex Browser.
2. **Installation**:
   - Build a `.zip` of the `extension/` folder (or copy the folder to the device).
   - Open the browser, go to `chrome://extensions` and enable **Developer mode**.
   - Tap **+ (from .zip / .crx / dir)** and pick the folder or archive.
   - Open the extension popup, paste your API key and save.

---

## 🚀 Production Deployment Guide

### Deploying Backend to Render

You can deploy the backend on [Render](https://render.com), [Railway](https://railway.app) or [Fly.io](https://fly.io):

1. Push your repository to GitHub (make sure `.env` is ignored).
2. In the Render dashboard click **New +** → **Web Service** and connect the repository.
3. Set:
   - **Root Directory**: `server`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. Under **Environment Variables**, add:
   - `GEMINI_API_KEY`: your Gemini API key
   - `GEMINI_MODEL`: `gemini-2.5-flash`
   - `API_SECRET`: a long random string (**required**, otherwise the API answers 503)
   - `TRUST_PROXY`: `1`
   - `ALLOWED_ORIGINS`: leave empty (only the extension origin is allowed)
5. Click **Create Web Service** and note your public URL (for example `https://your-service.onrender.com`).

> [!NOTE]
> Render's free tier sleeps when idle. The first request after a pause can take about 50 seconds. The popup shows "Waking up server..." meanwhile.

### Configuring the Extension for Production

1. Click the extension icon in the toolbar.
2. The **Backend Service URL** is prefilled with `https://auto-answer-ini7.onrender.com`. If you deployed your own backend, replace it with your `https://` URL.
3. Paste the same `API_SECRET` into the **API Key** field. It is stored in this browser only (local storage, never synced).
4. Click **Test**: the status must show **Online**. "Wrong API key" means the key does not match the backend.
5. Click **Save Settings**. The browser may ask permission to reach the backend: allow it.

If you change `API_SECRET` on the backend, update the API Key in the popup on every device that uses the extension.

---

## 🧪 Testing & Verification Plan

| Test Case | Scenario / Step | Expected Result |
| :--- | :--- | :--- |
| **1. Page Detection** | Open a Google Form | Tiny gray dot appears in the chosen corner without shifting the page layout |
| **2. Short Answer** | Run Scan -> Get Suggestions | Concise answer; card shows SHORT_ANSWER badge |
| **3. Paragraph** | Question asking for an explanation | Multi-sentence answer, editable in the review dialog |
| **4. Multiple Choice** | Radio question with fixed options | Suggested answer matches one of the provided options exactly |
| **5. Checkbox Question** | Multi-select question | Array of options that exist on the form |
| **6. Dropdown Question** | Custom Google Forms listbox | Opens the listbox and selects the matching option |
| **7. Personal Data Detection** | Question asking for your name/email | Low confidence, warning shown, answer left empty and not filled |
| **8. Empty / Unsupported** | Open a non-form page or an empty form | Toast notification, red dot, no unhandled errors |
| **9. Backend Unavailable** | Stop the backend and request suggestions | Red dot, toast explains the connection error, no UI lockup |
| **10. User Answer Edit** | Edit an answer in the review dialog | The edited text is the one that gets filled |
| **11. Human Approval Rule** | Open the review dialog after *Get Gemini Suggestions* | Nothing approved by default; *Fill Approved* disabled until at least one box is checked |
| **12. One-Tap Flow** | Click *Scan Form & Auto Fill* | Non-empty answers are filled, empty ones skipped, form is NOT submitted |
| **13. Overwrite Protection** | Answer a question manually, then fill | Existing answer is kept while "Overwrite" is off |
| **14. Non-Submission Guarantee** | Fill answers by any method | The submit button is never clicked; a toast reminds you to submit manually |
| **15. API Key Check** | Enter a wrong API key and press Test | Popup shows "Wrong API key" |
| **16. Keyboard Accessibility** | `Tab` to the dot, `Enter`, then `Escape` | Menu opens on Enter and closes cleanly on Escape |

---

## 🔒 Privacy & Security

- **No Gemini key in the extension**: the extension holds zero Gemini credentials. The backend isolates `GEMINI_API_KEY`.
- **Authenticated backend**: `/api/suggest` and `/api/regenerate` require the `X-API-Key` header (constant-time comparison). If `API_SECRET` is not set they fail closed with 503.
- **API key stays out of web pages**: requests go from the content script to the extension's background service worker, which adds the key. Google Forms page scripts never see it.
- **Locked-down transport**: the backend URL must be `https://` (plain `http://` only for localhost), and the background worker accepts messages only from the extension's own content script on Google Forms pages.
- **Minimal permissions**: `storage`, access to `docs.google.com/forms/*` and localhost, plus an optional permission for your own `https://` backend that the browser asks for when you save the settings.
- **No unrelated data collection**: the content script only reads question titles, descriptions, and option labels. It never reads browsing history, cookies, or account sessions. The server log does not contain questions or answers.
- **Zero automated submissions**: form submission triggers are forbidden in the codebase (checked by the tests).
- **Backend hardening**: Helmet headers, CORS limited to extension origins by default, rate limiting (100 requests / 15 min per IP) and a 1 MB payload cap.
- **Prompt-injection resistance**: form text is treated as data for Gemini, and choice answers are validated against the real options on the form.

---

## ⚠️ Known Limitations

- Not supported yet: **grid** questions (multiple choice grid / checkbox grid), **date**, **time** and file upload questions. Date and time fields are skipped, and grid rows are not handled correctly.
- The free-text box of an **"Other:"** option is not filled.
- A single request is limited to **50 questions**; larger forms return an error.
- The scanner works on the questions currently on the page. On multi-page forms, run it again after you press Next.
- Gemini can be wrong. Always review the form before you submit it.

---

## ❓ Troubleshooting & FAQ

#### Why is the status dot red?
1. Open the extension popup and press **Test**.
2. Confirm the backend is running (`npm start` in `server/`) or awake (Render).
3. Make sure `GEMINI_API_KEY` and `API_SECRET` are set on the backend.
4. Check the browser console (`F12`) for network errors.

#### The popup says "Wrong API key" or "API key needed".
The API Key in the popup must equal `API_SECRET` on the backend. After changing the secret, save the new value in the popup.

#### The popup says "Server API_SECRET not set".
Add the `API_SECRET` environment variable on the backend and redeploy.

#### The first request is very slow on Render.
The free service sleeps when idle and needs up to about a minute to wake up. Try again after it is awake.

#### Can the extension fill answers on multi-page forms?
Yes. After you move to the next section, run **Scan Form & Auto Fill** again for the questions that are now visible.

#### Can I change the dot position if it covers a page element?
Yes. Choose **Bottom-Right**, **Bottom-Left**, **Top-Right** or **Top-Left** in the toolbar popup. The position updates instantly.

---

## 📄 License

This project is open-sourced under the [MIT License](LICENSE).
