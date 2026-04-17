'use strict';

// retail-producer.js — Continuous retail domain event generator
//
// Topics: retail.orders, retail.returns, retail.products
//
// Cross-topic referential integrity (D-06):
//   - product_id pool: 1-50 (shared between orders and products)
//   - recentOrderIds ring buffer: last 100 order_ids, used by returns
//   - Returns always reference an order that was recently produced
//
// Field types match Phase 2 sqlValidationService expectations:
//   - total_amount, refund_amount, price: string (TRY_CAST in Flink SQL)
//   - created_at, updated_at: long epoch millis (TO_TIMESTAMP_LTZ in Flink SQL)
//
// Event rates:
//   retail.orders: ~2 events/s (500ms interval)
//   retail.returns: ~1 event/s (1000ms interval); ~50% return rate is unrealistically high
//                   but ensures JOIN queries produce results quickly
//   retail.products: ~0.5 events/s (2000ms interval); products change slowly

const { createTopicIfNeeded, registerSchema, createProducer, encodeAndSend } = require('./lib/schemaHelper');

// ----- Avro schemas (embedded; match infrastructure/schemas/*.avsc exactly) -----

const ORDERS_SCHEMA = {
  type: 'record',
  name: 'Order',
  namespace: 'com.bride.retail',
  fields: [
    { name: 'order_id', type: 'long' },
    { name: 'customer_id', type: 'long' },
    { name: 'product_id', type: 'long' },
    { name: 'quantity', type: 'int' },
    { name: 'total_amount', type: 'string' },
    { name: 'status', type: 'string' },
    { name: 'created_at', type: 'long' },
  ],
};

const RETURNS_SCHEMA = {
  type: 'record',
  name: 'Return',
  namespace: 'com.bride.retail',
  fields: [
    { name: 'return_id', type: 'long' },
    { name: 'order_id', type: 'long' },
    { name: 'product_id', type: 'long' },
    { name: 'reason', type: 'string' },
    { name: 'refund_amount', type: 'string' },
    { name: 'created_at', type: 'long' },
  ],
};

const PRODUCTS_SCHEMA = {
  type: 'record',
  name: 'Product',
  namespace: 'com.bride.retail',
  fields: [
    { name: 'product_id', type: 'long' },
    { name: 'name', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'price', type: 'string' },
    { name: 'updated_at', type: 'long' },
  ],
};

// ----- Static data for realistic generation -----

const PRODUCT_NAMES = [
  'Wireless Earbuds Pro', 'USB-C Hub 7-Port', 'Mechanical Keyboard', 'Monitor 27" 4K',
  'Ergonomic Mouse', 'Webcam 1080p', 'Standing Desk Converter', 'Laptop Stand Aluminum',
  'Cable Management Kit', 'Power Bank 20000mAh', 'Smart Watch Series 5', 'Fitness Tracker',
  'Bluetooth Speaker Portable', 'Noise Cancelling Headphones', 'Tablet Case 10"',
  'Cotton Crew T-Shirt', 'Slim Fit Jeans Dark Blue', 'Running Shoes Lite', 'Winter Parka',
  'Casual Sneakers White', 'Yoga Pants High Waist', 'Polo Shirt Classic', 'Hoodie Zip-Up',
  'Leather Belt Brown', 'Wool Beanie',
  'Coffee Maker Drip 12-Cup', 'Air Purifier HEPA', 'Robot Vacuum Cleaner', 'Smart Thermostat',
  'LED Desk Lamp', 'Storage Ottoman', 'Throw Pillow Set 4pc', 'Candle Set Lavender',
  'Wall Clock Minimalist', 'Bamboo Cutting Board',
  'Yoga Mat Non-Slip', 'Resistance Bands Set', 'Foam Roller', 'Water Bottle 32oz',
  'Gym Gloves', 'Protein Shaker Bottle', 'Jump Rope Speed', 'Pull-Up Bar Doorway',
  'Dumbbells Adjustable 20lb', 'Knee Sleeves Pair',
  'Novel - The Last Signal', 'Data Structures & Algorithms', 'Kafka: The Definitive Guide',
  'Sketch Book 9x12', 'Watercolor Set 24 Colors',
];

