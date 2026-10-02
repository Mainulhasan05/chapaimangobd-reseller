'use strict';

/*
 * The sixty-four districts on the backend, and the seed that makes every one
 * of them orderable. A storefront whose zones cover nothing greys out all
 * sixty-four, and a customer cannot order at all. docs/adr/0019.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const tokens = require('../src/services/tokens');
const seedZones = require('../src/seed/seedZones');
const { resolveDeliveryZone } = require('../src/services/pricing');
const { DISTRICTS, canonicalDistrict, normalizeDistrictList } = require('../src/domain/districts');
const DeliveryZone = require('../src/models/DeliveryZone');
const { toPoisha } = require('../src/utils/money');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

/* ------------------------------------------------------------- the list */

test('the backend list is the frontend list, value for value', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'lib', 'districts.ts'),
    'utf8'
  );
  // Rows look like ['Rajshahi', 'Chapai Nawabganj', 'চাঁপাইনবাবগঞ্জ'].
  const frontend = [...source.matchAll(/\[\s*'[A-Za-z]+',\s*'([^']+)',\s*["'][^"']+["']\s*\]/g)].map(
    (m) => m[1]
  );
  assert.equal(frontend.length, 64);
  assert.deepEqual([...DISTRICTS].sort(), [...frontend].sort());
});

test('old and loose spellings resolve to the stored one', () => {
  assert.equal(canonicalDistrict('Chapainawabganj'), 'Chapai Nawabganj');
  assert.equal(canonicalDistrict('chapai nawabganj'), 'Chapai Nawabganj');
  assert.equal(canonicalDistrict("Cox's Bazar"), 'Coxs Bazar');
  assert.equal(canonicalDistrict('Chittagong'), 'Chattogram');
  assert.equal(canonicalDistrict(' dhaka '), 'Dhaka');
  assert.equal(canonicalDistrict('Gotham'), null);
});

test('a textarea-era entry is split, respelled and deduplicated, unknowns kept', () => {
  assert.deepEqual(normalizeDistrictList(['Dhaka, Rajshahi', 'dhaka', 'Gotham\nBogra']), [
    'Dhaka',
    'Rajshahi',
    'Gotham',
    'Bogura',
  ]);
});

/* ------------------------------------------------------------- the seed */

async function coveredByActiveZone() {
  const zones = await DeliveryZone.find({ isActive: true });
  return new Set(zones.flatMap((z) => z.districts));
}

test('an empty database ends up with all sixty-four orderable', async () => {
  await seedZones();

  const covered = await coveredByActiveZone();
  assert.equal(covered.size, 64);
  for (const district of DISTRICTS) {
    // The same lookup checkout runs, so "covered" means the order goes through.
    // eslint-disable-next-line no-await-in-loop
    const { zone } = await resolveDeliveryZone(district);
    assert.ok(zone, district);
  }

  const home = await resolveDeliveryZone('Chapai Nawabganj');
  assert.equal(home.chargePoisha, toPoisha(60));
  assert.equal((await resolveDeliveryZone('Dhaka')).chargePoisha, toPoisha(80));
  assert.equal((await resolveDeliveryZone('Sylhet')).chargePoisha, toPoisha(140));
});

test('a legacy "Dhaka, Rajshahi" zone is repaired and keeps its own charge', async () => {
  // Exactly what a live database held: one zone, one entry, matching nothing.
  await DeliveryZone.collection.insertOne({
    name: 'Dhaka',
    districts: ['Dhaka, Rajshahi'],
    chargePoisha: toPoisha(120),
    isActive: true,
    sortOrder: 0,
  });

  const report = await seedZones();
  assert.equal(report.repaired.length, 1);

  const legacy = await DeliveryZone.findOne({ name: 'Dhaka' });
  assert.deepEqual([...legacy.districts], ['Dhaka', 'Rajshahi']);
  assert.equal(legacy.chargePoisha, toPoisha(120));
  assert.equal((await resolveDeliveryZone('Rajshahi')).chargePoisha, toPoisha(120));

  // Dhaka was already the owner's, so no default Dhaka zone appears beside it.
  assert.equal(await DeliveryZone.exists({ name: 'ঢাকার ভিতরে' }), null);
  assert.equal((await coveredByActiveZone()).size, 64);
});

test('a second run changes nothing', async () => {
  await seedZones();
  const before = await DeliveryZone.find().lean();

  const report = await seedZones();
  assert.deepEqual(report.repaired, []);
  assert.deepEqual(report.created, []);
  assert.deepEqual(report.added, []);
  assert.deepEqual(await DeliveryZone.find().lean(), before);
});

test('a district in a switched-off zone stays switched off', async () => {
  await f.makeZone({ name: 'Paused', districts: ['Sylhet'], charge: 200 });
  await DeliveryZone.updateOne({ name: 'Paused' }, { $set: { isActive: false } });

  const report = await seedZones();
  assert.deepEqual(report.offInInactive, [{ district: 'Sylhet', zone: 'Paused' }]);
  await assert.rejects(resolveDeliveryZone('Sylhet'), /deliver/);
  assert.equal((await coveredByActiveZone()).size, 63);
});

test('a dry run reports the plan and writes nothing', async () => {
  const report = await seedZones({ dryRun: true });
  assert.equal(report.created.length, 3);
  assert.equal(await DeliveryZone.countDocuments(), 0);
});

/* ------------------------------------------------------------- the zone API */

test('the zone API stores districts in the spelling checkout matches on', async () => {
  const { user } = await f.makeOwner();
  const res = await request(app)
    .post('/api/owner/delivery-zones')
    .set('Authorization', `Bearer ${tokens.signAccessToken(user)}`)
    .send({ name: 'North', districts: ['rangpur', 'Dinajpur, Thakurgaon'], charge: 130 });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const zone = await DeliveryZone.findOne({ name: 'North' });
  assert.deepEqual([...zone.districts], ['Rangpur', 'Dinajpur', 'Thakurgaon']);
  assert.ok((await resolveDeliveryZone('Rangpur')).zone);
});
