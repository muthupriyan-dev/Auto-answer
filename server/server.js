/**
 * server.js - Secure Express Backend for Gemini AI Google Forms Assistant
 * Provides authenticated Gemini API proxy, rate limiting, CORS management, and input validation.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { generateFormSuggestions, regenerateSingleSuggestion, getModelName } = require('./gemini');

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware: Helmet
app.use(helmet());

// CORS Configuration: Support Chrome Extensions and Localhost
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || '*';
const corsOptions = {
  origin: function (origin, callback) {
    // Allow non-browser tools (like curl, Postman) or same-origin requests
    if (!origin) return callback(null, true);

    // If wildcard allowed
    if (allowedOriginsEnv === '*') return callback(null, true);

    const originsList = allowedOriginsEnv.split(',').map(o => o.trim());

    // Check if origin is explicitly listed or is a chrome-extension://
    if (originsList.includes(origin) || origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }

    return callback(new Error('CORS policy: This origin is not authorized.'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith('your_actual_'));
  res.json({
    status: 'healthy',
    service: 'Gemini AI Google Forms Assistant Backend',
    version: '1.0.0',
    model: getModelName(),
    apiKeyConfigured: hasKey,
    uptime: Math.floor(process.uptime())
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'Gemini AI Google Forms Assistant API',
    status: 'online',
    healthCheck: '/api/health'
  });
});

// Primary Suggestion Endpoint
app.post('/api/suggest', async (req, res) => {
  try {
    const { questions, formTitle } = req.body;

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

    // Call Gemini API service
    const suggestions = await generateFormSuggestions(questions, formTitle);

    return res.json({
      success: true,
      formTitle: formTitle || 'Google Form',
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
app.post('/api/regenerate', async (req, res) => {
  try {
    const { question, customContext, formTitle } = req.body;

    if (!question || typeof question !== 'object' || !question.id) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: "question" object with "id" is required.'
      });
    }

    const suggestion = await regenerateSingleSuggestion(question, customContext, formTitle);

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
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err.message);
  res.status(500).json({
    success: false,
    error: 'An unexpected internal server error occurred.'
  });
});

// Start Server if called directly
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` Gemini AI Google Forms Backend Service Running `);
    console.log(` Port: ${PORT}`);
    console.log(` Model: ${getModelName()}`);
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
