'use strict';

/**
 * mockDataService.js
 *
 * Handles mock row extraction from LLM responses and fallback row generation
 * when the LLM doesn't provide mock data or it's malformed.
 *
 * Primary approach: extract LLM-generated mock rows from the parsed response.
 * Fallback: generate placeholder rows that match the outputSchema field types.
 */

/**
 * parseMockRows(llmResponse)
 *
 * Extracts the mockRows array from a parsed Claude JSON response object.
 * Validates that mockRows is an array. Returns empty array if:
 * - response is null/undefined/not an object
 * - mockRows property is missing
 * - mockRows is not an array (null, string, etc.)
 *
 * @param {Object|null|undefined} llmResponse - Parsed JSON response from Claude
 * @returns {Array<Object>} Array of row objects (may be empty)
 */
function parseMockRows(llmResponse) {
  if (llmResponse === null || llmResponse === undefined) {
    return [];
  }

  if (typeof llmResponse !== 'object' || Array.isArray(llmResponse)) {
    return [];
  }

  const mockRows = llmResponse.mockRows;

  if (!Array.isArray(mockRows)) {
    return [];
  }

  return mockRows;
}

/**
 * generateFallbackMockRows(outputSchema, count = 5)
 *
 * Generates placeholder rows when LLM-provided mock rows are unavailable or malformed.
 * Each row has a value for every field in the outputSchema, with the value type
 * based on the SQL type declared in the schema.
 *
 * Type mapping:
 * - STRING, VARCHAR, CHAR:   "sample_{index}"
 * - BIGINT, INT, INTEGER, SMALLINT, TINYINT: 1000 + index
 * - DOUBLE, FLOAT, REAL:     1000 + index (as number)
 * - DECIMAL, NUMERIC:        (99.99 + index).toFixed(2)  (as string)
 * - TIMESTAMP:               new Date().toISOString()
 * - BOOLEAN:                 index % 2 === 0
 * - Other/unknown:           "value_{index}"
 *
 * @param {Array<{field: string, type: string}>} outputSchema - Array of field descriptors
 * @param {number} [count=5] - Number of rows to generate
 * @returns {Array<Object>} Array of row objects
 */
function generateFallbackMockRows(outputSchema, count = 5) {
  if (!Array.isArray(outputSchema)) {
    outputSchema = [];
  }

  const rows = [];

  for (let i = 0; i < count; i++) {
    const row = {};

    for (const { field, type } of outputSchema) {
      row[field] = generatePlaceholderValue(type, i);
    }

    rows.push(row);
  }

  return rows;
}

/**
 * generatePlaceholderValue(type, index)
 *
 * Returns a type-appropriate placeholder value for a given SQL type and row index.
 * Index is used to differentiate rows (so rows are not all identical).
 *
 * @param {string} type - SQL type string (e.g. "STRING", "BIGINT", "DECIMAL")
 * @param {number} index - Row index for differentiation
 * @returns {*} Placeholder value
 */
function generatePlaceholderValue(type, index) {
  const upperType = (type || '').toUpperCase();

  if (upperType === 'STRING' || upperType === 'VARCHAR' || upperType === 'CHAR') {
    return `sample_${index}`;
  }

  if (
    upperType === 'BIGINT' ||
    upperType === 'INT' ||
    upperType === 'INTEGER' ||
    upperType === 'SMALLINT' ||
    upperType === 'TINYINT'
  ) {
    return 1000 + index;
  }

  if (upperType === 'DOUBLE' || upperType === 'FLOAT' || upperType === 'REAL') {
    return 1000 + index;
  }

  if (upperType === 'DECIMAL' || upperType === 'NUMERIC') {
    return (99.99 + index).toFixed(2);
  }

  if (upperType === 'TIMESTAMP' || upperType.startsWith('TIMESTAMP(')) {
    return new Date().toISOString();
  }

  if (upperType === 'BOOLEAN') {
    return index % 2 === 0;
  }

  // Fallback for unknown types
  return `value_${index}`;
}

module.exports = { parseMockRows, generateFallbackMockRows };
