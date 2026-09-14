'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const { httpLogger } = require('./config/logger');
const { databaseIsUp } = require('./config/db');
const { notFoundHandler, errorHandler } = require('./middleware/error');

const app = express();

// First, so every later line, including an error, carries the request id.
app.use(httpLogger);

// The exact number of proxy hops. Guessing here either collapses every client
// into one rate-limit bucket or lets X-Forwarded-For be attacker controlled.
app.set('trust proxy', env.TRUST_PROXY);

app.use(helmet());

// In production the browser only ever talks to the Next origin, which rewrites
// to this API, so no cross-origin request should exist. See docs/adr/0005.
// In development the Next dev server may call directly, so allow that one origin.
if (!env.isProd) {
  app.use(cors({ origin: env.APP_URL, credentials: true }));
}

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());

/*
 * Public, because a load balancer probes it without credentials, and so it says
 * only whether this instance can serve: is the database reachable. Which
 * integrations are configured is a map for an attacker and lives behind the
 * owner login at /api/owner/system/health instead.
 */
app.get('/api/health', async (_req, res) => {
  const db = (await databaseIsUp()) ? 'up' : 'down';
  res.status(db === 'up' ? 200 : 503).json({ ok: db === 'up', db });
});

app.use('/api/auth', require('./modules/auth/routes'));
app.use('/api/public', require('./modules/public/routes'));
app.use('/api/reseller', require('./modules/reseller/routes'));
app.use('/api/owner', require('./modules/owner/routes'));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
