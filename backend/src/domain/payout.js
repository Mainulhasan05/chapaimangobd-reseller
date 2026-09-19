'use strict';

const { DEPOSIT_METHOD } = require('./constants');

/**
 * Where a withdrawal is actually paid to.
 *
 * A payout destination is shaped by its method, and until this existed every
 * method was asked for the same thing: a Bangladeshi mobile number. That is
 * right for bKash, Nagad and Rocket and wrong for a bank, where the money moves
 * on an account number, at a named bank, at a named branch, to a named account
 * holder. A reseller choosing "bank" was being asked for a phone number nobody
 * could pay into, and `normalizeBdPhone` refused their account number outright.
 *
 * One declaration, read by the request schema, the controller and the owner's
 * payout screen, so those three cannot disagree about what a bank transfer
 * needs. See docs/adr/0018.
 */

/** Methods paid to a mobile wallet, on a Bangladeshi mobile number. */
const MOBILE_METHODS = Object.freeze([
  DEPOSIT_METHOD.BKASH,
  DEPOSIT_METHOD.NAGAD,
  DEPOSIT_METHOD.ROCKET,
]);

/**
 * What a bank transfer needs, in the order a form asks for it.
 *
 * `routingNumber` is optional: it is what a BEFTN transfer is actually routed
 * on, and a reseller reading a passbook often does not have it, while the bank
 * and branch names are enough for a counter transfer.
 */
const BANK_FIELDS = Object.freeze({
  REQUIRED: Object.freeze(['accountName', 'bankName', 'branchName', 'accountNumber']),
  OPTIONAL: Object.freeze(['routingNumber']),
});

const isMobileMethod = (method) => MOBILE_METHODS.includes(method);
const isBankMethod = (method) => method === DEPOSIT_METHOD.BANK;

/**
 * Whether a method is paid to a number at all.
 *
 * Cash is handed over, so it has no destination number in principle; it keeps
 * one today because the owner uses it to record which number was contacted, and
 * changing that is a separate decision from fixing bank transfers.
 */
const needsDestinationNumber = (method) => !isBankMethod(method);

/**
 * One line naming where a withdrawal went, for a notification or a log.
 *
 * A bank transfer has no single number to quote, so it is named by the bank and
 * the account: "Islami Bank · 20501234567890". Never the branch as well, which
 * makes the line too long for an SMS and tells the reseller nothing they did
 * not type themselves.
 */
function describeDestination(withdrawal) {
  if (!withdrawal) return null;
  if (isBankMethod(withdrawal.method)) {
    if (!withdrawal.bank) return null;
    return `${withdrawal.bank.bankName} · ${withdrawal.bank.accountNumber}`;
  }
  return withdrawal.destinationNumber || null;
}

module.exports = {
  MOBILE_METHODS,
  BANK_FIELDS,
  isMobileMethod,
  isBankMethod,
  needsDestinationNumber,
  describeDestination,
};
