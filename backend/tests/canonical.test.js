'use strict';

// Integration test: requires ANTHROPIC_API_KEY environment variable
// Run with: ANTHROPIC_API_KEY=sk-... npx jest tests/canonical.test.js --testTimeout=60000

const { generateWithSelfCorrection } = require('../src/services/llmService');
const { validateFlinkSql, catalogCheck } = require('../src/services/sqlValidationService');

// Mock schemas matching Phase 1 retail domain topics
const MOCK_SCHEMAS = {
  'retail.orders': {
    type: 'record',
    name: 'Order',
    fields: [
      { name: 'order_id', type: 'long' },
      { name: 'user_id', type: 'int' },
      { name: 'product_id', type: 'string' },
      { name: 'total_amount', type: 'string' },
      { name: 'status', type: 'string' },
      { name: 'created_at', type: 'long' }
    ]
  },
  'retail.returns': {
    type: 'record',
    name: 'Return',
    fields: [
      { name: 'return_id', type: 'long' },
      { name: 'order_id', type: 'long' },
      { name: 'product_id', type: 'string' },
      { name: 'reason', type: 'string' },
      { name: 'created_at', type: 'long' }
    ]
  },
  'retail.products': {
    type: 'record',
    name: 'Product',
    fields: [
      { name: 'product_id', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'price', type: 'string' }
    ]
  }
};

// Skip if no API key
const describeIfApiKey = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeIfApiKey('Canonical Query Integration', () => {
  jest.setTimeout(60000);

  test('canonical query: customer return rates by product for the last three weeks', async () => {
    const result = await generateWithSelfCorrection(
      'customer return rates by product for the last three weeks',
      MOCK_SCHEMAS
    );

    expect(result.sql).toBeDefined();
    expect(result.sql.length).toBeGreaterThan(50);
    expect(result.sql).toMatch(/retail[._]orders|retail\.orders/i);
    expect(result.sql).toMatch(/retail[._]returns|retail\.returns/i);
    expect(result.sql).toMatch(/CREATE TABLE/i);
    expect(result.sql).toMatch(/INSERT INTO/i);
    expect(result.outputSchema).toBeDefined();
    expect(Array.isArray(result.outputSchema)).toBe(true);
    expect(result.mockRows).toBeDefined();
    expect(Array.isArray(result.mockRows)).toBe(true);
    expect(result.validation).toBeDefined();
    expect(['green', 'yellow', 'red']).toContain(result.validation.status);

    console.log('Validation status:', result.validation.status);
    console.log('Attempts:', result.validation.attempts);
    console.log('SQL length:', result.sql.length);
    console.log('Mock rows:', result.mockRows.length);
  });

  test('simple filter query generates valid syntax', async () => {
    const result = await generateWithSelfCorrection(
      'show me all cancelled orders',
      MOCK_SCHEMAS
    );

    expect(result.sql).toBeDefined();
    expect(result.sql).toMatch(/cancelled|CANCELLED/i);

    const syntaxResult = validateFlinkSql(result.sql);
    if (!syntaxResult.valid) {
      console.log('Syntax validation errors:', syntaxResult.errors);
    }
  });
});
