/**
 * server.js - Secure Express Backend for Gemini AI Google Forms Assistant
 * Provides authenticated Gemini API proxy, rate limiting, CORS management, and input validation.
 */

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { generateFormSuggestions, regenerateSingleSuggestion, getModelName } = require('./gemini');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '1.1.0';

// Render / Railway / Heroku sit behind a reverse proxy. Without this, every user
// shares the proxy's IP and the rate limiter blocks everybody at once.
// TRUST_PROXY = number of proxy hops in front of the app (default 1).
const trustProxyRaw = process.env.TRUST_PROXY;
const trustProxyHops =
  trustProxyRaw !== undefined && trustProxyRaw !== '' && Number.isInteger(Number(trustProxyRaw))
    ? Number(trustProxyRaw)
    : 1;
app.set('trust proxy', trustProxyHops);

// Security Middleware: Helmet
app.use(helmet());

// CORS Configuration
// - ALLOWED_ORIGINS unset/empty : only chrome-extension:// origins (plus non-browser tools) are allowed
// - ALLOWED_ORIGINS=a,b         : only the listed origins (list extension ids as chrome-extension://<id>)
// - ALLOWED_ORIGINS=*           : any origin (local testing only)
const originsList = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
const allowAllOrigins = originsList.includes('*');

const corsOptions = {
  origin: function (origin, callback) {
    // Non-browser tools (curl, Postman) and same-origin requests send no Origin header.
    // They are still protected by the API key below.
    if (!origin) return callback(null, true);
    if (allowAllOrigins) return callback(null, true);
    if (originsList.includes(origin)) return callback(null, true);
    if (originsList.length === 0 && origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }

    const err = new Error('CORS policy: This origin is not authorized.');
    err.isCorsError = true;
    return callback(err);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Requested-With'],
  credentials: false
};
app.use(cors(corsOptions));

// Body Parser with strict payload size limit
app.use(express.json({ limit: '1mb' }));

// Rate Limiting: Prevent abuse and quota depletion
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP. Please try again after 15 minutes.'
  }
});
app.use('/api/', limiter);

// Request Logger (Complies with privacy rule: does not log question/answer contents)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// --- API KEY AUTHENTICATION ---
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Requires the shared secret in the X-API-Key header.
 * Fails CLOSED: if API_SECRET is not configured the protected routes return 503,
 * unless ALLOW_NO_AUTH=true is set explicitly (local testing only).
 */
function requireApiKey(req, res, next) {
  const secret = (process.env.API_SECRET || '').trim();

  if (!secret) {
    if (process.env.ALLOW_NO_AUTH === 'true') return next();
    return res.status(503).json({
      success: false,
      error: 'Server authentication is not configured. Set API_SECRET on the backend.'
    });
  }

  const provided = req.get('X-API-Key') || '';
  if (!provided || !safeEqual(provided, secret)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: missing or invalid API key.'
    });
  }

  return next();
}

// Health check endpoint (public, no secrets exposed)
app.get('/api/health', (req, res) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith('your_actual_'));
  res.json({
    status: 'healthy',
    service: 'Gemini AI Google Forms Assistant Backend',
    version: VERSION,
    model: getModelName(),
    apiKeyConfigured: hasKey,
    uptime: Math.floor(process.uptime())
  });
});

// Lets the extension popup verify that its API key is accepted
app.get('/api/auth-check', requireApiKey, (req, res) => {
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.json({
    name: 'Gemini AI Google Forms Assistant API',
    status: 'online',
    healthCheck: '/api/health'
  });
});

// Primary Suggestion Endpoint
app.post('/api/suggest', requireApiKey, async (req, res) => {
  try {
    const { questions, formTitle } = req.body || {};

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: "questions" must be an array.'
      });
    }

    if (questions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'The questions array cannot be empty.'
      });
    }

    const safeTitle = typeof formTitle === 'string' ? formTitle.trim().slice(0, 200) : '';

    // Call Gemini API service
    const suggestions = await generateFormSuggestions(questions, safeTitle);

    return res.json({
      success: true,
      formTitle: safeTitle || 'Google Form',
      count: suggestions.length,
      suggestions
    });
  } catch (err) {
    const status = err.status || 500;
    // Log safe error without secret
    console.error(`[Error] /api/suggest failed (${status}):`, err.message);

    return res.status(status).json({
      success: false,
      error: err.message || 'Internal server error while processing form suggestions.'
    });
  }
});

// Single Question Regeneration Endpoint
app.post('/api/regenerate', requireApiKey, async (req, res) => {
  try {
    const { question, customContext, formTitle } = req.body || {};

    if (!question || typeof question !== 'object' || !question.id) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: "question" object with "id" is required.'
      });
    }

    const safeTitle = typeof formTitle === 'string' ? formTitle.trim().slice(0, 200) : '';
    const safeContext = typeof customContext === 'string' ? customContext.trim().slice(0, 1000) : '';

    const suggestion = await regenerateSingleSuggestion(question, safeContext, safeTitle);

    return res.json({
      success: true,
      suggestion
    });
  } catch (err) {
    const status = err.status || 500;
    console.error(`[Error] /api/regenerate failed (${status}):`, err.message);

    return res.status(status).json({
      success: false,
      error: err.message || 'Internal server error while regenerating answer.'
    });
  }
});

// Global 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found.`
  });
});

// Global Error Handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Request payload too large.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON in request body.' });
  }
  if (err && err.isCorsError) {
    return res.status(403).json({ success: false, error: err.message });
  }

  console.error('[Unhandled Error]', err && err.message);
  return res.status(500).json({
    success: false,
    error: 'An unexpected internal server error occurred.'
  });
});

// Start Server if called directly
if (require.main === module) {
  const hasSecret = Boolean((process.env.API_SECRET || '').trim());
  if (!hasSecret && process.env.ALLOW_NO_AUTH !== 'true') {
    console.warn('[WARNING] API_SECRET is not set: /api/suggest and /api/regenerate will answer 503 until you set it.');
  }
  if (!hasSecret && process.env.ALLOW_NO_AUTH === 'true') {
    console.warn('[WARNING] ALLOW_NO_AUTH=true: the API is OPEN. Use only for local testing.');
  }

  const server = app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` Gemini AI Google Forms Backend Service Running `);
    console.log(` Port: ${PORT}`);
    console.log(` Model: ${getModelName()}`);
    console.log(` Auth: ${hasSecret ? 'API key required' : 'NOT CONFIGURED'}`);
    console.log(` Health: http://localhost:${PORT}/api/health`);
    console.log(`=================================================`);
  });

  const handleShutdown = () => {
    console.log('\nGracefully shutting down backend server...');
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

module.exports = app;
