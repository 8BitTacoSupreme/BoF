---
phase: 02-nlp-to-sql-query-with-validation-and-sample-output
plan: "03"
subsystem: api-and-frontend
tags: [express, react, vite, tailwind, monaco-editor, api-routes, query-builder, validation-indicator, sample-output]

# Dependency graph
requires:
  - "02-01-PLAN.md (sqlValidationService, schemaRegistryService)"
  - "02-02-PLAN.md (llmService, mockDataService)"
provides:
  - "POST /api/query — NLP submission with LLM self-correction and session storage"
  - "POST /api/query/refine — conversational follow-up using session context"
  - "POST /api/query/validate — re-validate manually edited SQL"
  - "GET /api/schemas — schema listing with Avro union type normalisation"
  - "Express app factory (app.js) with CORS/JSON middleware"
  - "ValidationIndicator — green/yellow/red traffic light component with aria-label"
  - "SqlEditor — Monaco editor (language=sql, theme=vs-dark) with re-validate button"
  - "SampleOutput — table/JSON toggle view for mock rows"
  - "QueryBuilder — NLP textarea, example prompts, collapsible schema sidebar, history"
  - "App.jsx — two-tab nav (Topics | Query Builder)"
affects:
  - "02-04 (Flink job submission will build on these API routes and frontend components)"

# Tech tracking
tech-stack:
  added:
    - "express (API framework)"
    - "cors (CORS middleware)"
    - "supertest (HTTP integration testing)"
    - "@monaco-editor/react@4.7.0 (Monaco SQL editor component)"
    - "@tailwindcss/vite (Tailwind v4 Vite plugin)"
    - "react@19 + react-dom@19 (frontend framework)"
    - "vite@8 (build tool)"
  patterns:
    - "Express app factory pattern (app.js separated from index.js for testability)"
    - "supertest integration tests with fully mocked service dependencies"
    - "Tailwind v4 CSS-first config (no tailwind.config.js — @import tailwindcss)"
    - "Vite /api proxy to backend for development"
    - "crypto.randomUUID() for client-side session ID generation"
    - "localStorage persistence for query history"

key-files:
  created:
    - "backend/src/app.js"
    - "backend/src/routes/api.js"
    - "backend/index.js"
    - "backend/tests/api.test.js"
    - "frontend/ (full Vite + React scaffold)"
    - "frontend/src/components/ValidationIndicator.jsx"
    - "frontend/src/components/SqlEditor.jsx"
    - "frontend/src/components/SampleOutput.jsx"
    - "frontend/src/components/QueryBuilder.jsx"
    - "frontend/src/App.jsx"
    - "frontend/vite.config.js"
  modified:
    - "backend/package.json (added express, cors, supertest)"
    - "frontend/package.json (added @monaco-editor/react, @tailwindcss/vite)"
    - "frontend/src/index.css (replaced with Tailwind v4 @import)"

key-decisions:
  - "Express app factory pattern: app.js exports the Express app; index.js starts the HTTP server. This lets supertest import the app without binding a port."
  - "Tailwind v4 CSS-first config: no tailwind.config.js needed — @import 'tailwindcss' in index.css + @tailwindcss/vite plugin handles everything."
  - "Frontend bootstrapped as React 19 Vite project (latest defaults from create-vite) rather than copying older package.json structure."
  - "QueryBuilder uses React 19 / crypto.randomUUID() for session IDs (available in all modern browsers without polyfill)."

requirements-completed: []

# Metrics
duration: "~5 minutes"
completed: 2026-04-16
---

# Phase 2 Plan 03: API Routes + Frontend Query Builder Summary

Express API endpoints wiring the LLM pipeline to HTTP, plus complete React frontend: NLP input with example prompts and history, collapsible schema sidebar, Monaco SQL editor with re-validate button, green/yellow/red traffic light, and table/JSON sample output.

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-16T11:50:02Z
- **Completed:** 2026-04-16T11:55:02Z
- **Tasks:** 2
- **Files created/modified:** ~24

## Accomplishments

**Task 1 — API Routes**
- `app.js`: Express factory with CORS + JSON middleware, global error handler
- `routes/api.js`: 4 endpoints wired to llmService + schemaRegistryService + sqlValidationService + mockDataService
- `index.js`: HTTP server entry point (port 3001)
- `tests/api.test.js`: 25-test supertest suite covering all routes, all error paths, session storage, mock row fallback, Avro union type normalisation — all pass

