'use strict';

const { orderSearchFilter, escapeRegex, toLatinDigits } = require('./orderSearch');
const { agingCutoff } = require('./dhakaTime');
const { ORDER_STATUS } = require('../domain/constants');

/**
 * The one place a set of owner order filters becomes a Mongo query.
 *
 * The list, the counts beside it, the printable sheet and the CSV export all
 * build from this. They used to each assemble their own, which is why the
 * reports screen could show one figure and the export beneath it another: the
 * export was reading no filters at all.
 *
 * Dates are matched on the denormalised `businessDate` string rather than on
 * `createdAt`. The two are equivalent by construction — `businessDate` is the
 * Dhaka calendar date of `createdAt` — but only one of them is indexed, and
 * `YYYY-MM-DD` sorts lexicographically, so a range is an index scan. It is also
 * the definition the rest of the system already uses for "today's orders", so
 * this can no longer disagree with the dashboard about which day an order is on.
 */
function buildOrderFilter(query = {}, { agingHours, resellerIds } = {}) {
  const filter = {};

  if (query.status) filter.status = { $in: String(query.status).split(',') };
  if (query.reseller) filter.reseller = query.reseller;
  /*
   * Every order carrying a line collected from this orchard. A source lives on
   * the line, not the order (docs/adr/0006), so this reaches into the array;
   * `{ 'items.source': 1, createdAt: -1 }` on Order is what makes it a scan of
   * that orchard rather than of everything.
   */
  if (query.source) filter['items.source'] = query.source;

  if (query.from || query.to) {
    filter.businessDate = {};
    if (query.from) filter.businessDate.$gte = query.from;
    // Inclusive, because a person picking 1st to 7th means seven days.
    if (query.to) filter.businessDate.$lte = query.to;
  }

  /*
   * Aging is a wall-clock age, not a calendar date, so it overrides the status
   * filter rather than narrowing it: only a confirmed order can be stale.
   */
  if (query.aging) {
    filter.status = ORDER_STATUS.CONFIRMED;
    filter.confirmedAt = { $lt: agingCutoff(agingHours) };
  }

  const search = orderSearchFilter(query.q, { resellerIds });
  if (search) Object.assign(filter, search);

  return filter;
}

/**
 * The shops whose name contains the search term, for the owner's lists.
 *
 * A separate step because it is a query and `buildOrderFilter` asks the database
 * nothing. Every owner surface that takes `q` — the list, the counts, the sheet
 * and the CSV — resolves it through here, so typing a shop name narrows all four
 * the same way. Capped: a two-letter term matching every shop is a term that
 * matches every order anyway.
 */
async function shopMatches(q) {
  const term = toLatinDigits(q || '').trim();
  if (term.length < 2) return [];
  // Required here rather than at the top: this module is otherwise pure, and the
  // unit tests load it without a model registry.
  // eslint-disable-next-line global-require
  const ResellerProfile = require('../models/ResellerProfile');
  const rows = await ResellerProfile.find({ shopName: new RegExp(escapeRegex(term), 'i') })
    .select('_id')
    .limit(50)
    .lean();
  return rows.map((row) => row._id);
}

/** The owner's filter, shop names included. See `shopMatches`. */
async function buildOwnerOrderFilter(query = {}, { agingHours } = {}) {
  const resellerIds = query.q ? await shopMatches(query.q) : [];
  return buildOrderFilter(query, { agingHours, resellerIds });
}

module.exports = { buildOrderFilter, buildOwnerOrderFilter, shopMatches };
