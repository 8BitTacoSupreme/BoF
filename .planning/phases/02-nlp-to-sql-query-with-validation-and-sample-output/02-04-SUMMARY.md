---
phase: 02-nlp-to-sql-query-with-validation-and-sample-output
plan: "04"
subsystem: testing
tags: [jest, integration-test, canonical-query, nlp-to-sql, flink-sql, anthropic, self-correction]

# Dependency graph
requires:
  - "02-01-PLAN.md (sqlValidationService, schemaRegistryService)"
  - "02-02-PLAN.md (llmService with generateWithSelfCorrection, mockDataService)"
  - "02-03-PLAN.md (API routes, QueryBuilder frontend)"
provides:
  - "backend/tests/canonical.test.js — integration test exercising full NLP-to-SQL pipeline with real Claude API call"
  - "Human-verified end-to-end UX: NLP input -> SQL generation -> validation traffic light -> sample output -> refinement"
affects:
  - "Phase 3 (Flink job submission can rely on validated pipeline)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "describeIfApiKey pattern: skip integration tests when ANTHROPIC_API_KEY not set, never fail"
    - "MOCK_SCHEMAS inline definition for integration tests: portable, no Schema Registry dependency"

key-files:
  created:
    - "backend/tests/canonical.test.js"
  modified: []

key-decisions:
  - "Integration test skips gracefully when ANTHROPIC_API_KEY is absent (describe.skip) — CI runs safely without credentials"
  - "Canonical query test asserts both topic references (retail.orders AND retail.returns) and structural SQL (CREATE TABLE, INSERT INTO) — not just non-empty output"
  - "Human-verify checkpoint is blocking: Phase 2 closes only on explicit human approval of the full UX flow"

requirements-completed: []

# Metrics
duration: ~10 min (Task 1 ~5 min automated, Task 2 human review)
completed: 2026-04-16
---

# Phase 2 Plan 04: Integration Test + End-to-End Verification Summary

**Canonical integration test for NLP-to-SQL pipeline (retail.orders + retail.returns JOIN with 3-week window) plus human-verified end-to-end UX approval — Phase 2 complete.**

## Performance

- **Duration:** ~10 min total (Task 1: ~5 min automated; Task 2: human review)
- **Started:** 2026-04-16T11:58:08Z
- **Completed:** 2026-04-16 (human approval received)
- **Tasks:** 2 (1 auto, 1 checkpoint:human-verify)
- **Files created/modified:** 1

## Accomplishments

**Task 1 — Canonical Integration Test**
- `backend/tests/canonical.test.js` created (93 lines)
- Two integration tests under `describeIfApiKey` guard:
  1. **Canonical query test**: `"customer return rates by product for the last three weeks"` — asserts `result.sql` references `retail.orders` and `retail.returns`, contains `CREATE TABLE` and `INSERT INTO`, returns `outputSchema` array, `mockRows` array, and `validation.status` in `[green, yellow, red]`
  2. **Simple filter test**: `"show me all cancelled orders"` — asserts SQL references cancelled, then cross-checks with `validateFlinkSql()` to surface any syntax errors to console
- `MOCK_SCHEMAS` inline: retail.orders (6 fields), retail.returns (5 fields), retail.products (4 fields) — portable, no live Schema Registry needed
- Skips entire suite gracefully if `ANTHROPIC_API_KEY` is absent; never counts as a failure in CI

**Task 2 — Human Verification (Checkpoint)**
- User performed end-to-end UX verification of the full NLP-to-SQL pipeline
- Verified: schema sidebar, canonical query generation, Monaco SQL editor with syntax highlighting, traffic light (green/yellow), sample output table, conversational follow-up, re-validate flow, error handling
- User response: **"approved"**
- Phase 2 closes on this approval

## What Phase 2 Delivers (Plans 01-04)

| Plan | Delivered |
|------|-----------|
| 02-01 | dt-sql-parser SQL validation (`validateFlinkSql`), field catalog check (`catalogCheck`), Schema Registry bulk fetch (`getAllSchemas`), babel-jest ESM transform, 106 tests |
| 02-02 | `generateWithSelfCorrection` (3-retry Claude loop), system prompt with schema injection, few-shot Flink SQL examples, `mockDataService`, 80 tests |
| 02-03 | Express API (POST /api/query, /api/query/refine, /api/query/validate, GET /api/schemas), React frontend (QueryBuilder, SqlEditor, SampleOutput, ValidationIndicator), 131 tests total, Vite build clean |
| 02-04 | Canonical integration test, human-verified E2E UX — Phase 2 complete |

## Task Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Canonical integration test (backend/tests/canonical.test.js) | 3a4c2f8 |
| 2 | Human-verify checkpoint — user approved | (no code change) |

## Files Created/Modified

- `backend/tests/canonical.test.js` — Integration test for canonical NLP query through full pipeline; skips without ANTHROPIC_API_KEY

## Decisions Made

- **Integration test skips without API key:** Using `describe.skip` when `ANTHROPIC_API_KEY` is absent keeps CI green without real credentials. Operators with the key can run it as a smoke test.
- **Assertions check structure, not content:** Regex matches on topic names and SQL keywords rather than exact SQL text — model output varies slightly, structural correctness is what matters.
- **Phase 2 closes on human approval:** The checkpoint is the only mechanism that proves the full UX path works. Automation alone cannot substitute for seeing the Monaco editor render with syntax highlighting and the traffic light respond correctly.

## Deviations from Plan

None — plan executed exactly as written. Task 1 produced the canonical test file as specified; Task 2 checkpoint received human approval on the first pass.

## Issues Encountered

None.

## User Setup Required

None — canonical.test.js requires `ANTHROPIC_API_KEY` to run live but skips safely without it. No new external configuration added in this plan.

## Known Stubs

None introduced in this plan. See 02-03-SUMMARY.md for the pre-existing `TopicBrowserPlaceholder` stub in App.jsx (intentional, Phase 1 frontend not yet built).

## Next Phase Readiness

Phase 2 is complete. The full NLP-to-SQL pipeline is validated:
- SQL validation service (syntax + catalog)
- LLM self-correction loop (up to 3 retries, Claude claude-sonnet-4-6)
- API routes wiring all services
- React frontend delivering the full UX
- Canonical integration test covering the end-to-end path

Phase 3 can build on these foundations to add Flink job submission: taking the validated SQL output from `POST /api/query` and pushing it live to a Confluent Cloud Flink compute pool. The `POST /api/query` response shape (sql, outputSchema, mockRows, validation, reasoning) is the Phase 3 input contract.

## Self-Check: PASSED

- backend/tests/canonical.test.js: FOUND
- Commit 3a4c2f8 (Task 1 — canonical integration test): FOUND
- Commit 31e0b47 (chore: STATE.md paused at checkpoint): FOUND
- Human approval received: "approved"

---
*Phase: 02-nlp-to-sql-query-with-validation-and-sample-output*
*Completed: 2026-04-16*
