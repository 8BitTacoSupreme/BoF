'use strict';

// Schema Registry Service — REST client for Confluent Schema Registry.
// Supports individual schema fetch, bulk subject discovery, and parallel schema fetch.
//
// Environment:
//   SCHEMA_REGISTRY_URL — e.g. http://schema-registry:8081 (default)
//   RUNNING_IN_DOCKER   — set to 'true' when running inside Docker network

const axios = require('axios');

// Container vs host resolution: when running in Docker, use the container hostname;
// when running on the host, substitute 'localhost' for the service name.
const isRunningInDocker = process.env.RUNNING_IN_DOCKER === 'true';
const SCHEMA_REGISTRY_HOST = process.env.SCHEMA_REGISTRY_URL
  ? process.env.SCHEMA_REGISTRY_URL.replace(
      'schema-registry',
      isRunningInDocker ? 'schema-registry' : 'localhost'
    )
  : (isRunningInDocker ? 'http://schema-registry:8081' : 'http://localhost:8081');

/**
 * getTopicSchema(topicName) — Fetch and parse the latest Avro schema for a topic.
 *
 * Uses the Schema Registry REST API: GET /subjects/{topic}-value/versions/latest
 *
 * @param {string} topicName - Kafka topic name (without the -value suffix)
 * @returns {Promise<Object>} Parsed Avro schema JSON
 * @throws {Error} If the schema is not found or network error occurs
 */
const getTopicSchema = async (topicName) => {
  const subject = `${topicName}-value`;
  const url = `${SCHEMA_REGISTRY_HOST}/subjects/${encodeURIComponent(subject)}/versions/latest`;

  try {
    const response = await axios.get(url);
    const schemaString = response.data.schema;
    if (!schemaString) {
      throw new Error(`Schema string not found in response for topic: ${topicName}`);
    }
    return JSON.parse(schemaString);
  } catch (error) {
    if (error.response && error.response.status === 404) {
      throw new Error(`Schema not found for topic: ${topicName}`);
    }
    // Re-throw network or parse errors
    throw new Error(`Could not fetch schema for topic '${topicName}': ${error.message}`);
  }
};

/**
 * getAllSubjects() — Fetch all registered subjects from Schema Registry.
 *
 * Filters to only -value subjects (skips -key subjects), then strips the -value
 * suffix to return plain topic names.
 *
 * @returns {Promise<string[]>} Array of topic names (e.g. ['retail.orders', 'retail.products'])
 */
const getAllSubjects = async () => {
  const url = `${SCHEMA_REGISTRY_HOST}/subjects`;
  const response = await axios.get(url);
  const subjects = response.data || [];

  // Only return -value subjects; strip the suffix to get topic names
  return subjects
    .filter((s) => typeof s === 'string' && s.endsWith('-value'))
    .map((s) => s.slice(0, -'-value'.length));
};

/**
 * getAllSchemas(topics) — Parallel bulk fetch of schemas for all specified topics.
 *
 * If topics is null/undefined, discovers them via getAllSubjects() first.
 * Topics that have no registered schema (404) return null — errors do not propagate.
 *
 * @param {string[]|null|undefined} topics - Optional topic names to fetch
 * @returns {Promise<Object>} Map of { topicName: parsedAvroSchema | null }
 */
const getAllSchemas = async (topics) => {
  if (!topics) {
    topics = await getAllSubjects();
  }

  const results = {};
  await Promise.all(
    topics.map(async (topic) => {
      try {
        results[topic] = await getTopicSchema(topic);
      } catch (e) {
        // Return null for missing or inaccessible schemas — callers handle absent schemas gracefully
        results[topic] = null;
      }
    })
  );
  return results;
};

module.exports = { getTopicSchema, getAllSchemas, getAllSubjects };
