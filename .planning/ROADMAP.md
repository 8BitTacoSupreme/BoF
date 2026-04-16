# Roadmap

## Phase 1: Cluster is set up and producers hydrate the topics and user can see the data and its schema
- **Goal**: Cluster is set up and producers hydrate the topics and user can see the data and its schema
- **Deliverables**: TBD (refine during planning)
- **Acceptance criteria**: TBD
- **Status**: Pending

## Phase 2: user can enter an NLP and the model turns that into a SQL query which is validated and a sample/expected message appears
- **Goal**: NLP-to-Flink-SQL pipeline where users enter natural language, the system generates validated Flink SQL with schema-grounded context, and presents editable SQL with sample output before pushing live
- **Plans:** 2/4 plans executed
- **Acceptance criteria**: Canonical query "customer return rates by product for the last three weeks" produces valid Flink SQL referencing correct topics/fields; SQL editor is editable with traffic-light validation; sample output shows mock rows; conversational follow-ups work
- **Status**: Planned

Plans:
- [x] 02-01-PLAN.md -- SQL validation service (dt-sql-parser + catalog check) + test infrastructure + Schema Registry bulk fetch
- [x] 02-02-PLAN.md -- LLM service (Claude API, system prompt, few-shot examples, 3-retry self-correction) + mock data service
- [ ] 02-03-PLAN.md -- API routes (POST /api/query, /api/query/refine, GET /api/schemas) + frontend query builder (Monaco editor, schema sidebar, sample output, validation indicator)
- [ ] 02-04-PLAN.md -- Canonical integration test + end-to-end human verification checkpoint

## Phase 3: user accepts and the sql query is pushed live and the resultant kafka topic appears with real messages
- **Goal**: user accepts and the sql query is pushed live and the resultant kafka topic appears with real messages
- **Deliverables**: TBD (refine during planning)
- **Acceptance criteria**: TBD
- **Status**: Pending
