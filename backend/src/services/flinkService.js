'use strict';

// flinkService.js
// SQL Gateway REST client with session management, DDL/DML submission, and job lifecycle tracking.
//
// Design decisions:
// - Single long-lived session cached at module scope (per D-303).
//   On each request, probe session with GET /v1/sessions/:id. If 404/error, create new session.
// - DDL (CREATE TABLE) submitted synchronously — poll until FINISHED (max 30s).
// - DML (INSERT INTO) submitted asynchronously — streaming jobs stay RUNNING permanently,
//   which is SUCCESS for streaming (not a failure). Do NOT poll INSERT until FINISHED.
//   Per RESEARCH.md Pitfall 1.
// - Running jobs tracked in in-memory flink_jobs Map (per D-304). State is lost on restart
//   — accepted Phase 3 MVP limitation per D-316.
// - Environment-aware URLs (matches schemaRegistryService.js pattern).

const axios = require('axios');
const { splitStatements } = require('./sqlValidationService');

// ── Environment configuration ──────────────────────────────────────────────

const isRunningInDocker = process.env.RUNNING_IN_DOCKER === 'true';

// SQL Gateway REST API — port 8083 (host) or internal container hostname
const SQL_GATEWAY_URL =
  process.env.FLINK_SQL_GATEWAY_URL ||
  (isRunningInDocker ? 'http://sql-gateway:8083' : 'http://localhost:8083');

// Flink JobManager REST API — host port 8082 maps to container port 8081
// (to avoid collision with Schema Registry on 8081 — per RESEARCH.md port note)
const JOBMANAGER_URL =
  process.env.FLINK_JOBMANAGER_URL ||
  (isRunningInDocker ? 'http://jobmanager:8081' : 'http://localhost:8082');

// ── Session management ─────────────────────────────────────────────────────

/** Cached SQL Gateway session handle at module scope */
let _sessionHandle = null;

/**
 * getOrCreateSession()
 *
 * Returns the current session handle, creating one if needed.
 * Probes the existing session with GET /v1/sessions/:id; re-creates on any error.
 *
 * @returns {Promise<string>} Active session handle
 */
async function getOrCreateSession() {
  if (_sessionHandle) {
    try {
      await axios.get(`${SQL_GATEWAY_URL}/v1/sessions/${_sessionHandle}`);
      return _sessionHandle;
    } catch (_) {
      // Session expired or unreachable — fall through to create a new one
      _sessionHandle = null;
    }
  }

  const resp = await axios.post(`${SQL_GATEWAY_URL}/v1/sessions`, {
    sessionName: 'bride-of-flinkenstein',
    properties: { 'execution.runtime-mode': 'streaming' },
  });
  _sessionHandle = resp.data.sessionHandle;
  return _sessionHandle;
}

// ── DDL submission helpers ─────────────────────────────────────────────────

/** Simple sleep utility */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * pollUntilFinished(session, opHandle, maxWaitMs)
 *
 * Polls GET /v1/sessions/:sid/operations/:opHandle/status every 1 second until:
 * - status === 'FINISHED' → resolves
 * - status === 'ERROR'    → rejects with error message from result/0
 * - timeout              → rejects
 *
 * Used ONLY for DDL (CREATE TABLE) statements.
 * Do NOT use for streaming INSERT statements — they stay RUNNING indefinitely.
 *
 * @param {string} session
 * @param {string} opHandle
 * @param {number} [maxWaitMs=30000]
 */
async function pollUntilFinished(session, opHandle, maxWaitMs = 30000) {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const statusResp = await axios.get(
      `${SQL_GATEWAY_URL}/v1/sessions/${session}/operations/${opHandle}/status`
    );
    const status = statusResp.data.status;

    if (status === 'FINISHED') {
      return;
    }

    if (status === 'ERROR') {
      let errorMsg = 'DDL operation failed';
      try {
        const errResp = await axios.get(
          `${SQL_GATEWAY_URL}/v1/sessions/${session}/operations/${opHandle}/result/0`
        );
        const errData = errResp.data?.results?.data?.[0]?.fields?.[0];
        if (errData) errorMsg = errData;
      } catch (_) {
        // Ignore fetch failure — use generic message
      }
      throw new Error(errorMsg);
    }

    await sleep(1000);
  }

  throw new Error(`DDL operation timed out after ${maxWaitMs / 1000}s (handle: ${opHandle})`);
}

