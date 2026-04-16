'use strict';

/**
 * Flink SQL dialect rules for Confluent Platform.
 * Injected into the system prompt to enforce correct DDL and DML patterns.
 *
 * Why these rules: The LLM's SQL training data skews toward ANSI/MySQL/PostgreSQL.
 * Confluent Platform Flink SQL has specific dialect requirements that Claude
 * will violate without explicit instruction.
 */
const FLINK_SQL_RULES = `
## Flink SQL Rules (MANDATORY — never violate these)

1. **Reserved word quoting**: Always backtick-quote these reserved words when used as field names:
   \`timestamp\`, \`time\`, \`user\`, \`order\`, \`value\`, \`row\`, \`interval\`, \`table\`, \`key\`, \`comment\`

2. **STRING fields in arithmetic**: STRING fields used in SUM/AVG/arithmetic MUST use TRY_CAST:
   \`TRY_CAST(total_amount AS DECIMAL(10,2))\`
   Never use: SUM(total_amount) — total_amount is STRING type in Avro schemas.

3. **BIGINT timestamp conversion**: BIGINT epoch millisecond fields MUST use TO_TIMESTAMP_LTZ before use in window functions or comparisons:
   \`TO_TIMESTAMP_LTZ(created_at, 3)\`
   Fields named \`created_at\`, \`event_time\`, or \`timestamp\` of BIGINT type are epoch milliseconds.

4. **Watermark requirement**: Every time-windowed query (TUMBLE, HOP, SESSION) MUST include a WATERMARK declaration in the source CREATE TABLE:
   \`WATERMARK FOR event_time AS event_time - INTERVAL '5' SECOND\`

5. **Kafka connector properties**: Use \`value.format\` (NOT bare \`format\`) and \`value.avro-confluent.url\` (NOT \`avro-confluent.url\`):
   \`'value.format' = 'avro-confluent'\`
   \`'value.avro-confluent.url' = 'http://schema-registry:8081'\`

6. **Startup mode**: Always use \`'scan.startup.mode' = 'earliest-offset'\` for deterministic replay.

7. **Consumer group**: Always set \`'properties.group.id' = 'bride-of-flinkenstein-reader'\` on source tables.

8. **Bootstrap servers**: \`'properties.bootstrap.servers' = 'broker:9092'\`

9. **Schema Registry**: \`'value.avro-confluent.url' = 'http://schema-registry:8081'\`

10. **Complete DDL**: Every job MUST have: CREATE TABLE source (with WATERMARK if windowed), CREATE TABLE sink, INSERT INTO. Three statements, terminated by semicolons.
`.trim();

/**
 * Canonical few-shot Flink SQL examples for Confluent Platform.
 * These examples demonstrate the correct dialect patterns and must appear
 * verbatim-style in the system prompt so Claude learns by demonstration.
 *
 * Covers: window aggregation, cross-topic JOIN, filter, non-windowed aggregation.
 */
