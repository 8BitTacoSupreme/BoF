# Phase 3: SQL Push-Live + Resultant Topic Appearance - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the final hop of the pipeline: after the user accepts the generated Flink SQL in the Query Builder (Phase 2 output), the system submits it to a running Flink cluster, tracks the job lifecycle, and surfaces the resultant Kafka topic and its live messages in the UI alongside the existing source topics. Because Phase 1 infrastructure was decided but never built, this phase also delivers the local Confluent Platform Docker Compose stack (Kafka + Schema Registry + cp-flink + sample-data producers) that the whole application depends on.

</domain>

<decisions>
## Implementation Decisions

### Flink Execution Target (Infrastructure)
- **D-301:** Local Confluent Platform Docker Compose (cp-kafka, cp-schema-registry, cp-flink) is the Flink runtime. Matches Phase 1 D-01/D-03; preserves CC SQL dialect parity for future migration.
- **D-302:** Phase 3 delivers `docker-compose.yml` and the producer services (retail, FSI, fraud domains) as part of its own scope. Phase 1 was discussed but never executed — without this, "push live" has no target.
- **D-303:** Flink SQL is submitted via the **Flink SQL Gateway REST API** (port 8083) — `/v1/sessions`, `/v1/sessions/:sid/statements`, `/v1/sessions/:sid/operations/:oid/result`. Native CP pattern; async statement lifecycle.
- **D-304:** Running statements are tracked in an in-memory `flink_jobs` Map keyed by jobId → `{ statementId, sessionHandle, state, outputTopic, createdAt }`. No persistent registry; documented limitation that state is lost on backend restart (Flink jobs themselves continue running — SQL Gateway is source of truth).

### Accept Flow UX (Interaction)
- **D-305:** A **"Push Live" primary button** appears in the Query Builder, enabled only when validation status is green or yellow (disabled on red). Single click, no modal confirmation. Keyboard shortcut: Cmd+Shift+Enter.
- **D-306:** On click, a compact **Deployment Status panel** opens below the SQL editor showing live states: Submitting → Compiling → Starting → Running → Streaming. The Query Builder inputs remain visible so the user can iterate while a job runs.
- **D-307:** Output topic name comes from the LLM-generated `CREATE TABLE ... WITH (topic='...')` clause, defaulting to `derived.{semantic_name}` (e.g., `derived.customer_return_rates`). The name is editable in the Monaco editor before clicking Push Live — the Push Live action re-parses the current editor contents to extract the topic.
- **D-308:** Once deployed, the **"Push Live" button becomes a "Stop" button**. Stop halts the Flink statement via SQL Gateway but preserves the output topic and its data (no topic deletion). A lightweight inline confirmation ("Stop this job?") precedes the actual stop call.

### Topic Appearance & Live Message Display (Visual)
- **D-309:** The new derived topic appears in the **existing Schema Sidebar** (the collapsible list users already see in Query Builder), with a **"◆ derived" badge** distinguishing it from source topics. Sidebar auto-refreshes after deploy by re-calling `/api/schemas` (existing endpoint — extend to include derived topics).
- **D-310:** Real messages flow into a **live message panel inside the Deployment Status panel** via short-interval polling (`GET /api/topics/:topic/messages?limit=10&since={offset_or_ts}` every 2s). Backend maintains a per-session KafkaJS consumer on the output topic. No full WebSocket infrastructure in this phase — polling is sufficient for MVP.
- **D-311:** If no messages arrive within 30s, the panel shows a non-blocking "No messages yet — job is running but no matching source events. [Check Job Status]" state. No auto-fail. User can inspect the Flink job status or keep waiting.
- **D-312:** Output Schema Registry registration happens **automatically via Flink** — the LLM already emits `value.format='avro-confluent'` + `value.avro-confluent.url` in the generated CREATE TABLE WITH clause (Phase 2 few-shot patterns). Backend confirms registration by polling `GET /subjects/{topic}-value` post-deploy.

### Error Handling & Observability (Execution)
- **D-313:** Three error classes surfaced distinctly in the Deployment Status panel:
  - **Submission errors** (SQL Gateway 400 — compile/parse failures): show the gateway's error text + "Edit SQL" action returning focus to Monaco editor.
  - **Runtime errors** (job transitions to FAILED): show state + Flink exception summary + "Retry" action.
  - **Connectivity errors** (Gateway unreachable): show + "Retry in 5s" with automatic retry countdown.
- **D-314:** Backend polls SQL Gateway job status every 5s for active session jobs and exposes `GET /api/jobs/:id`. Frontend polls that endpoint only while the Deployment Status panel is open — polling stops when the panel closes or the user navigates away.
- **D-315:** Testing stack: unit tests for the Flink submission service with axios-mocked SQL Gateway responses; integration test against a running local cp-flink container (require-env guard pattern, analogous to `canonical.test.js` with `ANTHROPIC_API_KEY`); human-verified E2E checkpoint that exercises the canonical query end-to-end.
- **D-316:** Backend restart during a running job: in-memory `flink_jobs` Map is lost — accepted Phase 3 MVP limitation. Running Flink jobs continue independently; user will not see them in Deployment Status after restart but the derived topic remains visible in the Schema Sidebar. Documented in the phase summary.

