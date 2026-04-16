# Phase 02: NLP to SQL Query with Validation and Sample Output - Research

**Researched:** 2026-04-15
**Domain:** NL-to-Flink-SQL pipeline, Claude API, Flink SQL parsing, schema-grounded SQL generation, React SQL editor
**Confidence:** HIGH (core stack verified; Flink SQL parser for Node.js has a definitive answer)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Claude API (Anthropic) as the LLM provider — already in the Anthropic ecosystem, strong code/SQL generation, tool use for schema introspection
- Full schema dump in system prompt — topic count is bounded (~10-15 topics), Avro schemas are compact; simpler than RAG with no drift risk
- Few-shot with Flink SQL examples + chain-of-thought prompting — 3-5 canonical query patterns (window aggregation, JOIN, filter) as examples; model reasons about which topics/fields to use
- Target Confluent Platform Flink SQL dialect — matches Phase 1 local CP environment; CC-specific features (INFORMATION_SCHEMA, auto-watermarks) noted for future migration
- Flink SQL parser validation + catalog check — parse SQL for syntax correctness, validate table/field names against Schema Registry schemas; no actual Flink dry-run (too heavy)
- Generate mock rows from output schema inference — LLM infers output schema from the SQL, generates 5-10 realistic sample rows; fast, no Flink execution needed
- Editable SQL with syntax highlighting — user can tweak the generated SQL before accepting; supports power users and iteration
- Table view as default output format with JSON toggle available — consistent with Phase 1 message viewer (D-10)
- Inline error display with retry — show what went wrong (invalid field, ambiguous intent), let user rephrase or edit SQL directly
- Conversational follow-ups — "make it weekly instead of daily", "add the product category" build on previous query context
- Traffic light validation indicator — green (valid SQL, all fields resolve), yellow (valid syntax but uncertain field mapping), red (parse error)
- 3 auto-retries on validation failure before surfacing to user — LLM gets validation errors fed back for self-correction

### Claude's Discretion
- Exact system prompt structure and few-shot example selection
- Schema serialization format for LLM context (JSON, markdown table, etc.)
- SQL syntax highlighting library choice
- Mock data generation approach (LLM-generated vs template-based)
- WebSocket vs REST for query submission
- UI layout specifics for the query builder panel
- Token/cost optimization for Claude API calls

### Deferred Ideas (OUT OF SCOPE)
- Confluent Cloud migration and INFORMATION_SCHEMA integration (future milestone)
- RAG knowledge base for query patterns (referenced in flinkenstein, not needed for Phase 2 MVP)
- ML_PREDICT / managed model inference in Flink SQL (CC-only feature)
- Query cost estimation before execution
- Saved query library (beyond recent history)
</user_constraints>

---

## Summary

Phase 2 builds the intelligence layer on top of Phase 1's Kafka/Schema Registry foundation. The core pipeline is: user enters natural language → backend fetches all schemas from Schema Registry → schemas are injected into Claude's system prompt → Claude generates Flink SQL → `dt-sql-parser`'s `FlinkSQL` class validates syntax → field names are cross-checked against Schema Registry catalog → LLM generates 5-10 mock output rows → frontend presents editable SQL in Monaco Editor with a traffic-light indicator and tabular sample output.

The reference implementation (`/Users/jhogan/flinkenstein/`) provides proven patterns for every component: `@anthropic-ai/sdk` usage with Claude, `schemaRegistryService.js` for schema fetching, `validateSqlWithAI` for AI-assisted correction, and `@monaco-editor/react` for the SQL editor. **The primary research finding that unlocks the locked decisions is `dt-sql-parser`**: this ANTLR4-based npm package has a dedicated `FlinkSQL` class that parses and validates Flink SQL dialect natively in Node.js — no Flink process, no Java, no heavy infrastructure. This is the missing piece the original flinkenstein never had.

The critical architectural shift from the reference flinkenstein is that bride_of_flinkenstein uses Claude exclusively (not a provider dropdown), hardcodes Claude Sonnet 4.6 (`claude-sonnet-4-6`) rather than the deprecated `claude-3-5-sonnet-20241022`, and uses a single multi-topic system prompt with full schema context rather than per-topic context. The 3-retry auto-correction loop (validation error → LLM self-correction → re-validate) is the primary quality mechanism and must be implemented as a server-side loop, not a client-side retry.

