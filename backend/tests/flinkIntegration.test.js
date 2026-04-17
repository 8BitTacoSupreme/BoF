'use strict';

// Integration test: requires FLINK_GATEWAY_URL environment variable
// Run with: FLINK_GATEWAY_URL=http://localhost:8083 npx jest tests/flinkIntegration.test.js --testTimeout=60000
//
// When FLINK_GATEWAY_URL is not set, the entire describe block is skipped —
// zero failures in CI or when Docker is not running.

const axios = require('axios');

const FLINK_SQL_GATEWAY_URL = process.env.FLINK_GATEWAY_URL || 'http://localhost:8083';

// Guard: mirrors canonical.test.js describeIfApiKey pattern.
// All tests skip cleanly when FLINK_GATEWAY_URL is not set.
const describeIfFlinkGateway = process.env.FLINK_GATEWAY_URL
  ? describe
  : describe.skip;

describeIfFlinkGateway('Flink Integration (requires live SQL Gateway)', () => {
  jest.setTimeout(60000);

  let sessionHandle = null;

  // ── Health check ──────────────────────────────────────────────────────────

  test('SQL Gateway /v1/info returns product info', async () => {
    const res = await axios.get(`${FLINK_SQL_GATEWAY_URL}/v1/info`);
    expect(res.status).toBe(200);
    // Apache Flink SQL Gateway identifies itself as 'Apache Flink'
    expect(res.data.productName).toBe('Apache Flink');
  });

  // ── Session management ────────────────────────────────────────────────────

  test('can create a SQL Gateway session', async () => {
    const res = await axios.post(`${FLINK_SQL_GATEWAY_URL}/v1/sessions`, {
      sessionName: 'integration-test',
      properties: { 'execution.runtime-mode': 'streaming' },
    });
    expect(res.status).toBe(200);
    expect(res.data.sessionHandle).toBeDefined();
    sessionHandle = res.data.sessionHandle;
  });

  // ── DDL submission ────────────────────────────────────────────────────────

  test('can submit a CREATE TABLE statement', async () => {
    // This test depends on the session created above
    expect(sessionHandle).not.toBeNull();

    const ddl = `CREATE TABLE integration_test_source (
      id BIGINT,
      name STRING,
      event_time BIGINT,
      event_ts AS TO_TIMESTAMP_LTZ(event_time, 3),
      WATERMARK FOR event_ts AS event_ts - INTERVAL '5' SECOND
    ) WITH (
      'connector' = 'kafka',
      'topic' = 'retail.orders',
      'properties.bootstrap.servers' = 'broker:9092',
      'properties.group.id' = 'integration-test-reader',
      'scan.startup.mode' = 'earliest-offset',
      'value.format' = 'avro-confluent',
      'value.avro-confluent.url' = 'http://schema-registry:8081'
    )`;

    const res = await axios.post(
      `${FLINK_SQL_GATEWAY_URL}/v1/sessions/${sessionHandle}/statements`,
      { statement: ddl }
    );
    expect(res.status).toBe(200);
    expect(res.data.operationHandle).toBeDefined();
  }, 30000);

  // ── Full deployJob flow ───────────────────────────────────────────────────

  test('deployJob submits SQL and returns operationHandle + sessionHandle', async () => {
    const { deployJob } = require('../src/services/flinkService');

    // Use a print connector sink — writes to stdout, not Kafka.
    // This is the simplest possible streaming INSERT that Flink can run
    // without Kafka brokers or Schema Registry being fully configured.
    const sql = `
      CREATE TABLE print_sink (id BIGINT, name STRING)
      WITH ('connector' = 'print');
      INSERT INTO print_sink SELECT 1 AS id, 'integration-test' AS name FROM (VALUES (1));
    `;
    const result = await deployJob(sql);
    expect(result.operationHandle).toBeDefined();
    expect(result.sessionHandle).toBeDefined();
    // jobId may be null if JobManager is unreachable — that is acceptable for this test
    // outputTopic is null because print connector has no 'topic' WITH property
    expect(result.outputTopic).toBeNull();
  }, 30000);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  afterAll(async () => {
    if (sessionHandle) {
      await axios
        .delete(`${FLINK_SQL_GATEWAY_URL}/v1/sessions/${sessionHandle}`)
        .catch(() => {
          // Ignore cleanup errors — session may have already expired
        });
    }
  });
});
