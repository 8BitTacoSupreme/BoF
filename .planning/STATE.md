# Project State

## Current Focus
Phase 2: NLP-to-SQL Query with Validation and Sample Output

## Progress
- Phase 1: Context gathered, ready for planning
- Phase 2: In progress — Plans 02-01, 02-02, and 02-03 complete
- Phase 3: Not started

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

## Session Log
- 2026-04-13: Phase 1 context gathered via discuss-phase
- 2026-04-16: Phase 2 Plan 02-01 executed — SQL validation service, Schema Registry bulk fetch, Jest infrastructure (106 tests passing)
- 2026-04-16: Phase 2 Plan 02-02 executed — LLM service, system prompt, few-shot examples, mock data service (80 tests passing)
- 2026-04-16: Phase 2 Plan 02-03 executed — Express API routes (POST /api/query, /api/query/refine, /api/query/validate, GET /api/schemas), React frontend (QueryBuilder, SqlEditor, SampleOutput, ValidationIndicator), 131 backend tests passing, frontend build clean

## Blockers/Concerns
None

## Last Stopped At
Completed phase 02, plan 02-03: API Routes + Frontend Query Builder with Monaco SQL Editor and Sample Output
