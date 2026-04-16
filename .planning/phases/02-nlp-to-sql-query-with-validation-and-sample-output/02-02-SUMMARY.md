---
phase: 02-nlp-to-sql-query-with-validation-and-sample-output
plan: "02"
subsystem: llm-pipeline
tags: [llm, claude, anthropic, system-prompt, few-shot, self-correction, mock-data, flink-sql]
dependency_graph:
  requires: [02-01-PLAN.md]
  provides: [llmService.js, systemPrompt.js, fewShotExamples.js, mockDataService.js]
  affects: [02-03-PLAN.md, 02-04-PLAN.md]
tech_stack:
  added: ["@anthropic-ai/sdk@0.89.0"]
  patterns: [few-shot prompting, self-correction loop, server-side retry, schema-grounded prompting, markdown table schema serialization, JSON response parsing with fence fallback]
key_files:
  created:
    - backend/src/prompts/fewShotExamples.js
    - backend/src/prompts/systemPrompt.js
    - backend/src/services/llmService.js
    - backend/src/services/mockDataService.js
    - backend/tests/systemPrompt.test.js
    - backend/tests/llmService.test.js
    - backend/tests/mockDataService.test.js
  modified:
    - backend/package.json
    - backend/package-lock.json
decisions:
  - "Use claude-sonnet-4-6 (not deprecated claude-3-5-sonnet-20241022)"
  - "API key from process.env.ANTHROPIC_API_KEY only — never from client"
  - "Single combined prompt returns sql+outputSchema+mockRows+reasoning in one JSON"
  - "JSON fence fallback parsing: direct parse -> json fence -> plain fence -> first { } object"
  - "In-memory sessions Map with 1-hour TTL for conversational follow-ups"
  - "Shared mockMessagesCreate pattern in tests to reliably track Anthropic SDK calls across instances"
metrics:
  duration: "7 minutes 16 seconds"
  completed: "2026-04-16T02:44:07Z"
  tasks_completed: 2
  files_created: 7
  tests_added: 80
---

# Phase 2 Plan 2: LLM Service + System Prompt + Mock Data Service Summary

Claude API integration with 3-retry self-correction loop using claude-sonnet-4-6, schema-grounded system prompt with 4 canonical Flink SQL few-shot examples, and mock data service with type-aware fallback generation.

## Tasks Completed

| Task | Description | Commit | Tests |
|------|-------------|--------|-------|
| 1 | System prompt builder with schema context and few-shot examples | 3e3886b | 39 |
| 2 (RED) | Failing tests for LLM service and mock data service | c5dc0a8 | 0 (RED) |
| 2 (GREEN) | LLM service, mock data service implementations | 2b37e74 | 41 |

**Total: 80 tests passing across 3 test suites**

## What Was Built

### `backend/src/prompts/fewShotExamples.js`

Two exported constants:

- `FLINK_SQL_RULES`: 10-rule block enforcing Confluent Platform Flink SQL dialect — reserved word backtick quoting, TRY_CAST for STRING fields, TO_TIMESTAMP_LTZ for BIGINT timestamps, value.format/value.avro-confluent.url connector properties, earliest-offset startup mode, properties.group.id consumer group.

- `FEW_SHOT_EXAMPLES`: 4 canonical examples covering window aggregation (TUMBLE), cross-topic JOIN, time filter, and non-windowed GROUP BY aggregation. All examples use correct Confluent Platform dialect.

### `backend/src/prompts/systemPrompt.js`

- `buildSchemaBlock(schemas)`: Converts `{ topicName: avroSchemaObject | null }` to markdown tables per topic. Handles Avro union types `["null", "string"]` → STRING with Nullable=YES. Skips null/missing schemas.

- `buildSystemPrompt(schemas)`: Assembles complete system prompt: role definition + schema block + FLINK_SQL_RULES + FEW_SHOT_EXAMPLES + JSON response format. Instructs Claude to respond with ONLY a JSON object (no markdown fencing).

### `backend/src/services/llmService.js`

