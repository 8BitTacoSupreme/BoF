'use strict';

/**
 * api.js — Express router for bride-of-flinkenstein API.
 *
 * Endpoints:
 *   POST /api/query           — NLP query submission → SQL generation with self-correction
 *   POST /api/query/refine    — Conversational follow-up using session context
 *   POST /api/query/validate  — Re-validate manually edited SQL
 *   GET  /api/schemas         — Schema listing for frontend sidebar
 */

const express = require('express');
const { generateWithSelfCorrection, sessions } = require('../services/llmService');
const { getAllSchemas } = require('../services/schemaRegistryService');
const { validateAndClassify } = require('../services/sqlValidationService');
const { parseMockRows, generateFallbackMockRows } = require('../services/mockDataService');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/query — new NLP query submission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/query
 *
 * Body: { query: string, sessionId?: string }
 *
 * Returns: { sql, outputSchema, mockRows, reasoning, validation }
 */
router.post('/query', async (req, res) => {
  try {
    const { query, sessionId } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'query is required and must be a non-empty string' });
    }

    // 1. Fetch all schemas for LLM context
    const schemas = await getAllSchemas();

    // 2. Generate SQL with self-correction (up to 3 retries)
    const result = await generateWithSelfCorrection(query.trim(), schemas);

    // 3. Parse/validate mock rows; fallback if missing
    let mockRows = parseMockRows(result);
    if (mockRows.length === 0 && result.outputSchema) {
      mockRows = generateFallbackMockRows(result.outputSchema);
    }

    // 4. Store session for follow-ups (keyed by caller-supplied sessionId)
    if (sessionId) {
      sessions.set(sessionId, {
        messages: [
          { role: 'user', content: query.trim() },
          { role: 'assistant', content: result.rawResponse }
        ],
        lastAccess: Date.now()
      });
    }

    return res.json({
      sql: result.sql,
      outputSchema: result.outputSchema,
      mockRows,
      reasoning: result.reasoning,
      validation: result.validation
    });
  } catch (err) {
    console.error('POST /api/query error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/query/refine — conversational follow-up
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/query/refine
 *
 * Body: { query: string, sessionId: string }
 *
 * Returns: { sql, outputSchema, mockRows, reasoning, validation }
 */
router.post('/query/refine', async (req, res) => {
  try {
    const { query, sessionId } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'query is required and must be a non-empty string' });
    }

    if (!sessionId) {
      return res.status(400).json({ error: 'query and sessionId are required' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found. Start a new query.' });
    }

    const schemas = await getAllSchemas();
    const messageHistory = session.messages;

    const result = await generateWithSelfCorrection(query.trim(), schemas, messageHistory);

    let mockRows = parseMockRows(result);
    if (mockRows.length === 0 && result.outputSchema) {
      mockRows = generateFallbackMockRows(result.outputSchema);
    }

    // Update session history with new exchange
    session.messages.push(
      { role: 'user', content: query.trim() },
      { role: 'assistant', content: result.rawResponse }
    );
    session.lastAccess = Date.now();

    return res.json({
      sql: result.sql,
      outputSchema: result.outputSchema,
      mockRows,
      reasoning: result.reasoning,
      validation: result.validation
    });
  } catch (err) {
    console.error('POST /api/query/refine error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/query/validate — re-validate manually edited SQL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/query/validate
 *
 * Body: { sql: string }
 *
 * Returns: { status, syntaxErrors, catalogIssues, warnings? }
 */
router.post('/query/validate', async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'sql is required' });
    }

    const schemas = await getAllSchemas();
    const result = validateAndClassify(sql, schemas);

    return res.json(result);
  } catch (err) {
    console.error('POST /api/query/validate error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/schemas — schema listing for the frontend sidebar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/schemas
 *
 * Returns: Array<{ topic: string, fields: Array<{ name: string, type: string }> }>
 */
router.get('/schemas', async (req, res) => {
  try {
    const schemas = await getAllSchemas();

    const schemaList = Object.entries(schemas)
      .filter(([, schema]) => schema !== null)
      .map(([topic, schema]) => ({
        topic,
        fields: (schema.fields || []).map((f) => {
          // Normalise Avro union types e.g. ["null", "string"] → "STRING"
          let type;
          if (Array.isArray(f.type)) {
            // Union type: strip "null", take the first non-null primitive
            const nonNull = f.type.filter((t) => t !== 'null');
            type = nonNull.length > 0 ? String(nonNull[0]).toUpperCase() : 'UNKNOWN';
          } else if (f.type && typeof f.type === 'object') {
            // Complex Avro type object: use .type field if present
            type = (f.type.type || JSON.stringify(f.type)).toUpperCase();
          } else {
            type = String(f.type || 'UNKNOWN').toUpperCase();
          }

          return { name: f.name, type };
        })
      }));

    return res.json(schemaList);
  } catch (err) {
    console.error('GET /api/schemas error:', err);
    return res.status(500).json({ error: err.message || 'Could not fetch schemas' });
  }
});

module.exports = router;
