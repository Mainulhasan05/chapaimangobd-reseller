'use strict';

const crypto = require('node:crypto');
const pino = require('pino');
const pinoHttp = require('pino-http');
const env = require('./env');

/**
 * One JSON line per event, so a log shipper can index it without regexes.
 * Tests stay silent: a failing assertion is easier to read without a wall of
 * request lines around it.
 */
const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'chapaimango-api' },
  // A session cookie or bearer token in a log file is a session anyone with log
  // access can replay.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
});

/*
 * An id a proxy already assigned is kept, so one request can be followed from
 * the edge to here. It is capped and restricted to a safe alphabet, because it
 * is echoed into a response header and every log line.
 */
const INCOMING_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const requestId = (req, res) => {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && INCOMING_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
};

const httpLogger = pinoHttp({
  logger,
  genReqId: requestId,
  // The health probe fires every few seconds and says nothing worth keeping.
  autoLogging: { ignore: (req) => req.url === '/api/health' },
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, headers: req.headers }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

module.exports = { logger, httpLogger };
