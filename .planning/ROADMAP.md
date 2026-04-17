# Roadmap

## Phase 1: Cluster is set up and producers hydrate the topics and user can see the data and its schema
- **Goal**: Cluster is set up and producers hydrate the topics and user can see the data and its schema
- **Deliverables**: TBD (refine during planning)
- **Acceptance criteria**: TBD
- **Status**: Pending

## Phase 2: user can enter an NLP and the model turns that into a SQL query which is validated and a sample/expected message appears
- **Goal**: NLP-to-Flink-SQL pipeline where users enter natural language, the system generates validated Flink SQL with schema-grounded context, and presents editable SQL with sample output before pushing live
- **Plans:** 4/4 plans executed
- **Acceptance criteria**: Canonical query "customer return rates by product for the last three weeks" produces valid Flink SQL referencing correct topics/fields; SQL editor is editable with traffic-light validation; sample output shows mock rows; conversational follow-ups work
- **Status**: Complete

Plans:
- [x] 02-01-PLAN.md -- SQL validation service (dt-sql-parser + catalog check) + test infrastructure + Schema Registry bulk fetch
- [x] 02-02-PLAN.md -- LLM service (Claude API, system prompt, few-shot examples, 3-retry self-correction) + mock data service
- [x] 02-03-PLAN.md -- API routes (POST /api/query, /api/query/refine, GET /api/schemas) + frontend query builder (Monaco editor, schema sidebar, sample output, validation indicator)
- [x] 02-04-PLAN.md -- Canonical integration test + end-to-end human verification checkpoint (approved)

## Phase 3: user accepts and the sql query is pushed live and the resultant kafka topic appears with real messages
- **Goal**: Complete push-live pipeline — user accepts generated Flink SQL, system submits it to a local Confluent Platform Flink cluster via SQL Gateway REST API, tracks job lifecycle, and surfaces the resultant Kafka topic with live messages in the UI alongside source topics
- **Plans:** 3/5 plans executed
- **Acceptance criteria**: Push Live button deploys Flink SQL job via SQL Gateway; Deployment Status panel shows live state transitions; derived output topic appears in Schema Sidebar with badge; live messages poll into the panel; Stop button halts the job cleanly; Docker Compose stack runs Kafka + Schema Registry + Flink + producers
- **Status**: Planned

Plans:
- [x] 03-01-PLAN.md -- Docker Compose infrastructure (cp-kafka, cp-schema-registry, cp-flink, sql-gateway) + Avro schemas + 3 data producers (retail, FSI, fraud) + kafkajs install
- [x] 03-02-PLAN.md -- Backend services: flinkService.js (SQL Gateway REST client, session management, DDL/DML submission, job tracking) + kafkaConsumerService.js (per-request message tailing)
- [x] 03-03-PLAN.md -- Backend API routes: POST /api/query/deploy, GET /api/jobs/:id, DELETE /api/jobs/:id, GET /api/topics/:topic/messages + extend GET /api/schemas with isDerived flag
- [x] 03-04-PLAN.md -- Frontend: Push Live button, DeploymentStatusPanel (state pill, live messages table, error areas, stop confirmation), polling hooks, derived topic badge in Schema Sidebar
- [ ] 03-05-PLAN.md -- Guarded Flink integration test + end-to-end human verification checkpoint