const FEW_SHOT_EXAMPLES = `
## Examples (Follow these patterns exactly)

### Example 1: Window Aggregation — "total sales by product per day"

\`\`\`sql
CREATE TABLE retail_orders_source (
  \`order_id\` BIGINT,
  \`product_id\` STRING,
  \`total_amount\` STRING,
  \`created_at\` BIGINT,
  \`event_time\` AS TO_TIMESTAMP_LTZ(\`created_at\`, 3),
  WATERMARK FOR \`event_time\` AS \`event_time\` - INTERVAL '5' SECOND
) WITH (
  'connector' = 'kafka',
  'topic' = 'retail.orders',
  'properties.bootstrap.servers' = 'broker:9092',
  'properties.group.id' = 'bride-of-flinkenstein-reader',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081',
  'scan.startup.mode' = 'earliest-offset'
);

CREATE TABLE daily_sales_sink (
  \`product_id\` STRING,
  \`window_start\` TIMESTAMP(3),
  \`window_end\` TIMESTAMP(3),
  \`total_sales\` DECIMAL(10, 2)
) WITH (
  'connector' = 'kafka',
  'topic' = 'retail.daily-sales',
  'properties.bootstrap.servers' = 'broker:9092',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081'
);

INSERT INTO daily_sales_sink
SELECT
  \`product_id\`,
  window_start,
  window_end,
  SUM(TRY_CAST(\`total_amount\` AS DECIMAL(10, 2))) AS total_sales
FROM TABLE(
  TUMBLE(TABLE retail_orders_source, DESCRIPTOR(\`event_time\`), INTERVAL '1' DAY)
)
GROUP BY \`product_id\`, window_start, window_end;
\`\`\`

---

### Example 2: Cross-Topic JOIN — "orders with their return reasons"

\`\`\`sql
CREATE TABLE retail_orders_source (
  \`order_id\` BIGINT,
  \`user_id\` INT,
  \`product_id\` STRING,
  \`status\` STRING,
  \`created_at\` BIGINT,
  \`proc_time\` AS PROCTIME()
) WITH (
  'connector' = 'kafka',
  'topic' = 'retail.orders',
  'properties.bootstrap.servers' = 'broker:9092',
  'properties.group.id' = 'bride-of-flinkenstein-reader',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081',
  'scan.startup.mode' = 'earliest-offset'
);

CREATE TABLE retail_returns_source (
  \`return_id\` BIGINT,
  \`order_id\` BIGINT,
  \`reason\` STRING,
  \`returned_at\` BIGINT
) WITH (
  'connector' = 'kafka',
  'topic' = 'retail.returns',
  'properties.bootstrap.servers' = 'broker:9092',
  'properties.group.id' = 'bride-of-flinkenstein-reader',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081',
  'scan.startup.mode' = 'earliest-offset'
);

CREATE TABLE orders_with_returns_sink (
  \`order_id\` BIGINT,
  \`product_id\` STRING,
  \`status\` STRING,
  \`return_reason\` STRING
) WITH (
  'connector' = 'kafka',
  'topic' = 'retail.orders-with-returns',
  'properties.bootstrap.servers' = 'broker:9092',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081'
);

INSERT INTO orders_with_returns_sink
SELECT
  o.\`order_id\`,
  o.\`product_id\`,
  o.\`status\`,
  r.\`reason\` AS return_reason
FROM retail_orders_source AS o
JOIN retail_returns_source AS r ON o.\`order_id\` = r.\`order_id\`;
\`\`\`

---

### Example 3: Filter — "cancelled orders from the last hour"

\`\`\`sql
CREATE TABLE retail_orders_source (
  \`order_id\` BIGINT,
  \`user_id\` INT,
  \`status\` STRING,
  \`created_at\` BIGINT,
  \`event_time\` AS TO_TIMESTAMP_LTZ(\`created_at\`, 3),
  WATERMARK FOR \`event_time\` AS \`event_time\` - INTERVAL '5' SECOND
) WITH (
  'connector' = 'kafka',
  'topic' = 'retail.orders',
  'properties.bootstrap.servers' = 'broker:9092',
  'properties.group.id' = 'bride-of-flinkenstein-reader',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081',
  'scan.startup.mode' = 'earliest-offset'
);

CREATE TABLE cancelled_orders_sink (
  \`order_id\` BIGINT,
  \`user_id\` INT,
  \`status\` STRING,
  \`event_time\` TIMESTAMP(3)
) WITH (
  'connector' = 'kafka',
  'topic' = 'retail.cancelled-orders',
  'properties.bootstrap.servers' = 'broker:9092',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081'
);

INSERT INTO cancelled_orders_sink
SELECT
  \`order_id\`,
  \`user_id\`,
  \`status\`,
  \`event_time\`
FROM retail_orders_source
WHERE \`status\` = 'CANCELLED'
  AND \`event_time\` > CURRENT_TIMESTAMP - INTERVAL '1' HOUR;
\`\`\`

---

### Example 4: Non-Windowed Aggregation — "count of orders by status"

\`\`\`sql
CREATE TABLE retail_orders_source (
  \`order_id\` BIGINT,
  \`status\` STRING
) WITH (
  'connector' = 'kafka',
  'topic' = 'retail.orders',
  'properties.bootstrap.servers' = 'broker:9092',
  'properties.group.id' = 'bride-of-flinkenstein-reader',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081',
  'scan.startup.mode' = 'earliest-offset'
);

CREATE TABLE order_status_counts_sink (
  \`status\` STRING,
  \`order_count\` BIGINT,
  PRIMARY KEY (\`status\`) NOT ENFORCED
) WITH (
  'connector' = 'upsert-kafka',
  'topic' = 'retail.order-status-counts',
  'properties.bootstrap.servers' = 'broker:9092',
  'value.format' = 'avro-confluent',
  'value.avro-confluent.url' = 'http://schema-registry:8081'
);

INSERT INTO order_status_counts_sink
SELECT
  \`status\`,
  COUNT(*) AS order_count
FROM retail_orders_source
GROUP BY \`status\`;
\`\`\`
`.trim();

module.exports = { FEW_SHOT_EXAMPLES, FLINK_SQL_RULES };
