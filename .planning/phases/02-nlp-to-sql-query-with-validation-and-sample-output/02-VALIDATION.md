---
phase: 02
slug: nlp-to-sql-query-with-validation-and-sample-output
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x (backend) / vitest (frontend) |
| **Config file** | backend/jest.config.js / frontend/vite.config.ts |
| **Quick run command** | `cd backend && npx jest --passWithNoTests` |
| **Full suite command** | `cd backend && npx jest && cd ../frontend && npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd backend && npx jest --passWithNoTests`
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Will be filled after plans are created.*

---

## Wave 0 Requirements

- [ ] `backend/tests/` — test directory structure
- [ ] `jest` — install in backend if not present
- [ ] `frontend/tests/` — test directory structure
- [ ] `vitest` — install in frontend if not present

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| NLP input produces reasonable SQL | N/A | LLM output quality is subjective | Enter "customer return rates by product for last 3 weeks", verify SQL uses correct topics/fields |
| SQL syntax highlighting renders correctly | N/A | Visual verification needed | Open query builder, verify SQL is color-coded in editor |
| Traffic light indicator shows correct colors | N/A | Visual verification needed | Submit valid SQL (green), ambiguous mapping (yellow), broken SQL (red) |
| Sample output table is readable | N/A | Layout/UX verification | Submit a query, verify sample rows display in table format |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
