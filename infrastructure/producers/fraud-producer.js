'use strict';

// fraud-producer.js — Continuous fraud domain event generator
//
// Topics: fraud.alerts
//
// Cross-topic referential integrity (D-06):
//   - transaction_id pool: simulated sequential IDs overlapping with fsi-producer
//     range (100000+). Fraud runs independently, so exact referential integrity
//     requires shared state — simulated pool is the accepted MVP approach (D-316).
//
// Field types match Phase 2 sqlValidationService expectations:
//   - risk_score: double (no cast needed in Flink SQL)
//   - created_at: long epoch millis (TO_TIMESTAMP_LTZ in Flink SQL)
//
// Event rate:
//   fraud.alerts: ~0.5 events/s (2000ms interval); fraud is rarer than transactions

const { createTopicIfNeeded, registerSchema, createProducer, encodeAndSend } = require('./lib/schemaHelper');

// ----- Avro schema (embedded; matches infrastructure/schemas/fraud.alerts.avsc exactly) -----

const FRAUD_ALERTS_SCHEMA = {
  type: 'record',
  name: 'FraudAlert',
  namespace: 'com.bride.fraud',
  fields: [
    { name: 'alert_id', type: 'long' },
    { name: 'transaction_id', type: 'long' },
    { name: 'risk_score', type: 'double' },
    { name: 'alert_type', type: 'string' },
    { name: 'created_at', type: 'long' },
  ],
};

// ----- Static data for realistic generation -----

const ALERT_TYPES = [
  'velocity_check',
  'amount_threshold',
  'geo_anomaly',
  'device_change',
  'pattern_match',
];

// ----- State -----

let alertId = 1;
// Simulated transaction ID pool: start from 100000 to overlap with fsi-producer range
let transactionIdCursor = 100000;

function nextAlertId() {
  return alertId++;
}

/**
 * Returns a plausible transaction_id from the simulated pool.
 * The cursor advances to roughly track what fsi-producer may have emitted
 * at ~1 tx/s, but since producers are independent processes there is no
 * true synchronization. This is the accepted MVP limitation (D-316).
 */
function getNextTransactionId() {
  // Advance cursor ahead of alert cadence to simulate transactions always ahead of fraud
  transactionIdCursor += Math.floor(Math.random() * 3) + 1;
  return transactionIdCursor;
}

function pickFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ----- Record generator -----

function generateFraudAlert() {
  return {
    alert_id: nextAlertId(),
    transaction_id: getNextTransactionId(),
    // risk_score: 0.5-1.0 range (only high-risk events get alerts)
    risk_score: 0.5 + Math.random() * 0.5,
    alert_type: pickFromArray(ALERT_TYPES),
    created_at: Date.now(),
  };
}

// ----- Main startup -----

async function main() {
  console.log('[fraud-producer] Starting...');

  await createTopicIfNeeded('fraud.alerts', 3);

  const fraudAlertsSchemaId = await registerSchema('fraud.alerts', FRAUD_ALERTS_SCHEMA);

  const producer = await createProducer();

  console.log('[fraud-producer] Running. Emitting fraud alert events...');

  // fraud.alerts: ~0.5 events/s (fraud is rarer than other domain events)
  setInterval(async () => {
    try {
      await encodeAndSend(producer, 'fraud.alerts', fraudAlertsSchemaId, [generateFraudAlert()]);
    } catch (err) {
      console.error('[fraud-producer] alerts error:', err.message);
    }
  }, 2000);
}

main().catch((err) => {
  console.error('[fraud-producer] Fatal startup error:', err);
  process.exit(1);
});
