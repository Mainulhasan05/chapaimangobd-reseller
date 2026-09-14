'use strict';

const mongoose = require('mongoose');

/**
 * Written from day one. Retrofitting an audit trail gives you a trail starting the
 * day you added it, which is useless for the dispute that prompted adding it.
 *
 * `createdAt` is the time of the entry. The owner's viewer (GET /owner/audit)
 * pages on (createdAt, _id) descending, and each index below serves one of its
 * filters with that same sort, so no filter degrades into a scan and sort.
 */
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Unfiltered, and filtered by date only.
auditLogSchema.index({ createdAt: -1, _id: -1 });
// Everything that happened to one record.
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1, _id: -1 });
// Everything one person did.
auditLogSchema.index({ actor: 1, createdAt: -1, _id: -1 });
// One kind of action, such as every credit limit change.
auditLogSchema.index({ action: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
