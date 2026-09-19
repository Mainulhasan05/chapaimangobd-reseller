/**
 * The sixty-four districts of Bangladesh.
 *
 * One list, so that every screen that asks "which district" offers the same
 * sixty-four and every order carries a district name the delivery zones can
 * actually match. Before this, the owner typed district names into a textarea
 * on the zone editor and a customer picked from whatever had been typed: one
 * misspelling there and a whole district silently stopped being deliverable.
 *
 * `value` is what is stored on an order and on a zone, and it is the English
 * name. That is deliberate and it is not going to change: it is what the
 * existing zones, orders and seeds already hold, and renaming it would orphan
 * every district on every order ever placed. `bn` is what a reader sees, and
 * every screen in this app shows that and never the value.
 *
 * Search matches the Bengali name, the English name and the division, so
 * "চাঁপাই", "chapai" and "rajshahi" all find Chapai Nawabganj. Sixty-four is too
 * many to scroll on a phone, which is the whole reason the field is a combobox
 * and not a `<select>`.
 */

export type District = {
  /** Stored on orders and zones. Never shown to a reader. */
  value: string;
  /** What every screen displays. */
  bn: string;
  /** The division, shown as a caption and matched by the search. */
  division: string;
  divisionBn: string;
};

export const DIVISIONS_BN: Record<string, string> = {
  Barishal: 'বরিশাল',
  Chattogram: 'চট্টগ্রাম',
  Dhaka: 'ঢাকা',
  Khulna: 'খুলনা',
  Mymensingh: 'ময়মনসিংহ',
  Rajshahi: 'রাজশাহী',
  Rangpur: 'রংপুর',
  Sylhet: 'সিলেট',
};

