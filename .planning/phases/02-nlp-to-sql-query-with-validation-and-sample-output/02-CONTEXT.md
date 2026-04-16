# Phase 2: NLP to SQL Query with Validation and Sample Output - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver an NLP-to-Flink-SQL pipeline where users enter a natural language query (e.g., "show me customer return rates by product for the last three weeks"), the system infers which topics and fields to use, generates valid Flink SQL, validates it against the schema catalog, and presents a sample/expected output table — all before pushing live. This phase builds the intelligence layer on top of Phase 1's data foundation.

</domain>

<decisions>
## Implementation Decisions

### NLP Input Experience
- Free-form text box as primary input mechanism — natural language is the core value prop; no structured prompt builders
- Collapsible schema sidebar showing available topics and fields alongside the input — reduces hallucinated field names, aligns with schema-grounded agent pattern from research
- Recent query history persisted below input — cheap to build, high UX value for iteration
- Clickable example prompts for onboarding (e.g., "customer return rates by product for the last 3 weeks") — shows what's possible

### LLM & SQL Generation Pipeline
- Claude API (Anthropic) as the LLM provider — already in the Anthropic ecosystem, strong code/SQL generation, tool use for schema introspection
- Full schema dump in system prompt — topic count is bounded (~10-15 topics), Avro schemas are compact; simpler than RAG with no drift risk
- Few-shot with Flink SQL examples + chain-of-thought prompting — 3-5 canonical query patterns (window aggregation, JOIN, filter) as examples; model reasons about which topics/fields to use
- Target Confluent Platform Flink SQL dialect — matches Phase 1 local CP environment; CC-specific features (INFORMATION_SCHEMA, auto-watermarks) noted for future migration

### SQL Validation & Sample Output
- Flink SQL parser validation + catalog check — parse SQL for syntax correctness, validate table/field names against Schema Registry schemas; no actual Flink dry-run (too heavy)
- Generate mock rows from output schema inference — LLM infers output schema from the SQL, generates 5-10 realistic sample rows; fast, no Flink execution needed
- Editable SQL with syntax highlighting — user can tweak the generated SQL before accepting; supports power users and iteration
- Table view as default output format with JSON toggle available — consistent with Phase 1 message viewer (D-10)

### Error Handling & Refinement Flow
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Context (dependency)
- `.planning/phases/01-cluster-is-set-up-and-producers-hydrate-the-topics-and-user-can-see-the-data-and-its-schema/01-CONTEXT.md` — Tech stack decisions, topic/schema design, UI patterns

### Research artifacts
- `research/report.md` — NL-to-Flink-SQL architecture, schema-grounded LLM agent pattern, CC vs self-managed comparison, INFORMATION_SCHEMA usage
- `research/strategy.md` — Risk analysis and milestone feasibility
- `research/brief.md` — Research brief covering Confluent canon to NLP approaches

### Original flinkenstein (reference)
- `/Users/jhogan/flinkenstein/backend/src/` — Node.js/Express backend patterns, Kafka/SR service integration
- `/Users/jhogan/flinkenstein/frontend/src/` — React frontend, topic browsing and Flink SQL editing components

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 1 backend** (when built): Express API server with Kafka AdminClient, Schema Registry REST API integration, WebSocket streaming — the NLP pipeline will add routes to this server
- **Phase 1 frontend** (when built): React + Vite + Tailwind app with sidebar + detail panel layout, topic browsing, message display — the query builder will integrate as a new panel/view
- **flinkenstein reference** (`/Users/jhogan/flinkenstein/`): Prior implementation with Flink SQL editing, topic browsing, RAG knowledge base patterns — reference for SQL editor UX and backend service architecture

### Established Patterns
- Express route structure with service layer separation (from Phase 1 decisions)
- React SPA with Vite build tooling and Tailwind utility classes
- KafkaJS for Node.js Kafka integration
- Schema Registry REST API for schema introspection
- WebSocket for real-time data push to frontend

### Integration Points
- Backend: New `/api/query` routes for NLP submission, SQL generation, validation, sample output
- Frontend: New query builder panel integrated into existing sidebar + detail layout
- Schema Registry: Schema introspection feeds LLM context and validation
- Claude API: External dependency for NL-to-SQL generation (requires ANTHROPIC_API_KEY)

</code_context>

<specifics>
## Specific Ideas

- The canonical example from PROJECT.md — "customer return rates by product for the last three weeks" — must work end-to-end through this pipeline
- Schema-grounded agent pattern from research: LIST topics -> introspect schemas -> synthesize SQL -> validate -> surface sample output -> user confirms
- Cross-topic JOINs must be supported (Phase 1 D-06 ensures referential integrity across topics)
- SQL editor should feel like a first-class tool, not an afterthought — power users will edit SQL directly

</specifics>

<deferred>
## Deferred Ideas

- Confluent Cloud migration and INFORMATION_SCHEMA integration (future milestone)
- RAG knowledge base for query patterns (referenced in flinkenstein, not needed for Phase 2 MVP)
- ML_PREDICT / managed model inference in Flink SQL (CC-only feature)
- Query cost estimation before execution
- Saved query library (beyond recent history)

</deferred>

---

*Phase: 02-nlp-to-sql-query-with-validation-and-sample-output*
*Context gathered: 2026-04-15*
