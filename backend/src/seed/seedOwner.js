'use strict';

const bcrypt = require('bcryptjs');
const { connect, disconnect } = require('../config/db');
const User = require('../models/User');
const Setting = require('../models/Setting');
const { normalizeBdPhone } = require('../utils/phone');
const { ROLES } = require('../domain/constants');

/**
 * There is exactly one owner and registration cannot create it, so it comes from
 * here. Safe to run more than once: an existing owner is left alone.
 */
async function seedOwner() {
  const name = process.env.OWNER_NAME || 'Owner';
  const phone = process.env.OWNER_PHONE;
  const password = process.env.OWNER_PASSWORD;

  if (!phone || !password) {
    throw new Error('Set OWNER_PHONE and OWNER_PASSWORD in the environment first');
  }

  const phoneE164 = normalizeBdPhone(phone);
  const existing = await User.findOne({ role: ROLES.OWNER });

  if (existing) {
    return { created: false, owner: existing };
  }

  const owner = await User.create({
    name,
    phoneE164,
    passwordHash: await bcrypt.hash(password, 12),
    role: ROLES.OWNER,
  });

  await Setting.findOneAndUpdate({ key: 'global' }, { $setOnInsert: { key: 'global' } }, { upsert: true });

  return { created: true, owner };
}

if (require.main === module) {
  connect()
    .then(seedOwner)
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(
        result.created
          ? `[seed] owner created: ${result.owner.phoneE164}`
          : `[seed] owner already exists: ${result.owner.phoneE164}`
      );
      return disconnect();
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('[seed] failed:', err.message);
      await disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = seedOwner;
