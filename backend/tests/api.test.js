'use strict';

/**
 * api.test.js — Integration-style tests for Express API routes.
 *
 * Tests use supertest to make real HTTP requests against the Express app.
 * External service calls (LLM, Schema Registry, SQL validation) are fully mocked.
 */

const request = require('supertest');
const app = require('../src/app');

// ─────────────────────────────────────────────────────────────────────────────
// Mock all external service dependencies
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../src/services/llmService', () => {
  const sessions = new Map();
  return {
    generateWithSelfCorrection: jest.fn(),
    sessions,
  };
});

jest.mock('../src/services/schemaRegistryService', () => ({
  getAllSchemas: jest.fn(),
}));

jest.mock('../src/services/sqlValidationService', () => ({
  validateAndClassify: jest.fn(),
  splitStatements: jest.fn(),
}));

jest.mock('../src/services/mockDataService', () => ({
  parseMockRows: jest.fn(),
  generateFallbackMockRows: jest.fn(),
}));

jest.mock('../src/services/flinkService', () => ({
  deployJob: jest.fn(),
  stopJob: jest.fn(),
  getJobStatus: jest.fn(),
  isGatewayHealthy: jest.fn(),
  extractOutputTopicFromSql: jest.fn(),
  flink_jobs: new Map(),
}));

