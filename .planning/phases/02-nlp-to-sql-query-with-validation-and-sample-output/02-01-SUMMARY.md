---
phase: 02-nlp-to-sql-query-with-validation-and-sample-output
plan: 01
subsystem: testing
tags: [jest, dt-sql-parser, schema-registry, flink-sql, validation, axios, babel]

# Dependency graph
requires: []
provides:
  - "Flink SQL syntax validation via dt-sql-parser FlinkSQL.validate()"
  - "Catalog check: unknown field detection, STRING numeric cast warnings, BIGINT timestamp conversion warnings"
  - "Traffic-light classification: green/yellow/red based on validation results"
  - "Schema Registry REST client: getTopicSchema, getAllSubjects, getAllSchemas (parallel bulk fetch)"
  - "Jest 29 test infrastructure with babel-jest ESM transform for dt-sql-parser compatibility"
affects:
  - "02-02 (LLM SQL generation will pass output through validateAndClassify)"
  - "02-03 (query route will use schemaRegistryService.getAllSchemas for context)"
  - "02-04 (UI traffic light depends on green/yellow/red status from validateAndClassify)"

# Tech tracking
tech-stack:
  added:
    - "jest@29 (test runner)"
    - "babel-jest + @babel/core + @babel/preset-env (ESM-to-CJS transform for dt-sql-parser)"
    - "dt-sql-parser@4.4.2 (Flink SQL ANTLR4-based parser)"
    - "axios (Schema Registry REST client)"
  patterns:
    - "babel-jest transformIgnorePatterns to transform ESM-only node_modules for jest CJS compatibility"
    - "Singleton FlinkSQL parser instance (moderately expensive to construct)"
    - "extractTableNamesFromSQL() before field extraction to avoid table names being flagged as unknown fields"
    - "String concatenation instead of template literals for RegExp patterns containing backticks"

key-files:
  created:
    - "backend/src/services/sqlValidationService.js"
    - "backend/src/services/schemaRegistryService.js"
    - "backend/tests/sqlValidationService.test.js"
    - "backend/tests/schemaRegistryService.test.js"
    - "backend/jest.config.js"
    - "backend/babel.config.js"
    - "backend/.env.example"
    - "backend/.gitignore"
  modified:
    - "backend/package.json (added test/test:coverage scripts, jest/babel devDeps, axios)"

key-decisions:
  - "babel-jest transform used for dt-sql-parser and transitive ESM deps (antlr4-c3, antlr4ng) to run in jest CJS environment — avoids needing --experimental-vm-modules and maintains standard jest config"
  - "extractTableNamesFromSQL() pre-pass before field extraction prevents FROM/JOIN table names from being flagged as unknown fields in catalogCheck"
  - "Backtick-containing RegExp patterns built via string concatenation (not template literals) to avoid Node v24 template literal parsing ambiguity"
  - "BIGINT_TIMESTAMP_FIELDS catalog check uses predicate-context detection (WHERE/AND/OR) rather than any occurrence, reducing false positives"
  - "Traffic light red triggered by hasUnknownFields (not all catalogIssues) so type warnings alone yield green not red"

patterns-established:
  - "Validation pipeline: validateFlinkSql -> catalogCheck -> watermark check -> traffic light"
  - "Schema map shape: { topicName: { fields: [{name, type}] } } — consistent across validation and generation services"
  - "getAllSchemas parallel pattern: Promise.all with per-topic try/catch, null for 404"
  - "Jest test organization: describe blocks per function, integration-style tests with realistic Flink SQL"

requirements-completed: []

# Metrics
duration: 11min
completed: 2026-04-16
---

# Phase 2 Plan 01: SQL Validation Service + Test Infrastructure Summary

**Flink SQL deterministic validation gate using dt-sql-parser: syntax check, catalog field verification, and green/yellow/red traffic-light classification — plus Schema Registry bulk schema fetch with parallel Promise.all.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-16T02:37:15Z
- **Completed:** 2026-04-16T02:48:24Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- 17-test suite for sqlValidationService: syntax validation, multi-statement SQL, field extraction with alias stripping, catalog checks (unknown fields, STRING numeric warnings, BIGINT timestamp warnings), traffic-light classification (green/yellow/red)
- 9-test suite for schemaRegistryService: mocked axios, -value subject filtering, 404 null fallback, parallel fetch via Promise.all
- Resolved Node v24 + ESM compatibility for dt-sql-parser via babel-jest transform

## Task Commits

Each task was committed atomically:

1. **Task 1: Test infrastructure + SQL validation service** - `d52f202` (feat)
2. **Task 2: Enhance Schema Registry service with bulk schema fetch** - `ac4620e` (feat)

**Plan metadata:** (docs commit follows)

_Note: Task 1 followed TDD — tests written first (RED), then implementation (GREEN)._

## Files Created/Modified

- `backend/src/services/sqlValidationService.js` - validateFlinkSql, splitStatements, extractFieldsFromSQL, catalogCheck, validateAndClassify
- `backend/src/services/schemaRegistryService.js` - getTopicSchema, getAllSubjects, getAllSchemas
- `backend/tests/sqlValidationService.test.js` - 17 unit tests
- `backend/tests/schemaRegistryService.test.js` - 9 unit tests with mocked axios
- `backend/jest.config.js` - Jest 29 config with babel-jest ESM transform
- `backend/babel.config.js` - Babel preset-env targeting current Node
- `backend/.env.example` - ANTHROPIC_API_KEY + Phase 1 infrastructure vars
- `backend/.gitignore` - node_modules, .env, coverage/ excluded
- `backend/package.json` - test/test:coverage scripts, all dependencies

