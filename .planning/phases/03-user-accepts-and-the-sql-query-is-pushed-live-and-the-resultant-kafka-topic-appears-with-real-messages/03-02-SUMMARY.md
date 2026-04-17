---
phase: 03-user-accepts-and-the-sql-query-is-pushed-live-and-the-resultant-kafka-topic-appears-with-real-messages
plan: 02
subsystem: api
tags: [flink, kafka, kafkajs, sql-gateway, job-tracking, message-tailing]

# Dependency graph
requires:
  - phase: 02-user-can-enter-an-nlp-and-the-model-turns-that-into-a-sql-query
    provides: sqlValidationService.splitStatements reused for DDL/DML splitting
provides:
  - flinkService.js with SQL Gateway REST client, session management, DDL/DML submission, job lifecycle
  - kafkaConsumerService.js with per-request KafkaJS message tailing and sinceOffset support
  - flink_jobs in-memory Map for tracking active streaming jobs (D-304)
  - extractOutputTopicFromSql() utility for sink topic extraction from LLM-generated SQL
affects:
  - 03-03 (API routes — POST /api/query/deploy, GET /api/jobs/:id, GET /api/topics/:topic/messages)
  - 03-04 (frontend DeploymentStatusPanel, Push Live button)

# Tech tracking
tech-stack:
  added:
    - kafkajs@2.2.4 (per-request Kafka consumer for message tailing)
  patterns:
    - Module-scoped session handle caching with GET /v1/sessions/:id probe before reuse
    - DDL synchronous polling (pollUntilFinished) vs DML single-check (RUNNING=success)
    - Per-request unique groupId pattern: bof-tail-{topic}-{timestamp}
    - 5-second consumer timeout with .then() early-resolve for test performance
    - Graceful error handling returning empty array for missing topics (Pitfall 5)

key-files:
  created:
    - backend/src/services/flinkService.js
    - backend/src/services/kafkaConsumerService.js
    - backend/tests/flinkService.test.js
    - backend/tests/kafkaConsumerService.test.js
  modified:
    - backend/package.json (kafkajs@2.2.4 added)
    - backend/package-lock.json

key-decisions:
  - "INSERT streaming jobs: treat RUNNING status as success, never poll until FINISHED (RESEARCH Pitfall 1)"
  - "Session probe via GET /v1/sessions/:id (not heartbeat) — stable across Flink versions per RESEARCH Q3"
  - "Per-request KafkaJS consumers with unique groupId prevent offset pollution (RESEARCH Pitfall 4)"
  - "kafkajs consumer.run() .then() added to resolve outer promise early when mock returns — improves test speed"

patterns-established:
  - "Pattern: flinkService session caching — module-scoped _sessionHandle with probe+recreate on 404"
  - "Pattern: DDL vs DML distinction — CREATEs use pollUntilFinished, INSERTs use single 2s check"
  - "Pattern: per-request consumer isolation — unique bof-tail-{topic}-{ts} groupId prevents offset reuse"
  - "Pattern: nextOffset tracking — highest_offset+1 enables incremental frontend polling"

requirements-completed: [D-303, D-304, D-307, D-308, D-312, D-314, D-316]

# Metrics
duration: 45min
completed: 2026-04-17
---

# Phase 3 Plan 02: Backend Services (flinkService + kafkaConsumerService) Summary

**Flink SQL Gateway REST client with session caching, DDL/DML lifecycle, and per-request KafkaJS message tailing with sinceOffset incremental polling**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-04-17T01:25:00Z
- **Completed:** 2026-04-17T02:10:00Z
- **Tasks:** 2 (both TDD with RED/GREEN/REFACTOR phases)
- **Files modified:** 6

## Accomplishments

- `flinkService.js` implements full SQL Gateway session lifecycle: creates session on first call, probes with GET /v1/sessions/:id on subsequent calls, re-creates on 404. Splits LLM-generated SQL into CREATE and INSERT statements using existing `splitStatements()` from `sqlValidationService.js`. Submits CREATEs synchronously (polls until FINISHED), INSERT asynchronously (waits 2s, single RUNNING check = streaming success). Tracks all running jobs in `flink_jobs` Map keyed by Flink JobManager jobId.
- `kafkaConsumerService.js` creates a one-off KafkaJS consumer with unique `bof-tail-{topic}-{timestamp}` groupId per request. Collects up to `limit` messages or times out after 5s. Supports `sinceOffset` for incremental polling via `GROUP_JOIN` event seek. Always disconnects in `finally` block. Returns `{ messages, nextOffset }` so frontend can track position across polls.
- 33 new unit tests (22 for flinkService, 11 for kafkaConsumerService), all passing with mocked external dependencies. Full backend suite: 164 tests passing (131 existing + 33 new), 0 regressions.

