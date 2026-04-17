'use strict';

// fsi-producer.js — Continuous FSI domain event generator
//
// Topics: fsi.transactions, fsi.accounts
//
// Cross-topic referential integrity (D-06):
//   - account_id pool: 1-20 (shared between accounts and transactions)
//   - Transactions always reference an account_id from the pool
//
// Field types match Phase 2 sqlValidationService expectations:
//   - amount, balance: string (TRY_CAST in Flink SQL)
//   - created_at, updated_at: long epoch millis (TO_TIMESTAMP_LTZ in Flink SQL)
//
// Event rates:
//   fsi.transactions: ~1 event/s (1000ms interval)
//   fsi.accounts: ~0.3 events/s (3000ms interval); accounts change rarely

const { createTopicIfNeeded, registerSchema, createProducer, encodeAndSend } = require('./lib/schemaHelper');

// ----- Avro schemas (embedded; match infrastructure/schemas/*.avsc exactly) -----

const TRANSACTIONS_SCHEMA = {
  type: 'record',
  name: 'Transaction',
  namespace: 'com.bride.fsi',
  fields: [
    { name: 'transaction_id', type: 'long' },
    { name: 'account_id', type: 'long' },
    { name: 'amount', type: 'string' },
    { name: 'currency', type: 'string' },
    { name: 'transaction_type', type: 'string' },
    { name: 'created_at', type: 'long' },
  ],
};

const ACCOUNTS_SCHEMA = {
  type: 'record',
  name: 'Account',
  namespace: 'com.bride.fsi',
  fields: [
    { name: 'account_id', type: 'long' },
    { name: 'customer_name', type: 'string' },
    { name: 'account_type', type: 'string' },
    { name: 'balance', type: 'string' },
    { name: 'updated_at', type: 'long' },
  ],
};

// ----- Static data for realistic generation -----

const TRANSACTION_TYPES = ['deposit', 'withdrawal', 'transfer', 'payment'];
const ACCOUNT_TYPES = ['checking', 'savings', 'investment', 'credit'];
const CURRENCIES = ['USD', 'EUR', 'GBP'];

const CUSTOMER_NAMES = [
  'Alice Johnson', 'Bob Martinez', 'Carol White', 'David Lee', 'Emma Brown',
  'Frank Wilson', 'Grace Taylor', 'Henry Anderson', 'Iris Thomas', 'Jack Jackson',
  'Karen Harris', 'Leo Martin', 'Mia Garcia', 'Noah Davis', 'Olivia Rodriguez',
  'Peter Wilson', 'Quinn Moore', 'Rachel Clark', 'Sam Lewis', 'Tara Walker',
];

// Account pool: 20 accounts, IDs 1-20
const ACCOUNT_POOL_SIZE = 20;

// ----- State -----

let transactionId = 100000;

function nextTransactionId() {
  return transactionId++;
}

function pickFromPool(size) {
  return Math.floor(Math.random() * size) + 1;
}

function pickFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatDecimal(min, max, decimals = 2) {
  const value = Math.random() * (max - min) + min;
  return value.toFixed(decimals);
}

// ----- Record generators -----

function generateTransaction() {
  return {
    transaction_id: nextTransactionId(),
    account_id: pickFromPool(ACCOUNT_POOL_SIZE),
    amount: formatDecimal(1, 10000),
    currency: pickFromArray(CURRENCIES),
    transaction_type: pickFromArray(TRANSACTION_TYPES),
    created_at: Date.now(),
  };
}

function generateAccount() {
  const accountId = pickFromPool(ACCOUNT_POOL_SIZE);
  const balance = parseFloat(formatDecimal(0, 50000));
  return {
    account_id: accountId,
    customer_name: CUSTOMER_NAMES[accountId - 1],
    account_type: pickFromArray(ACCOUNT_TYPES),
    balance: balance.toFixed(2),
    updated_at: Date.now(),
  };
}

// ----- Main startup -----

async function main() {
  console.log('[fsi-producer] Starting...');

  await createTopicIfNeeded('fsi.transactions', 3);
  await createTopicIfNeeded('fsi.accounts', 3);

  const transactionsSchemaId = await registerSchema('fsi.transactions', TRANSACTIONS_SCHEMA);
  const accountsSchemaId = await registerSchema('fsi.accounts', ACCOUNTS_SCHEMA);

  const producer = await createProducer();

  console.log('[fsi-producer] Running. Emitting FSI events...');

  // fsi.transactions: ~1 event/s
  setInterval(async () => {
    try {
      await encodeAndSend(producer, 'fsi.transactions', transactionsSchemaId, [generateTransaction()]);
    } catch (err) {
      console.error('[fsi-producer] transactions error:', err.message);
    }
  }, 1000);

  // fsi.accounts: ~0.3 events/s (account snapshots; slower cadence)
  setInterval(async () => {
    try {
      await encodeAndSend(producer, 'fsi.accounts', accountsSchemaId, [generateAccount()]);
    } catch (err) {
      console.error('[fsi-producer] accounts error:', err.message);
    }
  }, 3000);
}

main().catch((err) => {
  console.error('[fsi-producer] Fatal startup error:', err);
  process.exit(1);
});