**Primary recommendation:** Use `dt-sql-parser@4.4.2` for syntax validation, `@anthropic-ai/sdk@0.89.0` with `claude-sonnet-4-6`, and `@monaco-editor/react@4.7.0` for the SQL editor. Implement the full schema dump as a structured system prompt with Flink SQL few-shot examples baked in. Run the 3-retry correction loop server-side before returning to the client.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | 0.89.0 | Claude API client — SQL generation and AI-powered validation | Locked decision; official Anthropic SDK; `claude-sonnet-4-6` is current non-deprecated model |
| `dt-sql-parser` | 4.4.2 | Flink SQL syntax parsing and validation in Node.js | Only production-grade Flink SQL parser in the npm ecosystem; ANTLR4-based, built specifically for BigData SQL dialects including Flink |
| `axios` | (Phase 1 choice) | Schema Registry REST API calls | Already used in Phase 1 reference; Schema Registry exposes REST at `/subjects/{subject}/versions/latest` |
| `@monaco-editor/react` | 4.7.0 | Editable SQL editor with syntax highlighting | Already used in reference flinkenstein (`SqlEditor.jsx`); VS Code foundation; `language="sql"` enables highlighting |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@faker-js/faker` | 10.4.0 | Realistic mock data generation for sample output rows | Use for template-based mock row generation as fallback; LLM-generated mock rows are primary approach |
| `monaco-sql-languages` | 1.0.0 | Flink-specific SQL keyword highlighting for Monaco | Use if Flink SQL keyword completion is needed beyond basic SQL mode; optional enhancement |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@monaco-editor/react` | `@uiw/react-codemirror` + `@codemirror/lang-sql` | CodeMirror is lighter (no Web Worker) but Monaco is already in the reference implementation and has richer IDE features; stick with Monaco |
| `dt-sql-parser` for validation | Flink SQL Gateway REST API | REST API requires a live Flink process with SQL Gateway running; per locked decision, no actual Flink dry-run — `dt-sql-parser` covers syntax validation without infrastructure |
| Full schema dump in system prompt | RAG + schema retrieval | Deferred per CONTEXT.md; simpler, no drift risk at 10-15 topic scale |
| LLM-generated mock rows | Execute real Flink statement | Real execution requires live Flink; too heavy for preview per locked decision |

**Installation (Phase 2 additions to Phase 1 backend):**
```bash
npm install @anthropic-ai/sdk@0.89.0 dt-sql-parser@4.4.2
```

**Installation (Phase 2 additions to Phase 1 frontend):**
```bash
npm install @monaco-editor/react@4.7.0
```

Note: `@faker-js/faker` is optional — add only if LLM-based mock generation proves insufficient.

**Version verification (confirmed 2026-04-15):**
- `@anthropic-ai/sdk`: 0.89.0 (verified via `npm view`)
- `dt-sql-parser`: 4.4.2 (verified via `npm view`, published 2026-03-06)
- `@monaco-editor/react`: 4.7.0 (verified via `npm view`)
- `@faker-js/faker`: 10.4.0 (verified via `npm view`)

---

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)

```
backend/src/
├── routes/
│   └── api.js                    # Add POST /api/query route (NLP submission)
├── services/
│   ├── schemaRegistryService.js  # Phase 1: getAllSchemas() addition
│   ├── llmService.js             # Phase 2: generateFlinkSQL(), selfCorrect()
│   ├── sqlValidationService.js   # Phase 2: FlinkSQL parser + catalog check
│   └── mockDataService.js        # Phase 2: generateMockRows()

frontend/src/
├── components/
│   ├── QueryBuilder.jsx           # Phase 2: NLP input + schema sidebar
│   ├── SqlEditor.jsx              # Phase 2: Monaco editor (from flinkenstein)
│   ├── SampleOutput.jsx           # Phase 2: Table/JSON view of mock rows
│   └── ValidationIndicator.jsx    # Phase 2: Traffic light (green/yellow/red)
```

### Pattern 1: Full Schema Dump for System Prompt

**What:** At query time, fetch all topic schemas from Schema Registry and serialize them into the system prompt as a structured block. The LLM's allowed vocabulary for table names and field names is bounded by this context.

**When to use:** Always — this is the locked decision. With ~10-15 topics and compact Avro schemas, the total context is well within Claude Sonnet 4.6's 1M-token context window.

