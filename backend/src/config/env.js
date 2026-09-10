'use strict';

require('dotenv').config();
const { z } = require('zod');

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default('http://localhost:3000'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  COOKIE_SECURE: bool(false),
  COOKIE_DOMAIN: z.string().optional(),

  // Number of proxy hops in front of Express. Wrong values either collapse every
  // client into one rate-limit bucket or let X-Forwarded-For be attacker controlled.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:support@example.com'),

  SMS_API_URL: z.string().default('https://api.automas.com.bd/smsapiv3'),
  SMS_BALANCE_URL: z.string().default('https://api.automas.com.bd/'),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}

const env = parsed.data;

env.isProd = env.NODE_ENV === 'production';
env.isTest = env.NODE_ENV === 'test';

env.cloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET
);
env.webPushConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
env.smsConfigured = Boolean(env.SMS_API_KEY && env.SMS_SENDER_ID);
env.telegramConfigured = Boolean(env.TELEGRAM_BOT_TOKEN);

module.exports = env;
