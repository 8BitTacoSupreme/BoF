'use strict';

// Dispatch to the correct producer based on PRODUCER_TYPE env var.
// Set by docker-compose.yml per service.

const type = process.env.PRODUCER_TYPE;

if (type === 'retail') {
  require('./retail-producer');
} else if (type === 'fsi') {
  require('./fsi-producer');
} else if (type === 'fraud') {
  require('./fraud-producer');
} else {
  console.error(`Unknown PRODUCER_TYPE: "${type}". Valid values: retail | fsi | fraud`);
  process.exit(1);
}
