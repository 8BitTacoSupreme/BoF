'use strict';

// kafkaConsumerService.js
// Per-request KafkaJS consumer for tailing output topic messages.
//
// Design decisions:
// - Per-request consumers with unique groupId per call (per Pitfall 4 in RESEARCH.md —
//   no group offset pollution across requests).
// - 5-second timeout: if fewer messages than limit arrive within 5s, return what we have.
// - sinceOffset support: enables incremental polling from frontend (per D-310).
//   Frontend passes highest seen offset; backend seeks to it on GROUP_JOIN.
// - nextOffset in response: frontend tracks position for the next poll cycle.
// - Graceful error handling: missing topics return empty array instead of throwing
//   (per Pitfall 5 in RESEARCH.md).
// - disconnect() always called in finally block to avoid consumer group leaks.

const { Kafka } = require('kafkajs');

// ── Environment configuration ──────────────────────────────────────────────

const isRunningInDocker = process.env.RUNNING_IN_DOCKER === 'true';

// Support comma-separated broker list from environment
const KAFKA_BROKERS = (
  process.env.KAFKA_BROKERS ||
  (isRunningInDocker ? 'broker:9092' : 'localhost:9092')
).split(',');

// KafkaJS client instance — shared across requests to reuse TCP connections
// while still creating a fresh consumer per request for isolation.
const kafka = new Kafka({
  clientId: 'bride-of-flinkenstein-tailer',
  brokers: KAFKA_BROKERS,
});

// ── Core function ──────────────────────────────────────────────────────────

/**
 * tailMessages(topicName, limit, sinceOffset)
 *
 * Creates a one-off KafkaJS consumer with a unique groupId, consumes up to
 * `limit` messages (or times out after 5s), disconnects, and returns the messages.
 *
 * Per D-310: polling pattern, per-request consumer, no persistent connections.
 * Per RESEARCH.md Pitfall 4: unique groupId per request to avoid offset pollution.
 * Per RESEARCH.md Pitfall 5: missing topics return empty result, not thrown error.
 *
 * @param {string} topicName - Kafka topic to tail
 * @param {number} [limit=10] - Max messages to return
 * @param {string|null} [sinceOffset=null] - Start from this offset (inclusive).
 *   Pass null to start from the beginning. Pass a numeric string to seek.
 * @returns {Promise<{messages: Array<{offset: string, value: string|null, timestamp: string}>, nextOffset: number}>}
 */
async function tailMessages(topicName, limit = 10, sinceOffset = null) {
  // Unique groupId per request — prevents Kafka group offset tracking from
  // returning zero results on subsequent polls (Pitfall 4)
  const groupId = `bof-tail-${topicName}-${Date.now()}`;
  const consumer = kafka.consumer({ groupId });
  const messages = [];

  try {
    await consumer.connect();

    await consumer.subscribe({
      topics: [topicName],
      // fromBeginning=true when no sinceOffset (fetch from start of topic)
      // fromBeginning=false when sinceOffset provided (consumer.seek handles the offset)
      fromBeginning: sinceOffset === null,
    });

    // Register GROUP_JOIN handler to seek to sinceOffset once partition is assigned.
    // Must register BEFORE consumer.run() to ensure the callback fires.
    if (sinceOffset !== null) {
      consumer.on(consumer.events.GROUP_JOIN, () => {
        consumer.seek({
          topic: topicName,
          partition: 0, // MVP: single-partition seek; multi-partition support deferred
          offset: String(sinceOffset),
        });
      });
    }

    await new Promise((resolve, reject) => {
      // Timeout: resolve after 5s if fewer messages than limit arrive.
      // This handles the case where the output topic has fewer messages than requested.
      const timeout = setTimeout(() => resolve(), 5000);

      consumer
        .run({
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
          },
        })
        .then(() => {
          // run() resolving means the consumer has finished processing available
          // messages (e.g. mock returns, or real consumer drains the assigned partitions).
          // Resolve the outer promise so we don't wait the full timeout.
          clearTimeout(timeout);
          resolve();
        })
        .catch(reject);
    });
  } catch (err) {
    // Graceful handling for missing topics, auth errors, etc.
    // Return empty array instead of propagating the error (Pitfall 5).
    // The frontend's 30s no-messages timer handles the wait gracefully (D-311).
    console.warn(`tailMessages(${topicName}): ${err.message}`);
  } finally {
    // Always disconnect to release consumer resources and clean up the ephemeral group
    await consumer.disconnect().catch(() => {});
  }

  // Calculate nextOffset from the highest message offset seen.
  // Frontend passes this back as sinceOffset on the next poll to avoid re-sending messages.
  const highestOffset =
    messages.length > 0
      ? Math.max(...messages.map((m) => Number(m.offset)))
      : -1;

  return {
    messages,
    nextOffset: highestOffset + 1, // 0 when no messages received
  };
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = { tailMessages };
