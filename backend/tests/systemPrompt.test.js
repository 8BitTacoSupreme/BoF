'use strict';

const { buildSystemPrompt, buildSchemaBlock } = require('../src/prompts/systemPrompt');
const { FEW_SHOT_EXAMPLES, FLINK_SQL_RULES } = require('../src/prompts/fewShotExamples');

// Sample Avro schemas for testing
const sampleSchemas = {
  'retail.orders': {
    type: 'record',
    name: 'Order',
    fields: [
      { name: 'order_id', type: 'long' },
      { name: 'user_id', type: 'int' },
      { name: 'total_amount', type: 'string' },
      { name: 'status', type: 'string' },
      { name: 'created_at', type: 'long' },
    ],
  },
  'retail.returns': {
    type: 'record',
    name: 'Return',
    fields: [
      { name: 'return_id', type: 'long' },
      { name: 'order_id', type: 'long' },
      { name: 'reason', type: ['null', 'string'] },
      { name: 'returned_at', type: 'long' },
    ],
  },
};

describe('buildSchemaBlock', () => {
  it('produces a markdown table with correct fields from a simple Avro schema', () => {
    const result = buildSchemaBlock({
      'retail.orders': sampleSchemas['retail.orders'],
    });

    expect(result).toContain('### retail.orders');
    expect(result).toContain('| Field | Avro Type | Nullable |');
    expect(result).toContain('| order_id |');
    expect(result).toContain('| total_amount |');
    expect(result).toContain('| status |');
    expect(result).toContain('| created_at |');
  });

  it('skips null schemas (topics without registered schemas)', () => {
    const schemas = {
      'retail.orders': sampleSchemas['retail.orders'],
      'internal.topic': null,
    };

    const result = buildSchemaBlock(schemas);

    expect(result).toContain('### retail.orders');
    expect(result).not.toContain('### internal.topic');
  });

  it('skips schemas with no fields property', () => {
    const schemas = {
      'retail.orders': sampleSchemas['retail.orders'],
      'empty.topic': { type: 'record', name: 'Empty' }, // no fields
    };

    const result = buildSchemaBlock(schemas);

    expect(result).toContain('### retail.orders');
    expect(result).not.toContain('### empty.topic');
  });

  it('handles Avro union types — ["null", "string"] maps to type STRING, Nullable YES', () => {
    const result = buildSchemaBlock({
      'retail.returns': sampleSchemas['retail.returns'],
    });

    // "reason" field is ["null", "string"]
    expect(result).toContain('| reason |');
    expect(result).toContain('STRING');
    expect(result).toContain('YES');
  });

  it('marks simple (non-nullable) fields as Nullable NO', () => {
    const result = buildSchemaBlock({
      'retail.orders': sampleSchemas['retail.orders'],
    });

    // order_id is plain "long" type, should be Nullable NO
    const lines = result.split('\n');
    const orderIdLine = lines.find((l) => l.includes('| order_id |'));
    expect(orderIdLine).toContain('NO');
  });

  it('handles multiple topics and joins them with blank lines', () => {
    const result = buildSchemaBlock(sampleSchemas);

    expect(result).toContain('### retail.orders');
    expect(result).toContain('### retail.returns');
  });

  it('returns empty placeholder string when all schemas are null', () => {
    const result = buildSchemaBlock({ 'topic.a': null, 'topic.b': null });
    expect(result).toBe('(No schemas available)');
  });

  it('returns empty string for empty schemas object', () => {
    const result = buildSchemaBlock({});
    expect(result).toBe('(No schemas available)');
  });

  it('returns empty string for null/undefined input', () => {
    expect(buildSchemaBlock(null)).toBe('');
    expect(buildSchemaBlock(undefined)).toBe('');
  });

  it('converts Avro type names to uppercase', () => {
    const result = buildSchemaBlock({
      'retail.orders': sampleSchemas['retail.orders'],
    });

    // "long" -> "LONG", "string" -> "STRING"
    expect(result).toContain('LONG');
    expect(result).toContain('STRING');
  });
});

