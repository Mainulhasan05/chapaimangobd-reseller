'use strict';

const { badRequest } = require('./errors');

/**
 * Slugs are ASCII lowercase only. Bengali slugs percent-encode in URLs, which
 * renders as garbage when shared over WhatsApp and breaks link previews.
 */

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

/** Route names and file paths a shop slug must never shadow. */
const RESERVED = new Set([
  'api', 'admin', 'owner', 'reseller', 'r', 's', 'shop', 'track', 'login', 'logout',
  'register', 'signup', 'signin', 'dashboard', 'settings', 'account', 'help', 'support',
  'about', 'terms', 'privacy', 'pricing', 'contact', 'static', 'public', 'assets',
  '_next', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'manifest.json', 'sw.js',
  'well-known', 'null', 'undefined', 'true', 'false',
]);

/** Best-effort slug from a shop or person name. Falls back to a random suffix. */
function slugify(input) {
  const base = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);

  if (base.length >= 3) return base;
  return `shop-${Math.random().toString(36).slice(2, 8)}`;
}

function assertValidSlug(slug, field = 'slug') {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    const message = 'Use 3 to 32 characters: lowercase letters, numbers and hyphens';
    throw badRequest('INVALID_SLUG', message, { [field]: message });
  }
  if (RESERVED.has(slug)) {
    const message = 'This address is reserved, please choose another';
    throw badRequest('RESERVED_SLUG', message, { [field]: message });
  }
  return slug;
}

const isReserved = (slug) => RESERVED.has(slug);

module.exports = { SLUG_RE, RESERVED, slugify, assertValidSlug, isReserved };
