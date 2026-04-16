# Project State

## Current Focus
Phase 2: NLP-to-SQL Query with Validation and Sample Output

## Progress
- Phase 1: Context gathered, ready for planning
- Phase 2: In progress — Plan 02 (LLM Service + System Prompt) complete
- Phase 3: Not started

## Decisions Made
- Use claude-sonnet-4-6 (not deprecated claude-3-5-sonnet-20241022)
- ANTHROPIC_API_KEY from process.env only — never from client
- Single combined Claude prompt returns sql+outputSchema+mockRows+reasoning in one JSON
- JSON fence fallback parsing: direct parse -> json fence -> plain fence -> first { } object
- In-memory sessions Map with 1-hour TTL for conversational follow-ups
- Shared mockMessagesCreate pattern in tests for reliable Anthropic SDK call tracking

## Session Log
- 2026-04-13: Phase 1 context gathered via discuss-phase
- 2026-04-16: Phase 2 Plan 02-02 executed — LLM service, system prompt, few-shot examples, mock data service (80 tests passing)

## Blockers/Concerns
None

## Last Stopped At
Completed phase 02, plan 02-02: LLM Service + System Prompt + Mock Data Service
