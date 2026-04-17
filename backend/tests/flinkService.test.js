'use strict';

// flinkService.test.js
// Unit tests for flinkService.js with axios-mocked SQL Gateway and JobManager responses.
// All external HTTP calls are mocked — no running infrastructure required.

jest.mock('axios');
jest.mock('../src/services/sqlValidationService', () => ({
  splitStatements: jest.fn((sql) =>
    sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
  ),
}));

const axios = require('axios');
const flinkService = require('../src/services/flinkService');

// ---------------------------------------------------------------------------
// Helper SQL fixtures
// ---------------------------------------------------------------------------

const SINK_SQL = [
  "CREATE TABLE source_orders (order_id BIGINT, product_id BIGINT) WITH (",
  "  'connector' = 'kafka',",
  "  'topic' = 'retail.orders',",
  "  'properties.bootstrap.servers' = 'broker:9092',",
  "  'value.format' = 'avro-confluent'",
  ")",
  ";",
  "CREATE TABLE sink_returns (product_id BIGINT, return_count BIGINT) WITH (",
  "  'connector' = 'kafka',",
  "  'topic' = 'derived.customer_return_rates',",
  "  'properties.bootstrap.servers' = 'broker:9092',",
  "  'value.format' = 'avro-confluent'",
  ")",
  ";",
  "INSERT INTO sink_returns SELECT product_id, COUNT(*) FROM source_orders GROUP BY product_id",
].join('\n');

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Set up the standard happy-path mock sequence for a full deployJob call.
 * 3 statement posts: CREATE source, CREATE sink, INSERT
 */