**Schema serialization recommendation (Claude's discretion area):** Use a compact markdown table format per topic — more readable than raw JSON, easier for the LLM to reason over, and saves tokens compared to pretty-printed JSON:

```
## Available Kafka Topics

### retail.orders
| Field | Type | Nullable |
|-------|------|----------|
| order_id | BIGINT | NO |
| user_id | INT | NO |
| total_amount | STRING | NO |
| status | STRING | NO |
| created_at | BIGINT | NO |
```

**Source:** Reference flinkenstein `llmService.js` — the `topicsBlock` in `getFlinkPersonaContext()` shows this pattern in practice.

### Pattern 2: dt-sql-parser FlinkSQL Validation

**What:** Use `dt-sql-parser`'s `FlinkSQL` class to validate syntax before any LLM-powered validation round. Returns an array of error objects with line/column positions when invalid; empty array when valid.

**When to use:** As the first validation gate — runs synchronously, < 1ms, requires no external services.

```javascript
// Source: dt-sql-parser official API (verified via npm, GitHub README)
const { FlinkSQL } = require('dt-sql-parser');

const flink = new FlinkSQL();

// Returns [] on valid SQL, or [{startLine, endLine, startCol, endCol, message}] on errors
const errors = flink.validate(sql);

if (errors.length > 0) {
  // Map to traffic-light: red
  return {
    status: 'red',
    errors: errors.map(e => ({
      line: e.startLine,
      col: e.startCol,
      message: e.message
    }))
  };
}
```

**Critical note:** `dt-sql-parser` validates Flink SQL grammar but does NOT know about your specific topics or fields — it catches `SELEC` (misspelling), wrong keyword order, unmatched parentheses, etc. The catalog check (field names against Schema Registry) is a separate step in `sqlValidationService.js`.

### Pattern 3: Catalog Check (Field Name Validation)

**What:** After syntax validation passes, check that every field referenced in the SQL exists in at least one known topic schema. The reference flinkenstein's `schemaAwareValidate()` shows the pattern — extract field names from SELECT and WHERE clauses via regex, cross-reference against known Avro schema fields.

**When to use:** Immediately after syntax validation, before LLM correction loop.

```javascript
// Adapted from /Users/jhogan/flinkenstein/backend/src/services/llmService.js
// schemaAwareValidate() — field extraction + existence check

const catalogCheck = (sql, schemasByTopic) => {
  const issues = [];
  const knownFields = new Set();

  // Build allowed field vocabulary from all topic schemas
  Object.values(schemasByTopic).forEach(schema => {
    if (schema?.fields) {
      schema.fields.forEach(f => knownFields.add(f.name));
    }
  });

  // Extract referenced field names (naive regex approach — proven in reference)
  const referencedFields = extractFieldsFromSQL(sql); // see llmService.js
  referencedFields.forEach(field => {
    if (!knownFields.has(field)) {
      issues.push(`Unknown field: '${field}' — not found in any topic schema`);
    }
  });

  // Type-safety checks (proven pain points in flinkenstein)
  if (/total_amount/i.test(sql) && !/CAST|TRY_CAST/i.test(sql)) {
    issues.push("'total_amount' is STRING — use TRY_CAST(total_amount AS DECIMAL(10,2))");
  }
  if (/created_at/i.test(sql) && !/TO_TIMESTAMP_LTZ/i.test(sql)) {
    issues.push("'created_at' is BIGINT millis — use TO_TIMESTAMP_LTZ(created_at, 3)");
  }

  return issues;
};
```

**Traffic light mapping:**
- Syntax errors from `dt-sql-parser`: **red**
- Unknown field names from catalog check: **red**
- Valid syntax + all fields resolve: **green**
- Valid syntax + fields resolve but watermark/window semantics uncertain: **yellow** (LLM confidence flag)

### Pattern 4: 3-Retry Self-Correction Loop (Server-Side)

**What:** When validation fails, feed the error back to Claude for self-correction. Run server-side (not client-round-trips) for latency and UX.

**When to use:** Always — this is the locked decision. Max 3 retries before surfacing to user.

```javascript
// Backend: services/llmService.js — generateWithSelfCorrection()

const generateWithSelfCorrection = async (nlQuery, schemaContext, maxRetries = 3) => {
  let sql = await callClaude(buildGenerationPrompt(nlQuery, schemaContext));

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const syntaxErrors = flinkParser.validate(sql);
    const catalogErrors = catalogCheck(sql, schemaContext.schemas);
    const allErrors = [...syntaxErrors, ...catalogErrors];

    if (allErrors.length === 0) {
      return { sql, attempts: attempt + 1, status: 'green' };
    }

    // Self-correction: feed errors back to Claude
    sql = await callClaude(buildCorrectionPrompt(sql, allErrors, schemaContext));
  }

  // After 3 retries: return best attempt with red/yellow indicator
  return { sql, attempts: maxRetries, status: 'red', errors: finalErrors };
};
```

### Pattern 5: Claude API Integration (Current SDK Pattern)

**What:** Use `@anthropic-ai/sdk` with `claude-sonnet-4-6`. The reference flinkenstein uses the deprecated `claude-3-5-sonnet-20241022` — update to current model. System prompt carries the schema context; user message carries the NL query.

**Key update from flinkenstein:** The model string `claude-3-5-sonnet-20241022` used throughout flinkenstein is a deprecated model. Use `claude-sonnet-4-6` (no snapshot date suffix for the alias).

```javascript
// Source: @anthropic-ai/sdk 0.89.0 — verified pattern
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const result = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',         // Current model; replaces deprecated claude-3-5-sonnet-20241022
  max_tokens: 4096,                    // SQL generation needs headroom; 2048 was tight in flinkenstein
  system: buildSystemPrompt(schemas),  // Full schema dump + Flink SQL persona + few-shot examples
  messages: [
    { role: 'user', content: nlQuery }
  ]
  // temperature: omit for SQL generation — deterministic output preferred; default is appropriate
});

const sql = result.content[0].text;
```

**Conversational follow-up pattern:** Maintain message history array in session state and append user follow-ups + assistant responses. Pass the full history array to `messages`:

```javascript
// Follow-up: "make it weekly instead of daily"
const result = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  system: buildSystemPrompt(schemas),
  messages: [
    { role: 'user', content: originalQuery },
    { role: 'assistant', content: previousSql },
    { role: 'user', content: 'make it weekly instead of daily' }
  ]
});
```

### Pattern 6: Mock Row Generation

**What:** After SQL validation passes (green or yellow), Claude infers the output schema from the SELECT clause and generates 5-10 realistic mock rows.

**Approach (Claude's discretion area):** LLM-generated mock rows are primary — Claude can infer realistic values from field names and the original NL query context. This requires a second (short) Claude call or can be chained into the generation prompt using a multi-part response structure.

**Recommendation:** A single prompt with structured output requesting both SQL and mock rows avoids the extra round-trip:

```javascript
// The system prompt instructs Claude to return a JSON envelope:
// { "sql": "...", "mockRows": [...], "outputSchema": [...] }
// Use Anthropic's structured outputs (beta) or instruct JSON-in-text

const buildGenerationPrompt = (nlQuery, schemaContext) => `
${SCHEMA_CONTEXT_BLOCK}

${FEW_SHOT_EXAMPLES}

User query: "${nlQuery}"

Respond with ONLY a JSON object:
{
  "sql": "<full Flink SQL with CREATE TABLE source, CREATE TABLE sink, INSERT INTO>",
  "outputSchema": [{"field": "...", "type": "...", "example": "..."}],
  "mockRows": [
    {"<field>": <value>, ...},
    // 5-8 realistic rows based on the schema and query intent
  ],
  "reasoning": "<brief chain-of-thought about topic and field selection>"
}
`;
```

### Pattern 7: Schema Registry Integration (Phase 2 Addition)

**What:** Phase 1 builds per-topic schema fetch. Phase 2 needs a `getAllSchemas()` function that fetches all topic schemas at query time for the system prompt.

**Reference:** `schemaRegistryService.js` in flinkenstein shows the per-topic fetch. Phase 2 adds bulk fetch.

```javascript
// Backend: services/schemaRegistryService.js — getAllSchemas()
const getAllSchemas = async (topics) => {
  const schemas = {};
  await Promise.all(topics.map(async (topic) => {
    try {
      schemas[topic] = await getTopicSchema(topic); // existing function
    } catch (e) {
      // Schema may not be registered for internal topics; ignore
      schemas[topic] = null;
    }
  }));
  return schemas;
};
```

### Anti-Patterns to Avoid

- **Sending the API key from the frontend:** The reference flinkenstein sent the API key from the React client to the backend. This is a security issue. For bride_of_flinkenstein, use `process.env.ANTHROPIC_API_KEY` on the backend only — the frontend never touches it.
- **Per-topic context (flinkenstein pattern):** The reference builds context scoped to one topic. Phase 2 uses full multi-topic context to support JOINs and cross-topic queries.
- **Client-side retry loop:** The 3-retry correction loop MUST run server-side. Client round-trips for each correction add 200-500ms of network latency per retry.
- **Using `claude-3-5-sonnet-20241022`:** This model is deprecated. Use `claude-sonnet-4-6`.
- **`temperature: 0.1` for SQL generation:** The flinkenstein uses 0.1. For SQL generation with few-shot prompting, default temperature (1.0) or no temperature parameter produces sufficiently deterministic output with Claude; 0.1 can cause repetitive failure modes in self-correction loops. Leave at default or use 0 for maximum determinism.
- **Regex-only field extraction for catalog check:** The reference flinkenstein's `extractIdentifiers()` uses regex, which misses table-aliased fields (e.g., `o.order_id` from JOIN). Improve to handle `tablealias.field` patterns.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flink SQL syntax validation | Custom regex parser | `dt-sql-parser` FlinkSQL class | ANTLR4 grammar handles the full Flink SQL dialect; regex cannot handle nested parens, multi-statement, reserved word context |
| SQL syntax highlighting | Custom tokenizer | `@monaco-editor/react` with `language="sql"` | Monaco's SQL mode covers DDL keywords; handles multi-statement; already in reference implementation |
| Schema Registry REST calls | Custom HTTP client | `axios` with existing `schemaRegistryService.js` pattern | Pattern is proven in flinkenstein; `/subjects/{topic}-value/versions/latest` is the canonical endpoint |
| Realistic mock data | Custom value generator | LLM-generated mock rows (or `@faker-js/faker` as fallback) | Claude can generate contextually appropriate values (realistic product names, realistic amounts); faker generates syntactically correct but semantically empty data |
| Multi-topic system prompt building | Ad-hoc string concatenation | A dedicated `buildSystemPrompt(schemas, examples)` service function | Needs consistent structure for the LLM to parse; testable; separates concerns |

**Key insight:** The "don't hand-roll" items in this phase are things that look simple but have deep correctness requirements. A regex-based Flink SQL validator will pass wrong SQL that `dt-sql-parser` catches. A hand-rolled schema serializer will produce inconsistent formats that confuse the LLM. Use libraries for parsing; use the LLM for semantic reasoning.

---

## Common Pitfalls

### Pitfall 1: Flink Reserved Word Backtick Requirement
**What goes wrong:** Claude generates SQL with unquoted Flink reserved words: `timestamp`, `time`, `user`, `order`, `value`. These fail at Flink parse time with cryptic errors.
**Why it happens:** ANSI SQL doesn't require backtick quoting; Claude's SQL training data skews toward ANSI/MySQL/PostgreSQL patterns.
**How to avoid:** Hard-code a reserved-word list in the system prompt: "Always backtick these field names: `timestamp`, `time`, `user`, `order`, `value`, `row`." The reference flinkenstein validates for this explicitly in `validateGeneratedSqlStructure()` — copy that check into `sqlValidationService.js`.
**Warning signs:** Parser errors mentioning "mismatched input 'timestamp'" or similar.

### Pitfall 2: STRING Fields Used in Numeric Operations
**What goes wrong:** The `total_amount` (and similar monetary) fields are Avro `string` type, stored as `"12.50"`. Claude generates `SUM(total_amount)` or `total_amount > 100`, which fails at Flink execution time.
**Why it happens:** Field name implies numeric type; LLM doesn't know the Avro type is string.
**How to avoid:** Include Avro types in the schema dump (e.g., the markdown table has a "Type" column). Also add a catalog check rule: if a field referenced in an arithmetic context is STRING type, flag it. The correction prompt should say: "Use `TRY_CAST(total_amount AS DECIMAL(10,2))`."
**Warning signs:** Catalog check warnings; runtime type errors in Flink.

### Pitfall 3: Missing Watermark for Window Functions
**What goes wrong:** Claude generates `TUMBLE(TABLE orders, DESCRIPTOR(event_time), INTERVAL '1' DAY)` but the source table DDL lacks a `WATERMARK FOR event_time AS event_time - INTERVAL '5' SECOND` declaration. The Flink SQL parser in `dt-sql-parser` may pass this (it validates grammar, not semantics), but Flink execution will fail.
**Why it happens:** CC Flink handles watermarks automatically; self-managed Flink requires explicit DDL. Few-shot examples must include watermark declarations.
**How to avoid:** Every few-shot example with a time window MUST include a complete source table DDL with WATERMARK. Make this a catalog check rule: if the SQL contains `TUMBLE`, `HOP`, or `SESSION`, verify the source CREATE TABLE has a WATERMARK clause.
**Warning signs:** SQL passes `dt-sql-parser` validation but fails when actually submitted to Flink.

### Pitfall 4: BIGINT Timestamp Conversion
**What goes wrong:** `created_at` is stored as BIGINT epoch milliseconds. Claude generates `WHERE created_at > CURRENT_TIMESTAMP` (comparing BIGINT to TIMESTAMP) or uses it directly in TUMBLE without conversion.
**Why it happens:** The schema dump shows type BIGINT; Claude infers it's a timestamp from the field name but doesn't know it needs `TO_TIMESTAMP_LTZ(created_at, 3)`.
**How to avoid:** Add to system prompt: "Fields named `created_at`, `timestamp`, or `event_time` of type BIGINT are epoch milliseconds. Convert with `TO_TIMESTAMP_LTZ(field, 3)` before use in window functions or comparisons." Include this pattern in the few-shot examples.
**Warning signs:** Type mismatch errors in catalog check or Flink submission.

### Pitfall 5: Multi-Statement SQL Parsing
**What goes wrong:** A complete Flink SQL job requires 3 statements: `CREATE TABLE source`, `CREATE TABLE sink`, `INSERT INTO`. `dt-sql-parser`'s `validate()` handles multi-statement SQL (separated by semicolons), but response parsing must split on `;` correctly — naive splits fail on strings containing semicolons.
**Why it happens:** The flinkenstein's `extractRawSql()` regex approach sometimes mis-splits. `dt-sql-parser` provides `splitSQLByStatement()` which is grammar-aware.
**How to avoid:** Use `flink.splitSQLByStatement(sql)` instead of regex split. Validate each statement individually for better error attribution.
**Warning signs:** Validation says "Missing CREATE TABLE" when all three statements are present.

### Pitfall 6: Session State vs Stateless Endpoints
**What goes wrong:** Conversational follow-ups ("make it weekly instead of daily") lose context between requests if the message history isn't maintained.
**Why it happens:** The reference flinkenstein uses in-memory `sessionContext` object keyed by sessionId — this works but resets on server restart and leaks memory if cleanup is missed.
**How to avoid:** Implement session cleanup with TTL (the reference has 1-hour cleanup — carry this forward). For Phase 2, the in-memory approach is acceptable. Send `sessionId` from frontend; backend looks up history. The frontend maintains the conversation context locally as well for display.
**Warning signs:** Follow-up queries start from scratch instead of refining the previous query.

---

## Code Examples

Verified patterns from reference implementation and official sources:

### Claude API Call — SQL Generation
```javascript
// Source: /Users/jhogan/flinkenstein/backend/src/services/enhancedLlmService.js
// Updated to current model and pattern

const Anthropic = require('@anthropic-ai/sdk');

const callClaude = async (systemPrompt, messages) => {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',  // Current model — replaces deprecated claude-3-5-sonnet-20241022
    max_tokens: 4096,
    system: systemPrompt,
    messages: messages
  });
  return result.content[0].text;
};
```

### dt-sql-parser Flink SQL Validation
```javascript
// Source: dt-sql-parser official API, verified via npm and GitHub README
const { FlinkSQL } = require('dt-sql-parser');

const flinkParser = new FlinkSQL();

const validateFlinkSql = (sql) => {
  const errors = flinkParser.validate(sql);
  // Returns [] for valid SQL
  // Returns [{startLine, endLine, startCol, endCol, message}] for errors
  return {
    valid: errors.length === 0,
    errors: errors.map(e => ({
      line: e.startLine,
      col: e.startCol,
      message: e.message
    }))
  };
};

// Split multi-statement SQL grammar-aware (safer than regex split on ';')
const splitStatements = (sql) => {
  return flinkParser.splitSQLByStatement(sql);
};
```

### Schema Registry — Bulk Schema Fetch
```javascript
// Source: adapted from /Users/jhogan/flinkenstein/backend/src/services/schemaRegistryService.js
const getAllSchemas = async (topics) => {
  const results = {};
  await Promise.all(
    topics.map(async (topic) => {
      try {
        const subject = `${topic}-value`;
        const url = `${SCHEMA_REGISTRY_HOST}/subjects/${encodeURIComponent(subject)}/versions/latest`;
        const response = await axios.get(url);
        results[topic] = JSON.parse(response.data.schema);
      } catch (e) {
        results[topic] = null; // topic may lack a registered schema
      }
    })
  );
  return results;
};
```

### Flink SQL System Prompt — Schema Block Format
```javascript
// Claude's discretion: recommended compact markdown table format
const buildSchemaBlock = (schemas) => {
  return Object.entries(schemas)
    .filter(([, schema]) => schema !== null)
    .map(([topic, schema]) => {
      const fields = schema.fields.map(f =>
        `| ${f.name} | ${typeof f.type === 'object' ? f.type.type : f.type} |`
      ).join('\n');
      return `### ${topic}\n| Field | Avro Type |\n|-------|----------|\n${fields}`;
    })
    .join('\n\n');
};
```

### Few-Shot Example — Window Aggregation (Critical for Time Window Queries)
```sql
-- Source: Derived from flinkenstein working patterns + Flink docs
-- This pattern MUST appear in the system prompt few-shot examples

