---
phase: 03-user-accepts-and-the-sql-query-is-pushed-live-and-the-resultant-kafka-topic-appears-with-real-messages
plan: "04"
subsystem: frontend
tags: [react, vite, tailwind, polling, deployment-status, push-live, flink]

requires:
  - phase: 03-03
    provides: POST /api/query/deploy, GET /api/jobs/:id, DELETE /api/jobs/:id, GET /api/topics/:topic/messages, GET /api/schemas with isDerived

provides:
  - Push Live button in QueryBuilder (enabled on green/yellow validation, Cmd+Shift+Enter shortcut)
  - DeploymentStatusPanel component with 7-state job pill, live messages table, error areas, stop confirmation
  - useJobPolling hook (polls GET /api/jobs/:id every 5s, stops on terminal states)
  - useMessagePolling hook (polls GET /api/topics/:topic/messages every 2s, incremental offsets, 30s timeout)
  - Derived topic badge (◆ derived) in Schema Sidebar for isDerived topics
  - Schema Sidebar auto-refresh when job reaches Running state

affects:
  - Any plan extending the frontend Push Live or deployment flow
  - 03-05 (E2E human-verify checkpoint)

tech-stack:
  added: []
  patterns:
    - Custom React polling hooks with interval cleanup and terminal state detection
    - useRef for mutable polling state (offsets, timers) to avoid unnecessary re-renders
    - useCallback + useEffect dependency arrays for stable polling loop lifecycle
    - Inline confirmation pattern (no modal) for destructive actions
    - Three-class error display: connectivity / submission / runtime

key-files:
  created:
    - frontend/src/hooks/useJobPolling.js
    - frontend/src/hooks/useMessagePolling.js
    - frontend/src/components/DeploymentStatusPanel.jsx
  modified:
    - frontend/src/components/QueryBuilder.jsx

key-decisions:
  - "useJobPolling wired at QueryBuilder level (not only inside DeploymentStatusPanel) to enable Push Live / Job Running button state gating without prop drilling"
  - "DeploymentStatusPanel uses its own internal useJobPolling instance; QueryBuilder uses a separate instance — both poll the same endpoint but the panel's instance drives the live display"
  - "Error classification in DeploymentStatusPanel: connectivity = 'unreachable'/'Gateway' in message; submission = Failed + parse/compile/syntax/sql keywords; runtime = Failed + everything else"
  - "Schema auto-refresh fires 3s after deploymentState transitions to Running — gives Flink time to register the output schema before re-fetching /api/schemas"

patterns-established:
  - "Pattern: useCallback-wrapped fetch inside useEffect with setInterval — stable polling loop that cleans up on unmount"
  - "Pattern: hasReceivedRef + startTimeRef for 30s no-messages timeout without polluting React state on every interval"
  - "Pattern: nextOffsetRef for incremental message fetching — ref (not state) avoids fetchMessages reference churn"

requirements-completed:
  - D-305
  - D-306
  - D-307
  - D-308
  - D-309
  - D-310
  - D-311
  - D-313

duration: 24min
completed: 2026-04-17
---

# Phase 03 Plan 04: Frontend Push Live Flow Summary

**Push Live button, DeploymentStatusPanel with 7-state job pill and live messages table, two custom polling hooks, derived topic badge, and schema auto-refresh — frontend builds cleanly, all Phase 3 UX requirements satisfied**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-04-17T11:48:12Z
- **Completed:** 2026-04-17T12:12:27Z
- **Tasks:** 2
- **Files modified:** 4 (2 created new, 2 modified)

## Accomplishments

- `useJobPolling`: polls `GET /api/jobs/:id` every 5s; stops on terminal states (Failed/Stopped); emits gateway-unreachable error message for connectivity errors; stable via `useCallback` + `useRef` interval management
- `useMessagePolling`: polls `GET /api/topics/:topic/messages` every 2s with incremental `nextOffset` tracking; accumulates newest-first up to 100 messages; 30s no-messages timeout triggers D-311 fallback state
- `DeploymentStatusPanel`: renders job state pill (Submitting/Compiling/Starting/Running/Streaming/Failed/Stopped with correct per-state Tailwind colors and animated pulse dots), live messages table (skeleton/live/no-messages states), three error classes (connectivity/submission/runtime), Stop button with inline confirmation ("Stop this job?" → "Yes, stop" / "Cancel"), DELETE `/api/jobs/:id` on confirm
- `QueryBuilder` extended: Push Live button enabled on green/yellow validation, disabled on red/null or active job; `isDeploying` spinner + "Submitting..." state; `deploymentState` polled via useJobPolling to show "Job Running" when active; Cmd+Shift+Enter keyboard shortcut (⌘⇧↵ hint displayed); DeploymentStatusPanel rendered below SqlEditor with all callbacks; schema auto-refresh 3s after Running transition; derived topic badge (◆ derived) on `isDerived: true` topics in Schema Sidebar with accessible aria-label
- Frontend Vite build: 35 modules, 0 errors, 227KB bundle

## Task Commits

1. **Task 1: Polling hooks** - `b5e885f` (feat)
2. **Task 2: DeploymentStatusPanel + QueryBuilder extension** - `3a0fc97` (feat)

## Files Created/Modified

- `frontend/src/hooks/useJobPolling.js` — Custom hook: 5s polling, terminal state stop, connectivity error message, `refresh` callback exposed for manual refetch
- `frontend/src/hooks/useMessagePolling.js` — Custom hook: 2s polling, incremental offset tracking, 30s no-messages timeout (D-311), newest-first accumulation, resets on topic change
- `frontend/src/components/DeploymentStatusPanel.jsx` — New component: STATE_STYLES map, LiveMessagesTable sub-component, error classification logic, Stop confirmation flow, DELETE /api/jobs/:id integration
- `frontend/src/components/QueryBuilder.jsx` — Extended: Push Live button + disabled states, useJobPolling for deploymentState, handlePushLive with POST /api/query/deploy, DeploymentStatusPanel render, schema auto-refresh effect, isDerived badge in SchemaSidebar

## Decisions Made

- `useJobPolling` wired at QueryBuilder level (not only inside DeploymentStatusPanel) to enable button state gating — avoids prop drilling deploymentState up from the panel
- Error classification in DeploymentStatusPanel is heuristic-based (keyword matching on error string) — sufficient for Phase 3 MVP; exact backend error codes could tighten this in a future phase
- Schema auto-refresh delay is 3s (not on-demand or at every poll) — avoids hammering /api/schemas while Flink completes topic registration

## Deviations from Plan

None — plan executed exactly as written. The `useJobPolling` dual-instance pattern (one in QueryBuilder, one inside DeploymentStatusPanel) is an implementation detail derived from the plan's guidance to "lift" job state to QueryBuilder level; both instances poll the same endpoint and are independent.

## Known Stubs

None. All data flows are wired to live API endpoints. No hardcoded mock data, placeholder text, or empty arrays flow to the UI.

## Self-Check: PASSED

- FOUND: frontend/src/hooks/useJobPolling.js
- FOUND: frontend/src/hooks/useMessagePolling.js
- FOUND: frontend/src/components/DeploymentStatusPanel.jsx
- FOUND: frontend/src/components/QueryBuilder.jsx (modified)
- FOUND commits: b5e885f (feat Task 1), 3a0fc97 (feat Task 2)
- Frontend build: ✓ built in 61ms, 35 modules, 0 errors

---
*Phase: 03-user-accepts-and-the-sql-query-is-pushed-live-and-the-resultant-kafka-topic-appears-with-real-messages*
*Completed: 2026-04-17*
