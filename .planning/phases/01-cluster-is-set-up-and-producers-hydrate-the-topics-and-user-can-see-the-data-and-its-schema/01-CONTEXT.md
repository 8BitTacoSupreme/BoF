# Phase 1: Cluster Setup + Data Hydration + Topic Viewer - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Stand up a local Confluent Platform streaming environment (Kafka, Schema Registry, Flink) via Docker Compose, populate it with realistic multi-domain sample data via continuous producers, and deliver a web UI where users can browse topics, inspect Avro schemas, and view live messages. This is the data foundation that Phases 2 (NLP→SQL) and 3 (live deployment) build on.

</domain>

<decisions>
## Implementation Decisions

### Target Platform
- **D-01:** Local Docker Compose with Confluent Platform containers (cp-kafka, cp-schema-registry, cp-flink). Not self-managed Apache OSS.
- **D-02:** Confluent Cloud support is a future concern — build for local now, refactor when CC migration happens. No abstraction layer needed yet.
- **D-03:** CP containers chosen for closer SQL dialect parity with CC Flink, easing eventual migration.

### Sample Data Domain
- **D-04:** All three business domains: retail, FSI (financial services), and fraud detection. Full coverage from the original flinkenstein.
- **D-05:** Continuous streaming producers — run indefinitely, emitting events at a configurable rate. No batch-seed-and-stop mode needed for Phase 1.
- **D-06:** Realistic data with cross-topic referential integrity. Orders reference real product IDs, returns reference real order IDs, fraud flags reference real transaction IDs. This enables meaningful JOINs in Phase 2.
- **D-07:** All topics use Avro schemas registered in Schema Registry with TopicNameStrategy and BACKWARD compatibility.

### Topic Viewer UI
- **D-08:** Sidebar + detail panel layout. Topic list in left sidebar, clicking a topic shows schema + messages in main panel. Standard data explorer pattern.
- **D-09:** Schema displayed as a field table (field name, type, nullable, description). No raw Avro IDL view needed.
- **D-10:** Messages displayed with both a scrolling table view (columns mapped to schema fields) and a raw JSON view, with a toggle to switch between them. Table view is the default.
- **D-11:** Real-time message streaming via WebSocket. Messages push to the UI live as they arrive.

### Tech Stack
- **D-12:** Node.js + Express backend (carry forward from flinkenstein pattern).
- **D-13:** React + Vite + Tailwind CSS frontend (carry forward from flinkenstein pattern).
- **D-14:** Fresh build in bride_of_flinkenstein — reference flinkenstein for patterns and domain logic but do not copy code wholesale. Clean architecture from the start.

### Claude's Discretion
- Exact topic names and partition counts per domain
- Producer event rates and data generation logic details
- WebSocket implementation approach (ws, socket.io, etc.)
- UI component library choice (shadcn/ui, headless UI, custom, etc.)
- Loading states, error handling, and empty states in the UI
- Docker Compose service configuration details

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Original flinkenstein (reference implementation)
- `/Users/jhogan/flinkenstein/README.md` — Full feature description, RAG knowledge base design, continuous learning system architecture
- `/Users/jhogan/flinkenstein/backend/src/` — Node.js/Express backend patterns, Kafka/SR service integration
- `/Users/jhogan/flinkenstein/frontend/src/` — React/Vite/Tailwind frontend, topic browsing components
- `/Users/jhogan/flinkenstein/infrastructure/docker-compose.yml` — Docker Compose configuration for self-managed Flink stack

### Research artifacts
- `research/report.md` — Comprehensive research on NL→Flink SQL architecture, Confluent Cloud vs self-managed, multi-agent pipeline design, Schema Registry best practices
- `research/strategy.md` — Strategic pressure test with risk analysis and milestone feasibility assessment
- `research/brief.md` — Research brief covering topics from Confluent canon to NLP approaches

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **flinkenstein backend** (`/Users/jhogan/flinkenstein/backend/src/`): Node.js/Express patterns for Kafka AdminClient, Schema Registry REST API integration, WebSocket message streaming. Reference for service architecture, not direct copy.
- **flinkenstein frontend** (`/Users/jhogan/flinkenstein/frontend/src/`): React components for topic browsing, message display, Flink SQL editing. Reference for UI patterns and domain-specific component design.
- **flinkenstein infrastructure** (`/Users/jhogan/flinkenstein/infrastructure/docker-compose.yml`): Docker Compose config for Kafka, Flink, Schema Registry. Needs to be adapted from Apache OSS to Confluent Platform containers.
- **flinkenstein producers**: Multi-domain data generators (retail, FSI, fraud) with cross-topic relationships. Domain logic and schema designs can be referenced.

### Established Patterns
- Express route structure with service layer separation
- React SPA with Vite build tooling and Tailwind utility classes
- KafkaJS for Node.js Kafka integration
- Qdrant for RAG knowledge base (Phase 2 concern, not Phase 1)

### Integration Points
- Docker Compose orchestrates all services (Kafka, SR, Flink, backend, frontend)
- Backend serves as API gateway between frontend and Kafka/SR
- WebSocket channel from backend to frontend for live message streaming
- Schema Registry REST API for schema introspection

</code_context>

<specifics>
## Specific Ideas

- Evolution of the flinkenstein project — same vision, cleaner implementation, targeting Confluent Platform for CC dialect parity
- The "customer return rates by product for the last three weeks" example from PROJECT.md must be supportable with the retail domain topics created in this phase
- Cross-topic referential integrity is essential — the NLP→SQL pipeline in Phase 2 needs JOINs to produce meaningful results

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-cluster-is-set-up-and-producers-hydrate-the-topics-and-user-can-see-the-data-and-its-schema*
*Context gathered: 2026-04-13*