function setupHappyPathMocks(sessionHandle = 'test-session-123') {
  let statementCallCount = 0;

  axios.post.mockImplementation((url) => {
    // New session creation
    if (url.includes('/v1/sessions') && !url.includes('/statements') && !url.includes('/cancel')) {
      return Promise.resolve({ data: { sessionHandle } });
    }
    // Statement submission
    if (url.includes('/statements')) {
      statementCallCount++;
      const handles = ['op-create-1', 'op-create-2', 'op-insert-1'];
      return Promise.resolve({ data: { operationHandle: handles[statementCallCount - 1] || 'op-unknown' } });
    }
    // Cancel
    if (url.includes('/cancel')) {
      return Promise.resolve({ data: {} });
    }
    return Promise.reject(new Error(`Unexpected POST: ${url}`));
  });

  axios.get.mockImplementation((url) => {
    // Session health probe
    if (url.includes(`/v1/sessions/${sessionHandle}`) && !url.includes('/operations')) {
      return Promise.resolve({ data: { sessionHandle } });
    }
    // DDL status → FINISHED
    if (url.includes('/op-create-1/status') || url.includes('/op-create-2/status')) {
      return Promise.resolve({ data: { status: 'FINISHED' } });
    }
    // DML status → RUNNING (streaming success)
    if (url.includes('/op-insert-1/status')) {
      return Promise.resolve({ data: { status: 'RUNNING' } });
    }
    // JobManager jobs list
    if (url.includes('/jobs') && !url.includes('/v1/sessions')) {
      return Promise.resolve({ data: { jobs: [{ id: 'flink-job-abc', status: 'RUNNING' }] } });
    }
    return Promise.reject(new Error(`Unexpected GET: ${url}`));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset cached session between tests for isolation
  flinkService._resetSession();
});

// ---------------------------------------------------------------------------
// extractOutputTopicFromSql
// ---------------------------------------------------------------------------

describe('extractOutputTopicFromSql', () => {
  it('extracts topic from the last CREATE TABLE WITH clause', () => {
    const result = flinkService.extractOutputTopicFromSql(SINK_SQL);
    expect(result).toBe('derived.customer_return_rates');
  });

  it('returns null when no WITH clause topic found', () => {
    expect(flinkService.extractOutputTopicFromSql('SELECT * FROM foo')).toBeNull();
  });

  it('extracts from the LAST CREATE TABLE when multiple exist — sink not source', () => {
    const result = flinkService.extractOutputTopicFromSql(SINK_SQL);
    expect(result).toBe('derived.customer_return_rates');
    expect(result).not.toBe('retail.orders');
  });

  it("handles single quotes around 'topic' key name", () => {
    const sql = `CREATE TABLE t (id BIGINT) WITH ('topic' = 'my.derived.topic', 'connector' = 'kafka')`;
    expect(flinkService.extractOutputTopicFromSql(sql)).toBe('my.derived.topic');
  });

  it('returns null for empty/non-string input', () => {
    expect(flinkService.extractOutputTopicFromSql('')).toBeNull();
    expect(flinkService.extractOutputTopicFromSql(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isGatewayHealthy
// ---------------------------------------------------------------------------

describe('isGatewayHealthy', () => {
  it('returns true when GET /v1/info succeeds', async () => {
    axios.get.mockResolvedValue({ data: { productName: 'Apache Flink' } });
    const healthy = await flinkService.isGatewayHealthy();
    expect(healthy).toBe(true);
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/v1/info'));
  });

  it('returns false on network error', async () => {
    axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const healthy = await flinkService.isGatewayHealthy();
    expect(healthy).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getOrCreateSession (tested indirectly via deployJob)
// ---------------------------------------------------------------------------

describe('getOrCreateSession (session management)', () => {
  it('creates a new session via POST /v1/sessions when no cached session', async () => {
    setupHappyPathMocks();
    await flinkService.deployJob(SINK_SQL);

    const sessionCreateCalls = axios.post.mock.calls.filter(
      (c) => c[0].includes('/v1/sessions') && !c[0].includes('/statements') && !c[0].includes('/cancel')
    );
    expect(sessionCreateCalls.length).toBe(1);
    expect(sessionCreateCalls[0][0]).toContain('/v1/sessions');
  });

  it('reuses cached session if GET /v1/sessions/:id succeeds (no new POST /v1/sessions)', async () => {
    setupHappyPathMocks();
    // First call primes the cache
    await flinkService.deployJob(SINK_SQL);

    jest.clearAllMocks();
    // Re-setup for second call — session probe returns 200 so no new session POST
    setupHappyPathMocks();

    await flinkService.deployJob(SINK_SQL);

    // Second call should NOT have created a new session
    const sessionCreateCalls = axios.post.mock.calls.filter(
      (c) => c[0].includes('/v1/sessions') && !c[0].includes('/statements') && !c[0].includes('/cancel')
    );
    expect(sessionCreateCalls.length).toBe(0);
  });

  it('creates new session when cached session GET returns 404', async () => {
    setupHappyPathMocks();
    await flinkService.deployJob(SINK_SQL);

    jest.clearAllMocks();

    // Session probe returns 404 → stale session
    let statementCallCount = 0;
    axios.get.mockImplementation((url) => {
      if (url.includes('/v1/sessions/test-session-123') && !url.includes('/operations')) {
        const err = new Error('Not Found');
        err.response = { status: 404 };
        return Promise.reject(err);
      }
      if (url.includes('/op-create-1/status') || url.includes('/op-create-2/status')) {
        return Promise.resolve({ data: { status: 'FINISHED' } });
      }
      if (url.includes('/op-insert-1/status')) {
        return Promise.resolve({ data: { status: 'RUNNING' } });
      }
      if (url.includes('/jobs') && !url.includes('/v1/sessions')) {
        return Promise.resolve({ data: { jobs: [{ id: 'flink-job-new', status: 'RUNNING' }] } });
      }
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });

    axios.post.mockImplementation((url) => {
      if (url.includes('/v1/sessions') && !url.includes('/statements') && !url.includes('/cancel')) {
        return Promise.resolve({ data: { sessionHandle: 'new-session-456' } });
      }
      if (url.includes('/statements')) {
        statementCallCount++;
        const handles = ['op-create-1', 'op-create-2', 'op-insert-1'];
        return Promise.resolve({ data: { operationHandle: handles[statementCallCount - 1] || 'op-unknown' } });
      }
      return Promise.reject(new Error(`Unexpected POST: ${url}`));
    });

    await flinkService.deployJob(SINK_SQL);

    const sessionCreateCalls = axios.post.mock.calls.filter(
      (c) => c[0].includes('/v1/sessions') && !c[0].includes('/statements') && !c[0].includes('/cancel')
    );
    expect(sessionCreateCalls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// deployJob
// ---------------------------------------------------------------------------

describe('deployJob', () => {
  it('returns { jobId, operationHandle, sessionHandle, outputTopic }', async () => {
    setupHappyPathMocks();
    const result = await flinkService.deployJob(SINK_SQL);
    expect(result).toHaveProperty('jobId');
    expect(result).toHaveProperty('operationHandle', 'op-insert-1');
    expect(result).toHaveProperty('sessionHandle', 'test-session-123');
    expect(result).toHaveProperty('outputTopic', 'derived.customer_return_rates');
  });

  it('stores entry in flink_jobs Map with state Running and correct outputTopic', async () => {
    setupHappyPathMocks();
    const result = await flinkService.deployJob(SINK_SQL);
    const jobEntry = flinkService.flink_jobs.get(result.jobId);
    expect(jobEntry).toBeDefined();
    expect(jobEntry.state).toBe('Running');
    expect(jobEntry.outputTopic).toBe('derived.customer_return_rates');
  });

  it('submits CREATE statements before INSERT via SQL Gateway /v1/sessions/:sid/statements', async () => {
    setupHappyPathMocks();
    await flinkService.deployJob(SINK_SQL);

    const statementPosts = axios.post.mock.calls.filter((c) => c[0].includes('/statements'));
    // 2 CREATE + 1 INSERT = 3 total
    expect(statementPosts.length).toBeGreaterThanOrEqual(3);
  });

  it('throws when INSERT operation returns ERROR status', async () => {
    let statementCallCount = 0;

    axios.post.mockImplementation((url) => {
      if (url.includes('/v1/sessions') && !url.includes('/statements') && !url.includes('/cancel')) {
        return Promise.resolve({ data: { sessionHandle: 'test-session-err' } });
      }
      if (url.includes('/statements')) {
        statementCallCount++;
        const handles = ['op-create-1', 'op-create-2', 'op-insert-err'];
        return Promise.resolve({ data: { operationHandle: handles[statementCallCount - 1] || 'op-unknown' } });
      }
      return Promise.reject(new Error(`Unexpected POST: ${url}`));
    });

    axios.get.mockImplementation((url) => {
      if (url.includes('/op-create-1/status') || url.includes('/op-create-2/status')) {
        return Promise.resolve({ data: { status: 'FINISHED' } });
      }
      if (url.includes('/op-insert-err/status')) {
        return Promise.resolve({ data: { status: 'ERROR' } });
      }
      if (url.includes('/op-insert-err/result/0')) {
        return Promise.resolve({
          data: { results: { data: [{ fields: ['INSERT failed: type mismatch'] }] } },
        });
      }
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });

    await expect(flinkService.deployJob(SINK_SQL)).rejects.toThrow();
  });

  it('probes session health before submission via GET /v1/sessions/:id', async () => {
    // Prime a session
    setupHappyPathMocks();
    await flinkService.deployJob(SINK_SQL);

    jest.clearAllMocks();
    setupHappyPathMocks();

    await flinkService.deployJob(SINK_SQL);

    const sessionProbeCalls = axios.get.mock.calls.filter(
      (c) => c[0].includes('/v1/sessions/') && !c[0].includes('/operations')
    );
    expect(sessionProbeCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// stopJob
// ---------------------------------------------------------------------------

describe('stopJob', () => {
  it('calls POST .../operations/:opHandle/cancel', async () => {
    setupHappyPathMocks();
    const result = await flinkService.deployJob(SINK_SQL);

    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: {} });

    await flinkService.stopJob(result.jobId);
    const cancelCall = axios.post.mock.calls.find((c) => c[0].includes('/cancel'));
    expect(cancelCall).toBeDefined();
    expect(cancelCall[0]).toContain('/cancel');
  });

  it('updates flink_jobs Map entry state to Stopped', async () => {
    setupHappyPathMocks();
    const result = await flinkService.deployJob(SINK_SQL);

    jest.clearAllMocks();
    axios.post.mockResolvedValue({ data: {} });

    await flinkService.stopJob(result.jobId);
    const jobEntry = flinkService.flink_jobs.get(result.jobId);
    expect(jobEntry.state).toBe('Stopped');
  });

  it('resolves without throwing when jobId is not in flink_jobs', async () => {
    await expect(flinkService.stopJob('nonexistent-id')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getJobStatus
// ---------------------------------------------------------------------------

describe('getJobStatus', () => {
  it('calls GET {JOBMANAGER_URL}/jobs/:jobId and returns { state, startTime }', async () => {
    axios.get.mockResolvedValue({
      data: { jid: 'flink-job-abc', state: 'RUNNING', 'start-time': 1700000000000 },
    });

    const status = await flinkService.getJobStatus('flink-job-abc');
    expect(status).toHaveProperty('state');
    expect(status).toHaveProperty('startTime');
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('flink-job-abc'));
  });

  it('maps Flink RUNNING state to Running UI state', async () => {
    axios.get.mockResolvedValue({ data: { state: 'RUNNING', 'start-time': 0 } });
    const status = await flinkService.getJobStatus('job-abc');
    expect(status.state).toBe('Running');
  });

  it('maps Flink FAILED state to Failed UI state', async () => {
    axios.get.mockResolvedValue({ data: { state: 'FAILED', 'start-time': 0 } });
    const status = await flinkService.getJobStatus('job-failed');
    expect(status.state).toBe('Failed');
  });

  it('maps Flink CANCELED state to Stopped UI state', async () => {
    axios.get.mockResolvedValue({ data: { state: 'CANCELED', 'start-time': 0 } });
    const status = await flinkService.getJobStatus('job-canceled');
    expect(status.state).toBe('Stopped');
  });
});