-- Example: "total sales by product per day for the last week"
CREATE TABLE retail_orders_source (
  `order_id` BIGINT,
  `product_id` STRING,
  `total_amount` STRING,   -- STRING type: use TRY_CAST for numeric ops
  `created_at` BIGINT,     -- BIGINT epoch millis: use TO_TIMESTAMP_LTZ
  `event_time` AS TO_TIMESTAMP_LTZ(`created_at`, 3),
  WATERMARK FOR `event_time` AS `event_time` - INTERVAL '5' SECOND
) WITH (
  'connector' = 'kafka',
  'topic' = 'retail.orders',
  'properties.bootstrap.servers' = 'broker:9092',
  'properties.group.id' = 'bride-of-flinkenstein-reader',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081',
  'scan.startup.mode' = 'earliest-offset'
);

CREATE TABLE daily_sales_sink (
  `product_id` STRING,
  `window_start` TIMESTAMP(3),
  `window_end` TIMESTAMP(3),
  `total_sales` DECIMAL(10, 2)
) WITH (
  'connector' = 'kafka',
  'topic' = 'retail.daily-sales',
  'properties.bootstrap.servers' = 'broker:9092',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081'
);

INSERT INTO daily_sales_sink
SELECT
  `product_id`,
  window_start,
  window_end,
  SUM(TRY_CAST(`total_amount` AS DECIMAL(10, 2))) AS total_sales