// ── Output topic extraction ────────────────────────────────────────────────

/**
 * extractOutputTopicFromSql(sql)
 *
 * Finds all CREATE TABLE ... WITH (...) blocks in the SQL and extracts the
 * 'topic' = '...' value from the LAST one (which is the sink table).
 *
 * The last CREATE TABLE is chosen because LLM-generated SQL always puts
 * source tables first and the sink table last.
 *
 * @param {string} sql
 * @returns {string|null} The topic name, or null if not found
 */
function extractOutputTopicFromSql(sql) {
  if (!sql || typeof sql !== 'string') return null;

  // Match each CREATE TABLE ... WITH (...) block (non-greedy on WITH clause content)
  const withClauses = [
    ...sql.matchAll(/CREATE\s+TABLE[^(]*\([\s\S]*?\)\s*WITH\s*\(([^)]+)\)/gi),
  ];

  if (!withClauses.length) return null;

  // Take the last CREATE TABLE block (the sink)
  const lastWith = withClauses[withClauses.length - 1][1];
  const topicMatch = lastWith.match(/'topic'\s*=\s*'([^']+)'/i);
  return topicMatch ? topicMatch[1] : null;
}

// ── Job state mapping ──────────────────────────────────────────────────────

/**
 * Map Flink REST API job states to UI-friendly states.
 *
 * Flink states reference: https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/glossary/#execution-state
 */
const FLINK_STATE_MAP = {
  CREATED: 'Starting',
  RUNNING: 'Running',
  FAILING: 'Failed',
  FAILED: 'Failed',
  CANCELLING: 'Stopped',
  CANCELED: 'Stopped',
  FINISHED: 'Stopped',
  RESTARTING: 'Starting',
  RECONCILING: 'Starting',
  SUSPENDED: 'Starting',
};

function mapFlinkState(rawState) {
  return FLINK_STATE_MAP[(rawState || '').toUpperCase()] || rawState || 'Unknown';
}

// ── In-memory job tracking ─────────────────────────────────────────────────

/**
 * In-memory map of running Flink jobs.
 *
 * Key: jobId (Flink JobManager job ID or generated fallback)
 * Value: {
 *   operationHandle: string,  — SQL Gateway operation handle for stop/cancel
 *   sessionHandle: string,    — SQL Gateway session handle
 *   state: string,            — UI state: 'Submitting'|'Running'|'Failed'|'Stopped'
 *   outputTopic: string|null, — extracted from sink CREATE TABLE
 *   createdAt: number,        — Date.now()
 * }
 *
 * Per D-316: state is lost on backend restart (accepted MVP limitation).
 */
const flink_jobs = new Map();

// ── Core service functions ─────────────────────────────────────────────────

/**
 * deployJob(sql)
 *
 * Full deployment flow:
 * 1. getOrCreateSession()
 * 2. splitStatements(sql) → identify CREATEs and INSERT
 * 3. Submit each CREATE via POST /v1/sessions/:sid/statements, pollUntilFinished
 * 4. Submit INSERT via POST /v1/sessions/:sid/statements
 * 5. Wait 2s, check INSERT operation status once
 * 6. If RUNNING or FINISHED: get Flink jobId from JobManager /jobs endpoint
 * 7. If ERROR: throw with error message
 * 8. Store in flink_jobs Map with state 'Running'
 * 9. Return { jobId, operationHandle, sessionHandle, outputTopic }
 *
 * @param {string} sql - Multi-statement Flink SQL (CREATE + INSERT)
 * @returns {Promise<{jobId: string, operationHandle: string, sessionHandle: string, outputTopic: string|null}>}
 */
