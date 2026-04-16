'use strict';

/**
 * index.js — HTTP server entry point.
 *
 * Start with: node index.js
 * Requires: ANTHROPIC_API_KEY env var (see .env.example)
 */

const app = require('./src/app');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`bride-of-flinkenstein backend listening on http://localhost:${PORT}`);
});