FROM TABLE(
  TUMBLE(TABLE retail_orders_source, DESCRIPTOR(`event_time`), INTERVAL '1' DAY)
)
GROUP BY `product_id`, window_start, window_end;
```

### Monaco Editor — SQL Editor Component Pattern
```jsx
// Source: /Users/jhogan/flinkenstein/frontend/src/components/SqlEditor.jsx
import Editor from '@monaco-editor/react';

function SqlEditor({ sql, onChange }) {
  return (
    <Editor
      height="300px"
      language="sql"
      theme="vs-dark"
      value={sql}
      onChange={onChange}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        wordWrap: 'on',
      }}
    />
  );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `claude-3-5-sonnet-20241022` | `claude-sonnet-4-6` | 2025-2026 | Old model deprecated; new model has 1M context window (vs 200k) — full schema dump even more feasible |
| Provider picker (Gemini/OpenAI/Claude) | Claude only, hardcoded | Design decision | Simpler code, no multi-provider abstraction needed, key stays server-side |
| RAG + vector search for schema context | Full schema dump in system prompt | Phase 2 decision | At 10-15 topics, full dump is simpler and more accurate; RAG deferred |
| `format` / `avro-confluent.url` property keys | `value.format` / `value.avro-confluent.url` | Flink connector update | Old format keys are deprecated in newer Flink Kafka connector versions; use `value.format` prefix |
| Per-topic SQL generation context | Multi-topic context for JOIN support | Phase 2 design | Required for cross-topic queries like "customer return rates by product" |

