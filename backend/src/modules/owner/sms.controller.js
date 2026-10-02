'use strict';

const SmsLog = require('../../models/SmsLog');
const ResellerProfile = require('../../models/ResellerProfile');
const User = require('../../models/User');
const smsService = require('../../services/sms');
const gateway = require('../../channels/sms');
const env = require('../../config/env');
const audit = require('../../services/audit');
const { getSettings, updateSettings } = require('../../services/settings');
const { ok } = require('../../middleware/error');
const { notFound, badRequest, conflict } = require('../../utils/errors');
const { toTaka } = require('../../utils/money');
const { businessDate, startOfBusinessDay } = require('../../utils/dhakaTime');
const { normalizeBdPhone } = require('../../utils/phone');
const { escapeRegex } = require('../../utils/orderSearch');
const { SMS_STATUS, SMS_PURPOSE } = require('../../domain/constants');

/**
 * The owner's SMS panel.
 *
 * Two jobs: the switch, and the record. The switch is the one control in this
 * app that spends money on every use, so it has its own endpoint rather than
 * riding along with thirty other settings, and every flip is audited. The record
 * is every message the platform attempted, with what the gateway said back,
 * because "did the customer get the text" was previously answerable only by
 * asking the customer.
 */

/* ------------------------------------------------------------------ shape -- */

/**
 * Purposes a resend is refused for.
 *
 * An OTP is logged masked, so resending the row would text the customer six
 * asterisks; and a fresh code is what the person needs anyway, which only the
 * sign-in screen can issue. A test proved the gateway once and proves nothing
 * more the second time — the test form is where another one is sent from.
 */
const NOT_RESENDABLE = Object.freeze([SMS_PURPOSE.OTP, SMS_PURPOSE.TEST]);

/** The list row. Deliberately without the raw provider reply, which is large. */
const shapeRow = (log) => ({
  id: log._id,
  phone: log.toPhoneE164,
  text: log.text,
  status: log.status,
  blockedReason: log.blockedReason || null,
  purpose: log.purpose,
  eventType: log.eventType || null,
  segments: log.segments,
  encoding: log.encoding,
  resellerName: log.resellerName || null,
  resellerId: log.reseller || null,
  creditsCharged: log.creditsCharged,
  creditsRefunded: log.creditsRefunded,
  providerMessageId: log.providerMessageId || null,
  providerStatusCode: log.providerStatusCode,
  error: log.error || null,
  durationMs: log.durationMs,
  sentAt: log.sentAt,
  // Whether the resend button applies at all. See NOT_RESENDABLE.
  resendable: !NOT_RESENDABLE.includes(log.purpose),
  createdAt: log.createdAt,
});

/** The detail view adds the evidence: exactly what came back off the wire. */
const shapeDetail = (log) => ({
  ...shapeRow(log),
  senderId: log.senderId || null,
  toLocal: log.toLocal || null,
  retryable: log.retryable,
  providerHttpStatus: log.providerHttpStatus,
  providerResponse: log.providerResponse || null,
  providerRaw: log.providerRaw || null,
  outboxMessageId: log.outboxMessage || null,
});

/* --------------------------------------------------------------- overview -- */

/**
 * Everything the top of the panel needs in one request: the switch, whether the
 * gateway is even reachable, and what the last thirty days cost.
 *
 * The gateway balance is fetched but never allowed to fail the request. It is a
 * third party over the network, and an owner who cannot open their own SMS page
 * because Automas is down has been failed by us, not by them.
 */
