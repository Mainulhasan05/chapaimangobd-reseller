'use strict';

const orderService = require('../../services/orderService');
const audit = require('../../services/audit');
const { ok } = require('../../middleware/error');
const { normalizeBdPhone } = require('../../utils/phone');
const { toTaka } = require('../../utils/money');
const present = require('../../utils/present');
const { ROLES } = require('../../domain/constants');

/**
 * PATCH /orders/:id/customer, for the owner and the reseller alike.
 * PLAN-2 decision 9.
 *
 * One handler for both roles because the rule is the same for both: until the
 * parcel ships, whoever notices a wrong address fixes it, and the other side is
 * told. The only difference is scope, which the service applies from the role:
 * a reseller reaches only their own orders.
 *
 * The delivery charge is deliberately left alone. When the new district is in
 * another zone the response says so, with that zone's charge, and the owner
 * decides through the delivery-charge endpoint.
 */
function editCustomer(role) {
  return async function handle(req, res) {
    const { name, phone, address, district } = req.body;

    const result = await orderService.editCustomer({
      orderId: req.params.id,
      role,
      resellerProfile: role === ROLES.RESELLER ? req.reseller : undefined,
      actorUser: req.user,
      changes: {
        name,
        phoneE164: phone !== undefined ? normalizeBdPhone(phone, 'phone') : undefined,
        address,
        district,
      },
    });

    if (result.changed.length > 0) {
      await audit.record({
        actor: req.user._id,
        action: 'order.edit_customer',
        targetType: 'Order',
        targetId: result.order._id,
        before: { ...result.before, status: result.order.status },
        after: { ...result.after, deliveryZoneChanged: result.deliveryZoneChanged },
        ip: req.ip,
      });
    }

    // The same shape as GET /orders/:id for this role: the owner's includes the shop.
    if (role === ROLES.OWNER) await result.order.populate('reseller', 'shopName slug');

    return ok(res, {
      order: present.orderFor(result.order, role),
      changed: result.changed.map((field) => (field === 'phoneE164' ? 'phone' : field)),
      deliveryZoneChanged: result.deliveryZoneChanged,
      // The zone the new district belongs to, when it differs from the order's.
      suggestedZone:
        result.deliveryZoneChanged && result.zone
          ? { id: result.zone._id, name: result.zone.name, charge: toTaka(result.zone.chargePoisha) }
          : null,
    });
  };
}

module.exports = { editCustomer };
