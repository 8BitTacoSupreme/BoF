'use strict';

// SQL Validation Service — deterministic validation gate for all generated Flink SQL.
// No LLM required. Uses dt-sql-parser for syntax validation plus catalog-based field
// checking and traffic-light classification (green / yellow / red).

const { FlinkSQL } = require('dt-sql-parser');

// Singleton parser instance — FlinkSQL instantiation is moderately expensive
const flinkParser = new FlinkSQL();

// Flink reserved words that must be backtick-quoted when used as identifiers.
// Reference: Flink SQL docs — "Reserved Keywords"
const FLINK_RESERVED_WORDS = new Set([
  'timestamp', 'time', 'user', 'order', 'value', 'row', 'interval',
  'table', 'key', 'comment'
]);

// Fields whose Avro/physical type requires a runtime cast before numeric operations.
// Keyed by field name pattern → recommended cast expression.
const NUMERIC_STRING_FIELDS = {
  total_amount: 'TRY_CAST(total_amount AS DECIMAL(10,2))',
  total: 'TRY_CAST(total AS DECIMAL(10,2))',
  price: 'TRY_CAST(price AS DECIMAL(10,2))',
  amount: 'TRY_CAST(amount AS DECIMAL(10,2))'
};

// Fields whose Avro/physical type is BIGINT epoch millis and need a TIMESTAMP conversion
// before use in time-based predicates or window functions.
const BIGINT_TIMESTAMP_FIELDS = ['created_at', 'event_time', 'updated_at', 'event_ts'];

// Window function keywords — presence triggers watermark check
const WINDOW_FUNCTION_KEYWORDS = /\b(?:TUMBLE|HOP|SESSION|TUMBLE_START|TUMBLE_END|HOP_START|HOP_END|SESSION_START|SESSION_END)\b/i;

// WATERMARK keyword in DDL
const WATERMARK_REGEX = /\bWATERMARK\b/i;

// SQL keywords that should never be treated as field names during extraction
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'HAVING', 'JOIN',
  'INNER', 'LEFT', 'RIGHT', 'OUTER', 'FULL', 'CROSS', 'ON', 'AS',
  'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'CASE',
  'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT', 'ALL', 'UNION', 'INTERSECT',
  'EXCEPT', 'INSERT', 'INTO', 'CREATE', 'TABLE', 'WITH', 'SET',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'CAST',
  'TRY_CAST', 'INTERVAL', 'TUMBLE', 'HOP', 'SESSION', 'WINDOW',
  'WATERMARK', 'FOR', 'SECOND', 'MINUTE', 'HOUR', 'DAY', 'MONTH', 'YEAR',
  'TIMESTAMP', 'DATE', 'TIME', 'BOOLEAN', 'INT', 'BIGINT', 'STRING',
  'VARCHAR', 'DOUBLE', 'FLOAT', 'DECIMAL', 'ARRAY', 'MAP', 'ROW',
  'TRUE', 'FALSE', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'FETCH', 'NEXT',
  'ROWS', 'ONLY', 'OVER', 'PARTITION', 'PRECEDING', 'FOLLOWING',
  'UNBOUNDED', 'CURRENT', 'RANGE', 'TO_TIMESTAMP_LTZ',
  'CONNECTOR', 'FORMAT', 'TOPIC', 'KAFKA', 'PROPERTIES', 'SCAN',
  'STARTUP', 'MODE', 'AVRO', 'CONFLUENT', 'URL', 'PRINT',
  'PRIMARY', 'KEY', 'ENFORCED', 'COMPUTED', 'COLUMN',
  'METADATA', 'VIRTUAL', 'GENERATED', 'ALWAYS', 'VALUE', 'LATEST',
  'EARLIEST', 'SPECIFIC', 'START', 'STOP', 'TUMBLE_START', 'TUMBLE_END',
  'HOP_START', 'HOP_END', 'SESSION_START', 'SESSION_END', 'DESCRIPTOR',
  'PROCTIME', 'ROWTIME', 'UPSERT', 'SHOW', 'TABLES', 'DROP', 'ALTER',
  'MODIFY', 'RENAME', 'TO', 'BEGIN', 'COMMIT', 'ROLLBACK', 'EXECUTE',
  'STATEMENT', 'SET', 'RESET', 'EXPLAIN', 'USE', 'DATABASE', 'CATALOG',
  'IF', 'EXISTS', 'LIKE', 'OPTIONS', 'PARTITIONED', 'BUCKETED',
  'SORTED', 'STORED', 'LOCATION', 'COMMENT', 'TBLPROPERTIES',
  'LTZ', 'TIMESTAMP_LTZ', 'ROWNUM'
]);

