'use strict';

/*
 * `SKIP_DOTENV=true` means the environment is already complete and `.env` must
 * not be read. The smoke test sets it: its servers run from this directory, and
 * a developer's `.env` would otherwise fill in a real SMS gateway, Telegram bot
 * or storage bucket behind a throwaway database.
 */
if (process.env.SKIP_DOTENV !== 'true') require('dotenv').config();
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  // Further browser origins allowed to call this API cross-origin, comma
  // separated. APP_URL is always allowed; this names the ones it cannot, such
  // as a second front end domain or a phone on the LAN hitting the dev server.
  CORS_ORIGINS: z.string().optional(),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  // 32 characters is the floor for an HMAC key that is not brute forceable
  // offline from a single captured token. The two must differ, or a refresh
  // token would verify as an access token.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  // Mixed into every stored OTP hash, so a leaked database does not hand over a
  // six digit code by brute force in a millisecond. Falls back to the refresh
  // secret when unset. Changing it voids codes already sent, nothing else.
  OTP_PEPPER: z.string().min(32, 'OTP_PEPPER must be at least 32 chars').optional(),
  /*
   * The owner's new-device OTP (docs/adr/0014), off unless switched on.
   *
   * It used to be on everywhere and could not be turned off in production. The
   * owner runs this business from one phone, and a code on every sign-in from a
   * browser that had cleared its cookies meant waiting on the SMS gateway to
   * reach their own orders — a gateway which, when it is the thing that has
   * broken, locks them out exactly when they need to look.
   *
   * What it costs: the owner's password alone now opens every reseller's money.
   * Set this to `true` for any setup where more than one person holds it.
   */
  OWNER_DEVICE_OTP: z.enum(['true', 'false', '1', '0']).default('false'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Left unset, this follows NODE_ENV: on in production, off elsewhere. Setting
  // it to false in production is refused at boot, see below.
  COOKIE_SECURE: z.enum(['true', 'false', '1', '0']).optional(),
  COOKIE_DOMAIN: z.string().optional(),

  // Number of proxy hops in front of Express. Wrong values either collapse every
  // client into one rate-limit bucket or let X-Forwarded-For be attacker controlled.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  // Ignored under NODE_ENV=test, where logging is silent.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Cloudflare R2, which speaks the S3 API. The bucket is private; KYC scans and
  // deposit screenshots are only ever reachable through short-lived signed URLs.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  // The private bucket. KYC scans and deposit screenshots live here and it must
  // never have public access enabled.
  R2_BUCKET: z.string().optional(),
  // A SEPARATE bucket for customer-facing images. R2 public access is bucket
  // wide, so product photos cannot share a bucket with national ID scans.
  R2_PUBLIC_BUCKET: z.string().optional(),
  // Everything this app writes lives under this one prefix, so the bucket stays
  // legible and a second environment can share it without collisions.
  R2_PREFIX: z.string().default('chapaimango'),
  // Where the bucket is exposed for customer-facing images (product photos and
  // shop logos). An r2.dev subdomain or a custom domain. Private files never
  // use this.
  R2_PUBLIC_BASE_URL: z.string().url().optional(),

  // ImgBB hosts every image a customer or a logged-out visitor may see: product
  // photographs, shop logos, brand assets. It is a free image host with no
  // bucket, no signing and no egress bill, which is the whole reason it is here.
  // Nothing private ever goes to it. KYC scans and deposit screenshots stay in
  // R2, behind signed URLs, because ImgBB has no notion of a private image.
  IMGBB_API_KEY: z.string().optional(),
  IMGBB_UPLOAD_URL: z.string().url().default('https://api.imgbb.com/1/upload'),
  // A slow third party must not hold an Express worker open indefinitely.
  IMGBB_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:support@example.com'),

  // Automas, the SMS gateway. The AUTOMAS_ names are what the dashboard calls
  // them and are what a new deployment should set; the SMS_ names are the
  // originals and still work, so an existing .env keeps booting untouched.
  SMS_API_URL: z.string().default('https://api.automas.com.bd/smsapiv3'),
  // Lowercase, and it is not a path under smsapiv3. It answers
  // `{"response":"104"}`, a count of messages rather than a sum of money.
  SMS_BALANCE_URL: z.string().default('https://api.automas.com.bd/getbalance'),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  AUTOMAS_API_KEY: z.string().optional(),
  AUTOMAS_SENDER_ID: z.string().optional(),

  // Where customers reach the site, for the tracking link in a customer SMS.
  // Unset, the link is left out of the message rather than pointing at localhost.
  PUBLIC_APP_URL: z.string().url().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // Without the @. Read from the bot itself (getMe) when unset.
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  // Set to switch the bot from polling to a webhook. The public base URL of this
  // API; the bot registers `${TELEGRAM_WEBHOOK_URL}/api/telegram/webhook/<secret>`.
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),
  // Required with the webhook. Telegram's own rule for secret_token: 1-256 of
  // letters, digits, underscore and hyphen.
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,256}$/, 'TELEGRAM_WEBHOOK_SECRET must be 16-256 of A-Z a-z 0-9 _ -')
    .optional(),

  // Scheduled jobs (nightly reconciliation, 09:00 digest, KYC purge) run only in
  // a process with this set. Each job also takes a MongoDB lock, so turning it
  // on for every instance is safe, just wasteful. See docs/adr/0012.
  RUN_JOBS: z.enum(['true', 'false', '1', '0']).default('false'),
  // The digest warns the owner when the gateway's remaining balance falls below
  // this. Automas reports a count of messages, not taka, so this is a count.
  SMS_LOW_BALANCE: z.coerce.number().int().min(0).default(200),
});

