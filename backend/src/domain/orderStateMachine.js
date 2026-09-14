'use strict';

const { ORDER_STATUS, ROLES } = require('./constants');
const { conflict, forbidden } = require('../utils/errors');

const S = ORDER_STATUS;

/**
 * Every status change in the system validates against this table. No controller
 * contains a bare status comparison, because scattering `if (status === 'pending')`
 * across controllers is exactly how the money bugs ship.
 *
 * `ledger` names what the transition posts:
 *   confirm         cost debit plus delivery debit
 *   codCollection   credit of what the courier collected, cash on delivery only
 *   reverseOpen     reverse every entry the order has posted so far
 *   reverseOnReturn reverse the cost debit, and the delivery debit together with
 *                   its adjustments only if the owner setting says so, since the
 *                   courier was paid regardless
 *
 * Every reversal ignores the credit limit: a limit governs new commitments, never
 * the undoing of old ones. See docs/adr/0008.
 *
 * `stock` names what the transition does to stock:
 *   decrement          take it, inside the confirm transaction
 *   restore            put it back, whenever the order had taken it
 *   restoreIfRequested put it back only when the owner ticks "put back in stock"
 */
const TRANSITIONS = {
  confirm: {
    to: S.CONFIRMED,
    from: { [ROLES.RESELLER]: [S.PENDING], [ROLES.OWNER]: [S.PENDING] },
    ledger: 'confirm',
    stock: 'decrement',
    requiresKyc: true,
    timestampField: 'confirmedAt',
  },
  /*
   * Accepting is where the owner commits to filling the order, which is the
   * moment they know which orchard each line is coming from. The requirement
   * lives here rather than in the controller for the same reason every other
   * rule does: the table is the only place that decides what a transition needs.
   */
  accept: {
    to: S.ACCEPTED,
    from: { [ROLES.OWNER]: [S.CONFIRMED] },
    timestampField: 'acceptedAt',
    requiresSources: true,
  },
  pack: {
    to: S.PACKED,
    from: { [ROLES.OWNER]: [S.ACCEPTED] },
    timestampField: 'packedAt',
  },
  ship: {
    to: S.SHIPPED,
    from: { [ROLES.OWNER]: [S.PACKED] },
    timestampField: 'shippedAt',
    requiresCourier: true,
  },
  deliver: {
    to: S.DELIVERED,
    from: { [ROLES.OWNER]: [S.SHIPPED] },
    ledger: 'codCollection',
    timestampField: 'deliveredAt',
  },
  cancel: {
    to: S.CANCELLED,
    // The reseller may pull back their own order until the owner has accepted it.
    // After that it is the owner call. Every status from confirmed has taken
    // stock, so every one of them gives it back; pending never took any.
    from: {
      [ROLES.RESELLER]: [S.PENDING, S.CONFIRMED],
      [ROLES.OWNER]: [S.PENDING, S.CONFIRMED, S.ACCEPTED, S.PACKED],
    },
    ledger: 'reverseOpen',
    stock: 'restore',
    timestampField: 'closedAt',
  },
  return: {
    to: S.RETURNED,
    // Only a parcel still with the courier can come back. Delivered is terminal:
    // a problem after delivery is a manual ledger entry with a note.
    from: { [ROLES.OWNER]: [S.SHIPPED] },
    ledger: 'reverseOnReturn',
    // Travelled mangoes are usually gone, so the owner decides per return.
    stock: 'restoreIfRequested',
    timestampField: 'closedAt',
  },
};

const TERMINAL = new Set([S.CANCELLED, S.RETURNED, S.DELIVERED]);

/**
 * An order that never reached confirmed has no ledger entries and never took
 * stock, so cancelling it must not try to reverse or restore anything.
 */
const wasCommitted = (status) => status !== S.PENDING;

/**
 * The owner learns the real courier cost at accept or ship, so the charge stays
 * editable until the parcel has left. See docs/adr/0010.
 */
const DELIVERY_CHARGE_EDITABLE = Object.freeze([S.PENDING, S.CONFIRMED, S.ACCEPTED, S.PACKED]);

function assertDeliveryChargeEditable(order) {
  if (!DELIVERY_CHARGE_EDITABLE.includes(order.status)) {
    throw conflict(
      'DELIVERY_CHARGE_LOCKED',
      `The delivery charge cannot be changed on an order that is ${order.status}`
    );
  }
}

function getTransition(action) {
  const t = TRANSITIONS[action];
  if (!t) throw conflict('UNKNOWN_TRANSITION', `Unknown order action: ${action}`);
  return t;
}

/**
 * Throws unless this role may move this order from its current status.
 * Returns the transition definition so the caller can act on its flags.
 */
function assertCanTransition(order, action, role) {
  const transition = getTransition(action);
  const allowedFrom = transition.from[role];

  if (!allowedFrom) {
    throw forbidden(`A ${role} cannot ${action} an order`);
  }
  if (!allowedFrom.includes(order.status)) {
    throw conflict(
      'INVALID_TRANSITION',
      `An order that is ${order.status} cannot be ${transition.to}`
    );
  }
  return transition;
}

/** Every action this role could take on this order right now, for the UI. */
function availableActions(order, role) {
  return Object.entries(TRANSITIONS)
    .filter(([, t]) => (t.from[role] || []).includes(order.status))
    .map(([action]) => action);
}

module.exports = {
  TRANSITIONS,
  TERMINAL,
  wasCommitted,
  DELIVERY_CHARGE_EDITABLE,
  assertDeliveryChargeEditable,
  getTransition,
  assertCanTransition,
  availableActions,
};
