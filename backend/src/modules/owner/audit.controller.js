'use strict';

const AuditLog = require('../../models/AuditLog');
const { ok } = require('../../middleware/error');
const { encodeCursor, afterCursor } = require('../../utils/cursor');
const { startOfBusinessDay, endOfBusinessDay } = require('../../utils/dhakaTime');

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

  // The cursor is the last row's (createdAt, _id); see utils/cursor.js.
  if (cursor) Object.assign(filter, afterCursor(cursor, -1));

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
