'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('../prompts/systemPrompt');
const { validateAndClassify } = require('./sqlValidationService');

/**
 * llmService.js
 *
 * Claude-powered intelligence layer for the NL-to-Flink-SQL pipeline.
 *
 * Core responsibilities:
 * - callClaude: raw API call with model=claude-sonnet-4-6
 * - parseJsonResponse: extract JSON from Claude's response (handles markdown fences)
 * - generateFlinkSQL: main generation function (builds prompt, calls Claude, parses response)
 * - generateWithSelfCorrection: 3-retry loop feeding validation errors back to Claude
 * - buildCorrectionPrompt: formats validation errors for self-correction
 * - sessions: in-memory conversation history with TTL cleanup
 *
 * Security: ANTHROPIC_API_KEY comes from process.env only — never from client.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Session management — in-memory conversation history keyed by sessionId
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, {messages: Array, lastAccess: number}>} */
const sessions = new Map();

/** Session TTL: 1 hour in milliseconds */
const SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * cleanupSessions()
 * Removes sessions older than SESSION_TTL_MS. Call periodically to prevent memory leaks.
 */
function cleanupSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions.entries()) {
    if (session.lastAccess < cutoff) {
      sessions.delete(id);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core API integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * callClaude(systemPrompt, messages)
 *
 * Makes a raw call to the Claude API using claude-sonnet-4-6.
 * API key is sourced exclusively from process.env.ANTHROPIC_API_KEY.
 *
 * @param {string} systemPrompt - Full system prompt (schema context + rules + examples)
 * @param {Array<{role: string, content: string}>} messages - Conversation messages array
 * @returns {Promise<string>} Raw text response from Claude
 */
async function callClaude(systemPrompt, messages) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages,
  });

  return result.content[0].text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * parseJsonResponse(text)
 *
 * Extracts and parses the JSON object from Claude's response text.
 * Strategy:
 * 1. Try direct JSON.parse (Claude followed instructions and returned bare JSON)
 * 2. Try extracting from ```json ... ``` code fence
 * 3. Try extracting from ``` ... ``` code fence (no language tag)
 * 4. Throw descriptive error if all strategies fail
 *
 * @param {string} text - Raw text response from Claude
 * @returns {Object} Parsed JSON object with { sql, outputSchema, mockRows, reasoning }
 * @throws {Error} If JSON cannot be extracted
 */
function parseJsonResponse(text) {
  const trimmed = text.trim();

  // Strategy 1: direct parse (Claude returned bare JSON as instructed)
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    // Fall through to fence extraction
  }

  // Strategy 2: ```json ... ``` fence
  const jsonFenceMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonFenceMatch) {
    try {
      return JSON.parse(jsonFenceMatch[1].trim());
    } catch (e) {
      // Fall through to plain fence
    }
  }

  // Strategy 3: ``` ... ``` plain fence
  const plainFenceMatch = trimmed.match(/```\s*([\s\S]*?)\s*```/);
  if (plainFenceMatch) {
    try {
      return JSON.parse(plainFenceMatch[1].trim());
    } catch (e) {
      // Fall through to error
    }
  }

  // Strategy 4: look for the first { ... } JSON object in the text
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch (e) {
      // Fall through to error
    }
  }

  throw new Error(
    `Failed to parse JSON from Claude response. ` +
    `Response starts with: ${trimmed.substring(0, 200)}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateFlinkSQL(nlQuery, schemas, messageHistory = [])
 *
 * Main SQL generation function. Builds a system prompt with full schema context,
 * constructs the message array (supporting conversational follow-ups), calls Claude,
 * and parses the structured JSON response.
 *
 * @param {string} nlQuery - Natural language query from user
 * @param {Object} schemas - Map of { topicName: avroSchemaObject | null }
 * @param {Array} [messageHistory=[]] - Previous messages for conversational follow-ups
 * @returns {Promise<{sql, outputSchema, mockRows, reasoning, rawResponse}>}
 */
async function generateFlinkSQL(nlQuery, schemas, messageHistory = []) {
  const systemPrompt = buildSystemPrompt(schemas);

  // Build messages array: append current query to history (if any)
  const messages = [
    ...messageHistory,
    { role: 'user', content: nlQuery },
  ];

  const rawResponse = await callClaude(systemPrompt, messages);
  const parsed = parseJsonResponse(rawResponse);

  return {
    sql: parsed.sql || '',
    outputSchema: parsed.outputSchema || [],
    mockRows: parsed.mockRows || [],
    reasoning: parsed.reasoning || '',
    rawResponse,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-correction loop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildCorrectionPrompt(sql, errors)
 *
 * Formats validation errors into a correction message for Claude.
 * Both object errors (with .message) and plain string errors are supported.
 *
 * @param {string} sql - The SQL that failed validation
 * @param {Array<{message: string}|string>} errors - Validation error list
 * @returns {string} Formatted correction prompt
 */
function buildCorrectionPrompt(sql, errors) {
  const errorList = errors
    .map((e) => `- ${e.message !== undefined ? e.message : e}`)
    .join('\n');

  return (
    `The following Flink SQL has validation errors:\n\n` +
    `\`\`\`sql\n${sql}\n\`\`\`\n\n` +
    `Errors:\n${errorList}\n\n` +
    `Fix ALL errors and respond with the corrected JSON (same format as before).`
  );
}

