'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const images = require('./services/images');
const { notFoundHandler, errorHandler } = require('./middleware/error');

const app = express();

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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    data: {
      status: 'up',
      env: env.NODE_ENV,
      integrations: {
        storage: env.r2Configured,
        // Where a public image goes: the host, the bucket, or nowhere yet.
        publicImages: images.provider(),
        imageHost: env.imgbbConfigured,
        webPush: env.webPushConfigured,
        sms: env.smsConfigured,
        telegram: env.telegramConfigured,
      },
    },
  });
});

app.use('/api/auth', require('./modules/auth/routes'));
app.use('/api/public', require('./modules/public/routes'));
app.use('/api/reseller', require('./modules/reseller/routes'));
app.use('/api/owner', require('./modules/owner/routes'));

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