describe('buildSystemPrompt', () => {
  let prompt;

  beforeAll(() => {
    prompt = buildSystemPrompt(sampleSchemas);
  });

  it('includes the schema block with topic names', () => {
    expect(prompt).toContain('### retail.orders');
    expect(prompt).toContain('### retail.returns');
  });

  it('includes the FLINK_SQL_RULES content', () => {
    // FLINK_SQL_RULES content should appear in the prompt
    expect(prompt).toContain('value.format');
    expect(prompt).toContain('TRY_CAST');
    expect(prompt).toContain('TO_TIMESTAMP_LTZ');
    expect(prompt).toContain('WATERMARK');
  });

  it('includes few-shot examples with value.format (not deprecated bare format)', () => {
    // Should use value.format, not just 'format' = 'avro-confluent'
    expect(prompt).toContain("'value.format' = 'avro-confluent'");
    // Should NOT have the deprecated format key pattern (bare format without value. prefix)
    // Check that it doesn't have the pattern 'format' = 'avro-confluent' without the value. prefix
    const bareFormatPattern = /'format'\s*=\s*'avro-confluent'/;
    expect(bareFormatPattern.test(prompt)).toBe(false);
  });

  it('includes value.avro-confluent.url in examples', () => {
    expect(prompt).toContain('value.avro-confluent.url');
  });

  it('includes WATERMARK FOR in examples', () => {
    expect(prompt).toContain('WATERMARK FOR');
  });

  it('includes TRY_CAST in examples', () => {
    expect(prompt).toContain('TRY_CAST');
  });

  it('includes TO_TIMESTAMP_LTZ in examples', () => {
    expect(prompt).toContain('TO_TIMESTAMP_LTZ');
  });

  it('instructs Claude to respond with ONLY a JSON object (no markdown fencing)', () => {
    expect(prompt).toContain('Respond with ONLY a JSON object');
  });

  it('includes all four required JSON fields in the response format', () => {
    expect(prompt).toContain('"sql"');
    expect(prompt).toContain('"outputSchema"');
    expect(prompt).toContain('"mockRows"');
    expect(prompt).toContain('"reasoning"');
  });

  it('declares Claude as a Flink SQL expert for Confluent Platform', () => {
    expect(prompt).toContain('Flink SQL expert for Confluent Platform');
  });

  it('handles empty schemas gracefully', () => {
    const emptyPrompt = buildSystemPrompt({});
    expect(emptyPrompt).toContain('Respond with ONLY a JSON object');
    expect(emptyPrompt).toContain('value.format');
  });

  it('includes scan.startup.mode in rules or examples', () => {
    expect(prompt).toContain('scan.startup.mode');
  });

  it('includes properties.group.id in rules or examples', () => {
    expect(prompt).toContain('properties.group.id');
  });
});

describe('FEW_SHOT_EXAMPLES', () => {
  it('exports FEW_SHOT_EXAMPLES as a non-empty string', () => {
    expect(typeof FEW_SHOT_EXAMPLES).toBe('string');
    expect(FEW_SHOT_EXAMPLES.length).toBeGreaterThan(100);
  });

  it('contains value.format connector property', () => {
    expect(FEW_SHOT_EXAMPLES).toContain("'value.format' = 'avro-confluent'");
  });

  it('contains value.avro-confluent.url', () => {
    expect(FEW_SHOT_EXAMPLES).toContain('value.avro-confluent.url');
  });

  it('contains WATERMARK FOR pattern', () => {
    expect(FEW_SHOT_EXAMPLES).toContain('WATERMARK FOR');
  });

  it('contains TO_TIMESTAMP_LTZ pattern', () => {
    expect(FEW_SHOT_EXAMPLES).toContain('TO_TIMESTAMP_LTZ');
  });

  it('contains TRY_CAST pattern', () => {
    expect(FEW_SHOT_EXAMPLES).toContain('TRY_CAST');
  });

  it('covers window aggregation (TUMBLE)', () => {
    expect(FEW_SHOT_EXAMPLES).toContain('TUMBLE');
  });

  it('covers cross-topic JOIN', () => {
    expect(FEW_SHOT_EXAMPLES).toContain('JOIN');
  });

  it('covers filter pattern (WHERE clause)', () => {
    expect(FEW_SHOT_EXAMPLES).toContain('WHERE');
  });
});

describe('FLINK_SQL_RULES', () => {
  it('exports FLINK_SQL_RULES as a non-empty string', () => {
    expect(typeof FLINK_SQL_RULES).toBe('string');
    expect(FLINK_SQL_RULES.length).toBeGreaterThan(100);
  });

  it('mentions backtick quoting for reserved words', () => {
    expect(FLINK_SQL_RULES).toContain('timestamp');
    expect(FLINK_SQL_RULES).toContain('value');
  });

  it('mandates TRY_CAST for STRING arithmetic', () => {
    expect(FLINK_SQL_RULES).toContain('TRY_CAST');
  });

  it('mandates TO_TIMESTAMP_LTZ for BIGINT timestamps', () => {
    expect(FLINK_SQL_RULES).toContain('TO_TIMESTAMP_LTZ');
  });

  it('mandates WATERMARK for windowed queries', () => {
    expect(FLINK_SQL_RULES).toContain('WATERMARK');
  });

  it('specifies value.format connector property', () => {
    expect(FLINK_SQL_RULES).toContain('value.format');
  });

  it('specifies earliest-offset startup mode', () => {
    expect(FLINK_SQL_RULES).toContain('earliest-offset');
  });
});