const CATEGORIES = ['electronics', 'clothing', 'home', 'sports', 'books', 'beauty'];
const ORDER_STATUSES = ['completed', 'pending', 'cancelled', 'shipped'];
const RETURN_REASONS = ['defective', 'wrong_size', 'not_as_described', 'changed_mind', 'late_delivery'];

// ----- State for cross-topic referential integrity -----

let orderId = 1000;
let returnId = 1;
/** Ring buffer of last 100 order_ids for returns to reference */
const recentOrderIds = [];
const RING_BUFFER_SIZE = 100;

function nextOrderId() {
  return orderId++;
}

function nextReturnId() {
  return returnId++;
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

function generateOrder() {
  const id = nextOrderId();
  const productId = pickFromPool(50);
  const quantity = Math.floor(Math.random() * 5) + 1;
  const unitPrice = parseFloat(formatDecimal(5, 500));
  const record = {
    order_id: id,
    customer_id: pickFromPool(1000),
    product_id: productId,
    quantity,
    total_amount: (unitPrice * quantity).toFixed(2),
    status: pickFromArray(ORDER_STATUSES),
    created_at: Date.now(),
  };
  // Push to ring buffer for returns to reference
  recentOrderIds.push({ order_id: id, product_id: productId });
  if (recentOrderIds.length > RING_BUFFER_SIZE) recentOrderIds.shift();
  return record;
}

function generateReturn() {
  if (recentOrderIds.length === 0) return null; // Nothing to return yet
  const sourceOrder = pickFromArray(recentOrderIds);
  const unitPrice = parseFloat(formatDecimal(5, 500));
  return {
    return_id: nextReturnId(),
    order_id: sourceOrder.order_id,
    product_id: sourceOrder.product_id,
    reason: pickFromArray(RETURN_REASONS),
    refund_amount: (unitPrice * (Math.floor(Math.random() * 3) + 1)).toFixed(2),
    created_at: Date.now(),
  };
}

function generateProduct() {
  const productId = pickFromPool(50);
  return {
    product_id: productId,
    name: PRODUCT_NAMES[productId - 1] || `Product ${productId}`,
    category: CATEGORIES[Math.floor((productId - 1) / 9)] || 'other',
    price: formatDecimal(5, 500),
    updated_at: Date.now(),
  };
}

// ----- Main startup -----

async function main() {
  console.log('[retail-producer] Starting...');

  // Ensure topics exist before registering schemas
  await createTopicIfNeeded('retail.orders', 3);
  await createTopicIfNeeded('retail.returns', 3);
  await createTopicIfNeeded('retail.products', 3);

  const ordersSchemaId = await registerSchema('retail.orders', ORDERS_SCHEMA);
  const returnsSchemaId = await registerSchema('retail.returns', RETURNS_SCHEMA);
  const productsSchemaId = await registerSchema('retail.products', PRODUCTS_SCHEMA);

  const producer = await createProducer();

  console.log('[retail-producer] Running. Emitting retail events...');

  // retail.orders: ~2 events/s
  setInterval(async () => {
    try {
      await encodeAndSend(producer, 'retail.orders', ordersSchemaId, [generateOrder()]);
    } catch (err) {
      console.error('[retail-producer] orders error:', err.message);
    }
  }, 500);

  // retail.returns: ~1 event/s (references recentOrderIds)
  setInterval(async () => {
    try {
      const ret = generateReturn();
      if (ret) {
        await encodeAndSend(producer, 'retail.returns', returnsSchemaId, [ret]);
      }
    } catch (err) {
      console.error('[retail-producer] returns error:', err.message);
    }
  }, 1000);

  // retail.products: ~0.5 events/s (catalog updates are slow)
  setInterval(async () => {
    try {
      await encodeAndSend(producer, 'retail.products', productsSchemaId, [generateProduct()]);
    } catch (err) {
      console.error('[retail-producer] products error:', err.message);
    }
  }, 2000);
}

main().catch((err) => {
  console.error('[retail-producer] Fatal startup error:', err);
  process.exit(1);
});