- `callClaude(systemPrompt, messages)`: Raw Anthropic API call. Model: `claude-sonnet-4-6`. max_tokens: 4096. API key from `process.env.ANTHROPIC_API_KEY` only.

- `parseJsonResponse(text)`: Extracts JSON from Claude's response with 4-strategy fallback: direct parse → ```json fence → ``` plain fence → first `{...}` object in text.

- `generateFlinkSQL(nlQuery, schemas, messageHistory)`: Builds system prompt, constructs message array (appends to history for conversational follow-ups), calls Claude, parses response. Returns `{ sql, outputSchema, mockRows, reasoning, rawResponse }`.

- `generateWithSelfCorrection(nlQuery, schemas, messageHistory, maxRetries=3)`: Server-side 3-retry loop. On red validation: builds `buildCorrectionPrompt` message, appends to conversation, retries. On green/yellow: returns immediately with attempt count. After maxRetries: returns with `status: 'red', attempts: N, errors: [...]`.

- `buildCorrectionPrompt(sql, errors)`: Formats validation errors (both `{message}` objects and plain strings) into a correction prompt that includes the original SQL.

- `sessions` Map + `cleanupSessions()`: In-memory conversation history with 1-hour TTL.

### `backend/src/services/mockDataService.js`

- `parseMockRows(llmResponse)`: Safe extraction of `mockRows` array from Claude response. Returns `[]` for null/undefined input, non-object input, missing `mockRows`, and non-array `mockRows`.

- `generateFallbackMockRows(outputSchema, count=5)`: Type-aware placeholder rows — STRING→`"sample_N"`, BIGINT/INT→`1000+N`, DECIMAL→`(99.99+N).toFixed(2)`, TIMESTAMP→ISO string, BOOLEAN→`N%2===0`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test mock pattern for Anthropic SDK**
- **Found during:** Task 2 GREEN phase
- **Issue:** Original test used `const mockInstance = new Anthropic()` before and after `callClaude()` expecting the same mock instance's `messages.create` to be called. Each `new Anthropic()` creates a new mock object, so `mockInstance.messages.create` had 0 calls.
- **Fix:** Lifted `mockCreate` to module scope as `const mockMessagesCreate = jest.fn()` so all `new Anthropic()` instances share the same `messages.create` spy.
- **Files modified:** `backend/tests/llmService.test.js`
- **Commit:** Part of 2b37e74

**2. [Rule 3 - Blocking] sqlValidationService.js stub created then replaced by plan 02-01**
- **Found during:** Task 2 GREEN phase
- **Issue:** `llmService.js` imports `validateAndClassify` from `sqlValidationService.js`, and Jest's `jest.mock` with a factory function requires the module file to exist for module resolution. Since plan 02-01 is running in parallel, the file didn't exist when needed.
- **Fix:** Created a minimal stub `sqlValidationService.js`. Plan 02-01 then replaced it with the full implementation (recognized by the system reminder). The stub was sufficient for the test suite since tests mock the module anyway.
- **Files modified:** `backend/src/services/sqlValidationService.js` (created as stub, then replaced by 02-01)
- **Commit:** Untracked (plan 02-01's responsibility to commit)

## Known Stubs

None — all exported functions are fully implemented and tested.

## Self-Check

### Files Exist
- [x] `backend/src/prompts/fewShotExamples.js` — exists
- [x] `backend/src/prompts/systemPrompt.js` — exists
- [x] `backend/src/services/llmService.js` — exists
- [x] `backend/src/services/mockDataService.js` — exists
- [x] `backend/tests/systemPrompt.test.js` — exists
- [x] `backend/tests/llmService.test.js` — exists
- [x] `backend/tests/mockDataService.test.js` — exists

### Commits Exist
- [x] 3e3886b — Task 1 (system prompt + few-shot examples + tests)
- [x] c5dc0a8 — Task 2 RED phase (failing tests)
- [x] 2b37e74 — Task 2 GREEN phase (implementations)

### Tests Pass
- [x] 80/80 tests pass across all 3 test suites

## Self-Check: PASSED
