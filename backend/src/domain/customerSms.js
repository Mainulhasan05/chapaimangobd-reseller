'use strict';

const gsm7 = require('../utils/gsm7');
const { toTaka } = require('../utils/money');

/**
 * The text of an SMS to a customer, on the owner's accept, ship and cancel.
 *
 * One function renders it, and both the preview endpoint and the transition that
 * queues the message call it with the same inputs, so what the owner read in the
 * modal is, byte for byte, what the outbox carries (docs/adr/0013).
 *
 * Templates are the owner's, edited in Settings, and restricted to the GSM-7
 * alphabet so a message is billed at 160 characters a segment rather than 70.
 * The values substituted into them come from people who type in Bengali, so
 * they are cleaned before they go in. The rule, in full:
 *
 * - Every value is folded to GSM-7 (accents dropped, curly quotes straightened,
 *   anything else removed). A value is used only when at least 60% of its
 *   letters survive; a mostly-Bengali value is treated as missing rather than
 *   printed as the few Latin characters left over.
 * - {customer} missing: the name is simply left out ("Hi, your order ...").
 * - {shop} missing: the shop's address slug when the reseller chose one, then the
 *   business name, then "ChapaiMango".
 * - {courier} missing: "courier".
 * - {trackingId}, {trackUrl} and {reason} missing: the whole clause holding the
 *   placeholder is removed, from the previous `,` `.` `!` `?` `;` or line break
 *   up to the next one, together with the comma that introduced it. So
 *   "shipped via X, tracking {trackingId}. Track: {trackUrl}" loses ", tracking"
 *   when there is no tracking number and ". Track: ..." when PUBLIC_APP_URL is
 *   not set.
 */

const ACTIONS = Object.freeze(['accept', 'ship', 'cancel']);

const PLACEHOLDERS = Object.freeze([
  'customer',
  'shop',
  'code',
  'courier',
  'trackingId',
  'trackUrl',
  'reason',
  'total',
]);

/** Placeholders whose clause disappears when they have no value. */
const CLAUSE_PLACEHOLDERS = new Set(['trackingId', 'trackUrl', 'reason']);

const DEFAULT_TEMPLATES = Object.freeze({
  accept: 'Hi {customer}, your order {code} from {shop} is confirmed. Track: {trackUrl}',
  ship: 'Order {code} from {shop} shipped via {courier}, tracking {trackingId}. Track: {trackUrl}',
  cancel: 'Order {code} from {shop} was cancelled. {reason}',
});

const MAX_SEGMENTS = 3;
const MAX_TEMPLATE_LENGTH = 480;

const PLACEHOLDER_RE = /\{([A-Za-z]+)\}/g;
const DELIMITERS = new Set([',', '.', '!', '?', ';', '\n']);

/** Messages are English on purpose: they are also the field errors the API returns. */
function validateTemplate(template) {
  const value = String(template ?? '');
  if (!value.trim()) return 'Template is required';
  if (value.length > MAX_TEMPLATE_LENGTH) {
    return `Template must be at most ${MAX_TEMPLATE_LENGTH} characters`;
  }
  const bad = gsm7.invalidChars(value);
  if (bad.length > 0) return `Only English (GSM-7) characters are allowed: ${bad.join(' ')}`;

  const unknown = [...value.matchAll(PLACEHOLDER_RE)]
    .map((m) => m[1])
    .filter((name) => !PLACEHOLDERS.includes(name));
  if (unknown.length > 0) return `Unknown placeholder: {${unknown[0]}}`;

  if (gsm7.measure(value).segments > MAX_SEGMENTS) {
    return `Template must fit in ${MAX_SEGMENTS} SMS segments`;
  }
  return null;
}

/** A value that is mostly Latin after cleaning, or '' when it is not. */
function usable(value, { minLetters = 1, max = 60 } = {}) {
  const { text, kept } = gsm7.sanitize(value);
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (!text || kept < 0.6 || letters < minLetters) return '';
  return text.slice(0, max).trim();
}

/** Auto-generated slugs (`shop-x1y2z3`) name nothing, so they are no fallback. */
const chosenSlug = (slug) => (slug && !/^shop-[a-z0-9]{6}$/.test(slug) ? slug : '');

/** The values, cleaned. Missing ones are ''. */
function valuesFor({ order, profile, settings, courierName, trackingNumber, reason, publicAppUrl }) {
  const code = order.orderCode;
  return {
    customer: usable(order.customer && order.customer.name, { minLetters: 2, max: 30 }),
    shop:
      usable(profile && profile.shopName, { minLetters: 2, max: 40 }) ||
      chosenSlug(profile && profile.slug) ||
      usable(settings && settings.businessName, { minLetters: 2, max: 40 }) ||
      'ChapaiMango',
    code,
    courier: usable(courierName, { max: 40 }) || 'courier',
    trackingId: gsm7.sanitize(trackingNumber).text.replace(/\s+/g, '').slice(0, 40),
    trackUrl: publicAppUrl ? `${publicAppUrl}/track?code=${encodeURIComponent(code)}` : '',
    reason: usable(reason, { max: 120 }),
    total:
      order.totals && order.totals.customerTotalPoisha != null
        ? `Tk ${toTaka(order.totals.customerTotalPoisha)}`
        : '',
  };
}

/** Removes the clause around `{name}`; see the rule at the top of the file. */
function dropClause(template, name) {
  const token = `{${name}}`;
  let out = template;
  let at = out.indexOf(token);
  while (at !== -1) {
    let start = at;
    while (start > 0 && !DELIMITERS.has(out[start - 1])) start -= 1;
    let end = at + token.length;
    while (end < out.length && !DELIMITERS.has(out[end])) end += 1;

    // The comma that introduced the clause goes with it; a full stop stays,
    // because it ends the sentence before.
    if (start > 0 && out[start - 1] === ',') start -= 1;
    // A clause opening the message takes its closing delimiter along instead.
    else if (start === 0 && end < out.length) end += 1;

    out = out.slice(0, start) + out.slice(end);
    at = out.indexOf(token);
  }
  return out;
}

const tidy = (text) =>
  text
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.!?;:])/g, '$1')
    .replace(/,([,.!?;])/g, '$1')
    .replace(/ *\n */g, '\n')
    .trim();

/**
 * Renders one template. Returns the text and what it costs, plus the phone it
 * goes to, which is exactly what the preview shows and the outbox stores.
 */
function renderCustomerSms({ template, ...context }) {
  const values = valuesFor(context);

  let text = String(template ?? '');
  CLAUSE_PLACEHOLDERS.forEach((name) => {
    if (!values[name]) text = dropClause(text, name);
  });
  text = text.replace(PLACEHOLDER_RE, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match
  );
  text = tidy(text);

  const { chars, segments, encoding } = gsm7.measure(text);
  return {
    text,
    chars,
    segments,
    encoding,
    phone: context.order.customer ? context.order.customer.phoneE164 : null,
  };
}

/** The template for an action, falling back to the default for one never saved. */
function templateFor(settings, action) {
  const saved = settings && settings.customerSmsTemplates && settings.customerSmsTemplates[action];
  return saved && String(saved).trim() ? saved : DEFAULT_TEMPLATES[action];
}

module.exports = {
  ACTIONS,
  PLACEHOLDERS,
  DEFAULT_TEMPLATES,
  MAX_SEGMENTS,
  MAX_TEMPLATE_LENGTH,
  validateTemplate,
  renderCustomerSms,
  templateFor,
};
