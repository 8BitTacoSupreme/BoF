'use strict';

const { parseMockRows, generateFallbackMockRows } = require('../src/services/mockDataService');

describe('parseMockRows', () => {
  it('extracts the mockRows array from a valid LLM response object', () => {
    const response = {
      sql: 'SELECT order_id FROM orders',
      outputSchema: [{ field: 'order_id', type: 'BIGINT' }],
      mockRows: [{ order_id: 1001 }, { order_id: 1002 }, { order_id: 1003 }],
      reasoning: 'Using retail.orders',
    };

    const result = parseMockRows(response);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ order_id: 1001 });
  });

  it('returns empty array when mockRows is missing from response', () => {
    const response = {
      sql: 'SELECT order_id FROM orders',
      outputSchema: [],
      reasoning: 'test',
    };

    const result = parseMockRows(response);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when mockRows is null', () => {
    const response = { mockRows: null };

    const result = parseMockRows(response);

    expect(result).toEqual([]);
  });

  it('returns empty array when mockRows is not an array', () => {
    const response = { mockRows: 'invalid' };

    const result = parseMockRows(response);

    expect(result).toEqual([]);
  });

  it('returns empty array when response itself is null or undefined', () => {
    expect(parseMockRows(null)).toEqual([]);
    expect(parseMockRows(undefined)).toEqual([]);
  });

  it('returns empty array when response is malformed (not an object)', () => {
    expect(parseMockRows('string')).toEqual([]);
    expect(parseMockRows(42)).toEqual([]);
  });

  it('returns the mockRows array as-is when it contains valid row objects', () => {
    const rows = [
      { product_id: 'P001', total_sales: 1234.56 },
      { product_id: 'P002', total_sales: 987.65 },
    ];
    const response = { mockRows: rows };

    const result = parseMockRows(response);

    expect(result).toEqual(rows);
  });
});

describe('generateFallbackMockRows', () => {
  it('generates 5 rows by default', () => {
    const schema = [
      { field: 'order_id', type: 'BIGINT' },
      { field: 'status', type: 'STRING' },
    ];

    const rows = generateFallbackMockRows(schema);

    expect(rows).toHaveLength(5);
  });

  it('generates the requested number of rows when count is specified', () => {
    const schema = [{ field: 'order_id', type: 'BIGINT' }];

    const rows = generateFallbackMockRows(schema, 3);

    expect(rows).toHaveLength(3);
  });

  it('uses placeholder values for STRING/VARCHAR fields', () => {
    const schema = [{ field: 'product_name', type: 'STRING' }];

    const rows = generateFallbackMockRows(schema, 2);

    expect(typeof rows[0].product_name).toBe('string');
    expect(rows[0].product_name).toContain('sample_');
    expect(rows[1].product_name).toContain('sample_');
  });

  it('uses placeholder values for VARCHAR fields same as STRING', () => {
    const schema = [{ field: 'status', type: 'VARCHAR' }];

    const rows = generateFallbackMockRows(schema, 2);

    expect(typeof rows[0].status).toBe('string');
    expect(rows[0].status).toContain('sample_');
  });

  it('uses numeric placeholder values for BIGINT fields', () => {
    const schema = [{ field: 'order_id', type: 'BIGINT' }];

    const rows = generateFallbackMockRows(schema, 3);

    expect(typeof rows[0].order_id).toBe('number');
    expect(rows[0].order_id).toBeGreaterThanOrEqual(1000);
  });

  it('uses numeric placeholder values for INT fields', () => {
    const schema = [{ field: 'user_id', type: 'INT' }];

    const rows = generateFallbackMockRows(schema, 2);

    expect(typeof rows[0].user_id).toBe('number');
  });

  it('uses decimal placeholder values for DECIMAL fields', () => {
    const schema = [{ field: 'total_sales', type: 'DECIMAL' }];

    const rows = generateFallbackMockRows(schema, 2);

    expect(typeof rows[0].total_sales).toBe('string');
    // Should be a decimal-formatted string like "99.99", "100.99"
    expect(rows[0].total_sales).toMatch(/^\d+\.\d{2}$/);
  });

  it('uses ISO timestamp for TIMESTAMP fields', () => {
    const schema = [{ field: 'window_start', type: 'TIMESTAMP' }];

    const rows = generateFallbackMockRows(schema, 2);

    expect(typeof rows[0].window_start).toBe('string');
    // ISO date string
    expect(rows[0].window_start).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('uses boolean values for BOOLEAN fields alternating by index', () => {
    const schema = [{ field: 'is_active', type: 'BOOLEAN' }];

    const rows = generateFallbackMockRows(schema, 4);

    expect(typeof rows[0].is_active).toBe('boolean');
    expect(rows[0].is_active).toBe(true);  // index 0: 0 % 2 === 0
    expect(rows[1].is_active).toBe(false); // index 1: 1 % 2 !== 0
    expect(rows[2].is_active).toBe(true);  // index 2: 2 % 2 === 0
  });

  it('handles empty schema array (returns rows with no fields)', () => {
    const rows = generateFallbackMockRows([], 3);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({});
  });

  it('generates rows with all schema fields present', () => {
    const schema = [
      { field: 'order_id', type: 'BIGINT' },
      { field: 'product_id', type: 'STRING' },
      { field: 'total_sales', type: 'DECIMAL' },
    ];

    const rows = generateFallbackMockRows(schema, 2);

    expect(rows[0]).toHaveProperty('order_id');
    expect(rows[0]).toHaveProperty('product_id');
    expect(rows[0]).toHaveProperty('total_sales');
  });

  it('each row has different index-based values (not all identical)', () => {
    const schema = [{ field: 'order_id', type: 'BIGINT' }];

    const rows = generateFallbackMockRows(schema, 3);

    // Values should differ because they use index
    expect(rows[0].order_id).not.toBe(rows[1].order_id);
    expect(rows[1].order_id).not.toBe(rows[2].order_id);
  });
});
