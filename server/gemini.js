/**
 * gemini.js - Google Gemini API Integration Module
 * Handles model communication, structured prompt generation, JSON schema validation,
 * confidence analysis, and sensitive data detection.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Clean and validate model name
function getModelName() {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === '' || key.startsWith('your_actual_')) {
    throw new Error('GEMINI_API_KEY is not configured in the backend environment.');
  }
  return key.trim();
}

/**
 * System instruction defining the persona, accuracy standards, and warning triggers
 */
const SYSTEM_INSTRUCTION = `
You are an expert Google Forms Assistant and Survey Analyst.
Your task is to analyze questions extracted from a Google Form and provide accurate, context-aware answer suggestions with brief explanations.

MANDATORY RULES:
1. ACCURACY & HONESTY: Never fabricate certainty. If a question is ambiguous, subjective, or requires specific personal knowledge, explicitly flag it.
2. PERSONAL / PRIVATE DATA DETECTION:
   If a question asks for personal, identifiable, or subjective information (e.g., respondent's full name, personal email, phone number, home address, company badge ID, personal opinions, or autobiographical details):
   - Set "confidence" to "low"
   - Set "warning" to "Requires your personal or private information. Please review and provide your own details."
   - Set "suggestedAnswer" to "[Your personal details here]" or leave blank.
3. OPTION MATCHING:
   - For MULTIPLE_CHOICE or DROPDOWN questions: "suggestedAnswer" MUST strictly match one of the exact strings from the question's provided "options" array. Never invent an option that is not listed.
   - For CHECKBOX questions: "suggestedAnswer" MUST be an array of exact string matches from the provided "options" array.
4. EXPLANATION:
   - Provide a clear, concise (1-2 sentences) explanation of why the answer was selected or why personal context is needed.
5. OUTPUT FORMAT:
   - Return STRICT JSON conforming to the requested schema. No conversational preamble.
`;

/**
 * Strips markdown code blocks if the model wrapped the JSON in ```json ... ```
 */
function cleanJsonOutput(raw) {
  if (!raw) return '';
  let str = raw.trim();
  if (str.startsWith('```json')) {
    str = str.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  } else if (str.startsWith('```')) {
    str = str.replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  }
  return str.trim();
}

/**
 * Validates and sanitizes the questions array before sending to the model
 */
function sanitizeQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Invalid request: questions must be a non-empty array.');
  }

  if (questions.length > 50) {
    throw new Error('Batch size limit exceeded: maximum 50 questions per request.');
  }

  return questions.map((q, idx) => ({
    id: String(q.id || `q_${idx + 1}`).trim(),
    type: String(q.type || 'SHORT_ANSWER').toUpperCase().trim(),
    title: String(q.title || `Question ${idx + 1}`).trim().slice(0, 1000),
    description: String(q.description || '').trim().slice(0, 500),
    required: Boolean(q.required),
    options: Array.isArray(q.options)
      ? q.options.map(opt => String(opt).trim()).filter(Boolean).slice(0, 50)
      : []
  }));
}

/**
 * Generates answer suggestions and explanations for an array of Google Forms questions
 * @param {Array} questions - Sanitized question objects
 * @param {string} formTitle - Optional title/context of the form
 * @returns {Promise<Array>} Structured suggestions array
 */