/**
 * generateWithSelfCorrection(nlQuery, schemas, messageHistory = [], maxRetries = 3)
 *
 * The server-side 3-retry self-correction loop. Locked decision from CONTEXT.md.
 *
 * Flow:
 * (a) Generate initial SQL via generateFlinkSQL
 * (b) Validate with validateAndClassify from sqlValidationService
 * (c) If green or yellow: return immediately with attempt count
 * (d) If red: build correction message with errors, append to messages, retry
 * (e) After maxRetries: return best attempt with red status and error list
 *
 * @param {string} nlQuery - Natural language query
 * @param {Object} schemas - Map of { topicName: avroSchemaObject | null }
 * @param {Array} [messageHistory=[]] - Existing conversation history
 * @param {number} [maxRetries=3] - Maximum correction attempts
 * @returns {Promise<Object>} Result with validation status, attempts, and sql/outputSchema/mockRows
 */
async function generateWithSelfCorrection(nlQuery, schemas, messageHistory = [], maxRetries = 3) {
  // Start with the initial user query appended to any existing history
  let currentMessages = [
    ...messageHistory,
    { role: 'user', content: nlQuery },
  ];

  let lastResult = null;
  let lastErrors = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // On the first attempt use the full generateFlinkSQL flow but with currentMessages.
    // On subsequent attempts (corrections), we call Claude directly to avoid
    // re-appending the original query (the correction prompt is already in currentMessages).
    let result;

    if (attempt === 1) {
      // First attempt: use generateFlinkSQL which builds the system prompt and messages
      // We call it with empty history so it adds the nlQuery, then we'll track messages manually
      const systemPrompt = buildSystemPrompt(schemas);
      const rawResponse = await callClaude(systemPrompt, currentMessages);
      const parsed = parseJsonResponse(rawResponse);

      result = {
        sql: parsed.sql || '',
        outputSchema: parsed.outputSchema || [],
        mockRows: parsed.mockRows || [],
        reasoning: parsed.reasoning || '',
        rawResponse,
      };
    } else {
      // Subsequent attempts: currentMessages already contains the correction prompt
      const systemPrompt = buildSystemPrompt(schemas);
      const rawResponse = await callClaude(systemPrompt, currentMessages);
      const parsed = parseJsonResponse(rawResponse);

      result = {
        sql: parsed.sql || '',
        outputSchema: parsed.outputSchema || [],
        mockRows: parsed.mockRows || [],
        reasoning: parsed.reasoning || '',
        rawResponse,
      };
    }

    lastResult = result;

    // Validate the generated SQL
    const validation = validateAndClassify(result.sql, schemas);

    if (validation.status === 'green' || validation.status === 'yellow') {
      // Validation passed — return immediately
      return {
        ...result,
        validation: {
          status: validation.status,
          attempts: attempt,
          warnings: validation.warnings,
        },
      };
    }

    // Red: collect errors for correction prompt
    const allErrors = [
      ...(validation.syntaxErrors || []),
      ...(validation.catalogIssues || []).map((issue) => ({ message: issue })),
    ];
    lastErrors = allErrors;

    if (attempt < maxRetries) {
      // Build correction message and append to conversation for next attempt
      const correctionMsg = buildCorrectionPrompt(result.sql, allErrors);
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: result.rawResponse },
        { role: 'user', content: correctionMsg },
      ];
    }
  }

  // Exhausted all retries — return last attempt with red status
  return {
    ...lastResult,
    validation: {
      status: 'red',
      attempts: maxRetries,
      errors: lastErrors,
    },
  };
}

module.exports = {
  callClaude,
  parseJsonResponse,
  generateFlinkSQL,
  generateWithSelfCorrection,
  buildCorrectionPrompt,
  sessions,
  cleanupSessions,
};