async function deployJob(sql) {
  const session = await getOrCreateSession();
  const statements = splitStatements(sql);

  const creates = statements.filter((s) => /^\s*CREATE/i.test(s));
  const inserts = statements.filter((s) => /^\s*INSERT/i.test(s));

  // Execute DDL synchronously — wait for FINISHED before proceeding
  for (const ddl of creates) {
    const opResp = await axios.post(`${SQL_GATEWAY_URL}/v1/sessions/${session}/statements`, {
      statement: ddl,
    });
    const opHandle = opResp.data.operationHandle;
    await pollUntilFinished(session, opHandle, 30000);
  }

  // Execute DML asynchronously — streaming INSERT stays RUNNING indefinitely (Pitfall 1)
  if (inserts.length === 0) {
    throw new Error('SQL must contain at least one INSERT statement');
  }

  const insertResp = await axios.post(`${SQL_GATEWAY_URL}/v1/sessions/${session}/statements`, {
    statement: inserts[0],
  });
  const insertOpHandle = insertResp.data.operationHandle;

  // Brief wait then single status check — do NOT loop (streaming jobs stay RUNNING forever)
  await sleep(2000);

  const statusResp = await axios.get(
    `${SQL_GATEWAY_URL}/v1/sessions/${session}/operations/${insertOpHandle}/status`
  );
  const insertStatus = statusResp.data.status;

  if (insertStatus === 'ERROR') {
    let errMsg = 'INSERT operation failed';
    try {
      const errResp = await axios.get(
        `${SQL_GATEWAY_URL}/v1/sessions/${session}/operations/${insertOpHandle}/result/0`
      );
      const errData = errResp.data?.results?.data?.[0]?.fields?.[0];
      if (errData) errMsg = errData;
    } catch (_) {
      // Ignore — use generic message
    }
    throw new Error(errMsg);
  }

  // RUNNING or FINISHED — both indicate successful streaming job submission
  // Get Flink jobId from the JobManager REST API
  let jobId = null;
  try {
    const jobsResp = await axios.get(`${JOBMANAGER_URL}/jobs`);
    const runningJobs = (jobsResp.data.jobs || []).filter(
      (j) => j.status === 'RUNNING' || j.state === 'RUNNING'
    );
    jobId = runningJobs[0]?.id || null;
  } catch (_) {
    // JobManager unreachable — generate a local tracking ID
  }

  // Fallback to a generated ID if JobManager lookup fails
  if (!jobId) {
    jobId = `local-${Date.now()}`;
  }

  const outputTopic = extractOutputTopicFromSql(sql);

  flink_jobs.set(jobId, {
    operationHandle: insertOpHandle,
    sessionHandle: session,
    state: 'Running',
    outputTopic,
    createdAt: Date.now(),
  });

  return { jobId, operationHandle: insertOpHandle, sessionHandle: session, outputTopic };
}

/**
 * stopJob(jobId)
 *
 * Cancels a running Flink statement via SQL Gateway and marks the job as Stopped.
 * The output topic is preserved — only the streaming job is halted.
 *
 * @param {string} jobId
 * @returns {Promise<void>}
 */
async function stopJob(jobId) {
  const job = flink_jobs.get(jobId);
  if (!job) {
    // Job not tracked — nothing to stop (idempotent)
    return;
  }

  try {
    await axios.post(
      `${SQL_GATEWAY_URL}/v1/sessions/${job.sessionHandle}/operations/${job.operationHandle}/cancel`
    );
  } catch (err) {
    // Cancel may fail if job already stopped — update state regardless
  }

  flink_jobs.set(jobId, { ...job, state: 'Stopped' });
}

/**
 * getJobStatus(jobId)
 *
 * Fetches current job state from Flink JobManager REST API.
 * Also updates the in-memory flink_jobs entry.
 *
 * @param {string} jobId - Flink JobManager job ID
 * @returns {Promise<{state: string, startTime: number|null}>}
 */
async function getJobStatus(jobId) {
  const resp = await axios.get(`${JOBMANAGER_URL}/jobs/${jobId}`);
  const rawState = resp.data.state;
  const startTime = resp.data['start-time'] || null;
  const state = mapFlinkState(rawState);

  // Keep in-memory map in sync
  const existing = flink_jobs.get(jobId);
  if (existing) {
    flink_jobs.set(jobId, { ...existing, state });
  }

  return { state, startTime };
}

/**
 * isGatewayHealthy()
 *
 * @returns {Promise<boolean>} true if SQL Gateway /v1/info responds, false on any error
 */
async function isGatewayHealthy() {
  try {
    await axios.get(`${SQL_GATEWAY_URL}/v1/info`);
    return true;
  } catch (_) {
    return false;
  }
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  deployJob,
  stopJob,
  getJobStatus,
  isGatewayHealthy,
  extractOutputTopicFromSql,
  flink_jobs,
  // Expose for testing / diagnostics
  _getSessionHandle: () => _sessionHandle,
  _resetSession: () => {
    _sessionHandle = null;
  },
};