async function generateFormSuggestions(questions, formTitle = '') {
  // Validate and sanitize input payload first
  const validatedQuestions = sanitizeQuestions(questions);

  const apiKey = getApiKey();
  const modelName = getModelName();

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2, // Low temperature for high precision and factual adherence
      topP: 0.8
    }
  });

  const promptPayload = {
    formTitle: formTitle || 'Google Form',
    questions: validatedQuestions.map(q => ({
      id: q.id,
      type: q.type,
      title: q.title,
      description: q.description,
      required: q.required,
      options: q.options
    }))
  };

  const userPrompt = `
Analyze the following Google Form questions and return a JSON array of suggestions.

Input Data:
${JSON.stringify(promptPayload, null, 2)}

Expected JSON Output Schema:
[
  {
    "questionId": "string (matching input id)",
    "questionText": "string (matching input title)",
    "suggestedAnswer": "string or array of strings for CHECKBOX",
    "explanation": "string (brief justification or context)",
    "confidence": "high" | "medium" | "low",
    "warning": "string or null (present if personal knowledge or uncertain)"
  }
]
`;

  try {
    const result = await model.generateContent(userPrompt);
    const response = await result.response;
    const rawText = response.text();

    const cleaned = cleanJsonOutput(rawText);
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      throw new Error(`Failed to parse AI response as JSON: ${parseErr.message}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error('AI output format error: expected an array of question suggestions.');
    }

    // Post-process and normalize each suggestion to guarantee schema integrity
    const questionMap = new Map(validatedQuestions.map(q => [q.id, q]));

    const normalizedResults = parsed.map((item, index) => {
      const qId = item.questionId || validatedQuestions[index]?.id || `q_${index + 1}`;
      const originalQ = questionMap.get(qId) || validatedQuestions[index] || {};

      let suggested = item.suggestedAnswer;
      if (originalQ.type === 'CHECKBOX') {
        if (!Array.isArray(suggested)) {
          suggested = suggested ? [String(suggested)] : [];
        }
      } else if (Array.isArray(suggested)) {
        suggested = suggested.join(', ');
      } else if (suggested !== undefined && suggested !== null) {
        suggested = String(suggested);
      } else {
        suggested = '';
      }

      // Confidence normalization
      let confidence = String(item.confidence || 'medium').toLowerCase();
      if (!['high', 'medium', 'low'].includes(confidence)) {
        confidence = 'medium';
      }

      return {
        questionId: qId,
        questionText: item.questionText || originalQ.title || `Question ${index + 1}`,
        questionType: originalQ.type || 'SHORT_ANSWER',
        suggestedAnswer: suggested,
        explanation: String(item.explanation || 'No explanation provided.').trim(),
        confidence,
        warning: item.warning ? String(item.warning).trim() : null
      };
    });

    return normalizedResults;
  } catch (err) {
    // Sanitize error messages to never leak API keys
    const safeMessage = err.message ? err.message.replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]') : 'Gemini API Error';

    if (safeMessage.includes('429') || safeMessage.includes('RESOURCE_EXHAUSTED')) {
      const quotaError = new Error('Gemini API quota exceeded or rate limit hit. Please try again shortly.');
      quotaError.status = 429;
      throw quotaError;
    }

    if (safeMessage.includes('404') || safeMessage.includes('models/')) {
      const modelError = new Error(`The requested Gemini model (${modelName}) was not found or is unavailable.`);
      modelError.status = 404;
      throw modelError;
    }

    if (safeMessage.includes('API_KEY_INVALID') || safeMessage.includes('403')) {
      const authError = new Error('Invalid Gemini API Key. Please verify your GEMINI_API_KEY environment variable.');
      authError.status = 403;
      throw authError;
    }

    const genericError = new Error(safeMessage);
    genericError.status = err.status || 500;
    throw genericError;
  }
}

/**
 * Regenerates an individual answer suggestion with optional custom user context
 */
async function regenerateSingleSuggestion(question, customContext = '', formTitle = '') {
  const apiKey = getApiKey();
  const modelName = getModelName();

  const [sanitized] = sanitizeQuestions([question]);
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3
    }
  });

  const prompt = `
Regenerate a suggestion for this specific question.
${customContext ? `User-provided extra context: "${customContext}"` : ''}

Question Details:
${JSON.stringify({ formTitle, question: sanitized }, null, 2)}

Return a single JSON object conforming to:
{
  "questionId": "${sanitized.id}",
  "questionText": "${sanitized.title}",
  "suggestedAnswer": "string or array of strings",
  "explanation": "string",
  "confidence": "high" | "medium" | "low",
  "warning": "string or null"
}
`;

  const result = await model.generateContent(prompt);
  const text = (await result.response).text();
  const cleaned = cleanJsonOutput(text);
  const item = JSON.parse(cleaned);

  let suggested = item.suggestedAnswer;
  if (sanitized.type === 'CHECKBOX') {
    if (!Array.isArray(suggested)) suggested = suggested ? [String(suggested)] : [];
  } else if (Array.isArray(suggested)) {
    suggested = suggested.join(', ');
  } else {
    suggested = String(suggested || '');
  }

  return {
    questionId: sanitized.id,
    questionText: sanitized.title,
    questionType: sanitized.type,
    suggestedAnswer: suggested,
    explanation: String(item.explanation || '').trim(),
    confidence: ['high', 'medium', 'low'].includes(String(item.confidence).toLowerCase()) ? item.confidence.toLowerCase() : 'medium',
    warning: item.warning ? String(item.warning).trim() : null
  };
}

module.exports = {
  generateFormSuggestions,
  regenerateSingleSuggestion,
  getModelName
};
