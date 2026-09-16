'use strict';

const { orderSearchFilter } = require('./orderSearch');
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
function buildOrderFilter(query = {}, { agingHours } = {}) {
  const filter = {};

  if (query.status) filter.status = { $in: String(query.status).split(',') };
  if (query.reseller) filter.reseller = query.reseller;

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

  const search = orderSearchFilter(query.q);
  if (search) Object.assign(filter, search);

  return filter;
}

module.exports = { buildOrderFilter };
