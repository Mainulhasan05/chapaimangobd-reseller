'use strict';

const { connect, disconnect } = require('../config/db');
const DeliveryZone = require('../models/DeliveryZone');
const { DISTRICTS, normalizeDistrictList } = require('../domain/districts');
const { toPoisha } = require('../utils/money');

/**
 * Where a district no zone mentions goes, and what it costs to deliver there.
 *
 * Starting rates the owner is expected to change on the zones page, not a
 * policy. Home district, the capital, everywhere else: the split couriers
 * here price by. `districts: null` means every district the earlier rows do
 * not name.
 */
const DEFAULT_ZONES = [
  { name: 'চাঁপাইনবাবগঞ্জ', districts: ['Chapai Nawabganj'], charge: 60 },
  { name: 'ঢাকার ভিতরে', districts: ['Dhaka'], charge: 80 },
  { name: 'ঢাকার বাইরে', districts: null, charge: 140 },
];

/**
 * Makes every one of the sixty-four districts orderable, without overruling
 * anything the owner has already decided.
 *
 * A customer can only pick a district some active zone covers, and a fresh
 * database has no zones at all, so every storefront opened with all sixty-four
 * greyed out until the owner built the zones by hand. This fills the gaps:
 *
 * 1. Repairs zone lists saved before the fixed list existed: "Dhaka, Rajshahi"
 *    as one entry becomes two, and old spellings take the stored one. Until
 *    then those districts matched nothing, on the form or at checkout.
 * 2. Puts every district that no zone mentions into a default zone.
 *
 * A district already in a zone stays exactly where it is, at that zone's
 * charge, even when the zone is switched off: switching a zone off is how the
 * owner stops delivering somewhere, and a seed must not quietly undo it. No
 * existing charge or on/off switch is touched. Safe to run again; the second
 * run changes nothing.
 */
async function seedZones({ dryRun = false } = {}) {
  const zones = await DeliveryZone.find().sort({ sortOrder: 1, createdAt: 1 });
  const report = { repaired: [], added: [], created: [], offInInactive: [], clashes: [] };

  for (const zone of zones) {
    const fixed = normalizeDistrictList(zone.districts);
    if (JSON.stringify(fixed) !== JSON.stringify(zone.districts)) {
      report.repaired.push({ zone: zone.name, from: [...zone.districts], to: fixed });
      zone.districts = fixed;
    }
  }

  // Which zone holds each district now, active ones winning.
  const holder = new Map();
  for (const zone of zones) {
    for (const district of zone.districts) {
      const key = district.toLowerCase();
      const current = holder.get(key);
      if (current?.isActive && zone.isActive) {
        report.clashes.push({ district, zones: [current.name, zone.name] });
      }
      if (!current || (!current.isActive && zone.isActive)) holder.set(key, zone);
    }
  }

  for (const district of DISTRICTS) {
    const zone = holder.get(district.toLowerCase());
    if (zone && !zone.isActive) report.offInInactive.push({ district, zone: zone.name });
  }

  const named = new Set(DEFAULT_ZONES.flatMap((z) => z.districts ?? []));
  let nextSort = zones.reduce((max, z) => Math.max(max, z.sortOrder ?? 0), 0);

  for (const preset of DEFAULT_ZONES) {
    const wanted = (preset.districts ?? DISTRICTS.filter((d) => !named.has(d))).filter(
      (d) => !holder.has(d.toLowerCase())
    );
    if (wanted.length === 0) continue;

    const existing = zones.find((z) => z.name === preset.name);
    if (existing) {
      existing.districts.push(...wanted);
      report.added.push({ zone: existing.name, districts: wanted, active: existing.isActive });
    } else {
      nextSort += 1;
      const zone = new DeliveryZone({
        name: preset.name,
        districts: wanted,
        chargePoisha: toPoisha(preset.charge),
        isActive: true,
        sortOrder: nextSort,
      });
      zones.push(zone);
      report.created.push({ zone: zone.name, districts: wanted, charge: preset.charge });
    }
    wanted.forEach((d) => holder.set(d.toLowerCase(), zones.find((z) => z.name === preset.name)));
  }

  if (!dryRun) {
    for (const zone of zones) {
      // eslint-disable-next-line no-await-in-loop
      if (zone.isNew || zone.isModified('districts')) await zone.save();
    }
  }

  return report;
}

/* eslint-disable no-console */
function printReport(report, dryRun) {
  const verb = dryRun ? 'would' : 'did';
  for (const r of report.repaired) {
    console.log(`[zones] ${verb} repair "${r.zone}": ${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)}`);
  }
  for (const c of report.created) {
    console.log(`[zones] ${verb} create "${c.zone}" at ৳${c.charge} with ${c.districts.length}: ${c.districts.join(', ')}`);
  }
  for (const a of report.added) {
    console.log(`[zones] ${verb} add ${a.districts.length} to "${a.zone}": ${a.districts.join(', ')}`);
    if (!a.active) console.log(`[zones]   "${a.zone}" is switched off, so these stay unorderable`);
  }
  for (const o of report.offInInactive) {
    console.log(`[zones] left alone: ${o.district} is in "${o.zone}", which is switched off`);
  }
  for (const c of report.clashes) {
    console.log(`[zones] WARNING: ${c.district} is in two active zones (${c.zones.join(', ')}); fix it on the zones page`);
  }
  const changed = report.repaired.length + report.created.length + report.added.length;
  console.log(changed ? `[zones] ${dryRun ? 'dry run, nothing written' : 'done'}` : '[zones] nothing to do');
}
/* eslint-enable no-console */

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  connect()
    .then(() => seedZones({ dryRun }))
    .then(async (report) => {
      printReport(report, dryRun);
      await disconnect();
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('[zones] failed:', err.message);
      await disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = seedZones;
module.exports.DEFAULT_ZONES = DEFAULT_ZONES;