/**
 * A blank line in .env means "not set", which is how every optional integration
 * ships. Zod treats an empty string as a present value, so `R2_PUBLIC_BASE_URL=`
 * failed url validation and took the whole process down at boot. Dropping empty
 * values first makes an unset variable behave the same whether the line is absent
 * or present and blank.
 */
const provided = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== '')
);

const parsed = schema.safeParse(provided);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}

const env = parsed.data;

/*
 * Rules that span more than one variable. Each one is a way a production
 * deployment can look healthy while being quietly insecure, so boot stops.
 */
const problems = [];
if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
}
const cookieSecureSetting =
  env.COOKIE_SECURE === undefined
    ? undefined
    : env.COOKIE_SECURE === 'true' || env.COOKIE_SECURE === '1';
if (env.NODE_ENV === 'production' && cookieSecureSetting === false) {
  // A session cookie sent over plain HTTP is a session anyone on the cafe wifi
  // can take. There is no production setup where that is the right answer.
  problems.push('COOKIE_SECURE cannot be false in production');
}
if (env.TELEGRAM_WEBHOOK_URL && !env.TELEGRAM_WEBHOOK_SECRET) {
  // An unauthenticated webhook lets anyone post a forged /start and link a chat.
  problems.push('TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_WEBHOOK_URL is set');
}
if (problems.length > 0) {
  const lines = problems.map((p) => `  - ${p}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}
// Unset follows NODE_ENV: secure in production, plain elsewhere so localhost works.
env.COOKIE_SECURE =
  cookieSecureSetting === undefined ? env.NODE_ENV === 'production' : cookieSecureSetting;

env.ownerDeviceOtp = env.OWNER_DEVICE_OTP === 'true' || env.OWNER_DEVICE_OTP === '1';
env.otpPepper = env.OTP_PEPPER || env.JWT_REFRESH_SECRET;

env.runJobs = env.RUN_JOBS === 'true' || env.RUN_JOBS === '1';

env.isProd = env.NODE_ENV === 'production';
env.isTest = env.NODE_ENV === 'test';

env.r2Configured = Boolean(
  env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
);
// Public delivery needs its own bucket and a hostname to serve it from. The
// separate bucket is not optional: R2 public access is bucket wide, so sharing
// one bucket would expose every national ID scan alongside the product photos.
env.r2PublicDelivery = Boolean(
  env.r2Configured && env.R2_PUBLIC_BUCKET && env.R2_PUBLIC_BASE_URL
);
// ImgBB needs nothing but a key, which is why it is the default home for public
// images and R2 public delivery is only the fallback when it is unset.
env.imgbbConfigured = Boolean(env.IMGBB_API_KEY);
env.webPushConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

/*
 * One pair of names for the gateway credentials, whichever pair the .env used.
 * Nothing outside this file should know that two spellings exist: the channel
 * reads `env.smsApiKey`, and adding a third alias later touches only these two
 * lines rather than every call site.
 */
env.smsApiKey = env.AUTOMAS_API_KEY || env.SMS_API_KEY || null;
env.smsSenderId = env.AUTOMAS_SENDER_ID || env.SMS_SENDER_ID || null;
env.smsConfigured = Boolean(env.smsApiKey && env.smsSenderId);
env.telegramConfigured = Boolean(env.TELEGRAM_BOT_TOKEN);
env.telegramWebhook = Boolean(env.telegramConfigured && env.TELEGRAM_WEBHOOK_URL);
env.publicAppUrl = env.PUBLIC_APP_URL ? env.PUBLIC_APP_URL.replace(/\/+$/, '') : null;

/*
 * One ready list, so app.js never parses a string. Trailing slashes are cut
 * because a browser's Origin header never carries one, and `cors` compares the
 * two as exact strings: `http://x/` in the .env would silently match nothing.
 */
env.corsOrigins = [env.APP_URL, ...(env.CORS_ORIGINS || '').split(',')]
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

module.exports = env;
