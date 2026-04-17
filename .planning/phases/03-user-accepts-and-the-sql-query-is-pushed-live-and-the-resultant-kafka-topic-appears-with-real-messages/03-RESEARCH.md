# Phase 3: SQL Push-Live + Resultant Topic Appearance — Research

**Researched:** 2026-04-16
**Domain:** Flink SQL Gateway REST API, KafkaJS consumer tailing, Confluent Platform Docker Compose, React polling patterns
**Confidence:** HIGH (infrastructure patterns verified via flinkenstein reference; SQL Gateway API verified via official Flink docs; KafkaJS API verified via official docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-301:** Local Confluent Platform Docker Compose (cp-kafka, cp-schema-registry, cp-flink) is the Flink runtime.

**D-302:** Phase 3 delivers `docker-compose.yml` and the producer services (retail, FSI, fraud domains) as part of its own scope. Phase 1 was discussed but never executed.

**D-303:** Flink SQL is submitted via the **Flink SQL Gateway REST API** (port 8083) — `/v1/sessions`, `/v1/sessions/:sid/statements`, `/v1/sessions/:sid/operations/:oid/result`. Native CP pattern; async statement lifecycle.

**D-304:** Running statements are tracked in an in-memory `flink_jobs` Map keyed by jobId → `{ statementId, sessionHandle, state, outputTopic, createdAt }`. No persistent registry; documented limitation that state is lost on backend restart.

**D-305:** A **"Push Live" primary button** appears in the Query Builder, enabled only when validation status is green or yellow. Single click, no modal confirmation. Keyboard shortcut: Cmd+Shift+Enter.

**D-306:** On click, a compact **Deployment Status panel** opens below the SQL editor showing live states: Submitting → Compiling → Starting → Running → Streaming.

**D-307:** Output topic name comes from the LLM-generated `CREATE TABLE ... WITH (topic='...')` clause, defaulting to `derived.{semantic_name}`. Name is editable before Push Live; Push Live re-parses editor contents to extract the topic.

**D-308:** Once deployed, the Push Live button becomes a "Stop" button. Stop halts the Flink statement via SQL Gateway but preserves the output topic and its data. Lightweight inline confirmation precedes actual stop call.

**D-309:** The new derived topic appears in the **existing Schema Sidebar** with a **"◆ derived" badge**. Sidebar auto-refreshes after deploy by re-calling `/api/schemas` (extend to include derived topics).

**D-310:** Real messages flow into a **live message panel inside the Deployment Status panel** via short-interval polling (`GET /api/topics/:topic/messages?limit=10&since={offset_or_ts}` every 2s). Backend maintains a per-session KafkaJS consumer on the output topic.

**D-311:** If no messages arrive within 30s, the panel shows a non-blocking "No messages yet" state. No auto-fail.

**D-312:** Output Schema Registry registration happens automatically via Flink. Backend confirms registration by polling `GET /subjects/{topic}-value` post-deploy.

**D-313:** Three error classes surfaced distinctly: Submission errors (SQL Gateway 400), Runtime errors (job FAILED), Connectivity errors (Gateway unreachable).

**D-314:** Backend polls SQL Gateway job status every 5s for active session jobs and exposes `GET /api/jobs/:id`. Frontend polls that endpoint only while the Deployment Status panel is open.

**D-315:** Testing stack: unit tests for the Flink submission service with axios-mocked SQL Gateway responses; integration test against a running local cp-flink container (require-env guard pattern); human-verified E2E checkpoint.

**D-316:** Backend restart during a running job: in-memory `flink_jobs` Map is lost — accepted Phase 3 MVP limitation.

### Claude's Discretion

- Exact Flink SQL Gateway session lifecycle (per-session vs shared long-lived session)
- Poll-interval backoff strategy (fixed 2s/5s vs adaptive)
- KafkaJS consumer groupId / clientId convention for message tailing consumers
- Error message formatting and copy in the Deployment Status panel
- Internal state machine representation for job states
- Docker Compose service versions, resource limits, and health-check configuration
- Producer event rates and per-topic partition counts
- Whether to reuse the Phase 2 `sessions` Map or introduce a dedicated `deployments` Map
- Deployment Status panel exact layout (inline vs collapsible section)

### Deferred Ideas (OUT OF SCOPE)

- Full Topic Browser view (completing `TopicBrowserPlaceholder`)
- Persistent job registry via Kafka control topic
- WebSocket-based message streaming
- Confluent Cloud migration and CC Flink statements API
- Saved deployment library / deployment history UI
- Multi-user / multi-tenant job isolation
- Flink job autoscaling / resource tuning UI
- Automated testcontainers-node integration tests in CI
</user_constraints>

---

## Summary

Phase 3 has three distinct implementation tracks that must be delivered together: (1) the infrastructure track — Docker Compose stack with Confluent Platform containers and data producers; (2) the backend track — Flink SQL Gateway REST client, KafkaJS message-tail consumer, and three new Express routes; (3) the frontend track — Push Live button in QueryBuilder, DeploymentStatusPanel component, schema sidebar derived badge, and polling hooks.

The critical path runs through the Docker Compose stack. Without `cp-flink` running on port 8083, nothing else can be integration-tested. The reference implementation in `/Users/jhogan/flinkenstein/` provides a battle-tested `flinkService.js` that already solved the tricky parts: session lifecycle, DDL vs DML statement sequencing, and operation status polling. That code must be adapted (not copied wholesale per D-14/D-302), with key improvements: use the existing `splitStatements()` from `sqlValidationService.js` rather than naive semicolon split; treat a streaming INSERT operation as a non-blocking submission (the operationHandle stays RUNNING indefinitely for streaming jobs — this is normal and must NOT block); and track the resulting Flink job ID via `GET /api/jobs` on the JobManager REST endpoint (port 8082) rather than trusting the operationHandle state alone.

The KafkaJS consumer tailing pattern is well-understood: create a dedicated consumer with a unique groupId per output topic, subscribe with `fromBeginning: false`, and use `consumer.seek()` to wind back ~100 messages for initial display context. The per-session consumer must be disconnected when the Deployment Status panel closes or the job is stopped.

**Primary recommendation:** Deliver in three waves: Wave 0 (infrastructure + test scaffolding), Wave 1 (backend services + API routes), Wave 2 (frontend components). The Docker Compose stack must be healthy before Wave 1 integration tests run.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| kafkajs | 2.2.4 (latest) | KafkaJS — Kafka consumer for message tailing | Already used in flinkenstein reference; pure JS, no native deps |
| axios | 1.15.0 (already installed) | HTTP client for SQL Gateway and JobManager REST | Already in backend dependencies — no new install |
| express | 5.2.1 (already installed) | Three new routes in api.js | Already installed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| confluentinc/cp-flink | 2.1.1-cp1-java21 (latest Docker Hub tag as of 2026-04) | Flink jobmanager + taskmanager + SQL Gateway | Docker Compose cp-flink image |
| confluentinc/cp-kafka | 7.9.0 or match existing | Kafka broker (KRaft mode) | Docker Compose — match flinkenstein pattern |
| confluentinc/cp-schema-registry | 7.9.0 or match existing | Avro schema registration | Docker Compose |

**Version note:** The flinkenstein reference uses `confluentinc/cp-kafka:7.6.1`. Locally cached images are `7.7.8`. The `cp-flink` image uses a different versioning scheme: `{flink-version}-cp{patch}-java{jdk}`. The latest verified tag from Docker Hub is `2.1.1-cp1-java21` (Flink 2.1.1, Confluent patch 1, Java 21). Use this — it includes the SQL Gateway bundled in the standard Flink distribution.

**Installation:**
```bash
# In bride_of_flinkenstein/backend:
npm install kafkajs@2.2.4
# axios, express already installed
```

**Version verification:**
```bash
npm view kafkajs version      # → 2.2.4
npm view axios version         # → 1.15.0
docker pull confluentinc/cp-flink:2.1.1-cp1-java21
```

---

## Architecture Patterns

### Recommended Project Structure

```
bride_of_flinkenstein/
├── infrastructure/
│   ├── docker-compose.yml           # cp-kafka, cp-schema-registry, cp-flink
│   ├── producers/
│   │   ├── retail-producer.js       # retail.orders, retail.returns, retail.products
│   │   ├── fsi-producer.js          # fsi.transactions, fsi.accounts
│   │   ├── fraud-producer.js        # fraud.alerts
│   │   └── package.json             # kafkajs, @kafkajs/confluent-schema-registry
│   └── schemas/
│       ├── retail.orders.avsc
│       ├── retail.returns.avsc
│       ├── retail.products.avsc
│       └── ...
├── backend/
│   └── src/
│       ├── services/
│       │   ├── flinkService.js      # NEW: SQL Gateway REST client
│       │   └── kafkaConsumerService.js  # NEW: per-topic tail consumers
│       └── routes/
│           └── api.js               # EXTEND: 3 new routes
└── frontend/
    └── src/
        └── components/
            ├── QueryBuilder.jsx     # EXTEND: Push Live button
            └── DeploymentStatusPanel.jsx  # NEW
```

### Pattern 1: Flink SQL Gateway Session Lifecycle

**What:** A single long-lived session handle cached at module scope. On each request, probe the session with GET /sessions/:id; if it returns 404 or network error, create a new one. This is the proven pattern from the flinkenstein reference.

**When to use:** All SQL Gateway interactions. A shared session means CREATE TABLE definitions persist for the session lifetime — which is correct for DDL-then-DML submission.

**Key insight about streaming DML:** After submitting an INSERT INTO statement, the operationHandle status will be `RUNNING` permanently for streaming jobs. This is NOT a failure — it means the Flink job is running. Do NOT poll until `FINISHED` for INSERT operations. Instead: detect that the operation is RUNNING, extract the Flink jobId from the JobManager REST API (`GET {FLINK_JOBMANAGER_URL}/jobs`), and use that jobId for lifecycle tracking.

```javascript
// Source: flinkenstein flinkService.js (adapted)
// backend/src/services/flinkService.js

const axios = require('axios');

const SQL_GATEWAY_URL = process.env.FLINK_SQL_GATEWAY_URL
  || (process.env.RUNNING_IN_DOCKER === 'true' ? 'http://sql-gateway:8083' : 'http://localhost:8083');
const JOBMANAGER_URL = process.env.FLINK_JOBMANAGER_URL
  || (process.env.RUNNING_IN_DOCKER === 'true' ? 'http://jobmanager:8081' : 'http://localhost:8082');

let _sessionHandle = null;

async function getOrCreateSession() {
  if (_sessionHandle) {
    try {
      await axios.get(`${SQL_GATEWAY_URL}/v1/sessions/${_sessionHandle}`);
      return _sessionHandle;
    } catch (_) {
      _sessionHandle = null;
    }
  }
  const resp = await axios.post(`${SQL_GATEWAY_URL}/v1/sessions`, {
    sessionName: 'bride-of-flinkenstein',
    properties: { 'execution.runtime-mode': 'streaming' }
  });
  _sessionHandle = resp.data.sessionHandle;
  return _sessionHandle;
}
```

### Pattern 2: DDL + Streaming DML Submission

**What:** Split the LLM-generated SQL into individual statements using the existing `splitStatements()` from `sqlValidationService.js`. Submit CREATE statements synchronously (poll until FINISHED). Submit the INSERT statement asynchronously (treat RUNNING as success). Return the Flink jobId from the JobManager for tracking.

**Critical:** INSERT INTO for streaming queries puts the operationHandle into RUNNING state permanently. The flinkenstein reference's `waitForOperationCompletion()` hangs on DML because of this — the correct pattern is to submit INSERT, verify the operationHandle is RUNNING (not ERROR), then immediately query the JobManager `/jobs` endpoint for the newest running job ID.

```javascript
// Source: flinkenstein flinkService.js + Flink SQL Gateway REST docs
async function deployJob(sql) {
  const session = await getOrCreateSession();
  const { splitStatements } = require('./sqlValidationService');
  const statements = splitStatements(sql);

  const creates = statements.filter(s => /^\s*CREATE/i.test(s));
  const inserts = statements.filter(s => /^\s*INSERT/i.test(s));

  // Execute DDL synchronously — wait for FINISHED
  for (const ddl of creates) {
    const opResp = await axios.post(`${SQL_GATEWAY_URL}/v1/sessions/${session}/statements`, { statement: ddl });
    const opHandle = opResp.data.operationHandle;
    await pollUntilFinished(session, opHandle, /* maxWaitMs */ 30000);
  }

  // Execute DML asynchronously — RUNNING = success for streaming INSERT
  const insertResp = await axios.post(
    `${SQL_GATEWAY_URL}/v1/sessions/${session}/statements`,
    { statement: inserts[0] }
  );
  const insertOpHandle = insertResp.data.operationHandle;

  // Brief delay then verify not ERROR
  await sleep(2000);
  const statusResp = await axios.get(
    `${SQL_GATEWAY_URL}/v1/sessions/${session}/operations/${insertOpHandle}/status`
  );
  if (statusResp.data.status === 'ERROR') {
    const errResp = await axios.get(
      `${SQL_GATEWAY_URL}/v1/sessions/${session}/operations/${insertOpHandle}/result/0`
    );
    throw new Error(errResp.data?.results?.data?.[0]?.fields?.[0] || 'INSERT failed');
  }
  // RUNNING or FINISHED — both indicate successful streaming job submission

  // Get Flink job ID from JobManager
  const jobsResp = await axios.get(`${JOBMANAGER_URL}/jobs`);
  const runningJobs = (jobsResp.data.jobs || []).filter(j => j.status === 'RUNNING');
  const jobId = runningJobs[0]?.id || null;

  return { operationHandle: insertOpHandle, jobId, sessionHandle: session };
}
```

### Pattern 3: Stopping a Running Flink Job

**What:** Cancel the operation via SQL Gateway (`POST /sessions/:id/operations/:opHandle/cancel`), which stops the Flink job. The output topic is preserved.

```javascript
// Source: Flink SQL Gateway REST API docs (Flink 1.20 stable)
async function stopJob(sessionHandle, operationHandle) {
  await axios.post(
    `${SQL_GATEWAY_URL}/v1/sessions/${sessionHandle}/operations/${operationHandle}/cancel`
  );
  // Clean up operation resources
  await axios.delete(
    `${SQL_GATEWAY_URL}/v1/sessions/${sessionHandle}/operations/${operationHandle}/close`
  ).catch(() => {}); // ignore cleanup errors
}
```

### Pattern 4: KafkaJS Message Tailing

**What:** Create a one-off KafkaJS consumer with a unique groupId, seek to recent offset on partition 0, collect messages in a buffer, return to REST caller. Use `fromBeginning: false` + `consumer.seek()` for offset control.

**When to use:** Backend handler for `GET /api/topics/:topic/messages`. Do NOT use persistent long-lived consumers — create, drain, disconnect per request to avoid group rebalance overhead at MVP scale.

**KafkaJS pattern — per-request tailing consumer:**

```javascript
// Source: kafkajs.org/docs/consuming (verified 2026-04)
const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'bride-of-flinkenstein-tailer',
  brokers: [process.env.RUNNING_IN_DOCKER === 'true' ? 'broker:9092' : 'localhost:9092']
});

async function tailMessages(topicName, limit = 10, sinceOffset = null) {
  const groupId = `bof-tail-${topicName}-${Date.now()}`;
  const consumer = kafka.consumer({ groupId });
  const messages = [];

  await consumer.connect();
  await consumer.subscribe({ topics: [topicName], fromBeginning: sinceOffset === null });

  // Seek to specific offset if provided
  consumer.on(consumer.events.GROUP_JOIN, () => {
    if (sinceOffset !== null) {
      consumer.seek({ topic: topicName, partition: 0, offset: String(sinceOffset) });
    }
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(), 5000); // max 5s wait
    consumer.run({
      eachMessage: async ({ message }) => {
        messages.push({
          offset: message.offset,
          value: message.value ? message.value.toString() : null,
          timestamp: message.timestamp,
        });
        if (messages.length >= limit) {
          clearTimeout(timeout);
          resolve();
        }
      }
    }).catch(reject);
  });

  await consumer.disconnect();
  return messages;
}
```

**Important note on `sinceOffset`:** The frontend passes `?since={offset}` so the backend returns only new messages on each poll. Track the highest offset seen on the frontend and pass it back on the next poll. This avoids re-sending the same messages every 2 seconds.

### Pattern 5: Derived Topic Detection in Schema Registry

**What:** After deployment, Schema Registry will have `derived.{topic}-value` registered (Flink does this automatically via `value.format='avro-confluent'`). The existing `getAllSubjects()` already fetches all `-value` subjects. Add an `isDerived` flag by checking if the topic name starts with `derived.`.

```javascript
// Source: existing schemaRegistryService.js + 03-CONTEXT.md D-309
// Extend /api/schemas response shape:
const schemaList = Object.entries(schemas)
  .filter(([, schema]) => schema !== null)
  .map(([topic, schema]) => ({
    topic,
    isDerived: topic.startsWith('derived.'),  // NEW flag
    fields: (schema.fields || []).map(f => ({ name: f.name, type: normaliseType(f.type) }))
  }));
```

### Pattern 6: Express Routes to Add

Three new routes in `backend/src/routes/api.js`:

```javascript
// POST /api/query/deploy
// Body: { sql: string, sessionId?: string }
// Returns: { jobId, operationHandle, outputTopic, state: 'Submitting' }
router.post('/query/deploy', async (req, res) => { ... });

// GET /api/jobs/:id
// Returns: { jobId, state: 'Running'|'Failed'|'Stopped', operationHandle, outputTopic, elapsed }
router.get('/jobs/:id', async (req, res) => { ... });

// GET /api/topics/:topic/messages?limit=10&since=<offset>
// Returns: { messages: [{offset, value, timestamp}], nextOffset }
router.get('/topics/:topic/messages', async (req, res) => { ... });
```

### Anti-Patterns to Avoid

- **Polling INSERT operationHandle until FINISHED:** Streaming jobs never reach FINISHED — the operationHandle stays RUNNING forever. This will cause an infinite wait. Treat RUNNING for INSERT as "job submitted successfully".
- **Using the same KafkaJS consumer group for all message tailing requests:** Consumer group offsets will interfere. Always use unique groupIds per tail request.
- **Creating derived topics by pre-creating Kafka topics before submitting SQL:** Flink creates the output topic automatically when the INSERT begins. Pre-creating can cause schema mismatches.
- **Using naive semicolon split on multi-statement SQL:** Semicolons inside string literals in WITH clauses will cause incorrect splits. Use `splitStatements()` from `sqlValidationService.js` — it uses the FlinkSQL parser.
- **Port conflicts:** Flink SQL Gateway uses port 8083; Kafka Connect also conventionally uses 8083. Since this project has no Connect service, there is no conflict — but document the port clearly in docker-compose.yml. Flink JobManager web UI is on 8081; expose as 8082 on the host to avoid conflict with Schema Registry (8081).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL statement splitting | Custom semicolon split | `splitStatements()` from `sqlValidationService.js` | Already exists; handles semicolons in string literals |
| Output topic extraction from SQL | Custom regex | `extractTableNamesFromSQL()` from `sqlValidationService.js` | Already exists; handles backtick-quoted names |
| Kafka message consumption | Custom TCP protocol | KafkaJS | Handles offsets, partition assignment, group coordination |
| Schema Registry polling | Custom interval polling | `schemaRegistryService.getTopicSchema()` | Already exists; handles 404 gracefully |
| Docker health checks | Custom shell scripts | Docker health check `CMD-SHELL` with curl/kafka-broker-api-versions | Standard CP pattern; verified in flinkenstein |

**Key insight:** The hard parts (SQL splitting, schema fetching, topic name extraction) are already solved in Phase 2 services. The new services wire these together rather than re-implementing them.

---

## Docker Compose Architecture

### Service Topology

```yaml
# infrastructure/docker-compose.yml (skeletal — full config in Wave 0 task)
services:
  broker:
    image: confluentinc/cp-kafka:7.7.8      # Match locally cached image
    container_name: broker
    ports: ["9092:9092", "29092:29092"]      # 9092 external, 29092 internal
    # KRaft mode — no ZooKeeper
    environment:
      KAFKA_PROCESS_ROLES: "broker,controller"
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
    healthcheck:
      test: ["CMD-SHELL", "kafka-broker-api-versions --bootstrap-server localhost:9092 >/dev/null 2>&1"]

  schema-registry:
    image: confluentinc/cp-schema-registry:7.7.8
    ports: ["8081:8081"]
    depends_on: { broker: { condition: service_healthy } }

  jobmanager:
    image: confluentinc/cp-flink:2.1.1-cp1-java21
    container_name: jobmanager
    ports: ["8082:8081"]               # Host 8082 → container 8081 (avoids SR port collision)
    command: jobmanager
    environment:
      JOB_MANAGER_RPC_ADDRESS: jobmanager
    depends_on: { schema-registry: { condition: service_healthy } }

  taskmanager:
    image: confluentinc/cp-flink:2.1.1-cp1-java21
    container_name: taskmanager
    command: taskmanager -Dtaskmanager.numberOfTaskSlots=4
    environment:
      JOB_MANAGER_RPC_ADDRESS: jobmanager
    depends_on: { jobmanager: { condition: service_healthy } }

  sql-gateway:
    image: confluentinc/cp-flink:2.1.1-cp1-java21
    container_name: sql-gateway
    ports: ["8083:8083"]
    command: >
      bash -c "/opt/flink/bin/sql-gateway.sh start-foreground
      -Dsql-gateway.endpoint.rest.address=0.0.0.0
      -Dsql-gateway.endpoint.rest.port=8083
      -Djobmanager.rpc.address=jobmanager
      -Drest.address=jobmanager
      -Drest.port=8081"
    depends_on: { taskmanager: { condition: service_healthy } }
```

**Critical port mapping:** The Flink JobManager container exposes 8081, mapped to host port 8082 to avoid collision with Schema Registry (also 8081). The SQL Gateway runs on 8083 in both host and container. The backend service must use:
- `FLINK_SQL_GATEWAY_URL=http://localhost:8083` (host) or `http://sql-gateway:8083` (container)
- `FLINK_JOBMANAGER_URL=http://localhost:8082` (host) or `http://jobmanager:8081` (container)

**cp-flink image note:** The `confluentinc/cp-flink` image includes the Flink distribution with SQL Gateway bundled (standard Flink 2.1.1 distribution). No custom Dockerfile is needed — unlike the flinkenstein reference which builds a custom image. The entrypoint accepts `jobmanager`, `taskmanager`, and the `sql-gateway.sh` command directly.

### Producer Services

Producers run as Node.js processes (or Docker services). Each domain emits continuously. Cross-topic referential integrity requires:
- Retail producer: generates `product_id` values shared between `retail.orders` and `retail.products`; generates `order_id` values shared between `retail.orders` and `retail.returns`
- FSI producer: `account_id` shared between `fsi.accounts` and `fsi.transactions`
- Fraud producer: `transaction_id` referenced from `fsi.transactions`

Producers should be Docker services (`depends_on: { schema-registry: { condition: service_healthy } }`) so they start after Schema Registry is ready and can pre-register schemas.

---

## Common Pitfalls

### Pitfall 1: Treating INSERT Streaming Jobs Like Batch
**What goes wrong:** Code polls `GET /sessions/:sid/operations/:opHandle/status` waiting for `FINISHED`. It never arrives — streaming INSERT stays `RUNNING` forever. Request times out.
**Why it happens:** The flinkenstein reference's `waitForOperationCompletion()` has a 30s timeout and works for DDL; for DML (INSERT INTO streaming), the operation status is `RUNNING` by design.
**How to avoid:** After submitting INSERT, poll the status once after 2s. If `RUNNING` → success (proceed to extract jobId). If `ERROR` → fetch result/0 for the error message. Never loop on INSERT operationHandle.
**Warning signs:** Backend hangs for exactly 30 seconds before returning; all job submissions time out.

### Pitfall 2: SQL Gateway Port Collision with Kafka Connect
**What goes wrong:** Port 8083 is conventionally used by Kafka Connect. If Connect is in the compose stack, SQL Gateway cannot bind 8083.
**Why it happens:** Both services use 8083 as default.
**How to avoid:** This project has no Connect service in scope. But if added later, use `8084:8083` host mapping for SQL Gateway. Document the conflict in docker-compose comments.
**Warning signs:** SQL Gateway container fails to start; `bind: address already in use` in logs.

### Pitfall 3: Schema Registry Not Ready When Producers Start
**What goes wrong:** Producers start before Schema Registry is accepting connections. Schema registration fails; topics have no registered schema; `/api/schemas` returns empty.
**Why it happens:** `depends_on: service_started` vs `service_healthy` distinction. `started` fires when the container starts, not when SR is ready.
**How to avoid:** All producer services must use `depends_on: { schema-registry: { condition: service_healthy } }`. The SR health check is `curl -sf http://localhost:8081/subjects`.
**Warning signs:** Schema sidebar shows "Loading schemas..." forever; SR logs show `KafkaException: Producer is closed during send`.

### Pitfall 4: KafkaJS Consumer Group Offset Pollution
**What goes wrong:** Re-using the same consumer `groupId` for message tailing means Kafka tracks the offset for that group. On the next poll, Kafka starts from where the previous request left off, returning 0 new messages until new ones arrive.
**Why it happens:** Consumer groups track committed offsets. A shared groupId means the second request sees committed offsets, not the beginning.
**How to avoid:** Use a unique groupId per request: `bof-tail-${topicName}-${Date.now()}`. Since this is ephemeral and short-lived, Kafka will GC the dead group after `offsets.retention.minutes` (default 7 days in CP).
**Warning signs:** First request returns messages; all subsequent requests return empty arrays.

### Pitfall 5: Output Topic Schema Not Registered Before Message Polling
**What goes wrong:** `GET /api/topics/:topic/messages` is called immediately after deploy. Flink is still initializing and hasn't written the first message. The topic may not exist yet, causing KafkaJS subscription to fail.
**Why it happens:** There's a race between job deployment and first message arrival. For windowed queries like "customer return rates for the last 3 weeks", the first tumbling window result won't appear until the window closes.
**How to avoid:** Wrap the KafkaJS subscription in a try/catch that returns `{ messages: [], nextOffset: 0 }` for missing topics. The 30s no-messages timer in the UI (D-311) handles the wait gracefully.
**Warning signs:** Message panel shows an error instead of "No messages yet".

### Pitfall 6: cp-flink Image Missing Kafka/Avro Connectors
**What goes wrong:** Flink SQL Gateway accepts the CREATE TABLE DDL but fails at job startup with `ClassNotFoundException: org.apache.flink.connector.kafka.source.KafkaSource`.
**Why it happens:** The base `cp-flink` image may not include the Kafka connector and Confluent Avro serializer JARs.
**How to avoid:** Verify the `cp-flink` image includes the required JARs by running `docker run --rm confluentinc/cp-flink:2.1.1-cp1-java21 ls /opt/flink/lib/ | grep kafka`. If missing, create a minimal Dockerfile extending `cp-flink` that adds the connector JARs. The flinkenstein reference uses a custom Dockerfile for exactly this reason — check its `Dockerfile` contents before assuming JARs are bundled.
**Warning signs:** Job starts then immediately transitions to FAILED; exception contains `ClassNotFoundException`.

---

## Code Examples

### Complete flinkService.js Interface

The new `backend/src/services/flinkService.js` exports:

```javascript
// Source: adapted from flinkenstein reference + Flink SQL Gateway REST API (Flink 1.20 stable docs)
module.exports = {
  deployJob,           // (sql: string) → Promise<{ jobId, operationHandle, sessionHandle, outputTopic }>
  stopJob,             // (sessionHandle, operationHandle) → Promise<void>
  getJobStatus,        // (jobId) → Promise<{ state, startTime }>
  isGatewayHealthy,    // () → Promise<boolean>
};
```

### In-Memory `flink_jobs` Map (D-304)

```javascript
// Source: 03-CONTEXT.md D-304; mirrors llmService.js sessions Map pattern
// backend/src/services/flinkService.js

/** @type {Map<string, {operationHandle, sessionHandle, state, outputTopic, createdAt}>} */
const flink_jobs = new Map();

// Keys: pseudo-jobId (use Flink JobManager jobId if available, else UUID)
// Values:
//   operationHandle — SQL Gateway operation handle for stop/cancel
//   sessionHandle   — SQL Gateway session handle
//   state           — 'Submitting' | 'Compiling' | 'Starting' | 'Running' | 'Streaming' | 'Failed' | 'Stopped'
//   outputTopic     — extracted topic name from sink CREATE TABLE
//   createdAt       — Date.now()
```

### POST /api/query/deploy Handler Skeleton

```javascript
// Source: api.js pattern (Express route handler with thin controller + service layer)
router.post('/query/deploy', async (req, res) => {
  const { sql, sessionId } = req.body;
  if (!sql) return res.status(400).json({ error: 'sql is required' });

  // 1. Extract output topic from SQL (reuse existing utility)
  const { extractTableNamesFromSQL } = require('../services/sqlValidationService');
  // The sink table name maps to a topic via the WITH clause — parse it
  const outputTopic = extractOutputTopicFromSql(sql); // new helper, wraps regex on WITH clause

  // 2. Submit to Flink SQL Gateway
  const jobId = `job-${Date.now()}`;
  flink_jobs.set(jobId, { state: 'Submitting', outputTopic, createdAt: Date.now() });
  res.json({ jobId, state: 'Submitting', outputTopic }); // Return immediately

  // 3. Execute deployment asynchronously (don't block HTTP response)
  deployJobAsync(jobId, sql, outputTopic);
});
```

**Note:** Return `jobId` to frontend immediately so it can begin polling `GET /api/jobs/:id`. The actual Flink submission happens asynchronously via `deployJobAsync()`. This pattern avoids HTTP timeouts for slow Flink starts.

### Output Topic Extraction

The existing `sqlValidationService.extractTableNamesFromSQL()` extracts table names but not the topic string from the WITH clause. A small additional helper is needed:

```javascript
// Source: new helper — regex on 'topic' = '...' pattern in WITH clause
function extractOutputTopicFromSql(sql) {
  // Find CREATE TABLE blocks, prefer the last one (likely the sink)
  const withClauses = [...sql.matchAll(/CREATE\s+TABLE[^(]+\([\s\S]*?\)\s*WITH\s*\(([^)]+)\)/gi)];
  if (!withClauses.length) return null;
  const lastWith = withClauses[withClauses.length - 1][1];
  const topicMatch = lastWith.match(/'topic'\s*=\s*'([^']+)'/i);
  return topicMatch ? topicMatch[1] : null;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ververica flink-sql-gateway (separate service) | Built-in SQL Gateway (Flink 1.16+, GA 1.19+) | Flink 1.16 | No separate deployment needed; bundled in cp-flink image |
| ZooKeeper-managed Kafka cluster | KRaft mode (no ZooKeeper) | Kafka 3.3 (CP 7.3) | Simpler Docker Compose; remove ZooKeeper service entirely |
| Custom Flink Dockerfile with connector JARs | cp-flink image (may bundle connectors) | CP 7.8 / CMF 2.x | Verify before assuming JARs are included |
| Per-job sessions in SQL Gateway | Long-lived single session | N/A (design choice) | Fewer sessions; DDL statements persist for job lifetime |

**Deprecated/outdated (from flinkenstein reference — do NOT copy):**
- `normalizeGeneratedSql()` and `ensureKafkaConnectorProperties()` in flinkenstein's flinkService.js: These normalise legacy topic names and Avro options. Phase 2 LLM already emits correct `value.format` and `value.avro-confluent.url` — no normalization layer needed.
- Custom Dockerfile building from scratch: Use `confluentinc/cp-flink:2.1.1-cp1-java21` directly.
- ZooKeeper: Not needed; flinkenstein's compose doesn't include it, cp-kafka 7.x uses KRaft.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Infrastructure wave | Yes | 29.2.1 | — |
| Node.js | Backend services | Yes | v24.5.0 | — |
| npm | Package install | Yes | 11.5.1 | — |
| kafkajs (npm) | KafkaJS consumer | Not installed | — | `npm install kafkajs@2.2.4` — Wave 0 task |
| confluentinc/cp-flink:2.1.1-cp1-java21 | Flink runtime | Not pulled | — | Pull during Wave 0; ~650MB |
| confluentinc/cp-kafka:7.7.8 | Kafka broker | Locally cached | 7.7.8 | Use cached image |
| confluentinc/cp-schema-registry:7.7.8 | Schema Registry | Locally cached | 7.7.8 | Use cached image |
| cp-flink Kafka connector JARs | Flink-Kafka integration | Unknown (in image) | — | Custom Dockerfile if missing |

**Missing dependencies with no fallback:**
- `kafkajs` npm package — must be installed before Wave 1 backend work: `npm install kafkajs@2.2.4`

**Missing dependencies with fallback:**
- `confluentinc/cp-flink:2.1.1-cp1-java21` — Docker pull required during Wave 0 infrastructure setup. If this specific tag is unavailable, fall back to the OSS `apache/flink:1.20.1` image with the flinkenstein custom Dockerfile approach (adds Kafka connector JARs).
- Kafka connector JARs in cp-flink — Verify with `docker run --rm confluentinc/cp-flink:2.1.1-cp1-java21 ls /opt/flink/lib/`. If absent, extend with a 3-line Dockerfile. This is Wave 0 task to discover.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 + supertest 7.2.2 |
| Config file | `backend/jest.config.js` |
| Quick run command | `cd backend && npx jest tests/flinkService.test.js --testTimeout=10000` |
| Full suite command | `cd backend && npx jest --silent` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-303 | SQL submitted via SQL Gateway REST API | unit (axios-mocked) | `npx jest tests/flinkService.test.js` | No — Wave 0 |
| D-304 | flink_jobs Map tracks state correctly | unit | `npx jest tests/flinkService.test.js` | No — Wave 0 |
| D-307 | Output topic extracted from SQL editor | unit | `npx jest tests/flinkService.test.js` | No — Wave 0 |
| D-309 | isDerived flag in /api/schemas response | unit (axios-mocked SR) | `npx jest tests/api.test.js` | Exists — extend |
| D-310 | /api/topics/:topic/messages returns messages | unit (kafkajs-mocked) | `npx jest tests/kafkaConsumerService.test.js` | No — Wave 0 |
| D-313 | Error classes surfaced in /api/jobs/:id | unit | `npx jest tests/api.test.js` | Exists — extend |
| D-315 | Full submit flow against live cp-flink | integration (guard) | `FLINK_GATEWAY_URL=http://localhost:8083 npx jest tests/flinkIntegration.test.js` | No — Wave 0 |
| E2E | Canonical query deployed end-to-end | human-verified | Manual browser session | N/A |

### Sampling Rate
- **Per task commit:** `cd backend && npx jest --silent` (131 existing + new unit tests)
- **Per wave merge:** Full suite + integration test if Docker stack is running
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `backend/tests/flinkService.test.js` — covers D-303, D-304, D-307, D-313 (axios-mocked)
- [ ] `backend/tests/kafkaConsumerService.test.js` — covers D-310 (kafkajs mocked)
- [ ] `backend/tests/flinkIntegration.test.js` — covers D-303 end-to-end with live Gateway; `describeIfFlinkGateway` guard (analogous to `describeIfApiKey` in canonical.test.js)
- [ ] `npm install kafkajs@2.2.4` in backend package.json

---

## Open Questions

1. **Does `confluentinc/cp-flink:2.1.1-cp1-java21` include Kafka connector + Confluent Avro JARs?**
   - What we know: The base Apache Flink image does NOT include Kafka connector. The cp-flink image is Confluent's distribution and may bundle them.
   - What's unclear: Whether the specific Kafka connector for Flink 2.1 + Confluent Schema Registry serializer is in the image.
   - Recommendation: Wave 0, Task 1 — after pulling the image, run `docker run --rm confluentinc/cp-flink:2.1.1-cp1-java21 ls /opt/flink/lib/ | grep -i kafka`. If absent, create a 3-line Dockerfile.

2. **Should KafkaJS tail consumers be per-request or persistent per-output-topic?**
   - What we know: D-310 says "backend maintains a per-session KafkaJS consumer on the output topic." D-316 accepts in-memory Map limitation.
   - What's unclear: Persistent consumers have lower latency (no group join overhead) but require lifecycle management and leak if not cleaned up. Per-request consumers are simpler.
   - Recommendation (Claude's discretion): Start with per-request consumers (simpler, no lifecycle management). A 2s poll with per-request consumer includes ~200ms group join overhead — acceptable for MVP. Upgrade to persistent consumer if latency is noticeably bad.

3. **Does the cp-flink SQL Gateway expose a `/v1/sessions/:id/heartbeat` endpoint?**
   - What we know: The flinkenstein reference calls `GET /sessions/:id/heartbeat` to validate session. The Flink 1.20 docs show `POST /sessions/:id/heartbeat`.
   - What's unclear: Whether GET vs POST matters and if cp-flink 2.1.1 differs.
   - Recommendation: Use `GET /sessions/:id` (session info endpoint) as the health probe — it's stable across versions. Fall back to session recreation on any 4xx response.

4. **How should producer event rate be configured for the canonical cross-topic JOIN test?**
   - What we know: D-305/D-307 expect the canonical query "customer return rates by product for the last three weeks" to produce messages within 30 seconds (D-311).
   - What's unclear: A 3-week tumbling window means no results for 3 weeks of real time. The query may need to use PROCTIME or a shorter window for testing purposes.
   - Recommendation (Claude's discretion): The E2E test should use a simpler query ("total orders by product per minute") for human verification. The canonical query can be demonstrated with a shorter window (1 minute TUMBLE) that fires quickly. Document this in the E2E checkpoint.

---

## Project Constraints (from CLAUDE.md)

The project CLAUDE.md (`bride_of_flinkenstein/.claude/CLAUDE.md`) specifies:

- **Pattern:** event-driven
- **Test coverage:** 80%
- **Current phase:** See `.planning/ROADMAP.md`
- **Active tools:** research, strategy, gsd, discipline

The global CLAUDE.md (user-level) requires:
- Confluent canonical defaults: `acks=all`, `enable.idempotence=true`, `value.format='avro-confluent'`, `scan.startup.mode='earliest-offset'`, `properties.group.id` set on source tables
- These are already embedded in the Phase 2 few-shot examples in `fewShotExamples.js` — Phase 3 inherits them
- For FSI domain producers: include `transaction_id` referencing pattern for fraud alerts topic
- Bootstrap servers pattern: `broker:9092` (internal) for Flink, `localhost:9092` for backend running on host

**Planner must verify:**
- All new service files are covered by unit tests (80% coverage target)
- KafkaJS consumer uses unique groupId per request (no group offset pollution)
- Docker Compose uses KRaft mode (no ZooKeeper)
- All Kafka connector properties in LLM-generated SQL use `value.format` not bare `format`, `value.avro-confluent.url` not `avro-confluent.url`

---

## Sources

### Primary (HIGH confidence)
- Apache Flink SQL Gateway REST API — `https://nightlies.apache.org/flink/flink-docs-release-1.20/docs/dev/table/sql-gateway/rest/` — endpoint list, operation states
- KafkaJS documentation — `https://kafka.js.org/docs/consuming` — consumer API, fromBeginning, seek, groupId
- flinkenstein reference — `/Users/jhogan/flinkenstein/backend/src/services/flinkService.js` — battle-tested SQL Gateway session + submission patterns
- Phase 2 codebase — `bride_of_flinkenstein/backend/src/services/sqlValidationService.js` — splitStatements, extractTableNamesFromSQL
- 03-CONTEXT.md — all locked decisions
- 03-UI-SPEC.md — component inventory, interaction flows, copywriting

### Secondary (MEDIUM confidence)
- Robin Moffatt — "Exploring the Flink SQL Gateway REST API" — `https://rmoff.net/2024/03/12/exploring-the-flink-sql-gateway-rest-api/` — practical session + statement flow examples
- Decodable — "Flink SQL Misconfiguration" — `https://www.decodable.co/blog/flink-sql-misconfiguration-misunderstanding-and-mishaps` — async submission pitfall (INSERT != FINISHED)
- Docker Hub confluentinc/cp-flink — `https://hub.docker.com/r/confluentinc/cp-flink` — latest tag `2.1.1-cp1-java21`
- Confluent Platform changelog — `https://docs.confluent.io/platform/current/flink/changelog.html` — CMF 2.3.0 (April 2026), Flink 2.1 supported

### Tertiary (LOW confidence)
- Whether `cp-flink:2.1.1-cp1-java21` bundles Kafka connector JARs — NOT verified; must be confirmed during Wave 0 environment audit

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — kafkajs and axios versions verified via npm registry; cp-flink tag from Docker Hub
- Architecture: HIGH — session + DDL/DML submission patterns verified against flinkenstein reference and official Flink docs
- Docker Compose: MEDIUM — cp-flink image confirmed to exist; connector JAR bundling not verified
- Pitfalls: HIGH — INSERT-stays-RUNNING pitfall verified against flinkenstein debug history and official docs

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable APIs; cp-flink image tag may update sooner)