/**
 * validateFlinkSql(sql) — Syntax-only validation using dt-sql-parser FlinkSQL.
 *
 * @param {string} sql - The Flink SQL statement(s) to validate.
 * @returns {{ valid: boolean, errors: Array<{line, col, message}> }}
 */
const validateFlinkSql = (sql) => {
  if (!sql || typeof sql !== 'string') {
    return { valid: false, errors: [{ line: 0, col: 0, message: 'SQL must be a non-empty string' }] };
  }

  // dt-sql-parser v4 validate() returns [] for valid SQL, error objects for invalid SQL.
  // Error object shape: { startLine, endLine, startColumn, endColumn, message }
  let rawErrors;
  try {
    rawErrors = flinkParser.validate(sql);
  } catch (e) {
    return { valid: false, errors: [{ line: 0, col: 0, message: e.message }] };
  }

  if (!rawErrors || rawErrors.length === 0) {
    return { valid: true, errors: [] };
  }

  // Normalize to a consistent shape: { line, col, message }
  const errors = rawErrors.map((e) => ({
    line: e.startLine != null ? e.startLine : (e.line || 0),
    col: e.startColumn != null ? e.startColumn : (e.column || e.col || 0),
    message: e.message || String(e)
  }));

  return { valid: false, errors };
};

/**
 * splitStatements(sql) — Grammar-aware SQL statement splitting.
 * Uses FlinkSQL.splitSQLByStatement() rather than naive semicolon split, so
 * semicolons inside string literals and WITH-clause options are handled correctly.
 *
 * @param {string} sql
 * @returns {string[]} Array of individual statement strings
 */
const splitStatements = (sql) => {
  if (!sql || typeof sql !== 'string') return [];
  let raw;
  try {
    raw = flinkParser.splitSQLByStatement(sql);
  } catch (e) {
    return [sql];
  }
  if (!Array.isArray(raw)) return [sql];
  return raw.map((s) => (typeof s === 'string' ? s : s.text || '')).filter(Boolean);
};

/**
 * extractTableNamesFromSQL(sql) — Extract table/source names from FROM and JOIN clauses
 * so they can be excluded from field extraction.
 *
 * @param {string} sql
 * @returns {Set<string>}
 */
