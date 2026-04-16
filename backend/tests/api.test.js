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
}));

jest.mock('../src/services/mockDataService', () => ({
  parseMockRows: jest.fn(),
  generateFallbackMockRows: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import mocked modules for configuration in each test
// ─────────────────────────────────────────────────────────────────────────────

const { generateWithSelfCorrection, sessions } = require('../src/services/llmService');
const { getAllSchemas } = require('../src/services/schemaRegistryService');
const { validateAndClassify } = require('../src/services/sqlValidationService');
const { parseMockRows, generateFallbackMockRows } = require('../src/services/mockDataService');

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
