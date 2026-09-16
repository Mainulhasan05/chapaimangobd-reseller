'use strict';

const mongoose = require('mongoose');
const { COMPLAINT_KIND, values } = require('../domain/constants');

/**
 * One thing a customer said was wrong with an order.
 *
 * This exists because the only negative signals the system had were `cancelled`
 * and `returned`, and both are fulfilment outcomes. A customer who takes the
 * parcel, pays for it, and then rings to say the mangoes were rotten left no
 * trace anywhere: the order reads as a clean delivery for ever. That is the
 * complaint that matters most, because it is the one the owner pays for twice —
 * once in the fruit and once in the customer not ordering again.
 *
 * A complaint never changes an order's status and never moves money. The order
 * happened; a return or a refund is a separate decision with its own ledger
 * entries. This is a record of what was said, so that it can be counted.
 *
 * ## Why the lines are on it
 *
 * The point of writing a complaint down is to be able to stop buying from
 * whoever caused it. A source is chosen per line at accept (docs/adr/0006), so
 * blame lands on a line and not on an order: one order can carry mangoes from
 * two orchards and only one of them sent bad fruit. A complaint about the
 * delivery itself names no lines at all, and that is why `items` may be empty.
 *
 * ## Why everything is snapshotted
 *
 * The same reason a line snapshots its price. A source is archived rather than
 * deleted and may be renamed; a product may be archived. Reading the name back
 * through a `populate()` would let a rename rewrite the history that is being
 * used to judge that orchard, which is exactly the record that must not move.
 * The refs are kept beside the snapshots so a source that still exists can be
 * linked to, and nothing else.
 */
const complaintItemSchema = new mongoose.Schema(
  {
    /** The `_id` of the line on the order, so the complaint points at one line. */
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    productNameBn: { type: String },
    /*
     * Null when the order was complained about before it was accepted, because
     * until accept nobody has chosen an orchard. A complaint with no source
     * still counts against the order; it just cannot count against anyone.
     */
    source: { type: mongoose.Schema.Types.ObjectId, ref: 'Source', default: null },
    sourceNameBn: { type: String, default: null },
  },
  { _id: false }
);

const complaintSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    // Snapshots, so the complaints list and the printed report need no joins.
    orderCode: { type: String, required: true },
    reseller: { type: mongoose.Schema.Types.ObjectId, ref: 'ResellerProfile', index: true },
    customerPhoneE164: { type: String },
    // The Dhaka date of the order, not of the complaint: a report about a bad
    // week of fruit is asking about when the fruit went out.
    businessDate: { type: String, required: true, index: true },

    kind: { type: String, enum: values(COMPLAINT_KIND), required: true },
    /*
     * Required, and required to say something. A complaint with no words is a
     * number that nobody can act on six weeks later, when the question is
     * whether to buy from this orchard again.
     */
    note: { type: String, required: true, trim: true, minlength: 3, maxlength: 1000 },

    items: { type: [complaintItemSchema], default: [] },

    /*
     * Closed out, with what was done about it. Kept rather than deleted: the
     * whole value of this collection is that it accumulates.
     */
    resolved: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
    resolution: { type: String, maxlength: 1000, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

/*
 * One orchard's record, which is the query this collection exists to answer.
 * Sparse in effect rather than by declaration: a complaint with no lines simply
 * has nothing to index here.
 */
complaintSchema.index({ 'items.source': 1, createdAt: -1 });
// The owner's working list: what is still open, newest first.
complaintSchema.index({ resolved: 1, createdAt: -1 });
complaintSchema.index({ kind: 1, createdAt: -1 });

module.exports = mongoose.model('Complaint', complaintSchema);
