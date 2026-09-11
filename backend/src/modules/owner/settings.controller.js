'use strict';

const { getSettings, updateSettings } = require('../../services/settings');
const audit = require('../../services/audit');
const sms = require('../../channels/sms');
const { ok } = require('../../middleware/error');
const { toPoisha, toTaka } = require('../../utils/money');
const { normalizeBdPhone } = require('../../utils/phone');
const imageService = require('../../services/images');
const { badRequest } = require('../../utils/errors');

const shape = (s) => ({
  businessName: s.businessName,
  supportPhone: s.supportPhoneE164,
  poweredByText: s.poweredByText,
  brandLogoUrl: s.brandLogoUrl || null,
  defaultCreditLimit: toTaka(s.defaultCreditLimitPoisha),
  orderAgingHours: s.orderAgingHours,
  reverseDeliveryChargeOnReturn: s.reverseDeliveryChargeOnReturn,
  smsPricePerCredit: toTaka(s.smsPricePerCreditPoisha),
  features: s.features,
});

async function get(_req, res) {
  const settings = await getSettings({ fresh: true });
  return ok(res, { settings: shape(settings) });
}

async function update(req, res) {
  const before = await getSettings({ fresh: true });
  const body = req.body;
  const patch = {};

  if (body.businessName !== undefined) patch.businessName = body.businessName;
  if (body.poweredByText !== undefined) patch.poweredByText = body.poweredByText;
  if (body.supportPhone !== undefined) {
    patch.supportPhoneE164 = body.supportPhone ? normalizeBdPhone(body.supportPhone) : null;
  }
  if (body.defaultCreditLimit !== undefined) {
    patch.defaultCreditLimitPoisha = toPoisha(body.defaultCreditLimit, 'defaultCreditLimit');
  }
  if (body.orderAgingHours !== undefined) patch.orderAgingHours = body.orderAgingHours;
  if (body.reverseDeliveryChargeOnReturn !== undefined) {
    patch.reverseDeliveryChargeOnReturn = body.reverseDeliveryChargeOnReturn;
  }
  if (body.smsPricePerCredit !== undefined) {
    patch.smsPricePerCreditPoisha = toPoisha(body.smsPricePerCredit, 'smsPricePerCredit');
  }
  if (body.features) {
    Object.entries(body.features).forEach(([key, value]) => {
      patch[`features.${key}`] = value;
    });
  }

  const settings = await updateSettings(patch);

  // Turning SMS on starts spending real money, so it is worth a record.
  if (body.features && body.features.sms !== undefined) {
    await audit.record({
      actor: req.user._id,
      action: 'settings.sms_toggle',
      targetType: 'Setting',
      targetId: settings._id,
      before: { sms: before.features.sms },
      after: { sms: settings.features.sms },
      ip: req.ip,
    });
  }

  return ok(res, { settings: shape(settings) });
}

/**
 * A public asset: the brand mark customers see on every shop and tracking page.
 *
 * It goes to the image host rather than the private bucket because its whole
 * audience is logged out. Nothing the owner uploads here is confidential; a
 * document that is belongs in KYC, which is a different route into a different
 * store entirely.
 */
async function uploadBrandLogo(req, res) {
  if (!req.file) throw badRequest('NO_FILE', 'Choose an image first');

  const before = await getSettings({ fresh: true });
  const previous = before.brandLogo;

  const image = await imageService.uploadPublic(req.file, { kind: imageService.KINDS.ASSET });

  const settings = await updateSettings({
    brandLogo: image,
    brandLogoUrl: imageService.urlOf(image),
  });

  // Released only after the replacement is saved, so a failure cannot leave the
  // brand with no mark at all.
  if (previous) await imageService.remove(previous);

  return ok(res, { settings: shape(settings) });
}

async function removeBrandLogo(_req, res) {
  const before = await getSettings({ fresh: true });
  const previous = before.brandLogo;

  const settings = await updateSettings({ brandLogo: null, brandLogoUrl: null });
  if (previous) await imageService.remove(previous);

  return ok(res, { settings: shape(settings) });
}

/** Gateway balance, so the owner learns about an empty account before a send fails. */
async function smsBalance(_req, res) {
  if (!sms.isConfigured()) {
    return ok(res, { configured: false, balance: null });
  }
  const balance = await sms.checkBalance();
  return ok(res, { configured: true, balance });
}

module.exports = { get, update, uploadBrandLogo, removeBrandLogo, smsBalance };
