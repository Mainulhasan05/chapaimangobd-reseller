'use strict';

/**
 * The stored values of the sixty-four districts of Bangladesh.
 *
 * The same sixty-four, spelled exactly as `frontend/lib/districts.ts` stores
 * them, because a zone and an order are matched on that string exactly (see
 * `pricing.resolveDeliveryZone`). The frontend list carries the Bengali names
 * and divisions; this one only needs the values, for seeding zones and for
 * putting a hand-typed name back into the spelling the rest of the app uses.
 * tests/districts.test.js fails if the two lists ever differ. docs/adr/0019.
 */
const DISTRICTS = Object.freeze([
  // Barishal
  'Barguna', 'Barishal', 'Bhola', 'Jhalokati', 'Patuakhali', 'Pirojpur',
  // Chattogram
  'Bandarban', 'Brahmanbaria', 'Chandpur', 'Chattogram', 'Coxs Bazar', 'Cumilla', 'Feni',
  'Khagrachhari', 'Lakshmipur', 'Noakhali', 'Rangamati',
  // Dhaka
  'Dhaka', 'Faridpur', 'Gazipur', 'Gopalganj', 'Kishoreganj', 'Madaripur', 'Manikganj',
  'Munshiganj', 'Narayanganj', 'Narsingdi', 'Rajbari', 'Shariatpur', 'Tangail',
  // Khulna
  'Bagerhat', 'Chuadanga', 'Jashore', 'Jhenaidah', 'Khulna', 'Kushtia', 'Magura', 'Meherpur',
  'Narail', 'Satkhira',
  // Mymensingh
  'Jamalpur', 'Mymensingh', 'Netrokona', 'Sherpur',
  // Rajshahi
  'Bogura', 'Chapai Nawabganj', 'Joypurhat', 'Naogaon', 'Natore', 'Pabna', 'Rajshahi',
  'Sirajganj',
  // Rangpur
  'Dinajpur', 'Gaibandha', 'Kurigram', 'Lalmonirhat', 'Nilphamari', 'Panchagarh', 'Rangpur',
  'Thakurgaon',
  // Sylhet
  'Habiganj', 'Moulvibazar', 'Sunamganj', 'Sylhet',
]);

/** Letters only, lower case: "Cox's Bazar", "coxs bazar" and "CoxsBazar" are one key. */
const keyOf = (name) => String(name).toLowerCase().replace(/[^a-z]/g, '');

/**
 * Spellings in common use that differ by more than spacing and case: the
 * pre-2018 English names, and the ones the old zone textarea actually received.
 */
const ALIASES = {
  barisal: 'Barishal',
  chittagong: 'Chattogram',
  comilla: 'Cumilla',
  jessore: 'Jashore',
  bogra: 'Bogura',
  nawabganj: 'Chapai Nawabganj',
  chapainababganj: 'Chapai Nawabganj',
  jhalakathi: 'Jhalokati',
  jhalokathi: 'Jhalokati',
  khagrachari: 'Khagrachhari',
  laxmipur: 'Lakshmipur',
  maulvibazar: 'Moulvibazar',
  netrakona: 'Netrokona',
  jaipurhat: 'Joypurhat',
};

const BY_KEY = new Map([
  ...Object.entries(ALIASES),
  ...DISTRICTS.map((value) => [keyOf(value), value]),
]);

/** The stored value a name means, or null when it is not one of the sixty-four. */
function canonicalDistrict(name) {
  if (typeof name !== 'string') return null;
  return BY_KEY.get(keyOf(name)) ?? null;
}

/**
 * A zone's district list in stored spelling, one district per entry.
 *
 * The old textarea let "Dhaka, Rajshahi" be saved as a single district, which
 * matches neither, so entries are split on commas and line breaks first. A name
 * that is not one of the sixty-four is kept as typed rather than dropped: it is
 * live data, and the zone editor shows it as a chip to fix. Duplicates go.
 */
function normalizeDistrictList(names) {
  const out = [];
  const seen = new Set();
  for (const raw of names ?? []) {
    for (const piece of String(raw).split(/[,\n،]/)) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      const value = canonicalDistrict(trimmed) ?? trimmed;
      const key = value.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(value);
      }
    }
  }
  return out;
}

module.exports = { DISTRICTS, canonicalDistrict, normalizeDistrictList };