**Task 2 — Frontend**
- `ValidationIndicator`: 12px traffic light circle (green/yellow/red/gray) with `aria-label` for accessibility
- `SqlEditor`: Monaco editor (language=sql, theme=vs-dark, wordWrap=on, minimap=off) + Re-validate button + ValidationIndicator
- `SampleOutput`: Table/JSON toggle — table default with schema-driven column headers, JSON pre block, reasoning italic above table, empty state
- `QueryBuilder`: Full Phase 2 UI — NLP textarea (Cmd/Ctrl+Enter submit), 4 clickable example prompts, schema sidebar (collapsible, per-topic expand/collapse), session via crypto.randomUUID(), localStorage history (max 10), error display with retry, refinement mode (POST /api/query/refine after first result)
- `App.jsx`: Two-tab nav (Topics placeholder | Query Builder) with Phase 1 topic browser wiring point ready

## Task Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | POST /api/query, /api/query/refine, /api/query/validate, GET /api/schemas + 25 tests | f1ab777 |
| 2 | Frontend scaffold + ValidationIndicator + SqlEditor + SampleOutput + QueryBuilder + App | 15a7f9d |

## Verification

```
backend  — npx jest tests/api.test.js: 25/25 PASS
backend  — npx jest: 131/131 PASS (all suites)
frontend — npx vite build: exit 0 (32 modules, no errors)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tailwind v4 does not use tailwind.config.js or `npx tailwindcss init`**
- **Found during:** Task 2 (installing Tailwind)
- **Issue:** The plan specifies `npm install tailwindcss postcss autoprefixer` and `npx tailwindcss init -p`. Tailwind v4 (installed by default in the generated project) replaced the config-file approach entirely. `npx tailwindcss init` fails with "could not determine executable to run" because there is no init command in v4.
- **Fix:** Installed `@tailwindcss/vite` plugin; added it to `vite.config.js`; replaced all CSS in `index.css` with `@import "tailwindcss"`. No `tailwind.config.js` needed.
- **Files modified:** frontend/vite.config.js, frontend/src/index.css, frontend/package.json
- **Commit:** 15a7f9d

**2. [Rule 3 - Blocking] Phase 1 frontend does not exist (prerequisite not met)**
- **Found during:** Task 2 (attempting to read frontend/src/App.jsx)
- **Issue:** Plan prerequisite states "Phase 1 frontend must exist (React + Vite + Tailwind app with sidebar layout)". Phase 1 was never built. No `frontend/` directory existed.
- **Fix:** Bootstrapped fresh React + Vite project via `npm create vite@latest frontend -- --template react`, then built the Phase 2 UI on top of it. App.jsx includes a `TopicBrowserPlaceholder` that provides a wiring point for Phase 1 UI when it's built.
- **Files created:** entire `frontend/` directory
- **Commit:** 15a7f9d

**3. [Rule 3 - Blocking] Backend had no Express server — only service-layer files**
- **Found during:** Task 1 (attempting to read backend/src/routes/api.js)
- **Issue:** No Express server existed in `backend/`. No `express` package, no `app.js`, no `index.js`, no routes directory.
- **Fix:** Installed `express` and `cors`; created `app.js` factory, `index.js` server entry, and `src/routes/` directory.
- **Files created:** backend/src/app.js, backend/index.js, backend/src/routes/api.js
- **Commit:** f1ab777

## Known Stubs

**TopicBrowserPlaceholder in App.jsx** — Phase 1 "Topics" tab renders a placeholder with text "Phase 1 infrastructure — coming soon." and a button to switch to Query Builder. This is intentional: Phase 1 frontend was never built. The wiring point is in place for a future phase to fill in.

The QueryBuilder itself has no stubs — all functionality is wired: API calls to `/api/query`, `/api/query/refine`, `/api/query/validate`, `/api/schemas` are implemented, schema sidebar loads real data, Monaco editor renders SQL, ValidationIndicator reflects real validation status, SampleOutput renders real mock rows.

## Self-Check: PASSED

- backend/src/app.js: FOUND
- backend/src/routes/api.js: FOUND
- backend/index.js: FOUND
- backend/tests/api.test.js: FOUND
- frontend/src/components/ValidationIndicator.jsx: FOUND
- frontend/src/components/SqlEditor.jsx: FOUND
- frontend/src/components/SampleOutput.jsx: FOUND
- frontend/src/components/QueryBuilder.jsx: FOUND
- frontend/src/App.jsx: FOUND
- frontend/vite.config.js: FOUND
- Commit f1ab777 (Task 1): FOUND
- Commit 15a7f9d (Task 2): FOUND
- Backend tests: 131/131 PASS
- Frontend build: exit 0

---
*Phase: 02-nlp-to-sql-query-with-validation-and-sample-output*
*Completed: 2026-04-16*