jest.mock('../src/services/kafkaConsumerService', () => ({
  tailMessages: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked modules for configuration in each test
// ─────────────────────────────────────────────────────────────────────────────

const { generateWithSelfCorrection, sessions } = require('../src/services/llmService');
const { getAllSchemas } = require('../src/services/schemaRegistryService');
const { validateAndClassify } = require('../src/services/sqlValidationService');
const { parseMockRows, generateFallbackMockRows } = require('../src/services/mockDataService');
const flinkService = require('../src/services/flinkService');
const { tailMessages } = require('../src/services/kafkaConsumerService');

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_SCHEMAS = {
  'retail.orders': {
    name: 'Order',
    fields: [
      { name: 'order_id', type: 'long' },
      { name: 'user_id', type: 'int' },
      { name: 'status', type: 'string' },
    ],
  },
};

const MOCK_LLM_RESULT = {
  sql: 'SELECT order_id, status FROM retail.orders',
  outputSchema: [
    { field: 'order_id', type: 'BIGINT' },
    { field: 'status', type: 'STRING' },
  ],
  mockRows: [
    { order_id: 1001, status: 'completed' },
    { order_id: 1002, status: 'pending' },
  ],
  reasoning: 'Direct selection from retail.orders',
  rawResponse: '{"sql":"SELECT order_id, status FROM retail.orders","outputSchema":[{"field":"order_id","type":"BIGINT"}],"mockRows":[{"order_id":1001,"status":"completed"}],"reasoning":"Direct selection"}',
  validation: { status: 'green', attempts: 1 },
};

const SAMPLE_SQL = "CREATE TABLE derived_output (order_id BIGINT) WITH ('topic' = 'derived.orders'); INSERT INTO derived_output SELECT order_id FROM retail.orders";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/query
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/query', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessions.clear();
    getAllSchemas.mockResolvedValue(MOCK_SCHEMAS);
    generateWithSelfCorrection.mockResolvedValue(MOCK_LLM_RESULT);
    parseMockRows.mockReturnValue(MOCK_LLM_RESULT.mockRows);
    generateFallbackMockRows.mockReturnValue([]);
  });

  it('returns 400 when query is missing', async () => {
    const res = await request(app)
      .post('/api/query')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/query is required/i);
  });

  it('returns 400 when query is empty string', async () => {
    const res = await request(app)
      .post('/api/query')
      .send({ query: '   ' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/query is required/i);
  });

  it('returns 400 when query is not a string', async () => {
    const res = await request(app)
      .post('/api/query')
      .send({ query: 42 })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/query is required/i);
  });

  it('returns 200 with sql, mockRows, outputSchema, reasoning, validation for valid query', async () => {
    const res = await request(app)
      .post('/api/query')
      .send({ query: 'show me recent orders' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sql: MOCK_LLM_RESULT.sql,
      outputSchema: MOCK_LLM_RESULT.outputSchema,
      mockRows: MOCK_LLM_RESULT.mockRows,
      reasoning: MOCK_LLM_RESULT.reasoning,
      validation: MOCK_LLM_RESULT.validation,
    });
  });

  it('calls getAllSchemas and generateWithSelfCorrection with trimmed query', async () => {
    await request(app)
      .post('/api/query')
      .send({ query: '  show me orders  ' })
      .set('Content-Type', 'application/json');

    expect(getAllSchemas).toHaveBeenCalledTimes(1);
    expect(generateWithSelfCorrection).toHaveBeenCalledWith(
      'show me orders',
      MOCK_SCHEMAS
    );
  });

  it('stores session when sessionId is provided', async () => {
    const sessionId = 'test-session-123';

    await request(app)
      .post('/api/query')
      .send({ query: 'show me orders', sessionId })
      .set('Content-Type', 'application/json');

    expect(sessions.has(sessionId)).toBe(true);
    const stored = sessions.get(sessionId);
    expect(stored.messages[0]).toEqual({ role: 'user', content: 'show me orders' });
  });

  it('does not store session when sessionId is absent', async () => {
    await request(app)
      .post('/api/query')
      .send({ query: 'show me orders' })
      .set('Content-Type', 'application/json');

    expect(sessions.size).toBe(0);
  });

  it('uses fallback mock rows when parseMockRows returns empty array', async () => {
    const fallbackRows = [{ order_id: 9999, status: 'sample_0' }];
    parseMockRows.mockReturnValue([]);
    generateFallbackMockRows.mockReturnValue(fallbackRows);

    const res = await request(app)
      .post('/api/query')
      .send({ query: 'show me orders' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.mockRows).toEqual(fallbackRows);
    expect(generateFallbackMockRows).toHaveBeenCalledWith(MOCK_LLM_RESULT.outputSchema);
  });

  it('returns 500 when generateWithSelfCorrection throws', async () => {
    generateWithSelfCorrection.mockRejectedValue(new Error('LLM API error'));

    const res = await request(app)
      .post('/api/query')
      .send({ query: 'show me orders' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('LLM API error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/query/refine
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/query/refine', () => {
  const SESSION_ID = 'refine-session-456';

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.clear();
    getAllSchemas.mockResolvedValue(MOCK_SCHEMAS);
    generateWithSelfCorrection.mockResolvedValue(MOCK_LLM_RESULT);
    parseMockRows.mockReturnValue(MOCK_LLM_RESULT.mockRows);
    generateFallbackMockRows.mockReturnValue([]);
  });

  it('returns 400 when query is missing', async () => {
    const res = await request(app)
      .post('/api/query/refine')
      .send({ sessionId: SESSION_ID })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/query is required/i);
  });

  it('returns 400 when sessionId is missing', async () => {
    const res = await request(app)
      .post('/api/query/refine')
      .send({ query: 'make it weekly' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sessionId are required/i);
  });

  it('returns 404 when session is not found', async () => {
    const res = await request(app)
      .post('/api/query/refine')
      .send({ query: 'make it weekly', sessionId: 'nonexistent-session' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Session not found/i);
  });

  it('returns 200 with updated result when session exists', async () => {
    // Seed a session
    sessions.set(SESSION_ID, {
      messages: [
        { role: 'user', content: 'show me orders' },
        { role: 'assistant', content: MOCK_LLM_RESULT.rawResponse },
      ],
      lastAccess: Date.now(),
    });

    const res = await request(app)
      .post('/api/query/refine')
      .send({ query: 'make it weekly', sessionId: SESSION_ID })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sql: MOCK_LLM_RESULT.sql,
      validation: MOCK_LLM_RESULT.validation,
    });
  });

  it('updates session history after successful refinement', async () => {
    sessions.set(SESSION_ID, {
      messages: [
        { role: 'user', content: 'show me orders' },
        { role: 'assistant', content: MOCK_LLM_RESULT.rawResponse },
      ],
      lastAccess: Date.now(),
    });

    await request(app)
      .post('/api/query/refine')
      .send({ query: 'make it weekly', sessionId: SESSION_ID })
      .set('Content-Type', 'application/json');

    const updated = sessions.get(SESSION_ID);
    // Original 2 messages + 2 new (user + assistant)
    expect(updated.messages).toHaveLength(4);
    expect(updated.messages[2]).toEqual({ role: 'user', content: 'make it weekly' });
  });

  it('passes message history to generateWithSelfCorrection', async () => {
    const existingMessages = [
      { role: 'user', content: 'show me orders' },
      { role: 'assistant', content: MOCK_LLM_RESULT.rawResponse },
    ];
    sessions.set(SESSION_ID, { messages: existingMessages, lastAccess: Date.now() });

    await request(app)
      .post('/api/query/refine')
      .send({ query: 'make it weekly', sessionId: SESSION_ID })
      .set('Content-Type', 'application/json');

    expect(generateWithSelfCorrection).toHaveBeenCalledWith(
      'make it weekly',
      MOCK_SCHEMAS,
      existingMessages
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/schemas
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/schemas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns array of { topic, fields } for available schemas', async () => {
    getAllSchemas.mockResolvedValue(MOCK_SCHEMAS);

    const res = await request(app).get('/api/schemas');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      topic: 'retail.orders',
      fields: expect.arrayContaining([
        { name: 'order_id', type: 'LONG' },
        { name: 'status', type: 'STRING' },
      ]),
    });
  });

  it('filters out topics with null schemas', async () => {
    getAllSchemas.mockResolvedValue({
      'retail.orders': MOCK_SCHEMAS['retail.orders'],
      'retail.missing': null,
    });

    const res = await request(app).get('/api/schemas');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].topic).toBe('retail.orders');
  });

  it('normalises Avro union types (["null","string"] → STRING)', async () => {
    getAllSchemas.mockResolvedValue({
      'retail.returns': {
        name: 'Return',
        fields: [
          { name: 'reason', type: ['null', 'string'] },
        ],
      },
    });

    const res = await request(app).get('/api/schemas');

    expect(res.status).toBe(200);
    expect(res.body[0].fields[0]).toEqual({ name: 'reason', type: 'STRING' });
  });

  it('returns isDerived: true for topics starting with "derived."', async () => {
    getAllSchemas.mockResolvedValue({
      'derived.customer_return_rates': {
        name: 'CustomerReturnRates',
        fields: [{ name: 'product_id', type: 'string' }],
      },
    });

    const res = await request(app).get('/api/schemas');

    expect(res.status).toBe(200);
    expect(res.body[0].isDerived).toBe(true);
  });

  it('returns isDerived: false for non-derived topics', async () => {
    getAllSchemas.mockResolvedValue(MOCK_SCHEMAS);

    const res = await request(app).get('/api/schemas');

    expect(res.status).toBe(200);
    expect(res.body[0].isDerived).toBe(false);
  });

  it('returns 500 when getAllSchemas throws', async () => {
    getAllSchemas.mockRejectedValue(new Error('Schema Registry unreachable'));

    const res = await request(app).get('/api/schemas');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Schema Registry unreachable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/query/validate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/query/validate', () => {
  const VALID_SQL = 'SELECT order_id FROM retail.orders';
  const VALIDATION_RESULT = { status: 'green', syntaxErrors: [], catalogIssues: [] };

  beforeEach(() => {
    jest.clearAllMocks();
    getAllSchemas.mockResolvedValue(MOCK_SCHEMAS);
    validateAndClassify.mockReturnValue(VALIDATION_RESULT);
  });

  it('returns 400 when sql is missing', async () => {
    const res = await request(app)
      .post('/api/query/validate')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sql is required');
  });

  it('returns 400 when sql is not a string', async () => {
    const res = await request(app)
      .post('/api/query/validate')
      .send({ sql: null })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sql is required');
  });

  it('returns validation result for valid SQL', async () => {
    const res = await request(app)
      .post('/api/query/validate')
      .send({ sql: VALID_SQL })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(VALIDATION_RESULT);
  });

  it('calls validateAndClassify with sql and schemas', async () => {
    await request(app)
      .post('/api/query/validate')
      .send({ sql: VALID_SQL })
      .set('Content-Type', 'application/json');

    expect(getAllSchemas).toHaveBeenCalledTimes(1);
    expect(validateAndClassify).toHaveBeenCalledWith(VALID_SQL, MOCK_SCHEMAS);
  });

  it('returns red status for invalid SQL', async () => {
    const redResult = {
      status: 'red',
      syntaxErrors: [{ line: 1, col: 0, message: 'syntax error' }],
      catalogIssues: [],
    };
    validateAndClassify.mockReturnValue(redResult);

    const res = await request(app)
      .post('/api/query/validate')
      .send({ sql: 'NOT VALID SQL' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('red');
  });

  it('returns 500 when getAllSchemas throws', async () => {
    getAllSchemas.mockRejectedValue(new Error('SR connection failed'));

    const res = await request(app)
      .post('/api/query/validate')
      .send({ sql: VALID_SQL })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('SR connection failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/query/deploy
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/query/deploy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    flinkService.flink_jobs.clear();
    flinkService.extractOutputTopicFromSql.mockReturnValue('derived.customer_return_rates');
    flinkService.deployJob.mockResolvedValue({
      jobId: 'flink-job-abc123',
      operationHandle: 'op-handle-xyz',
      sessionHandle: 'session-handle-abc',
      outputTopic: 'derived.customer_return_rates',
    });
  });

  it('returns 400 when sql is missing', async () => {
    const res = await request(app)
      .post('/api/query/deploy')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sql is required');
  });

  it('returns 400 when sql is empty string', async () => {
    const res = await request(app)
      .post('/api/query/deploy')
      .send({ sql: '   ' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sql is required');
  });

  it('returns 400 when sql is not a string', async () => {
    const res = await request(app)
      .post('/api/query/deploy')
      .send({ sql: 42 })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('sql is required');
  });

  it('returns 200 with jobId, state: Submitting, and outputTopic immediately', async () => {
    const res = await request(app)
      .post('/api/query/deploy')
      .send({ sql: SAMPLE_SQL })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      state: 'Submitting',
      outputTopic: 'derived.customer_return_rates',
    });
    expect(res.body.jobId).toBeDefined();
    expect(typeof res.body.jobId).toBe('string');
  });

  it('calls extractOutputTopicFromSql with the provided sql', async () => {
    await request(app)
      .post('/api/query/deploy')
      .send({ sql: SAMPLE_SQL })
      .set('Content-Type', 'application/json');

    expect(flinkService.extractOutputTopicFromSql).toHaveBeenCalledWith(SAMPLE_SQL);
  });

  it('stores job in flink_jobs Map with outputTopic set', async () => {
    // deployJob resolves immediately in mocked context so state transitions to Running
    // synchronously. We verify the job is tracked and the outputTopic is correct.
    const res = await request(app)
      .post('/api/query/deploy')
      .send({ sql: SAMPLE_SQL })
      .set('Content-Type', 'application/json');

    const { jobId } = res.body;
    expect(flinkService.flink_jobs.has(jobId)).toBe(true);
    const job = flinkService.flink_jobs.get(jobId);
    expect(job.outputTopic).toBe('derived.customer_return_rates');
  });

  it('uses fallback outputTopic when extractOutputTopicFromSql returns null', async () => {
    flinkService.extractOutputTopicFromSql.mockReturnValue(null);

    const res = await request(app)
      .post('/api/query/deploy')
      .send({ sql: SAMPLE_SQL })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.outputTopic).toMatch(/^derived\.job-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jobs/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/jobs/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    flinkService.flink_jobs.clear();
  });

  it('returns 404 for unknown job IDs', async () => {
    const res = await request(app).get('/api/jobs/nonexistent-job-id');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 200 with job details for known job', async () => {
    flinkService.flink_jobs.set('test-job-1', {
      operationHandle: 'op-abc',
      sessionHandle: 'session-abc',
      state: 'Running',
      outputTopic: 'derived.test_topic',
      createdAt: Date.now() - 5000,
    });

    const res = await request(app).get('/api/jobs/test-job-1');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      jobId: 'test-job-1',
      state: 'Running',
      outputTopic: 'derived.test_topic',
      operationHandle: 'op-abc',
    });
    expect(typeof res.body.elapsed).toBe('number');
    expect(res.body.elapsed).toBeGreaterThan(0);
  });

  it('refreshes state from Flink JobManager when flinkJobId is present', async () => {
    flinkService.flink_jobs.set('test-job-2', {
      operationHandle: 'op-abc',
      sessionHandle: 'session-abc',
      flinkJobId: 'flink-abc123',
      state: 'Running',
      outputTopic: 'derived.test_topic',
      createdAt: Date.now() - 3000,
    });
    flinkService.getJobStatus.mockResolvedValue({ state: 'Failed', startTime: null });

    const res = await request(app).get('/api/jobs/test-job-2');

    expect(res.status).toBe(200);
    expect(flinkService.getJobStatus).toHaveBeenCalledWith('flink-abc123');
    expect(res.body.state).toBe('Failed');
  });

  it('keeps last known state when getJobStatus throws', async () => {
    flinkService.flink_jobs.set('test-job-3', {
      operationHandle: 'op-abc',
      sessionHandle: 'session-abc',
      flinkJobId: 'flink-xyz',
      state: 'Running',
      outputTopic: 'derived.test_topic',
      createdAt: Date.now() - 1000,
    });
    flinkService.getJobStatus.mockRejectedValue(new Error('JobManager unreachable'));

    const res = await request(app).get('/api/jobs/test-job-3');

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('Running'); // Last known state preserved
  });

  it('does not call getJobStatus for terminal states', async () => {
    flinkService.flink_jobs.set('stopped-job', {
      operationHandle: 'op-abc',
      sessionHandle: 'session-abc',
      flinkJobId: 'flink-stopped',
      state: 'Stopped',
      outputTopic: 'derived.test_topic',
      createdAt: Date.now() - 10000,
    });

    const res = await request(app).get('/api/jobs/stopped-job');

    expect(res.status).toBe(200);
    expect(flinkService.getJobStatus).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/jobs/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/jobs/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    flinkService.flink_jobs.clear();
    flinkService.stopJob.mockResolvedValue();
  });

  it('returns 404 for unknown job IDs', async () => {
    const res = await request(app).delete('/api/jobs/nonexistent-job');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 200 with state: Stopped for existing job', async () => {
    flinkService.flink_jobs.set('running-job', {
      operationHandle: 'op-abc',
      sessionHandle: 'session-abc',
      state: 'Running',
      outputTopic: 'derived.test_topic',
      createdAt: Date.now() - 2000,
    });

    const res = await request(app).delete('/api/jobs/running-job');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ jobId: 'running-job', state: 'Stopped' });
  });

  it('calls stopJob when job has operationHandle and sessionHandle', async () => {
    flinkService.flink_jobs.set('running-job-2', {
      operationHandle: 'op-def',
      sessionHandle: 'session-def',
      state: 'Running',
      outputTopic: 'derived.test_topic',
      createdAt: Date.now() - 2000,
    });

    await request(app).delete('/api/jobs/running-job-2');

    expect(flinkService.stopJob).toHaveBeenCalledWith('running-job-2');
  });

  it('marks job as Stopped in flink_jobs Map', async () => {
    flinkService.flink_jobs.set('running-job-3', {
      operationHandle: 'op-ghi',
      sessionHandle: 'session-ghi',
      state: 'Running',
      outputTopic: 'derived.test_topic',
      createdAt: Date.now() - 2000,
    });

    await request(app).delete('/api/jobs/running-job-3');

    const job = flinkService.flink_jobs.get('running-job-3');
    expect(job.state).toBe('Stopped');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/topics/:topic/messages
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/topics/:topic/messages', () => {
  const MOCK_MESSAGES_RESULT = {
    messages: [
      { offset: '0', value: '{"product_id":"p1","return_rate":0.05}', timestamp: '1713398400000' },
      { offset: '1', value: '{"product_id":"p2","return_rate":0.12}', timestamp: '1713398401000' },
    ],
    nextOffset: 2,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tailMessages.mockResolvedValue(MOCK_MESSAGES_RESULT);
  });

  it('returns 200 with messages and nextOffset', async () => {
    const res = await request(app).get('/api/topics/derived.customer_return_rates/messages');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ offset: '0' }),
      ]),
      nextOffset: 2,
    });
  });

  it('calls tailMessages with the topic name', async () => {
    await request(app).get('/api/topics/derived.customer_return_rates/messages');

    expect(tailMessages).toHaveBeenCalledWith(
      'derived.customer_return_rates',
      expect.any(Number),
      null // no since param → null
    );
  });

  it('passes limit query param to tailMessages', async () => {
    await request(app).get('/api/topics/derived.customer_return_rates/messages?limit=5');

    expect(tailMessages).toHaveBeenCalledWith(
      'derived.customer_return_rates',
      5,
      null // no since param → null
    );
  });

  it('passes since query param to tailMessages', async () => {
    await request(app).get('/api/topics/derived.customer_return_rates/messages?limit=5&since=10');

    expect(tailMessages).toHaveBeenCalledWith(
      'derived.customer_return_rates',
      5,
      '10'
    );
  });

  it('uses default limit of 10 when not specified', async () => {
    await request(app).get('/api/topics/derived.test_topic/messages');

    expect(tailMessages).toHaveBeenCalledWith(
      'derived.test_topic',
      10,
      null // no since param → null
    );
  });

  it('returns 500 when tailMessages throws', async () => {
    tailMessages.mockRejectedValue(new Error('Kafka connection error'));

    const res = await request(app).get('/api/topics/derived.test_topic/messages');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Kafka connection error');
  });
});
