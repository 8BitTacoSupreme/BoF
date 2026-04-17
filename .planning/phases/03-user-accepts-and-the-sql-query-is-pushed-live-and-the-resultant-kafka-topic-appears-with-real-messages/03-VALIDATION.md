---
phase: 03
slug: user-accepts-and-the-sql-query-is-pushed-live-and-the-resultant-kafka-topic-appears-with-real-messages
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + supertest (backend) / vitest + RTL (frontend) |
| **Config file** | vitest.config.js or "none — Wave 0 installs" |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | TBD | TBD | TBD | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test framework installed and configured
- [ ] Test stubs for Flink SQL Gateway submission
- [ ] Test stubs for job status polling
- [ ] Test stubs for KafkaJS message tailing
- [ ] Shared test fixtures for mock Flink/Kafka responses

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Flink job creates Kafka topic | E2E | Requires running Docker Compose stack | Start stack, push SQL, verify topic appears in kafka-topics --list |
| Messages flow into derived topic | E2E | Requires live producers | Verify messages appear in topic with kafkacat/kcat |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