async function overview(_req, res) {
  const settings = await getSettings({ fresh: true });

  let balance = null;
  let balanceError = null;
  if (gateway.isConfigured()) {
    try {
      balance = await smsService.balance();
    } catch (err) {
      balanceError = err.message;
    }
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // Dhaka's midnight, not the server's: a UTC server counted 00:00-06:00 Dhaka
  // as yesterday. See utils/dhakaTime.js.
  const startOfToday = startOfBusinessDay(businessDate());

  const [monthly, today, credits] = await Promise.all([
    SmsLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          segments: { $sum: '$segments' },
          credits: { $sum: { $subtract: ['$creditsCharged', '$creditsRefunded'] } },
        },
      },
    ]),
    SmsLog.countDocuments({ createdAt: { $gte: startOfToday }, status: SMS_STATUS.SENT }),
    // What resellers are holding. The gateway balance is the owner's stock; this
    // is what has already been sold out of it and not yet spent.
    ResellerProfile.aggregate([
      { $group: { _id: null, total: { $sum: '$smsCredits' } } },
    ]),
  ]);

  const bucket = (status) => monthly.find((m) => m._id === status) || {};
  const counts = {
    sent: bucket(SMS_STATUS.SENT).count || 0,
    failed: bucket(SMS_STATUS.FAILED).count || 0,
    blocked: bucket(SMS_STATUS.BLOCKED).count || 0,
  };

  /*
   * What the owner paid the gateway over the same thirty days: segments sent,
   * whoever was charged credits for them, at the gateway's rate. Only when that
   * rate is configured; otherwise null rather than a guess, because the price a
   * reseller pays for a credit is what the owner sells at, not what it costs.
   */
  const segmentsSent = bucket(SMS_STATUS.SENT).segments || 0;
  const costPerSegmentPoisha = env.SMS_COST_PER_SEGMENT_POISHA;
  const spent30dPoisha =
    costPerSegmentPoisha == null ? null : segmentsSent * costPerSegmentPoisha;

  return ok(res, {
    enabled: settings.features.sms,
    configured: gateway.isConfigured(),
    senderId: gateway.isConfigured() ? env.smsSenderId : null,
    balance,
    /*
     * Automas reports what is left as a count of messages, not as money, so the
     * unit travels with the number and a screen never prints "৳104".
     */
    balanceUnit: 'sms',
    lowBalanceAt: env.SMS_LOW_BALANCE,
    balanceLow: balance == null ? null : balance < env.SMS_LOW_BALANCE,
    balanceError,
    pricePerCredit: settings.smsPricePerCreditPoisha / 100,
    costPerSegment: costPerSegmentPoisha == null ? null : toTaka(costPerSegmentPoisha),
    spent30d: spent30dPoisha == null ? null : toTaka(spent30dPoisha),
    stats: {
      sentToday: today,
      last30: counts,
      segments: bucket(SMS_STATUS.SENT).segments || 0,
      creditsSpent: bucket(SMS_STATUS.SENT).credits || 0,
      resellerCredits: credits[0] ? credits[0].total : 0,
    },
  });
}

/* ----------------------------------------------------------------- switch -- */

/**
 * The master switch.
 *
 * Off means off for everything a reseller does: no order, deposit or withdrawal
 * event produces a text, whatever that reseller has set in their own preferences
 * and however many credits they are holding. Two places enforce it, on purpose.
 * `services/notify.js` stops the message being queued, and `services/sms.js`
 * re-reads the setting at the moment of sending, which catches anything already
 * sitting in the outbox when the switch was thrown.
 */
async function toggle(req, res) {
  const before = await getSettings({ fresh: true });
  const enabled = Boolean(req.body.enabled);

  const settings = await updateSettings({ 'features.sms': enabled });

  await audit.record({
    actor: req.user._id,
    action: 'settings.sms_toggle',
    targetType: 'Setting',
    targetId: settings._id,
    before: { sms: before.features.sms },
    after: { sms: settings.features.sms },
    ip: req.ip,
  });

  return ok(res, { enabled: settings.features.sms });
}

/* ------------------------------------------------------------------- logs -- */

/**
 * The log, newest first.
 *
 * Filtered by outcome, by what the message was for, by reseller and by phone
 * number, because those are the four ways the question actually arrives: "is
 * anything failing", "what did we send this week", "why is this shop burning
 * credits", and "this customer says they got nothing".
 */