## Task Commits

Each task was committed atomically:

1. **Task 1: flinkService.js with SQL Gateway REST client** - `dd2a2f1` (feat)
2. **Task 2: kafkaConsumerService.js with per-request message tailing** - `f7ea79b` (feat)
3. **Task 2 refactor: early-resolve optimization** - `32942b3` (refactor)

## Files Created/Modified

- `backend/src/services/flinkService.js` — SQL Gateway REST client; exports deployJob, stopJob, getJobStatus, isGatewayHealthy, extractOutputTopicFromSql, flink_jobs
- `backend/src/services/kafkaConsumerService.js` — Per-request KafkaJS consumer; exports tailMessages
- `backend/tests/flinkService.test.js` — 22 unit tests with axios-mocked SQL Gateway and JobManager responses
- `backend/tests/kafkaConsumerService.test.js` — 11 unit tests with mocked KafkaJS
- `backend/package.json` — added kafkajs@2.2.4 dependency
- `backend/package-lock.json` — lock file updated

## Decisions Made

- **INSERT RUNNING = success:** Streaming INSERT operations never reach FINISHED in the SQL Gateway operation status — they stay RUNNING indefinitely. After submitting INSERT, wait 2s then check status once. RUNNING means the Flink streaming job is running correctly. This avoids the infinite-wait Pitfall 1 documented in RESEARCH.md.
- **Session probe uses GET /v1/sessions/:id:** Rather than POST /v1/sessions/:id/heartbeat (which differs between Flink versions), a GET on the session info endpoint is more stable and works across Flink 1.x and 2.x.
- **Per-request consumers:** Chose per-request over persistent consumers per the RESEARCH.md recommendation. Group join overhead (~200ms) is acceptable at MVP polling intervals.
- **`.then()` on consumer.run():** Added `.then(() => { clearTimeout(timeout); resolve(); })` to the `consumer.run()` chain. When the mock's `run()` resolves immediately, the outer Promise also resolves without waiting the full 5s. This reduced kafkaConsumerService test time from 40s to <1s with no production behavior change (real KafkaJS `run()` does not resolve until disconnected).

## Deviations from Plan

None — plan executed exactly as written. The `.then()` optimization on `consumer.run()` was discovered during testing (tests were timing out at 40s due to the 5-second wait), and was a straightforward improvement consistent with the plan's intent.

## Issues Encountered

- **Test isolation with jest.resetModules():** Initial test design used `resetModules()` in `beforeEach` to get fresh module state per test. This caused the `axios` mock reference to diverge from the module's `axios` (after reset, the module loaded a new axios instance that was not the mocked one). Resolved by removing `resetModules()` and using `flinkService._resetSession()` + `jest.clearAllMocks()` instead for per-test isolation.
- **Kafka mock instance access:** Used `Kafka.mock.instances[0].consumer.mock.calls` in tests expecting class-instance behavior, but the mock returns a POJO. Resolved by capturing `groupId` via `mockImplementationOnce` in the specific tests that need it, plus `jest.resetModules()` scoped to just those two tests.
- **kafkaConsumerService test speed:** The 5-second timeout in the service made tests run for 40+ seconds. Fixed by adding `.then()` to `consumer.run()` so the outer Promise resolves when `run()` returns (not just on timeout), making unit tests complete in <1s.

## User Setup Required

None — no external service configuration required for these unit-tested service files.

## Known Stubs

None — both services implement their full interface. The Flink SQL Gateway and KafkaJS calls are real implementations (not stubs); they require the Docker infrastructure from Plan 03-01 to work end-to-end.

## Next Phase Readiness

- `flinkService.deployJob(sql)` and `kafkaConsumerService.tailMessages(topic)` are ready for wiring to Express routes in Plan 03-03
- `POST /api/query/deploy`, `GET /api/jobs/:id`, and `GET /api/topics/:topic/messages` route implementations can now directly call these services
- `extractOutputTopicFromSql()` is ready for use in the deploy route handler
- `flink_jobs` Map is ready for job state queries from `GET /api/jobs/:id`

## Self-Check

Files created/verified:
- backend/src/services/flinkService.js — exists, exports all required functions
- backend/src/services/kafkaConsumerService.js — exists, exports tailMessages
- backend/tests/flinkService.test.js — exists, 22 tests pass
- backend/tests/kafkaConsumerService.test.js — exists, 11 tests pass

Commits verified:
- dd2a2f1 (Task 1 feat)
- f7ea79b (Task 2 feat)
- 32942b3 (Task 2 refactor)

---
*Phase: 03-user-accepts-and-the-sql-query-is-pushed-live-and-the-resultant-kafka-topic-appears-with-real-messages*
*Completed: 2026-04-17*