/** Grouped by division, and within a division alphabetical by English name. */
export const DISTRICTS: District[] = (
  [
    ['Barishal', 'Barguna', 'বরগুনা'],
    ['Barishal', 'Barishal', 'বরিশাল'],
    ['Barishal', 'Bhola', 'ভোলা'],
    ['Barishal', 'Jhalokati', 'ঝালকাঠি'],
    ['Barishal', 'Patuakhali', 'পটুয়াখালী'],
    ['Barishal', 'Pirojpur', 'পিরোজপুর'],

    ['Chattogram', 'Bandarban', 'বান্দরবান'],
    ['Chattogram', 'Brahmanbaria', 'ব্রাহ্মণবাড়িয়া'],
    ['Chattogram', 'Chandpur', 'চাঁদপুর'],
    ['Chattogram', 'Chattogram', 'চট্টগ্রাম'],
    ['Chattogram', 'Coxs Bazar', "কক্সবাজার"],
    ['Chattogram', 'Cumilla', 'কুমিল্লা'],
    ['Chattogram', 'Feni', 'ফেনী'],
    ['Chattogram', 'Khagrachhari', 'খাগড়াছড়ি'],
    ['Chattogram', 'Lakshmipur', 'লক্ষ্মীপুর'],
    ['Chattogram', 'Noakhali', 'নোয়াখালী'],
    ['Chattogram', 'Rangamati', 'রাঙামাটি'],

    ['Dhaka', 'Dhaka', 'ঢাকা'],
    ['Dhaka', 'Faridpur', 'ফরিদপুর'],
    ['Dhaka', 'Gazipur', 'গাজীপুর'],
    ['Dhaka', 'Gopalganj', 'গোপালগঞ্জ'],
    ['Dhaka', 'Kishoreganj', 'কিশোরগঞ্জ'],
    ['Dhaka', 'Madaripur', 'মাদারীপুর'],
    ['Dhaka', 'Manikganj', 'মানিকগঞ্জ'],
    ['Dhaka', 'Munshiganj', 'মুন্সিগঞ্জ'],
    ['Dhaka', 'Narayanganj', 'নারায়ণগঞ্জ'],
    ['Dhaka', 'Narsingdi', 'নরসিংদী'],
    ['Dhaka', 'Rajbari', 'রাজবাড়ী'],
    ['Dhaka', 'Shariatpur', 'শরীয়তপুর'],
    ['Dhaka', 'Tangail', 'টাঙ্গাইল'],

    ['Khulna', 'Bagerhat', 'বাগেরহাট'],
    ['Khulna', 'Chuadanga', 'চুয়াডাঙ্গা'],
    ['Khulna', 'Jashore', 'যশোর'],
    ['Khulna', 'Jhenaidah', 'ঝিনাইদহ'],
    ['Khulna', 'Khulna', 'খুলনা'],
    ['Khulna', 'Kushtia', 'কুষ্টিয়া'],
    ['Khulna', 'Magura', 'মাগুরা'],
    ['Khulna', 'Meherpur', 'মেহেরপুর'],
    ['Khulna', 'Narail', 'নড়াইল'],
    ['Khulna', 'Satkhira', 'সাতক্ষীরা'],

    ['Mymensingh', 'Jamalpur', 'জামালপুর'],
    ['Mymensingh', 'Mymensingh', 'ময়মনসিংহ'],
    ['Mymensingh', 'Netrokona', 'নেত্রকোনা'],
    ['Mymensingh', 'Sherpur', 'শেরপুর'],

    ['Rajshahi', 'Bogura', 'বগুড়া'],
    ['Rajshahi', 'Chapai Nawabganj', 'চাঁপাইনবাবগঞ্জ'],
    ['Rajshahi', 'Joypurhat', 'জয়পুরহাট'],
    ['Rajshahi', 'Naogaon', 'নওগাঁ'],
    ['Rajshahi', 'Natore', 'নাটোর'],
    ['Rajshahi', 'Pabna', 'পাবনা'],
    ['Rajshahi', 'Rajshahi', 'রাজশাহী'],
    ['Rajshahi', 'Sirajganj', 'সিরাজগঞ্জ'],

    ['Rangpur', 'Dinajpur', 'দিনাজপুর'],
    ['Rangpur', 'Gaibandha', 'গাইবান্ধা'],
    ['Rangpur', 'Kurigram', 'কুড়িগ্রাম'],
    ['Rangpur', 'Lalmonirhat', 'লালমনিরহাট'],
    ['Rangpur', 'Nilphamari', 'নীলফামারী'],
    ['Rangpur', 'Panchagarh', 'পঞ্চগড়'],
    ['Rangpur', 'Rangpur', 'রংপুর'],
    ['Rangpur', 'Thakurgaon', 'ঠাকুরগাঁও'],

    ['Sylhet', 'Habiganj', 'হবিগঞ্জ'],
    ['Sylhet', 'Moulvibazar', 'মৌলভীবাজার'],
    ['Sylhet', 'Sunamganj', 'সুনামগঞ্জ'],
    ['Sylhet', 'Sylhet', 'সিলেট'],
  ] as const
).map(([division, value, bn]) => ({
  value,
  bn,
  division,
  divisionBn: DIVISIONS_BN[division],
}));

const BY_VALUE = new Map(DISTRICTS.map((d) => [d.value.toLowerCase(), d]));

/** The district a stored value names, or undefined if it is not one of the 64. */
export function findDistrict(value: string | null | undefined): District | undefined {
  if (!value) return undefined;
  return BY_VALUE.get(value.trim().toLowerCase());
}

/**
 * What to show for a stored district value.
 *
 * Falls back to the value itself, because zones and orders written before this
 * list existed may hold a name that is not on it, and showing the raw string is
 * better than showing a blank where a district used to be.
 */
export function districtLabel(value: string | null | undefined): string {
  if (!value) return '';
  return findDistrict(value)?.bn ?? value;
}

/**
 * Does this district match what someone is typing?
 *
 * Matches the Bengali name, the English name and both division names, so a
 * reseller who types in either script finds the row. Case-insensitive, and the
 * term is not split: "cox" matching "Coxs Bazar" is wanted, "c b" is not.
 */
export function districtMatches(district: District, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return (
    district.bn.includes(term.trim()) ||
    district.value.toLowerCase().includes(q) ||
    district.division.toLowerCase().includes(q) ||
    district.divisionBn.includes(term.trim())
  );
}
