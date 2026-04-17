---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Executing Phase 03
last_updated: "2026-04-17T12:13:32.561Z"
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 9
  completed_plans: 8
---

# Project State

## Current Focus

Phase 3: SQL Push-Live + Resultant Topic Appearance (Plan 03-04 complete — 03-05 E2E checkpoint remains)

## Progress

- Phase 1: Context gathered, ready for planning
- Phase 2: Complete — Plans 02-01, 02-02, 02-03, and 02-04 all complete; human-verified end-to-end UX approved
- Phase 3: In progress — Plans 03-01 (infra/producers), 03-02 (backend services), 03-03 (API routes), and 03-04 (frontend Push Live) complete; 03-05 (E2E human-verify) remains

## Decisions Made

- Use claude-sonnet-4-6 (not deprecated claude-3-5-sonnet-20241022)
- ANTHROPIC_API_KEY from process.env only — never from client
- Single combined Claude prompt returns sql+outputSchema+mockRows+reasoning in one JSON
- JSON fence fallback parsing: direct parse -> json fence -> plain fence -> first { } object
- In-memory sessions Map with 1-hour TTL for conversational follow-ups
- Shared mockMessagesCreate pattern in tests for reliable Anthropic SDK call tracking
- babel-jest transform for dt-sql-parser ESM deps (antlr4-c3, antlr4ng) to run in jest CJS environment
- extractTableNamesFromSQL() pre-pass before field extraction prevents false unknown-field errors
- Traffic light red only on hasUnknownFields (not all catalog issues) — type warnings yield green not red
- Express app factory pattern (app.js separate from index.js) for supertest testability
- Tailwind v4 CSS-first config — @import tailwindcss in index.css + @tailwindcss/vite plugin (no tailwind.config.js)
- Frontend bootstrapped as React 19 + Vite 8 (latest create-vite defaults)
- TopicBrowserPlaceholder in App.jsx holds wiring point for Phase 1 UI when built
- [Phase 03]: INSERT streaming jobs treat RUNNING as success (not FINISHED) — Flink streaming INSERT stays RUNNING permanently, this is correct behavior (RESEARCH Pitfall 1)
- [Phase 03]: Per-request KafkaJS consumers with unique bof-tail-{topic}-{timestamp} groupId prevent Kafka group offset pollution across polls
- [Phase 03]: flinkService session caching: probe GET /v1/sessions/:id, recreate on 404 — stable across Flink 1.x and 2.x
- [Phase 03]: Multi-stage Dockerfile.flink: alpine/curl stage to download JARs into cp-flink RHEL minimal image (no wget/curl in base)
- [Phase 03]: Kafka connector 4.0.1-2.0 for Flink 2.x (no 2.1-specific version; 4.0.x targets Flink 2.x family)
- [Phase 03]: POST /api/query/deploy returns immediately with state=Submitting; async deployJob updates flink_jobs Map — frontend polls GET /api/jobs/:id
- [Phase 03]: isDerived: topic.startsWith('derived.') added to GET /api/schemas response per D-309
- [Phase 03]: useJobPolling wired at QueryBuilder level for Push Live button gating; DeploymentStatusPanel error classification uses keyword heuristics on error string; schema auto-refresh fires 3s after Running transition

## Session Log

- 2026-04-13: Phase 1 context gathered via discuss-phase
- 2026-04-16: Phase 2 Plan 02-01 executed — SQL validation service, Schema Registry bulk fetch, Jest infrastructure (106 tests passing)
- 2026-04-16: Phase 2 Plan 02-02 executed — LLM service, system prompt, few-shot examples, mock data service (80 tests passing)
- 2026-04-16: Phase 2 Plan 02-03 executed — Express API routes (POST /api/query, /api/query/refine, /api/query/validate, GET /api/schemas), React frontend (QueryBuilder, SqlEditor, SampleOutput, ValidationIndicator), 131 backend tests passing, frontend build clean
- 2026-04-16: Phase 2 Plan 02-04 Task 1 executed — canonical integration test (backend/tests/canonical.test.js, commit 3a4c2f8). Paused at human-verify checkpoint.
- 2026-04-16: Phase 2 Plan 02-04 Task 2 complete — human-verify checkpoint passed (user: "approved"). Phase 2 complete.
- 2026-04-17: Phase 3 Plan 03-01 executed — Docker Compose stack (8 services: broker, schema-registry, jobmanager, taskmanager, sql-gateway, 3 producers), custom Flink Dockerfile (multi-stage alpine/curl → cp-flink), 6 Avro schemas, 3 continuous producers (retail/fsi/fraud). kafkajs@2.2.4 added to backend. 164 backend tests passing.
- 2026-04-17: Phase 3 Plan 03-02 executed — flinkService.js (SQL Gateway REST client, session caching, DDL/DML submission, job tracking) and kafkaConsumerService.js (per-request KafkaJS consumer, sinceOffset, nextOffset), 33 new unit tests, 164 backend tests passing total.
- 2026-04-17: Phase 3 Plan 03-03 executed — 4 new API routes (POST /api/query/deploy, GET /api/jobs/:id, DELETE /api/jobs/:id, GET /api/topics/:topic/messages) wired to flinkService/kafkaConsumerService; isDerived flag added to GET /api/schemas; 24 new route tests, 188 total tests passing.

## Blockers/Concerns

None

## Session Log (continued)

- 2026-04-17: Phase 3 Plan 03-04 executed — Push Live button, DeploymentStatusPanel (7-state job pill, live messages table, error areas, stop confirmation), useJobPolling (5s), useMessagePolling (2s, 30s timeout), derived topic badge in Schema Sidebar, schema auto-refresh on Running. Frontend builds cleanly (35 modules, 0 errors).

## Last Stopped At

Completed 03-04: Frontend Push Live flow — DeploymentStatusPanel, polling hooks, QueryBuilder extension. Frontend builds cleanly. Ready for 03-05 (E2E human-verify checkpoint).
