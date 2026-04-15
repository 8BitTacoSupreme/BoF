# Phase 1: Cluster Setup + Data Hydration + Topic Viewer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 01-cluster-setup
**Areas discussed:** Target Platform, Sample Data Domain, Topic Viewer UI, Tech Stack Carry-Forward

---

## Target Platform

| Option | Description | Selected |
|--------|-------------|----------|
| Confluent Cloud | Full CC stack: Kafka cluster, Schema Registry, Flink SQL compute pools. Aligns with research findings. Requires CC account + API keys. | |
| Local Docker Compose | Self-contained like original flinkenstein. Kafka + SR + Flink in containers. Free, portable, but no INFORMATION_SCHEMA or auto-cataloging. | |
| Hybrid | CC for Kafka + SR + Flink, but local backend/frontend. Data plane in cloud, control plane local. | |

**User's choice:** Local for now, eventually it will have to support CC.
**Notes:** User wants pragmatic local development first, with CC as a future migration target.

### Follow-up: Local Stack Choice

| Option | Description | Selected |
|--------|-------------|----------|
| Confluent Platform containers | cp-kafka, cp-schema-registry, cp-flink. Closer SQL dialect parity with CC. Easier migration path later. | ✓ |
| Apache OSS containers | Apache Kafka + Apache Flink + Apicurio/CP SR. Fully open source, but wider SQL dialect gap when you move to CC. | |
| Reuse flinkenstein's docker-compose | Start from the existing docker-compose.yml in flinkenstein and evolve it. Fastest bootstrap. | |

**User's choice:** Confluent Platform containers

### Follow-up: Abstraction Layer

| Option | Description | Selected |
|--------|-------------|----------|
| Config-driven abstraction now | Environment config (local vs CC) drives connection strings, auth, and API endpoints. | |
| Refactor when needed | Build for local Docker Compose now. When CC time comes, refactor the connection/auth layer. | ✓ |
| You decide | Claude's discretion. | |

**User's choice:** Refactor when needed

---

## Sample Data Domain

| Option | Description | Selected |
|--------|-------------|----------|
| Retail only | Orders, products, customers, returns, inventory. Focused domain, simpler schema surface. | |
| Retail + FSI | Two domains for richer demo. | |
| All three (retail + FSI + fraud) | Full flinkenstein coverage. Richest demo but broadest surface area. | ✓ |

**User's choice:** All three domains

### Follow-up: Data Flow Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Continuous streaming | Producers run indefinitely, emitting events at a configurable rate. | ✓ |
| Batch seed then stop | Load N records per topic on startup, then producers exit. | |
| Both modes | A --seed flag for initial bulk load, then continuous streaming. | |

**User's choice:** Continuous streaming

### Follow-up: Data Realism

| Option | Description | Selected |
|--------|-------------|----------|
| Realistic with relationships | Cross-topic referential integrity: orders reference real product IDs, returns reference real order IDs, etc. | ✓ |
| Plausible but independent | Each topic generates sensible data but no cross-topic FK relationships. | |
| You decide | Claude's discretion. | |

**User's choice:** Realistic with relationships

---

## Topic Viewer UI

| Option | Description | Selected |
|--------|-------------|----------|
| Sidebar + detail panel | Topic list in left sidebar, clicking a topic opens schema + messages in main panel. | ✓ |
| Card grid | Topics displayed as cards in a grid. | |
| Single-page list | All topics in a scrollable list with inline expandable sections. | |

**User's choice:** Sidebar + detail panel

### Follow-up: Schema Display

| Option | Description | Selected |
|--------|-------------|----------|
| Field table with types | Tabular view: field name, type, nullable, description. | ✓ |
| Raw Avro/Protobuf + field table | Both raw schema definition and parsed field table. | |
| You decide | Claude's discretion. | |

**User's choice:** Field table with types

### Follow-up: Message Display

| Option | Description | Selected |
|--------|-------------|----------|
| Scrolling table | New messages appear at top of a table, columns mapped to schema fields. | |
| JSON viewer | Raw JSON messages with syntax highlighting. | |
| Both views with toggle | Table view (default) with a toggle to switch to raw JSON. | ✓ |

**User's choice:** Both views with toggle

### Follow-up: Real-time Updates

| Option | Description | Selected |
|--------|-------------|----------|
| WebSocket streaming | Messages push to the UI in real-time via WebSocket. | ✓ |
| Poll every few seconds | Frontend polls the backend for new messages on an interval. | |
| You decide | Claude's discretion. | |

**User's choice:** WebSocket streaming

---

## Tech Stack Carry-Forward

### Backend

| Option | Description | Selected |
|--------|-------------|----------|
| Node.js + Express | Same as flinkenstein. KafkaJS for Kafka, node-rdkafka for perf-sensitive paths. | ✓ |
| Python + FastAPI | Better ML/AI library ecosystem for Phase 2. confluent-kafka-python is Confluent's official client. | |
| You decide | Claude's discretion. | |

**User's choice:** Node.js + Express (carry forward)

### Frontend

| Option | Description | Selected |
|--------|-------------|----------|
| React + Vite + Tailwind | Same as flinkenstein. Proven stack, fast dev cycle. | ✓ |
| Next.js + Tailwind | SSR/SSG capabilities, file-based routing. | |
| You decide | Claude's discretion. | |

**User's choice:** React + Vite + Tailwind (carry forward)

### Schema Format

| Option | Description | Selected |
|--------|-------------|----------|
| Avro | Confluent's default. Best SR integration, Flink auto-maps Avro subjects to table columns. | ✓ |
| JSON Schema | Easier to read/debug during development. | |
| Protobuf | Strong typing, compact wire format. | |

**User's choice:** Avro

### Bootstrap Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Fresh build, reference flinkenstein | Start clean. Look at flinkenstein for patterns but don't copy wholesale. | ✓ |
| Fork flinkenstein, evolve it | Copy flinkenstein's codebase and modify in place. | |
| You decide | Claude's discretion. | |

**User's choice:** Fresh build, reference flinkenstein

---

## Claude's Discretion

- Exact topic names and partition counts per domain
- Producer event rates and data generation logic
- WebSocket implementation (ws, socket.io, etc.)
- UI component library
- Loading states, error handling, empty states
- Docker Compose service configuration details

## Deferred Ideas

None — discussion stayed within phase scope
