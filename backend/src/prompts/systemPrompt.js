'use strict';

const { FEW_SHOT_EXAMPLES, FLINK_SQL_RULES } = require('./fewShotExamples');

/**
 * buildSchemaBlock(schemas)
 *
 * Converts a map of { topicName: avroSchemaObject | null } into a markdown table
 * block suitable for injecting into the LLM system prompt.
 *
 * For each non-null schema, emits a markdown table:
 *   ### topicName
 *   | Field | Avro Type | Nullable |
 *   |-------|-----------|----------|
 *   | field_name | STRING | YES |
 *
 * Avro union types like ["null", "string"] are resolved to the non-null type
 * with Nullable=YES. Simple types get Nullable=NO.
 *
 * @param {Object} schemas - Map of { topicName: avroSchemaObject | null }
 * @returns {string} Markdown table block
 */
function buildSchemaBlock(schemas) {
  if (!schemas || typeof schemas !== 'object') {
    return '';
  }

  const blocks = [];

  for (const [topicName, schema] of Object.entries(schemas)) {
    // Skip null or missing schemas (topics without registered schemas)
    if (!schema || !schema.fields) {
      continue;
    }

    const rows = schema.fields.map((field) => {
      const { avroType, nullable } = resolveAvroType(field.type);
      return `| ${field.name} | ${avroType} | ${nullable ? 'YES' : 'NO'} |`;
    });

    blocks.push(
      `### ${topicName}\n` +
      `| Field | Avro Type | Nullable |\n` +
      `|-------|-----------|----------|\n` +
      rows.join('\n')
    );
  }

  if (blocks.length === 0) {
    return '(No schemas available)';
  }

  return blocks.join('\n\n');
}

/**
 * Resolves an Avro field type to a display string and nullability flag.
 *
 * Handles:
 * - Simple string type: "string" -> { avroType: "STRING", nullable: false }
 * - Union with null: ["null", "string"] -> { avroType: "STRING", nullable: true }
 * - Object type: { type: "record", ... } -> { avroType: "RECORD", nullable: false }
 *
 * @param {string|Array|Object} avroType
 * @returns {{ avroType: string, nullable: boolean }}
 */
function resolveAvroType(avroType) {
  if (typeof avroType === 'string') {
    return { avroType: avroType.toUpperCase(), nullable: false };
  }

  if (Array.isArray(avroType)) {
    // Union type: filter out "null" to find the real type
    const nonNull = avroType.filter((t) => t !== 'null');
    const isNullable = avroType.includes('null');

    if (nonNull.length === 0) {
      return { avroType: 'NULL', nullable: true };
    }

    const inner = nonNull[0];
    if (typeof inner === 'string') {
      return { avroType: inner.toUpperCase(), nullable: isNullable };
    }
    if (typeof inner === 'object' && inner.type) {
      return { avroType: inner.type.toUpperCase(), nullable: isNullable };
    }
    return { avroType: JSON.stringify(inner), nullable: isNullable };
  }

  if (typeof avroType === 'object' && avroType !== null) {
    if (avroType.type) {
      return { avroType: avroType.type.toUpperCase(), nullable: false };
    }
    return { avroType: 'COMPLEX', nullable: false };
  }

  return { avroType: 'UNKNOWN', nullable: false };
}

/**
 * buildSystemPrompt(schemas)
 *
 * Assembles the full system prompt string for the Flink SQL generation LLM call.
 * Includes:
 * - Role definition
 * - Full schema dump (markdown tables per topic)
 * - Flink SQL dialect rules
 * - Few-shot examples
 * - Structured JSON response format instruction
 *
 * @param {Object} schemas - Map of { topicName: avroSchemaObject | null }
 * @returns {string} Complete system prompt
 */
function buildSystemPrompt(schemas) {
  const schemaBlock = buildSchemaBlock(schemas);

  return `You are a Flink SQL expert for Confluent Platform. Generate complete, executable Flink SQL jobs.

## Available Kafka Topics and Schemas

${schemaBlock}

${FLINK_SQL_RULES}

${FEW_SHOT_EXAMPLES}

## Response Format

Respond with ONLY a JSON object (no markdown fencing, no explanation outside the JSON):
{
  "sql": "<complete Flink SQL with CREATE TABLE source(s), CREATE TABLE sink, INSERT INTO — all statements separated by semicolons>",
  "outputSchema": [{"field": "field_name", "type": "SQL_TYPE"}],
  "mockRows": [{"field_name": value}, ...],
  "reasoning": "<brief chain-of-thought: which topics selected, which fields used, why>"
}

The mockRows array MUST contain 5-8 realistic rows that match the outputSchema fields. Values should be plausible for the domain (realistic order IDs, product names, amounts, timestamps).`;
}

module.exports = { buildSystemPrompt, buildSchemaBlock };