async function listLogs(req, res) {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const filter = {};

  if (req.query.status) filter.status = req.query.status;
  if (req.query.purpose) filter.purpose = req.query.purpose;
  if (req.query.eventType) filter.eventType = req.query.eventType;
  if (req.query.resellerId) filter.reseller = req.query.resellerId;

  // Stored E.164, typed however people type it, so the tail is what matches:
  // 01712345678 and 1712345678 both find +8801712345678.
  const term = (req.query.q || '').trim();
  if (term) {
    const digits = term.replace(/\D/g, '');
    filter.$or = digits.length >= 3
      ? [
          { toPhoneE164: new RegExp(`${escapeRegex(digits)}$`) },
          { text: new RegExp(escapeRegex(term), 'i') },
        ]
      : [{ text: new RegExp(escapeRegex(term), 'i') }];
  }

  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) {
      // An inclusive end date. `to=2026-09-11` means through the end of the 11th,
      // not midnight at the start of it, which is what a person filling in a date
      // range means every time.
      const end = new Date(req.query.to);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  const [logs, total] = await Promise.all([
    SmsLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SmsLog.countDocuments(filter),
  ]);

  return ok(res, { logs: logs.map(shapeRow), total, page, limit });
}

async function getLog(req, res) {
  const log = await SmsLog.findById(req.params.id).lean();
  if (!log) throw notFound('SMS log not found');
  return ok(res, { log: shapeDetail(log) });
}

/* --------------------------------------------------------------- sending -- */

/**
 * One send, reported as its log row.
 *
 * The service throws when a message deserves another attempt, which is the
 * signal the outbox worker needs and the last thing an owner pressing a button
 * needs: a timeout at Automas is not a bug in this app and should not be a 500.
 * Either way the row was already written, so it is fetched back and returned,
 * and the screen shows what the gateway said.
 */
async function attempt(options) {
  let result;
  try {
    result = await smsService.send(options);
  } catch (err) {
    result = { status: SMS_STATUS.FAILED, logId: err.smsLogId || null, error: err.message };
  }

  const log = result.logId ? await SmsLog.findById(result.logId).lean() : null;
  return log ? shapeDetail(log) : { status: result.status, error: result.error || null };
}

/**
 * A test message, from the owner, to a number they choose.
 *
 * It is allowed to run while the master switch is off, and it is the only thing
 * that is. Turning SMS on for every reseller in order to find out whether the
 * credentials work would be a strange order to do things in. Nobody is charged
 * for it, and it is logged like everything else, marked as a test so it does not
 * pollute the delivery numbers.
 */
async function sendTest(req, res) {
  const phoneE164 = normalizeBdPhone(req.body.phone, 'phone');
  const text = (req.body.text || '').trim();
  if (!text) throw badRequest('EMPTY_MESSAGE', 'Write the message first', { text: 'Required' });

  const result = await attempt({
    phoneE164,
    text,
    purpose: SMS_PURPOSE.TEST,
    triggeredBy: req.user,
    ignoreFeatureFlag: true,
  });

  return ok(res, { result });
}

/**
 * Sends a logged message again, as its own attempt.
 *
 * It writes a new row rather than editing the old one. The log is a record of
 * what happened, and a failure that was later resolved by a retry is two facts,
 * not one fact that changed its mind. Unlike the test above, this honours the
 * master switch: it is re-running a reseller's message, which is exactly what
 * the switch exists to stop.
 */
async function resend(req, res) {
  const original = await SmsLog.findById(req.params.id);
  if (!original) throw notFound('SMS log not found');
  if (NOT_RESENDABLE.includes(original.purpose)) {
    throw conflict(
      'SMS_NOT_RESENDABLE',
      original.purpose === SMS_PURPOSE.OTP
        ? 'A sign-in code is never resent; ask for a new one from the sign-in screen'
        : 'A test message is not resent; send a new test instead'
    );
  }

  // Charged again, to the same reseller, because it is another message off the
  // gateway. A resend the owner does not want billed is one they should not do.
  const charge = original.reseller ? await ResellerProfile.findById(original.reseller) : null;
  const user = original.user ? await User.findById(original.user) : null;

  const result = await attempt({
    phoneE164: original.toPhoneE164,
    text: original.text,
    purpose: original.purpose,
    eventType: original.eventType,
    user,
    charge,
    triggeredBy: req.user,
    // An owner-paid message (a customer SMS, an alert) stays owner-paid when
    // resent, so the master switch does not suddenly apply to it. docs/adr/0013.
    payer: charge ? null : original.payer || null,
    category: original.category || null,
    order: original.order || null,
  });

  return ok(res, { result });
}

module.exports = { overview, toggle, listLogs, getLog, sendTest, resend };
