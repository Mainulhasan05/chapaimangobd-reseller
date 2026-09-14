'use strict';

const mongoose = require('mongoose');
const AuditLog = require('../../models/AuditLog');
const { ok } = require('../../middleware/error');
const { badRequest } = require('../../utils/errors');
const { startOfBusinessDay, endOfBusinessDay } = require('../../utils/dhakaTime');

/**
 * The cursor is the last row's (createdAt, _id), opaque to the client. Both
 * parts are needed: several entries routinely share a millisecond, such as a
 * deactivation and the credit-limit change saved with it.
 */
const encodeCursor = (row) =>
  Buffer.from(`${row.createdAt.toISOString()}|${row._id}`).toString('base64url');

function decodeCursor(cursor) {
  const invalid = () => badRequest('BAD_CURSOR', 'That page link is no longer valid');
  let at;
  let id;
  try {
    [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  } catch {
    throw invalid();
  }
  const date = new Date(at);
  if (Number.isNaN(date.getTime()) || !mongoose.isValidObjectId(id)) throw invalid();
  return { at: date, id: new mongoose.Types.ObjectId(id) };
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /owner/audit
 *
 * Newest first. `action` matches exactly, or by prefix when it ends in `*`
 * (`order.*`). `from` and `to` are Dhaka calendar days, both inclusive.
 */
async function list(req, res) {
  const { actor, targetType, targetId, action, from, to, cursor, limit } = req.query;
  const filter = {};

  if (actor) filter.actor = actor;
  if (targetType) filter.targetType = targetType;
  if (targetId) filter.targetId = targetId;
  if (action) {
    filter.action = action.endsWith('*')
      ? { $regex: `^${escapeRegex(action.slice(0, -1))}` }
      : action;
  }
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = startOfBusinessDay(from);
    if (to) filter.createdAt.$lt = endOfBusinessDay(to);
  }

  if (cursor) {
    const { at, id } = decodeCursor(cursor);
    filter.$or = [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: id } }];
  }

  const rows = await AuditLog.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .populate('actor', 'name role');

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? encodeCursor(page[page.length - 1]) : null;

  return ok(res, {
    entries: page.map((row) => ({
      id: row._id,
      at: row.createdAt,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId || null,
      // Null for an entry written by the system, or by an account since removed.
      actor: row.actor ? { id: row.actor._id, name: row.actor.name, role: row.actor.role } : null,
      before: row.before ?? null,
      after: row.after ?? null,
      ip: row.ip || null,
    })),
    nextCursor,
  });
}

module.exports = { list };
