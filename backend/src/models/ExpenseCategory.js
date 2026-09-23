'use strict';

const mongoose = require('mongoose');
const { CATEGORY_SCOPE, values } = require('../domain/constants');

/**
 * What kinds of expense this business has.
 *
 * An owner-managed collection and not a frozen enum, unlike `COMPLAINT_KIND`.
 * The reasoning that made that one an enum — a list picked from on a phone in
 * the middle of a call should not run to fifteen options — does not apply here,
 * because an expense is typed sitting down and because this is precisely where
 * the system stops being about mangoes. A business that later sells something
 * else needs its own categories, and shipping a code change for each one would
 * mean it never happens.
 *
 * Seeded with the six the owner named. Archived, never deleted: an expense
 * snapshots the category's name, and a deleted row would leave last year's
 * report unable to say what "অন্যান্য" once meant.
 */
const expenseCategorySchema = new mongoose.Schema(
  {
    nameBn: { type: String, required: true, trim: true, maxlength: 120 },

    /*
     * What this category may be used for. `both` lets one category serve either,
     * for something like packaging that is sometimes bought for a named parcel
     * and sometimes for the month.
     *
     * This is the field that keeps লেবার খরচ from being attached to an order.
     * See docs/adr/0027.
     */
    scope: { type: String, enum: values(CATEGORY_SCOPE), default: CATEGORY_SCOPE.PERIOD },

    note: { type: String, maxlength: 500 },
    isArchived: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

expenseCategorySchema.index({ isArchived: 1, sortOrder: 1, nameBn: 1 });

module.exports = mongoose.model('ExpenseCategory', expenseCategorySchema);
