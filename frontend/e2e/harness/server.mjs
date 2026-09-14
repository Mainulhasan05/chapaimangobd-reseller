/*
 * The end-to-end harness. Playwright starts this as its webServer.
 *
 * One Node process holds the whole backend:
 *
 *   1. an in-memory MongoDB replica set (transactions need one),
 *   2. the Express API, required in-process rather than spawned, so that
 *   3. a control port on 127.0.0.1 can hand the tests things no public endpoint
 *      ever should: the last OTP sent to a phone (read from the backend's own
 *      NODE_ENV=test hook, services/otp.js `__lastCodeFor`).
 *
 * It then spawns the built Next app (`next start`) against that API.
 *
 * Why in-process: OTP codes are stored only as peppered HMACs, so a test cannot
 * read one from the database, and adding an HTTP route to the API that returns
 * codes would be a backdoor waiting to ship. The control port lives only in this
 * file, which production never loads, and binds to loopback only.
 *
 * Safety: the backend's config/env.js calls `require('dotenv').config()`, which
 * would read backend/.env (the production Atlas URI) if the harness were started
 * from that directory. dotenv is neutralised before env.js is loaded, every
 * variable env.js reads is set explicitly here, and the resulting config is
 * checked to point at the in-memory server before anything connects.
 *
 * Also storage: KYC scans go to the private R2 bucket, which a test run has no
 * credentials for. The storage module's exports are replaced in this process by
 * an in-memory store, which is the seam; production code is untouched.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..', '..');
const BACKEND = path.resolve(FRONTEND, '..', 'backend');

const PORTS = {
  // The frontend build bakes the API rewrite destination in at build time, and
  // the default build points at localhost:4000. See next.config.ts.
  api: Number(process.env.E2E_API_PORT ?? 4000),
  web: Number(process.env.E2E_WEB_PORT ?? 3222),
  control: Number(process.env.E2E_CONTROL_PORT ?? 3223),
};

const OWNER = { phone: '01700000000', password: 'ownerpass123' };

const log = (...args) => console.log('[e2e-harness]', ...args);

/** The environment the Next child gets: the caller's, minus nothing it sets below. */
const parentEnv = { ...process.env };

function fail(message) {
  console.error(`[e2e-harness] ${message}`);
  shutdown(1);
  // Stops the caller; shutdown exits the process once cleanup is done.
  throw new Error(message);
}

/* ------------------------------------------------------------- preflight -- */

function assertBuilt() {
  const buildId = path.join(FRONTEND, '.next', 'BUILD_ID');
  const routes = path.join(FRONTEND, '.next', 'routes-manifest.json');
  if (!existsSync(buildId) || !existsSync(routes)) {
    fail('No production build found. Run `npm run build` in frontend/ first.');
  }
  // Refuse a build whose API rewrite points somewhere other than this harness,
  // or every browser call would go to whatever is listening there instead.
  const manifest = readFileSync(routes, 'utf8');
  const expected = [`localhost:${PORTS.api}/api`, `127.0.0.1:${PORTS.api}/api`];
  if (!expected.some((needle) => manifest.includes(needle))) {
    fail(
      `The frontend build does not rewrite /api to port ${PORTS.api}. ` +
        `Rebuild with API_ORIGIN=http://localhost:${PORTS.api} npm run build.`
    );
  }
}

async function assertPortFree(port, label) {
  await new Promise((resolve) => {
    const probe = http
      .get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
        res.resume();
        fail(
          `Something is already listening on ${label} port ${port}. Stop it first: ` +
            'the e2e run must never talk to a development server or a real database.'
        );
      })
      .on('error', () => resolve())
      .on('timeout', () => {
        probe.destroy();
        resolve();
      });
  });
}

/* ------------------------------------------------------------ environment -- */

/**
 * Every variable backend/src/config/env.js reads, set explicitly. Optional
 * integrations are set to the empty string rather than deleted: dotenv never
 * overwrites a key that exists, and env.js treats empty as unset.
 */