const extractTableNamesFromSQL = (sql) => {
  const tableNames = new Set();
  // Match: FROM table_name [AS alias] or JOIN table_name [AS alias]
  // Also handles backtick-quoted names
  const TABLE_PATTERN = /\b(?:FROM|JOIN)\s+[`]?([a-zA-Z_][a-zA-Z0-9_.]*)[`]?(?:\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/gi;
  let match;
  while ((match = TABLE_PATTERN.exec(sql)) !== null) {
    if (match[1]) {
      // Add the full table name and any dot-separated components
      const parts = match[1].split('.');
      parts.forEach((p) => tableNames.add(p));
      tableNames.add(match[1]);
    }
    // Also add alias if present
    if (match[2]) tableNames.add(match[2]);
  }
  return tableNames;
};

/**
 * extractFieldsFromSQL(sql) — Best-effort regex extraction of field names referenced
 * in SELECT, WHERE, GROUP BY, ORDER BY, HAVING, and JOIN ON clauses.
 *
 * Handles table-aliased fields (e.g. "o.order_id" → "order_id").
 * Excludes table names and aliases that appear in FROM/JOIN clauses.
 * Returns unique array of field name strings.
 *
 * @param {string} sql
 * @returns {string[]}
 */
const extractFieldsFromSQL = (sql) => {
  if (!sql || typeof sql !== 'string') return [];

  const fieldSet = new Set();
  // Collect table names and aliases to exclude
  const tableNames = extractTableNamesFromSQL(sql);

  // Two-phase regex:
  //  Group 1: alias.field  (capture field after the dot)
  //  Group 2: bare token   (identifier without a dot)
  const FIELD_PATTERN = /\b(?:[a-zA-Z_][a-zA-Z0-9_]*\.)([a-zA-Z_][a-zA-Z0-9_]*)\b|\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

  let match;
  while ((match = FIELD_PATTERN.exec(sql)) !== null) {
    // Prefer the aliased group (1) if present, else bare token (2)
    const candidate = match[1] || match[2];
    if (!candidate) continue;
    if (SQL_KEYWORDS.has(candidate.toUpperCase())) continue;
    if (/^\d+$/.test(candidate)) continue;
    // Exclude table names and their aliases
    if (tableNames.has(candidate)) continue;

    fieldSet.add(candidate);
  }

  return Array.from(fieldSet);
};

/**
 * catalogCheck(sql, schemasByTopic) — Validates field references against known schemas
 * and warns about common type-mismatch patterns.
 *
 * @param {string} sql
 * @param {Object} schemasByTopic - Map of { topicName: { fields: [{name, type}] } }
 * @returns {string[]} Array of issue description strings (empty = no issues)
 */
const catalogCheck = (sql, schemasByTopic) => {
  const issues = [];
  if (!sql || typeof sql !== 'string') return issues;
  if (!schemasByTopic || typeof schemasByTopic !== 'object') return issues;

  // Build a flat set of all known field names and a type map across all topic schemas
  const knownFields = new Set();
  const fieldTypeMap = {};

  for (const schema of Object.values(schemasByTopic)) {
    if (!schema || !Array.isArray(schema.fields)) continue;
    for (const field of schema.fields) {
      if (field && field.name) {
        knownFields.add(field.name);
        fieldTypeMap[field.name] = (field.type || 'UNKNOWN').toUpperCase();
      }
    }
  }

  // If no schemas provided, skip unknown-field checks (nothing to validate against)
  const hasSchemas = knownFields.size > 0;
  const sqlFields = extractFieldsFromSQL(sql);

  // --- (a) Unknown field check ---
  if (hasSchemas) {
    for (const field of sqlFields) {
      if (!knownFields.has(field)) {
        issues.push(`Unknown field '${field}' — not found in any registered topic schema`);
      }
    }
  }

  // --- (b) STRING field in numeric aggregation context ---
  for (const [fieldName, castExpr] of Object.entries(NUMERIC_STRING_FIELDS)) {
    const effectiveType = fieldTypeMap[fieldName];
    // Only flag if field is known AND typed STRING, or if no schema but field is referenced
    const shouldCheck = effectiveType === 'STRING' || (!hasSchemas && sql.toLowerCase().includes(fieldName));

    if (shouldCheck && sql.toLowerCase().includes(fieldName.toLowerCase())) {
      const aggPattern = new RegExp(
        `(?:SUM|AVG|MIN|MAX)\\s*\\(\\s*${fieldName}\\s*\\)|${fieldName}\\s*[+\\-*/]`,
        'i'
      );
      const hasTryCast = new RegExp(`TRY_CAST\\s*\\(\\s*${fieldName}`, 'i').test(sql);

      if (aggPattern.test(sql) && !hasTryCast) {
        issues.push(`'${fieldName}' is STRING type — use ${castExpr} before numeric operations`);
      }
    }
  }

  // --- (c) BIGINT timestamp fields used without TO_TIMESTAMP_LTZ ---
  for (const fieldName of BIGINT_TIMESTAMP_FIELDS) {
    const effectiveType = fieldTypeMap[fieldName];
    const shouldCheck = effectiveType === 'BIGINT' || (!hasSchemas && sql.toLowerCase().includes(fieldName));

    if (shouldCheck && sql.toLowerCase().includes(fieldName.toLowerCase())) {
      // Detect predicate usage: WHERE/AND/OR/ON/HAVING followed by the field with a comparison
      const usagePattern = new RegExp(
        `(?:WHERE|AND|OR|ON|HAVING)\\b[^;]*?\\b${fieldName}\\s*(?:>|<|=|>=|<=|<>|BETWEEN)`,
        'i'
      );
      const hasConversion = new RegExp(`TO_TIMESTAMP_LTZ\\s*\\(\\s*${fieldName}`, 'i').test(sql);

      if (usagePattern.test(sql) && !hasConversion) {
        issues.push(
          `'${fieldName}' is BIGINT epoch millis — use TO_TIMESTAMP_LTZ(${fieldName}, 3) for time-based operations`
        );
      }
    }
  }

  // --- (d) Reserved word used unquoted as identifier ---
  for (const reserved of FLINK_RESERVED_WORDS) {
    // Only warn if in an identifier context after SELECT, AS, or in comma-separated column lists.
    // Note: backtick lookahead uses string concat to avoid template literal closing early.
    const backtickLookahead = '(?!' + '`' + ')';
    const identifierContext = new RegExp(
      '(?:SELECT|,|\\bAS\\b|\\bBY\\b|\\bON\\b|\\bHAVING\\b)\\s+(?:[^,;]*?)?\\b' + reserved + '\\b' + backtickLookahead,
      'i'
    );
    if (identifierContext.test(sql)) {
      issues.push("'" + reserved + "' is a Flink reserved word - use backtick quoting: `" + reserved + '`');
    }
  }

  return issues;
};

/**
 * validateAndClassify(sql, schemasByTopic) — Full validation pipeline with traffic-light result.
 *
 * Classification rules:
 *   red    — syntax errors OR unknown fields detected in catalog check
 *   yellow — syntax valid + fields resolve, but window function used without WATERMARK DDL
 *   green  — all checks pass
 *
 * @param {string} sql
 * @param {Object} schemasByTopic
 * @returns {{ status: 'green'|'yellow'|'red', syntaxErrors: Array, catalogIssues: Array, warnings?: Array }}
 */
const validateAndClassify = (sql, schemasByTopic) => {
  // --- Step 1: Syntax validation ---
  const syntaxResult = validateFlinkSql(sql);
  if (!syntaxResult.valid) {
    return {
      status: 'red',
      syntaxErrors: syntaxResult.errors,
      catalogIssues: []
    };
  }

  // --- Step 2: Catalog check ---
  const catalogIssues = catalogCheck(sql, schemasByTopic);
  const hasUnknownFields = catalogIssues.some((i) => i.includes('Unknown field'));

  if (hasUnknownFields) {
    return {
      status: 'red',
      syntaxErrors: [],
      catalogIssues
    };
  }

  // --- Step 3: Window function + WATERMARK check ---
  const hasWindowFunction = WINDOW_FUNCTION_KEYWORDS.test(sql);
  const hasWatermark = WATERMARK_REGEX.test(sql);

  if (hasWindowFunction && !hasWatermark) {
    return {
      status: 'yellow',
      syntaxErrors: [],
      catalogIssues,
      warnings: ['Window function used but no WATERMARK declaration found in source DDL']
    };
  }

  // --- All checks passed ---
  return {
    status: 'green',
    syntaxErrors: [],
    catalogIssues
  };
};

module.exports = {
  validateFlinkSql,
  splitStatements,
  extractFieldsFromSQL,
  catalogCheck,
  validateAndClassify
};