**Deprecated/outdated patterns from reference flinkenstein:**
- `claude-3-5-sonnet-20241022`: deprecated, retire before June 15, 2026
- Passing API key from React frontend: security risk — move to server-side env var
- `global.lastSqlContext` and `global.lastErrorHistory`: module-level globals are fragile; replace with session-scoped state
- `'format' = 'avro-confluent'` property key: prefer `'value.format' = 'avro-confluent'` in newer connector versions

---

## Open Questions

1. **Does `dt-sql-parser` handle Confluent Platform-specific DDL extensions?**
   - What we know: `dt-sql-parser` uses ANTLR4 Flink SQL grammar; covers core Flink SQL including CREATE TABLE WITH, INSERT INTO, window functions
   - What's unclear: Whether it handles Confluent-specific connector properties (it should — those are string literals in WITH clauses, not grammar constructs)
   - Recommendation: Test with the `retail.orders` source table DDL including Confluent Kafka connector properties before committing to this library. If it fails on WITH-block property validation (it shouldn't — WITH values are opaque string literals in the grammar), fall back to LLM-only validation.

2. **Watermark semantics: syntax vs runtime validation**
   - What we know: `dt-sql-parser` validates grammar; it will accept a WATERMARK clause even if the column referenced doesn't exist in the field list
   - What's unclear: Whether cross-field references in WATERMARK FOR clauses are caught by the parser or only at Flink runtime
   - Recommendation: Add a catalog check rule specifically for WATERMARK: the field in `WATERMARK FOR <field>` must exist in the CREATE TABLE field list. This is a cheap regex check, not a parser requirement.

3. **Mock row generation quality vs performance tradeoff**
   - What we know: LLM-generated mock rows are the primary approach; a second Claude call adds ~1-2s latency
   - What's unclear: Whether combining SQL generation + mock row generation in a single prompt produces sufficient quality (fewer tokens but more complex prompt)
   - Recommendation: Implement as a single combined prompt (SQL + mock rows in one JSON response). If quality is insufficient, split into two sequential calls.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Backend runtime | Yes | v24.5.0 | — |
| Docker | Confluent Platform stack | Yes | 29.2.1 | — |
| ANTHROPIC_API_KEY | Claude API calls | Not set in shell | — | Set in backend `.env` before Phase 2 tasks run |
| Schema Registry (localhost:8081) | Schema fetching | Not currently running | — | Starts with Phase 1 Docker Compose |
| Confluent Platform (Control Center) | Background | Running at localhost:9021 | — | — |
| `dt-sql-parser` npm package | Flink SQL validation | Available on npm | 4.4.2 | None — this is the recommended library |
| `@anthropic-ai/sdk` npm package | Claude API | Available on npm | 0.89.0 | — |
| `@monaco-editor/react` npm package | SQL editor | Available on npm | 4.7.0 | — |

**Missing dependencies with no fallback:**
- `ANTHROPIC_API_KEY`: must be set in backend `.env` — blocks all LLM functionality. Wave 0 task: add `.env.example` with `ANTHROPIC_API_KEY=` placeholder.

**Missing dependencies with fallback:**
- Schema Registry: will be up when Phase 1 Docker Compose is running. Phase 2 can develop with a mocked `getAllSchemas()` response.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — Wave 0 must establish |
| Config file | None — see Wave 0 |
| Quick run command | `npm test` (to be configured) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| — | Schema dump builds correct system prompt block from Avro schemas | unit | `npm test -- tests/llmService.test.js` | No — Wave 0 |
| — | `dt-sql-parser` FlinkSQL.validate() returns errors for invalid SQL | unit | `npm test -- tests/sqlValidationService.test.js` | No — Wave 0 |
| — | Catalog check identifies unknown field names | unit | `npm test -- tests/sqlValidationService.test.js` | No — Wave 0 |
| — | 3-retry self-correction loop terminates within 3 attempts | unit | `npm test -- tests/llmService.test.js` | No — Wave 0 |
| — | Traffic light status maps correctly: green/yellow/red | unit | `npm test -- tests/sqlValidationService.test.js` | No — Wave 0 |
| — | `POST /api/query` returns SQL + mockRows + validationStatus | integration | `npm test -- tests/api.test.js` | No — Wave 0 |
| — | Canonical query "customer return rates by product for last 3 weeks" generates parseable Flink SQL | integration | `npm test -- tests/canonical.test.js` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/sqlValidationService.test.js` (unit tests only, no API key needed)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `backend/tests/sqlValidationService.test.js` — dt-sql-parser integration, catalog check, traffic light mapping
- [ ] `backend/tests/llmService.test.js` — system prompt builder, retry loop (mock Claude responses)
- [ ] `backend/tests/api.test.js` — POST /api/query integration test (mock Claude)
- [ ] `backend/tests/canonical.test.js` — end-to-end canonical query test (requires ANTHROPIC_API_KEY, mark as integration)
- [ ] `backend/package.json` test script — configure `jest` or `vitest` for Node.js backend
- [ ] `backend/.env.example` — `ANTHROPIC_API_KEY=` placeholder

---

## Project Constraints (from CLAUDE.md)

The project's `CLAUDE.md` specifies:
- **Architecture:** Event-driven pattern
- **Test coverage:** 80% target
- **Stack continuity:** Node.js + Express backend, React + Vite + Tailwind frontend (established in Phase 1)
- **Reference implementation:** `/Users/jhogan/flinkenstein/` — reference for patterns, not wholesale copy

Global `CLAUDE.md` applies:
- Confluent CP Flink SQL dialect (not CC-specific DDL)
- `acks=all`, `enable.idempotence=true` on producers (Phase 1 concern)
- `BOUNDED_OUT_OF_ORDERNESS` watermark strategy in generated SQL
- `UPSERT-KAFKA` for aggregation sink tables (when output is changelog)
- `scan.startup.mode = 'earliest-offset'` default in generated DDL

---

## Sources

### Primary (HIGH confidence)
- `/Users/jhogan/flinkenstein/backend/src/services/llmService.js` — reference implementation patterns for schema validation, multi-topic context, retry loop
- `/Users/jhogan/flinkenstein/backend/src/services/enhancedLlmService.js` — Claude API integration pattern
- `/Users/jhogan/flinkenstein/frontend/src/components/SqlEditor.jsx` — Monaco editor integration
- `npm view dt-sql-parser` (verified 2026-04-15) — package exists, v4.4.2, includes Flink SQL support
- `npm view @anthropic-ai/sdk` (verified 2026-04-15) — v0.89.0 current
- `npm view @monaco-editor/react` (verified 2026-04-15) — v4.7.0 current
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) — confirmed `claude-sonnet-4-6` is current non-deprecated model

### Secondary (MEDIUM confidence)
- [dt-sql-parser GitHub README](https://github.com/DTStack/dt-sql-parser) — API documentation for FlinkSQL.validate() and splitSQLByStatement()
- [Flink SQL Gateway REST API](https://rmoff.net/2024/03/12/exploring-the-flink-sql-gateway-rest-api/) — confirmed no dry-run endpoint exists; validates locked decision to use local parser instead
- Research report (`research/report.md`) — NL-to-Flink-SQL architecture patterns, schema-grounded agent pattern

### Tertiary (LOW confidence, for awareness only)
- [Anthropic structured outputs beta](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — available but requires beta header; standard JSON-in-text approach (as in flinkenstein) is simpler for Phase 2 MVP

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified via `npm view` on 2026-04-15; reference implementation provides proven patterns
- Architecture: HIGH — directly derived from working reference code; locked decisions align with what flinkenstein proved out
- Pitfalls: HIGH — every pitfall listed is a documented failure mode from the reference flinkenstein codebase, not speculation

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (npm packages stable; Claude model IDs change infrequently but verify before implementation)