function backendEnv(mongoUri) {
  return {
    NODE_ENV: 'test', // enables the OTP test hook; logging is silent
    PORT: String(PORTS.api),
    APP_URL: `http://127.0.0.1:${PORTS.web}`,
    MONGODB_URI: mongoUri,
    JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdefghijklmnop',
    JWT_REFRESH_SECRET: 'e2e-refresh-secret-9876543210zyxwvutsrqponmlk',
    OTP_PEPPER: 'e2e-otp-pepper-abcdefghijklmnopqrstuvwxyz012345',
    // On, as in production: the owner signs in with a device code once, in the
    // setup project, and every later owner context reuses that trusted device.
    OWNER_DEVICE_OTP: 'true',
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL_DAYS: '30',
    COOKIE_SECURE: 'false',
    COOKIE_DOMAIN: '',
    TRUST_PROXY: '0',
    LOG_LEVEL: 'error',
    RUN_JOBS: 'false',
    OWNER_NAME: 'E2E Owner',
    OWNER_PHONE: OWNER.phone,
    OWNER_PASSWORD: OWNER.password,
    R2_ACCOUNT_ID: '',
    R2_ACCESS_KEY_ID: '',
    R2_SECRET_ACCESS_KEY: '',
    R2_BUCKET: '',
    R2_PUBLIC_BUCKET: '',
    R2_PUBLIC_BASE_URL: '',
    IMGBB_API_KEY: '',
    VAPID_PUBLIC_KEY: '',
    VAPID_PRIVATE_KEY: '',
    SMS_API_KEY: '',
    SMS_SENDER_ID: '',
    AUTOMAS_API_KEY: '',
    AUTOMAS_SENDER_ID: '',
    PUBLIC_APP_URL: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_BOT_USERNAME: '',
    TELEGRAM_WEBHOOK_URL: '',
    TELEGRAM_WEBHOOK_SECRET: '',
  };
}

/* ---------------------------------------------------------------- storage -- */

/**
 * Replaces the private-bucket half of config/storage.js with a Map. Every
 * caller reaches storage through the module object (`storage.uploadBuffer`),
 * so swapping the exported functions is enough. Signed URLs become data URLs,
 * which the owner's KYC review renders in a plain <img>.
 */
function installMemoryStorage(storage) {
  const objects = new Map();
  let counter = 0;

  storage.uploadBuffer = async (buffer, { folder, contentType }) => {
    counter += 1;
    const key = `${storage.prefixFor(folder)}/e2e-${counter}`;
    objects.set(key, { buffer: Buffer.from(buffer), contentType });
    return { key, size: buffer.length, contentType };
  };
  storage.signedUrl = async (key) => {
    const object = objects.get(key);
    if (!object) return null;
    return `data:${object.contentType};base64,${object.buffer.toString('base64')}`;
  };
  storage.destroy = async (key) => {
    objects.delete(key);
  };
}

/* ----------------------------------------------------------------- control -- */