## Decisions Made

- Used `babel-jest` with `transformIgnorePatterns` to transform `dt-sql-parser`, `antlr4-c3`, `antlr4ng` from ESM to CJS for jest compatibility — cleaner than `--experimental-vm-modules` and stable on Node v24
- Pre-extract table names from FROM/JOIN clauses before field analysis — prevents false positives where table names appear as unknown fields
- Traffic light red only on `hasUnknownFields`, not on all catalog issues — type warnings (STRING numeric, BIGINT timestamp) produce warnings but don't block green classification unless fields are truly unknown

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ESM incompatibility: dt-sql-parser v4.4.2 uses directory imports not supported by Node v24**
- **Found during:** Task 1 (installing dt-sql-parser)
- **Issue:** dt-sql-parser and transitive deps (antlr4-c3, antlr4ng) use ESM `export { X } from './directory'` syntax. Node v24 ESM resolver does not support directory imports without explicit `index.js`. Both `require()` and dynamic `import()` failed.
- **Fix:** Configured babel-jest with `transformIgnorePatterns` to include dt-sql-parser, antlr4-c3, antlr4ng for CJS compilation; added `babel.config.js` with `@babel/preset-env` targeting current Node.
- **Files modified:** backend/jest.config.js, backend/babel.config.js, backend/package.json (devDeps)
- **Verification:** `npx jest tests/sqlValidationService.test.js` passes; FlinkSQL.validate() returns correct results
- **Committed in:** d52f202 (Task 1 commit)

**2. [Rule 1 - Bug] Template literal containing backtick lookahead caused SyntaxError in Babel parser**
- **Found during:** Task 1 (writing sqlValidationService.js)
- **Issue:** `new RegExp(\`...(?!\\`)\`)` — the `\\`` inside a template literal is parsed by Babel as: escaped backslash + template-closing backtick. Node v24 and Babel@7 both reject this pattern with "Unexpected string".
- **Fix:** Replaced the problematic template literal with string concatenation: `'(?!' + '\`' + ')'`. Also replaced template literals in the push call with regular string concatenation.
- **Files modified:** backend/src/services/sqlValidationService.js
- **Verification:** `node --check` passes; all tests pass
- **Committed in:** d52f202 (Task 1 commit)

**3. [Rule 1 - Bug] Table names in FROM/JOIN clause extracted as field names, causing false unknown-field errors**
- **Found during:** Task 1 (testing catalogCheck)
- **Issue:** `extractFieldsFromSQL('SELECT order_id FROM orders_source')` returned `['order_id', 'status', 'orders_source']`. `orders_source` is a table name, not a field — it caused false "Unknown field" errors in catalogCheck.
- **Fix:** Added `extractTableNamesFromSQL()` helper that collects table names and aliases from FROM/JOIN clauses. Field extraction now excludes these names.
- **Files modified:** backend/src/services/sqlValidationService.js
- **Verification:** catalogCheck returns no issues for `SELECT order_id FROM orders_source` when order_id is in schema
- **Committed in:** d52f202 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 3 blocking, 2 Rule 1 bugs)
**Impact on plan:** All three fixes were required for the implementation to function correctly. No scope creep — all fixes directly enable the plan's stated goals.

## Issues Encountered

- dt-sql-parser v4.4.2 has no published CJS build and uses extensionless directory imports incompatible with Node v24's ESM resolver — required babel-jest workaround. Documented for future reference if dt-sql-parser releases a proper CJS/dual build.
- Node v24 template literal parser is stricter about backtick escape sequences than documented — `\\`` inside template literals causes parse failures in both Node `--check` and Babel@7.

## User Setup Required

None - no external service configuration required. The `.env.example` documents what's needed but no manual step is gated on it for this plan.

## Known Stubs

None. Both services are fully implemented. schemaRegistryService will 404 on all topics until a running Schema Registry exists (Phase 1 infrastructure), but that is expected and handled gracefully by returning null.

## Next Phase Readiness

- sqlValidationService is the validation gate for Plan 02-02 (LLM SQL generation): call `validateAndClassify(generatedSql, schemas)` and retry if status is red
- schemaRegistryService.getAllSchemas() provides the schema context for the LLM system prompt in Plan 02-02
- Both services have full test coverage and stable APIs — downstream plans can depend on them without modification

## Self-Check: PASSED

- backend/src/services/sqlValidationService.js: FOUND
- backend/src/services/schemaRegistryService.js: FOUND
- backend/tests/sqlValidationService.test.js: FOUND
- backend/tests/schemaRegistryService.test.js: FOUND
- backend/jest.config.js: FOUND
- backend/.env.example: FOUND
- 02-01-SUMMARY.md: FOUND
- Commit d52f202 (Task 1): FOUND
- Commit ac4620e (Task 2): FOUND

---
*Phase: 02-nlp-to-sql-query-with-validation-and-sample-output*
*Completed: 2026-04-16*
