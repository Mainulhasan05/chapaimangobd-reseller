'use strict';

const mongoose = require('mongoose');
const { badRequest } = require('./errors');

/**
 * Keyset pagination over (createdAt, _id), for lists that grow while someone is
 * reading them. Page numbers over a growing list skip and repeat rows; a cursor
 * names the last row seen, so the next page starts exactly after it.
 *
 * Both parts are needed: several rows routinely share a millisecond, such as a
 * deactivation and the credit-limit change saved with it. The cursor is opaque
 * to the client, and a mangled one is a 400 BAD_CURSOR, never a silent first page.
 */

const encodeCursor = (row) =>
  Buffer.from(`${new Date(row.createdAt).toISOString()}|${row._id}`).toString('base64url');

function decodeCursor(cursor) {
  const invalid = () => badRequest('BAD_CURSOR', 'That page link is no longer valid');
  if (typeof cursor !== 'string' || cursor.length > 200) throw invalid();
  let at;
  let id;
  try {
    [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  } catch {
    throw invalid();
  }
  const date = new Date(at);
  if (!at || Number.isNaN(date.getTime()) || !mongoose.isValidObjectId(id)) throw invalid();
  return { at: date, id: new mongoose.Types.ObjectId(id) };
}

/**
 * The filter clause for "after this cursor" in the given direction, and the
 * matching sort. Newest first is `direction: -1`.
 */
function afterCursor(cursor, direction = -1) {
  const { at, id } = decodeCursor(cursor);
  const op = direction < 0 ? '$lt' : '$gt';
  return { $or: [{ createdAt: { [op]: at } }, { createdAt: at, _id: { [op]: id } }] };
}

const cursorSort = (direction = -1) => ({ createdAt: direction, _id: direction });

/**
 * Reads the paging parameters. Without a `limit` and a `cursor` the list is
 * returned whole, which is what every caller written before pagination expects.
 *
 * @returns {{ paged: boolean, limit: number|null, cursor: string|null }}
 */
function readPaging(query, { defaultLimit = 50, maxLimit = 100 } = {}) {
  const cursor = typeof query.cursor === 'string' && query.cursor ? query.cursor : null;
  const rawLimit = query.limit === undefined || query.limit === '' ? null : Number(query.limit);
  if (rawLimit === null && !cursor) return { paged: false, limit: null, cursor: null };

  const limit =
    rawLimit === null || !Number.isFinite(rawLimit)
      ? defaultLimit
      : Math.min(Math.max(Math.trunc(rawLimit), 1), maxLimit);
  return { paged: true, limit, cursor };
}

/**
 * Runs a find one row past the page, so whether another page exists is known
 * without a count. Unpaged, it is the plain find in the same order.
 */
async function findPage(model, filter, { direction = -1, paging, populate } = {}) {
  const full = paging.cursor ? { $and: [filter, afterCursor(paging.cursor, direction)] } : filter;
  let query = model.find(full).sort(cursorSort(direction));
  if (paging.paged) query = query.limit(paging.limit + 1);
  if (populate) query = query.populate(populate);
  const rows = await query;

  if (!paging.paged) return { rows, nextCursor: null };
  const page = rows.slice(0, paging.limit);
  const nextCursor = rows.length > paging.limit ? encodeCursor(page[page.length - 1]) : null;
  return { rows: page, nextCursor };
}

module.exports = { encodeCursor, decodeCursor, afterCursor, cursorSort, readPaging, findPage };
