# Gemini AI Google Forms Assistant 🤖📝

A modern, privacy-first Chrome Extension and Express backend powered by Google Gemini AI that assists users with Google Forms questionnaires.

Designed with an ultra-minimal footprint: when browsing Google Forms, it displays **only a single discreet 10px colored status dot** in the corner. The assistant analyzes questions, generates context-aware answer suggestions with explanations and confidence warnings, requires **explicit human verification and approval**, and safely fills only approved answers.

> [!IMPORTANT]
> **Safety Guarantee**: The extension **NEVER automatically submits a form**. The user retains complete control to review, edit, approve suggestions, and manually click the Submit button.

---

## 📑 Table of Contents

1. [Features & Design Philosophy](#-features--design-philosophy)
2. [Supported Question Types](#-supported-question-types)
3. [Repository Structure](#-repository-structure)
4. [Prerequisites](#-prerequisites)
5. [Local Development Setup](#-local-development-setup)
   - [1. Backend Setup](#1-backend-setup)
   - [2. Environment Configuration](#2-environment-configuration)
   - [3. Run the Backend](#3-run-the-backend)
   - [4. Run Automated Tests](#4-run-automated-tests)
6. [Extension Installation Guide](#-extension-installation-guide)
   - [Desktop Chromium Browsers](#desktop-chromium-browsers)
   - [Android Mobile Browsers](#android-mobile-browsers)
7. [Production Deployment Guide](#-production-deployment-guide)
   - [Deploying Backend to Render](#deploying-backend-to-render)
   - [Configuring Extension for Production](#configuring-extension-for-production)
8. [Comprehensive Testing & Verification Plan](#-comprehensive-testing--verification-plan)
9. [Privacy & Security Guarantees](#-privacy--security-guarantees)
10. [Troubleshooting & FAQ](#-troubleshooting--faq)
11. [License](#-license)

---

## ✨ Features & Design Philosophy

- **Mandatory Single Status Dot UI**:
  - No large floating panels, sidebars, banners, or obstructive overlays.
  - Exactly 10px circular indicator in a discreet corner (bottom-right by default).
  - Four distinct status color states:
    - ⚪ **Gray**: Idle / Ready.
    - 🔵 **Blue**: Scanning DOM or querying Gemini AI.
    - 🟢 **Green**: Suggestions ready for review or approved fields filled.
    - 🔴 **Red**: Warning or error (e.g. backend offline or no questions found).
- **Clean Action Menu on Demand**:
  - Clicking the dot reveals an accessible 5-step menu:
    1. 🔍 **Scan Form**: Detect questions and structure.
    2. ✨ **Get Gemini Suggestions**: Send questions securely to backend.
    3. 📝 **Review Suggested Answers**: Inspect explanations, edit answers, and approve selections.
    4. ✍️ **Fill Approved Answers**: Safely populate form inputs without auto-submitting.
    5. ⚙️ **Settings**: Configure backend URL, corner position, and overwrite policy.
- **Human-in-the-Loop Verification**:
  - Suggestions are **never** filled automatically.
  - Every question card features an explicit approval checkbox that defaults to unchecked (`false`).
  - Personal identification questions (names, emails, phone numbers) are automatically flagged with a low-confidence warning.
  - Users can edit any suggested answer directly before approving.
  - Single-question regeneration (`🔄 Regenerate`) allows refining suggestions on a per-question basis.
- **Overwrite Protection**:
  - Safe by default: will not overwrite fields that already contain user answers unless explicitly toggled in settings.

---

## 🎯 Supported Question Types

The DOM scanner and filler support all core Google Forms input paradigms:

| Question Type | DOM Identification | Filling Mechanism |
| :--- | :--- | :--- |
| **Short Answer** | `input[type="text"]:not([role="combobox"])` | Direct input simulation with dispatched `input`, `change`, and `blur` events |
| **Paragraph** | `textarea` | Value assignment with standard event dispatch |
| **Multiple Choice** | `div[role="radiogroup"]`, `div[role="radio"]` | Exact string matching on option text or `data-value` / `aria-label`, followed by click simulation |
| **Checkboxes** | `div[role="checkbox"]` | Array matching against options with toggle click simulation |
| **Dropdown** | `div[role="listbox"]`, `div[role="option"]` | Two-phase selection: activates listbox menu, matches item text, and simulates option click |

---

## 📁 Repository Structure

```
google-form/
├── LICENSE                          # MIT Open Source License
├── README.md                        # Complete project documentation
├── MASTER_PROMPT.md                 # System prompt reference for LLMs
├── .gitignore                       # Root git ignore (node_modules, .env, logs)
│
├── extension/                       # Chrome Extension (Manifest V3)
│   ├── manifest.json                # Extension manifest configuration
│   ├── background.js                # Service worker for default settings & lifecycle
│   ├── content.js                   # DOM scanner, dot UI, modal, and safe filling logic
│   ├── content.css                  # Isolated CSS styles for dot, menu, and modal
│   ├── popup.html                   # Extension toolbar settings popup
│   ├── popup.js                     # Settings management & backend health check
│   ├── popup.css                    # Popup styling
│   ├── icons/                       # Extension icons (16, 32, 48, 128 px)
│   └── test/
│       └── mock_form.html           # Standalone verification test form
│
└── server/                          # Backend Service (Node.js & Express)
    ├── package.json                 # Backend dependencies and scripts
    ├── server.js                    # Express server with rate-limiting, CORS, Helmet
    ├── gemini.js                    # Google Gemini API integration & prompt engineering
    ├── generate_icons.js            # Utility script to generate PNG icons
    ├── .env.example                 # Example environment variables template
    ├── .gitignore                   # Backend git ignore
    └── tests/                       # Automated test suite
        ├── api.test.js              # REST endpoint & validation unit tests
        ├── gemini_mock.test.js      # Gemini module sanitization tests
        └── dom_simulation.test.js   # DOM safety, dot UI, and approval rule tests
```

---

## 🔧 Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v8.0.0 or higher
- **Google Gemini API Key**: Free tier or paid key from [Google AI Studio](https://aistudio.google.com/apikey)
- **Browser**: Any Chromium-based browser (Chrome, Edge, Brave, Kiwi)

---

## 💻 Local Development Setup

### 1. Backend Setup

Navigate to the `server/` directory and install dependencies:

```bash
cd server
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` and provide your Gemini API key:

```env
# Server Port
PORT=3000

# Google Gemini API Key from Google AI Studio
GEMINI_API_KEY=AIzaSy...your_actual_key_here

# Recommended model
GEMINI_MODEL=gemini-2.5-flash

# CORS: Set to * for local development with unpacked extensions
ALLOWED_ORIGINS=*

# Rate limit: Max requests per 15 minutes per IP
RATE_LIMIT_MAX=100
```

> [!CAUTION]
> Never commit `.env` or expose your `GEMINI_API_KEY` in git repositories or client-side code!

### 3. Run the Backend

Start the server:

```bash
# Production mode
npm start

# Development mode (with nodemon if installed)
npm run dev
```

Verify backend health in your terminal or browser:

```bash
curl http://localhost:3000/api/health
```

Expected output:
```json
{
  "status": "healthy",
  "service": "Gemini AI Google Forms Assistant Backend",
  "version": "1.0.0",
  "model": "gemini-2.5-flash",
  "apiKeyConfigured": true,
  "uptime": 12
}
```

### 4. Run Automated Tests

The repository includes a comprehensive test suite using Node's native test runner (`node:test`):

```bash
npm test
```

This validates:
- API endpoints (`GET /api/health`, `POST /api/suggest`, `POST /api/regenerate`, 404 handler)
- Gemini input payload sanitization and question batch limits (50 max)
- Non-submission guarantee (`submitFormBtn.click()` and `form.submit()` checks)
- Human verification rule (approvals default to `false`)
- Overwrite protection enforcement
- Status dot sizing (strictly 8-12px)
- Escape key accessibility

---

## 🌐 Extension Installation Guide

### Desktop Chromium Browsers

Compatible with **Google Chrome**, **Microsoft Edge**, **Brave**, **Vivaldi**, and **Arc**:

1. Open your browser and navigate to the Extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
2. Enable **Developer mode** (toggle in top-right or sidebar).
3. Click **Load unpacked**.
4. Select the `extension/` directory from this repository.
5. Click the extension icon in the toolbar:
   - Check that the Backend Status displays **Online** (`http://localhost:3000`).
   - If needed, adjust the dot corner position (`bottom-right`, `bottom-left`, etc.).
6. Navigate to any Google Form (e.g., `https://docs.google.com/forms/d/e/.../viewform` or open [extension/test/mock_form.html](file:///data/data/com.termux/files/home/projects/google-form/extension/test/mock_form.html) in your browser).
7. Notice the tiny circular status dot in the corner!

### Android Mobile Browsers

> [!NOTE]
> Standard Google Chrome for Android does not support Chrome Extensions. However, Chromium-based mobile browsers with extension support work seamlessly:

1. **Recommended Browsers**:
   - **Kiwi Browser** (Play Store)
   - **Lemur Browser** (Play Store)
   - **Yandex Browser with Protect**
2. **Installation Steps**:
   - Transfer or clone this repository to your Android device or build a `.zip` of the `extension/` folder.
   - Open Kiwi/Lemur Browser and navigate to `chrome://extensions`.
   - Enable **Developer mode**.
   - Tap **+(from .zip / .crx / dir)** and pick the extension folder or archive.
   - Open your deployed backend URL in the extension popup settings (see next section).

---

## 🚀 Production Deployment Guide

### Deploying Backend to Render

You can deploy the backend for free or low cost on [Render](https://render.com), [Railway](https://railway.app), or [Fly.io]:

1. Push your repository to GitHub (ensure `.env` is ignored).
2. Log into [Render Dashboard](https://dashboard.render.com).
3. Click **New +** -> **Web Service**.
4. Connect your GitHub repository.
5. Set:
   - **Root Directory**: `server`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
6. Under **Environment Variables**, add:
   - `GEMINI_API_KEY`: `your_actual_gemini_api_key`
   - `GEMINI_MODEL`: `gemini-2.5-flash`
   - `ALLOWED_ORIGINS`: `*` (or your unpacked extension ID `chrome-extension://<id>`)
7. Click **Create Web Service**.
8. Note your public backend URL (e.g., `https://gemini-forms-api.onrender.com`).

### Configuring Extension for Production

1. Click the **Gemini Forms Assistant** icon in your browser toolbar.
2. In the **Backend Service URL** field, replace `http://localhost:3000` with your deployed URL (e.g., `https://gemini-forms-api.onrender.com`).
3. Click **Test** to verify connection. The status will update to **Online**.
4. Click **Save Settings**. The extension will now communicate securely with your production backend.

---

## 🧪 Comprehensive Testing & Verification Plan

Follow this manual checklist to verify all aspects of the application:

| Test Case | Scenario / Step | Expected Result | Verified |
| :--- | :--- | :--- | :---: |
| **1. Page Detection** | Open a Google Form | Tiny 10px gray dot appears in specified corner without shifting page layout | ✅ |
| **2. Short Answer** | Run Scan -> Get Suggestions | Suggests concise, accurate text answer; card displays SHORT_ANSWER badge | ✅ |
| **3. Paragraph** | Question asking for explanation | Generates multi-sentence response; editable inside textarea in review dialog | ✅ |
| **4. Multiple Choice** | Radio question with fixed options | Suggested answer strictly matches one of the provided options | ✅ |
| **5. Checkbox Question** | Multi-select question | Suggests array of valid options matching form DOM checkboxes | ✅ |
| **6. Dropdown Question** | Custom Google Forms listbox | Identifies options; safely simulates listbox open and option selection | ✅ |
| **7. Personal Data Detection** | Question asking for respondent's name/email | Confidence set to "low"; warning displayed; answer flagged for user input | ✅ |
| **8. Empty / Unsupported** | Open non-form page or empty form | Shows toast notification; sets dot to red without throwing unhandled errors | ✅ |
| **9. Backend Unavailable** | Stop backend server and click "Get Suggestions" | Dot turns red; toast explains connection error; no UI lockup | ✅ |
| **10. User Answer Edit** | Type customized text into review answer field | Edited text is retained and used when filling | ✅ |
| **11. Human Approval Rule** | Review suggested answers | "Fill Approved" button disabled until user checks at least one checkbox | ✅ |
| **12. Overwrite Protection** | Answer a question manually, then trigger fill | Existing answer is preserved when "Overwrite" is false in settings | ✅ |
| **13. Non-Submission Guarantee**| Fill approved answers | Fields populate; submit button is NEVER clicked; confirmation toast instructs manual submit | ✅ |
| **14. Keyboard Accessibility** | Press `Tab` to navigate to dot, press `Enter`, press `Escape` | Dot focuses, menu opens on Enter, menu/modal dismisses cleanly on Escape | ✅ |

---

## 🔒 Privacy & Security Guarantees

- **No Hardcoded Secrets**: The client-side extension contains **zero** API credentials. The backend securely isolates `GEMINI_API_KEY`.
- **Targeted Permissions**: Manifest V3 permissions are strictly limited to `storage`, `activeTab`, and `docs.google.com/forms/*`.
- **No Unrelated Data Collection**: The content script only reads question headers, descriptions, and option labels within question cards. It never reads browsing history, cookies, or account sessions.
- **Zero Automated Submissions**: Form submission triggers are forbidden in the codebase, preventing inadvertent or unwanted response dispatch.
- **Production Defense**: Backend implements Helmet headers, rate limiting (100 req/15 min), and 1MB payload caps.

---

## ❓ Troubleshooting & FAQ

#### Why is the status dot red?
1. Open the extension popup from your toolbar and test the backend connection.
2. Confirm your backend server is running (`npm start` in `server/`).
3. Ensure `GEMINI_API_KEY` is set in `server/.env`.
4. Inspect the browser Developer Tools Console (`F12`) for specific network error logs.

#### Can the extension fill answers on multi-page forms?
Yes. As you navigate through sections via Google Forms' "Next" button, clicking "Scan Form" from the status dot will index the newly visible page questions.

#### Can I change the dot position if it covers a page element?
Yes. Click the toolbar popup and choose from **Bottom-Right**, **Bottom-Left**, **Top-Right**, or **Top-Left**. The position updates instantly across tabs.

---

## 📄 License

This project is open-sourced under the [MIT License](LICENSE).
