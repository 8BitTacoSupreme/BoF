'use strict';

/**
 * api.js — Express router for bride-of-flinkenstein API.
 *
 * Endpoints:
 *   POST /api/query           — NLP query submission → SQL generation with self-correction
 *   POST /api/query/refine    — Conversational follow-up using session context
 *   POST /api/query/validate  — Re-validate manually edited SQL
 *   POST /api/query/deploy    — Deploy Flink SQL job asynchronously; returns jobId immediately
 *   GET  /api/schemas         — Schema listing for frontend sidebar (includes isDerived flag)
 *   GET  /api/jobs/:id        — Poll Flink job status (refreshes from JobManager)
 *   DELETE /api/jobs/:id      — Stop a running Flink job
 *   GET  /api/topics/:topic/messages — Tail messages from a Kafka topic
 */

const express = require('express');
const { generateWithSelfCorrection, sessions } = require('../services/llmService');
const { getAllSchemas } = require('../services/schemaRegistryService');
const { validateAndClassify } = require('../services/sqlValidationService');
const { parseMockRows, generateFallbackMockRows } = require('../services/mockDataService');
const {
  deployJob,
  stopJob,
  getJobStatus,
  flink_jobs,
  extractOutputTopicFromSql,
} = require('../services/flinkService');
const { tailMessages } = require('../services/kafkaConsumerService');

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
// POST /api/query/deploy — deploy Flink SQL job asynchronously
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/query/deploy
 *
 * Body: { sql: string }
 *
 * Returns immediately: { jobId, state: 'Submitting', outputTopic }
 *
 * The job is deployed asynchronously. Poll GET /api/jobs/:id for status updates.
 * Deployment pattern per D-305, D-306, D-307: non-blocking fire-and-forget,
 * frontend polls for state transitions (Submitting → Running / Failed).
 */
router.post('/query/deploy', async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string' || sql.trim().length === 0) {
      return res.status(400).json({ error: 'sql is required' });
    }

    // Extract output topic from SQL before submitting (per D-307)
    const outputTopic = extractOutputTopicFromSql(sql) || `derived.job-${Date.now()}`;

    // Generate a job tracking ID and store initial Submitting state
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    flink_jobs.set(jobId, {
      operationHandle: null,
      sessionHandle: null,
      state: 'Submitting',
      outputTopic,
      createdAt: Date.now(),
    });

    // Return immediately so frontend can start polling (non-blocking pattern per RESEARCH.md)
    res.json({ jobId, state: 'Submitting', outputTopic });

    // Deploy asynchronously — update flink_jobs Map as states change
    deployJob(sql)
      .then(({ operationHandle, sessionHandle, jobId: flinkJobId }) => {
        const entry = flink_jobs.get(jobId);
        if (entry) {
          entry.operationHandle = operationHandle;
          entry.sessionHandle = sessionHandle;
          entry.flinkJobId = flinkJobId;
          entry.state = 'Running';
        }
      })
      .catch((err) => {
        const entry = flink_jobs.get(jobId);
        if (entry) {
          entry.state = 'Failed';
          entry.error = err.message;
        }
      });
  } catch (err) {
    console.error('POST /api/query/deploy error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jobs/:id — poll Flink job status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/jobs/:id
 *
 * Returns: { jobId, flinkJobId, state, outputTopic, operationHandle, error, elapsed }
 *
 * Refreshes state from Flink JobManager REST API if job has a flinkJobId and is
 * in a non-terminal state. Keeps last known state on JobManager unreachability.
 * Per D-314: frontend polls this endpoint while Deployment Status panel is open.
 */
router.get('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const job = flink_jobs.get(id);

    if (!job) {
      return res.status(404).json({ error: `Job '${id}' not found` });
    }

    // If job has a Flink jobId and is in a non-terminal state, refresh from JobManager
    if (job.flinkJobId && !['Failed', 'Stopped'].includes(job.state)) {
      try {
        const status = await getJobStatus(job.flinkJobId);
        job.state = status.state;
      } catch {
        // JobManager unreachable — keep last known state (per D-313 connectivity error handling)
      }
    }

    return res.json({
      jobId: id,
      flinkJobId: job.flinkJobId || null,
      state: job.state,
      outputTopic: job.outputTopic,
      operationHandle: job.operationHandle,
      error: job.error || null,
      elapsed: Date.now() - job.createdAt,
    });
  } catch (err) {
    console.error('GET /api/jobs/:id error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/jobs/:id — stop a running Flink job
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DELETE /api/jobs/:id
 *
 * Returns: { jobId, state: 'Stopped' }
 *
 * Cancels the Flink statement via SQL Gateway and marks the job Stopped.
 * Output topic is preserved — only the streaming job is halted (per D-308).
 */
router.delete('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const job = flink_jobs.get(id);

    if (!job) {
      return res.status(404).json({ error: `Job '${id}' not found` });
    }

    if (job.operationHandle && job.sessionHandle) {
      await stopJob(id);
    }
    job.state = 'Stopped';

    return res.json({ jobId: id, state: 'Stopped' });
  } catch (err) {
    console.error('DELETE /api/jobs/:id error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/topics/:topic/messages — tail live messages from a Kafka topic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/topics/:topic/messages
 *
 * Query params:
 *   limit  — max messages to return (default: 10)
 *   since  — start from this offset (pass null for beginning)
 *
 * Returns: { messages: [...], nextOffset }
 *
 * Per D-310: polling endpoint; no persistent connections. Frontend polls every 2s
 * while Deployment Status panel is open, passing the previous nextOffset as `since`.
 */
router.get('/topics/:topic/messages', async (req, res) => {
  try {
    const { topic } = req.params;
    const limit = parseInt(req.query.limit, 10) || 10;
    const since = req.query.since != null ? req.query.since : null;

    const result = await tailMessages(topic, limit, since);
    return res.json(result);
  } catch (err) {
    console.error('GET /api/topics/:topic/messages error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/schemas — schema listing for the frontend sidebar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/schemas
 *
 * Returns: Array<{ topic: string, isDerived: boolean, fields: Array<{ name: string, type: string }> }>
 *
 * isDerived: true for topics starting with 'derived.' — enables the Schema Sidebar
 * to show a "◆ derived" badge per D-309.
 */
router.get('/schemas', async (req, res) => {
  try {
    const schemas = await getAllSchemas();

    const schemaList = Object.entries(schemas)
      .filter(([, schema]) => schema !== null)
      .map(([topic, schema]) => ({
        topic,
        isDerived: topic.startsWith('derived.'),  // Per D-309 — derived topic badge
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