### Claude's Discretion
- Exact Flink SQL Gateway session lifecycle (per-session vs shared long-lived session)
- Poll-interval backoff strategy (fixed 2s/5s vs adaptive)
- KafkaJS consumer groupId / clientId convention for message tailing consumers
- Error message formatting and copy in the Deployment Status panel
- Internal state machine representation for job states
- Docker Compose service versions, resource limits, and health-check configuration
- Producer event rates and per-topic partition counts
- Whether to reuse the Phase 2 `sessions` Map or introduce a dedicated `deployments` Map
- Deployment Status panel exact layout (inline vs collapsible section)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 2 artifacts (direct dependency)
- `.planning/phases/02-nlp-to-sql-query-with-validation-and-sample-output/02-CONTEXT.md` — NLP input UX, LLM pipeline, SQL editor decisions
- `.planning/phases/02-nlp-to-sql-query-with-validation-and-sample-output/02-VERIFICATION.md` — What ships; artifacts in place to extend
- `backend/src/routes/api.js` — Existing routes to extend with `/api/query/deploy`, `/api/jobs/:id`, `/api/topics/:topic/messages`
- `backend/src/services/llmService.js` — Existing `sessions` Map pattern to mirror for `flink_jobs`
- `backend/src/prompts/fewShotExamples.js` — LLM already emits `value.avro-confluent` — Phase 3 depends on this
- `frontend/src/components/QueryBuilder.jsx` — Integration point for Push Live button and Deployment Status panel
- `frontend/src/components/SqlEditor.jsx` — Source of the accepted SQL text

### Phase 1 context (infrastructure baseline — never implemented)
- `.planning/phases/01-cluster-is-set-up-and-producers-hydrate-the-topics-and-user-can-see-the-data-and-its-schema/01-CONTEXT.md` — Phase 1 D-01 through D-14; Phase 3 inherits the tech stack + domain decisions

### Flinkenstein reference (prior implementation)
- `/Users/jhogan/flinkenstein/infrastructure/docker-compose.yml` — Reference Docker Compose layout (adapt from Apache OSS → Confluent Platform)
- `/Users/jhogan/flinkenstein/backend/` — Reference backend patterns; do not copy wholesale

### Research
- `research/report.md` — NL→Flink SQL pipeline architecture
- `research/strategy.md` — Risk analysis + Phase 3 feasibility

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `backend/src/routes/api.js` (205 lines) — Express router; add `/api/query/deploy`, `/api/jobs/:id`, `/api/topics/:topic/messages` here
- `backend/src/services/llmService.js` (318 lines) — Pattern for service with in-memory `sessions` Map; mirror for `flink_jobs` and `deployments`
- `backend/src/services/schemaRegistryService.js` (98 lines) — axios-based REST client with container/host hostname resolution; extend to include derived topics in `getAllSubjects` filter
- `backend/src/services/sqlValidationService.js` (345 lines) — Already extracts topic names from CREATE TABLE statements via `extractTableNamesFromSQL`; reuse to extract output topic from editor contents before submit
- `frontend/src/components/QueryBuilder.jsx` (400 lines) — Host for Push Live button; has result state already
- `frontend/src/components/SqlEditor.jsx` (66 lines) — Monaco editor; provides current SQL text to Push Live handler
- `frontend/src/components/ValidationIndicator.jsx` (47 lines) — Traffic light that gates Push Live enablement
- `backend/tests/canonical.test.js` — require-env guard pattern (`describeIfApiKey`) — mirror for Flink integration test (`describeIfFlinkGateway`)

### Established Patterns
- Express route handlers with thin controller + service layer
- In-memory Map for session state (sessions Map in llmService) with lastAccess timestamps
- axios + container/host hostname resolution (schemaRegistryService pattern)
- Jest with babel-jest ESM transform (jest.config.js transformIgnorePatterns)
- supertest for API route tests
- Module-level exports as factories (`app.js` separate from `index.js`) for testability

### Integration Points
- Backend: New `flinkService.js` (SQL Gateway REST client), `kafkaConsumerService.js` (per-topic tail consumers), new routes in `api.js`
- Frontend: New `DeploymentStatusPanel.jsx` component rendered below SqlEditor in QueryBuilder; new hooks for polling `/api/jobs/:id` and `/api/topics/:topic/messages`
- Infrastructure: New top-level `infrastructure/docker-compose.yml`, `infrastructure/producers/` (retail, FSI, fraud generators), `infrastructure/schemas/` (Avro .avsc files)
- Schema Registry: Extend `/api/schemas` to surface derived topics with `isDerived: true` flag for sidebar badge

</code_context>

<specifics>
## Specific Ideas

- The canonical example "customer return rates by product for the last three weeks" must deploy end-to-end: Push Live → Flink job RUNNING → derived topic `derived.customer_return_rates` appears in sidebar with ◆ badge → live messages flow into the Deployment Status panel
- Cross-topic JOIN (retail.orders + retail.returns) continues to work in Phase 3 — producers must maintain referential integrity (carry forward D-06 from Phase 1)
- The Query Builder stays the single pane of glass — derived topics appear in its sidebar, deployment status sits in its main panel. No full-app navigation redesign in Phase 3
- SQL Gateway session management: a single long-lived "default" session per backend process is simpler than per-deployment sessions and matches how Flink SQL Client works interactively

</specifics>

<deferred>
## Deferred Ideas

- Full Topic Browser view (completing `TopicBrowserPlaceholder`) — separate concern, not needed for Phase 3 goal
- Persistent job registry via Kafka control topic — Phase 3 explicitly accepts in-memory limitation (D-316)
- WebSocket-based message streaming — polling is sufficient for MVP; future enhancement
- Confluent Cloud migration and CC Flink statements API — remains future concern (Phase 1 D-02 posture held)
- Saved deployment library / deployment history UI — beyond MVP scope
- Multi-user / multi-tenant job isolation — single-user local dev is the current target
- Flink job autoscaling / resource tuning UI
- Automated testcontainers-node integration tests in CI — out of scope; human-verified E2E is the acceptance bar

</deferred>

---

*Phase: 03-user-accepts-and-the-sql-query-is-pushed-live-and-the-resultant-kafka-topic-appears-with-real-messages*
*Context gathered: 2026-04-16*
