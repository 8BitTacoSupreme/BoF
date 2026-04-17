'use strict';

// schemaHelper.js — shared Kafka + Schema Registry setup for all producers
//
// Handles:
//   - Topic creation via Kafka Admin API
//   - Schema registration via @kafkajs/confluent-schema-registry (TopicNameStrategy)
//   - Avro-encoded message production

const { Kafka } = require('kafkajs');
const { SchemaRegistry, SchemaType } = require('@kafkajs/confluent-schema-registry');

// Resolve broker + SR URLs from env (set by docker-compose.yml or direct invocation)
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const SCHEMA_REGISTRY_URL = process.env.SCHEMA_REGISTRY_URL || 'http://localhost:8081';

const kafka = new Kafka({
  clientId: 'bof-producer',
  brokers: KAFKA_BROKERS,
  // Reduce log noise from internal consumer group coordination
  logLevel: 1, // ERROR only
});

const registry = new SchemaRegistry({ host: SCHEMA_REGISTRY_URL });

/**
 * Create a Kafka topic if it does not already exist.
 * @param {string} topicName
 * @param {number} [numPartitions=3] - 3 partitions enables parallelism for Flink consumers
 */
async function createTopicIfNeeded(topicName, numPartitions = 3) {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existing = await admin.listTopics();
    if (!existing.includes(topicName)) {
      await admin.createTopics({
        topics: [{
          topic: topicName,
          numPartitions,
          replicationFactor: 1, // Single-broker local dev
        }],
      });
      console.log(`[schemaHelper] Created topic: ${topicName} (${numPartitions} partitions)`);
    }
  } finally {
    await admin.disconnect();
  }
}

/**
 * Register an Avro schema in Schema Registry using TopicNameStrategy.
 * Subject will be: {topicName}-value
 * Compatible with BACKWARD by default (matches D-07).
 *
 * @param {string} topicName
 * @param {object} avroSchema - Raw Avro schema object (not string)
 * @returns {Promise<number>} Schema ID assigned by Schema Registry
 */
async function registerSchema(topicName, avroSchema) {
  const subject = `${topicName}-value`;
  const { id } = await registry.register(
    {
      type: SchemaType.AVRO,
      schema: JSON.stringify(avroSchema),
    },
    { subject }
  );
  console.log(`[schemaHelper] Registered schema for subject "${subject}" → id=${id}`);
  return id;
}

/**
 * Create an idempotent Kafka producer.
 * idempotent=true → acks=all + enable.idempotence=true (Confluent canonical default)
 *
 * @returns {Promise<import('kafkajs').Producer>}
 */
async function createProducer() {
  const producer = kafka.producer({ idempotent: true });
  await producer.connect();
  return producer;
}

/**
 * Avro-encode records using the given schema ID and send them to a topic.
 *
 * @param {import('kafkajs').Producer} producer
 * @param {string} topicName
 * @param {number} schemaId
 * @param {object[]} records - Array of plain objects matching the Avro schema
 */
async function encodeAndSend(producer, topicName, schemaId, records) {
  const messages = await Promise.all(
    records.map(async (record) => {
      const value = await registry.encode(schemaId, record);
      return { value };
    })
  );
  await producer.send({ topic: topicName, messages });
}

module.exports = {
  createTopicIfNeeded,
  registerSchema,
  createProducer,
  encodeAndSend,
};
