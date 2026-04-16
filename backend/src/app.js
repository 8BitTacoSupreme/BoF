'use strict';

/**
 * app.js — Express application factory.
 *
 * Separated from server.js so tests can import the app without starting the HTTP server.
 */

const express = require('express');
const cors = require('cors');
const router = require('./routes/api');

const app = express();

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── API Routes ──────────────────────────────────────────────────────────────
app.use('/api', router);

// ── Global error handler ────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
