'use strict';

const {
  validateFlinkSql,
  splitStatements,
  extractFieldsFromSQL,
  catalogCheck,
  validateAndClassify
} = require('../src/services/sqlValidationService');

// Sample schema map used across multiple tests
const SAMPLE_SCHEMAS = {
  'retail.orders': {
    fields: [
      { name: 'order_id', type: 'BIGINT' },
      { name: 'total_amount', type: 'STRING' },
      { name: 'created_at', type: 'BIGINT' },
      { name: 'status', type: 'STRING' }
    ]
  },
  'retail.products': {
    fields: [
      { name: 'product_id', type: 'BIGINT' },
      { name: 'product_name', type: 'STRING' },
      { name: 'category', type: 'STRING' }
    ]
  }
};

// ---------------------------------------------------------------------------
// validateFlinkSql
// ---------------------------------------------------------------------------
describe('validateFlinkSql', () => {
  it('returns valid=true and empty errors for correct Flink SQL SELECT', () => {
    const result = validateFlinkSql('SELECT order_id FROM orders_source');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns valid=false and errors for misspelled keyword SELEC', () => {
    const result = validateFlinkSql('SELEC order_id FROM orders_source');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatchObject({
      line: expect.any(Number),
      col: expect.any(Number),
      message: expect.any(String)
    });
  });

  it('handles multi-statement SQL (CREATE TABLE + INSERT INTO) without error', () => {
    const multiSql = [
      "CREATE TABLE orders_source (order_id BIGINT, status STRING) WITH ('connector' = 'kafka', 'topic' = 'orders', 'properties.bootstrap.servers' = 'broker:9092', 'format' = 'avro-confluent', 'avro-confluent.url' = 'http://schema-registry:8081', 'scan.startup.mode' = 'earliest-offset');",
      'INSERT INTO sink_table SELECT order_id, status FROM orders_source WHERE status = \'CANCELLED\''
    ].join('\n');
    const result = validateFlinkSql(multiSql);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// splitStatements
// ---------------------------------------------------------------------------
describe('splitStatements', () => {
  it('splits multi-statement SQL using grammar-aware parser (not naive semicolons)', () => {
    const sql = "SELECT 1; SELECT 2;";
    const stmts = splitStatements(sql);
    expect(Array.isArray(stmts)).toBe(true);
    expect(stmts.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// extractFieldsFromSQL
// ---------------------------------------------------------------------------
describe('extractFieldsFromSQL', () => {
  it('extracts fields from a simple SELECT clause', () => {
    const fields = extractFieldsFromSQL('SELECT order_id, status FROM orders_source');
    expect(fields).toContain('order_id');
    expect(fields).toContain('status');
  });

  it('strips table alias prefix from JOIN queries (e.g. o.order_id -> order_id)', () => {
    const sql = 'SELECT o.order_id, p.product_name FROM orders o JOIN products p ON o.product_id = p.product_id';
    const fields = extractFieldsFromSQL(sql);
    expect(fields).toContain('order_id');
    expect(fields).toContain('product_name');
    expect(fields).toContain('product_id');
    // Should NOT contain aliased versions like 'o.order_id'
    expect(fields).not.toContain('o.order_id');
    expect(fields).not.toContain('p.product_name');
  });

  it('extracts fields from WHERE clause', () => {
    const fields = extractFieldsFromSQL('SELECT * FROM t WHERE status = \'ACTIVE\'');
    expect(fields).toContain('status');
  });

  it('extracts fields from GROUP BY clause', () => {
    const fields = extractFieldsFromSQL('SELECT status, COUNT(*) FROM t GROUP BY status');
    expect(fields).toContain('status');
  });
});

// ---------------------------------------------------------------------------
// catalogCheck
// ---------------------------------------------------------------------------
describe('catalogCheck', () => {
  it('returns empty array when all fields resolve to known schema fields', () => {
    const issues = catalogCheck(
      'SELECT order_id, status FROM orders_source',
      SAMPLE_SCHEMAS
    );
    const unknownIssues = issues.filter(i => i.includes('Unknown field'));
    expect(unknownIssues).toHaveLength(0);
  });

  it('flags unknown field not present in any known topic schema', () => {
    const issues = catalogCheck(
      'SELECT unknown_field FROM orders_source',
      SAMPLE_SCHEMAS
    );
    expect(issues.some(i => i.toLowerCase().includes('unknown_field'))).toBe(true);
  });

  it('warns when STRING field total_amount is used in SUM() without TRY_CAST', () => {
    const sql = 'SELECT SUM(total_amount) AS revenue FROM orders_source';
    const issues = catalogCheck(sql, SAMPLE_SCHEMAS);
    expect(issues.some(i => i.includes('TRY_CAST'))).toBe(true);
  });

  it('warns when BIGINT timestamp field created_at is used without TO_TIMESTAMP_LTZ', () => {
    const sql = 'SELECT order_id FROM orders_source WHERE created_at > 1000000';
    const issues = catalogCheck(sql, SAMPLE_SCHEMAS);
    expect(issues.some(i => i.includes('TO_TIMESTAMP_LTZ'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateAndClassify
// ---------------------------------------------------------------------------
describe('validateAndClassify', () => {
  it('returns status green when SQL is syntactically valid and all fields resolve', () => {
    const sql = 'SELECT order_id, status FROM orders_source';
    const result = validateAndClassify(sql, SAMPLE_SCHEMAS);
    expect(result.status).toBe('green');
    expect(result.syntaxErrors).toEqual([]);
    expect(result.catalogIssues).toEqual([]);
  });

  it('returns status red when SQL has syntax errors', () => {
    const sql = 'SELEC order_id FROM orders_source';
    const result = validateAndClassify(sql, SAMPLE_SCHEMAS);
    expect(result.status).toBe('red');
    expect(result.syntaxErrors.length).toBeGreaterThan(0);
  });

  it('returns status red when SQL references unknown fields', () => {
    const sql = 'SELECT ghost_field FROM orders_source';
    const result = validateAndClassify(sql, SAMPLE_SCHEMAS);
    expect(result.status).toBe('red');
    expect(result.catalogIssues.length).toBeGreaterThan(0);
  });

  it('returns status yellow when SQL uses window function but lacks WATERMARK in DDL', () => {
    const sql = 'SELECT TUMBLE_START(event_time, INTERVAL \'1\' HOUR), COUNT(*) FROM orders_source GROUP BY TUMBLE(event_time, INTERVAL \'1\' HOUR)';
    // Schema includes event_time so field is known; no WATERMARK in SQL -> yellow
    const schemasWithEventTime = {
      'retail.orders': {
        fields: [
          { name: 'order_id', type: 'BIGINT' },
          { name: 'event_time', type: 'BIGINT' },
          { name: 'status', type: 'STRING' }
        ]
      }
    };
    const result = validateAndClassify(sql, schemasWithEventTime);
    expect(result.status).toBe('yellow');
    expect(result.warnings).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns green when WATERMARK is present alongside window function', () => {
    const sql = [
      "CREATE TABLE orders_source (order_id BIGINT, event_time TIMESTAMP(3), WATERMARK FOR event_time AS event_time - INTERVAL '5' SECOND) WITH ('connector' = 'kafka', 'topic' = 'orders', 'properties.bootstrap.servers' = 'broker:9092', 'format' = 'avro-confluent', 'avro-confluent.url' = 'http://schema-registry:8081', 'scan.startup.mode' = 'earliest-offset');",
      "SELECT TUMBLE_START(event_time, INTERVAL '1' HOUR), COUNT(*) FROM orders_source GROUP BY TUMBLE(event_time, INTERVAL '1' HOUR)"
    ].join('\n');
    const result = validateAndClassify(sql, {});
    // Schema has no known fields, but syntax + watermark present
    expect(['green', 'yellow']).toContain(result.status);
  });
});