function startControlServer({ otp, env }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORTS.control}`);
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });

      // GET /otp?phone=01XXXXXXXXX&purpose=register
      if (req.method === 'GET' && url.pathname === '/otp') {
        const { normalizeBdPhone } = backendRequire('./src/utils/phone');
        const phone = normalizeBdPhone(url.searchParams.get('phone') ?? '');
        const code = otp.__lastCodeFor(phone, url.searchParams.get('purpose') || undefined);
        return code ? send(200, { code }) : send(404, { error: 'no code sent to that phone' });
      }

      if (req.method === 'GET' && url.pathname === '/config') {
        return send(200, { ownerPhone: OWNER.phone, ownerPassword: OWNER.password, smsConfigured: env.smsConfigured });
      }

      return send(404, { error: 'not found' });
    } catch (err) {
      return send(500, { error: err.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORTS.control, '127.0.0.1', () => resolve(server));
  });
}

/* ------------------------------------------------------------------- boot -- */

const backendRequire = createRequire(path.join(BACKEND, 'package.json'));
const children = [];
let replset = null;
const servers = [];

async function waitFor(url, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  fail(`${label} did not come up within ${timeoutMs / 1000}s`);
}

function listen(app, host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORTS.api, host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

async function main() {
  assertBuilt();
  await assertPortFree(PORTS.api, 'API');
  await assertPortFree(PORTS.control, 'control');

  // 1. Neutralise dotenv before anything from the backend can call it.
  const dotenv = backendRequire('dotenv');
  dotenv.config = () => ({ parsed: {} });

  // 2. The throwaway database. Reuses the binary the backend tests downloaded.
  const cacheDir = path.join(BACKEND, 'node_modules', '.cache', 'mongodb-memory-server');
  if (!process.env.MONGOMS_DOWNLOAD_DIR && existsSync(cacheDir)) process.env.MONGOMS_DOWNLOAD_DIR = cacheDir;
  const { MongoMemoryReplSet } = backendRequire('mongodb-memory-server');
  log('starting in-memory replica set');
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const mongoUri = replset.getUri('e2e');

  // 3. Explicit environment, then load the config and prove where it points.
  Object.assign(process.env, backendEnv(mongoUri));
  const env = backendRequire('./src/config/env');
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(env.MONGODB_URI) || env.isProd || !env.isTest) {
    fail(`refusing to start: MONGODB_URI=${env.MONGODB_URI}, NODE_ENV=${env.NODE_ENV}`);
  }
  if (env.smsConfigured || env.telegramConfigured || env.r2Configured || env.imgbbConfigured) {
    fail('refusing to start: an external integration is configured');
  }

  // 4. Connect, create every collection up front (implicit creation is not
  //    allowed inside a transaction) and seed the single owner.
  const mongoose = backendRequire('mongoose');
  const { connect } = backendRequire('./src/config/db');
  await connect(mongoUri);
  const fs = await import('node:fs');
  for (const file of fs.readdirSync(path.join(BACKEND, 'src', 'models')).filter((f) => f.endsWith('.js'))) {
    backendRequire(`./src/models/${file}`);
  }
  await Promise.all(Object.values(mongoose.models).map((model) => model.createCollection()));
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
  await backendRequire('./src/seed/seedOwner')();

  // 5. Storage seam, then the app itself.
  installMemoryStorage(backendRequire('./src/config/storage'));
  const app = backendRequire('./src/app');
  const otp = backendRequire('./src/services/otp');
  if (typeof otp.__lastCodeFor !== 'function') fail('the OTP test hook is not available');

  backendRequire('./src/services/outbox').startOutboxWorker();

  // Both loopbacks: the build rewrites to `localhost`, which Node may resolve
  // to either. Never all interfaces.
  servers.push(await listen(app, '127.0.0.1'));
  try {
    servers.push(await listen(app, '::1'));
  } catch {
    log('IPv6 loopback unavailable, API on 127.0.0.1 only');
  }
  servers.push(await startControlServer({ otp, env }));
  log(`API on :${PORTS.api}, control on 127.0.0.1:${PORTS.control}`);

  // 6. The built Next app. Its fetch cache from an earlier run would serve a
  //    shop page rendered against a database that no longer exists.
  rmSync(path.join(FRONTEND, '.next', 'cache', 'fetch-cache'), { recursive: true, force: true });
  const nextBin = path.join(FRONTEND, 'node_modules', 'next', 'dist', 'bin', 'next');
  const web = spawn(
    process.execPath,
    [nextBin, 'start', '--port', String(PORTS.web), '--hostname', '127.0.0.1'],
    {
      cwd: FRONTEND,
      env: { ...parentEnv, API_ORIGIN: `http://127.0.0.1:${PORTS.api}`, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  children.push(web);
  web.stdout.on('data', (chunk) => {
    if (process.env.E2E_VERBOSE) process.stdout.write(`[next] ${chunk}`);
  });
  web.stderr.on('data', (chunk) => process.stderr.write(`[next] ${chunk}`));
  web.on('exit', (code) => {
    if (!shuttingDown) fail(`next start exited with code ${code}`);
  });

  await waitFor(`http://127.0.0.1:${PORTS.web}/login`, 'Next');
  log(`ready: web http://127.0.0.1:${PORTS.web}`);
}

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // Already gone.
    }
  }
  for (const server of servers) server.close();
  try {
    await backendRequire('./src/services/outbox').stopOutboxWorker();
    await backendRequire('mongoose').disconnect();
  } catch {
    // Best effort.
  }
  if (replset) await replset.stop().catch(() => {});
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGBREAK', () => shutdown(0));

main().catch((err) => {
  if (!shuttingDown) console.error('[e2e-harness] failed to start:', err);
  shutdown(1);
});
