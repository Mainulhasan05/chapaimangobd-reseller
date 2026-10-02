import { t } from '@/lib/i18n/bn';

/*
 * The spelling of 1 to 99. Bengali number words are irregular all the way up
 * (৪৫ is পঁয়তাল্লিশ, not "চার দশ পাঁচ"), so they are a table rather than a rule.
 * This is how numbers are written, not copy, which is why it is not in the
 * dictionary; the scale words around it are.
 */
const UNDER_HUNDRED = [
  '', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
  'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ',
  'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'উনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'উনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'উনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বাহান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'উনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'উনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'উনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'উননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
];

/** A whole number in the Bengali system: কোটি, লাখ, হাজার, শ. */
function spell(whole: number): string {
  if (whole === 0) return t('amountWords.zero');
  const parts: string[] = [];
  const crore = Math.floor(whole / 10_000_000);
  let rest = whole % 10_000_000;
  // Above a crore the count of crores is itself spelled the same way.
  if (crore) parts.push(`${spell(crore)} ${t('amountWords.crore')}`);
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  if (lakh) parts.push(`${UNDER_HUNDRED[lakh]} ${t('amountWords.lakh')}`);
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (thousand) parts.push(`${UNDER_HUNDRED[thousand]} ${t('amountWords.thousand')}`);
  const hundred = Math.floor(rest / 100);
  rest %= 100;
  if (hundred) parts.push(`${UNDER_HUNDRED[hundred]}${t('amountWords.hundred')}`);
  if (rest) parts.push(UNDER_HUNDRED[rest]);
  return parts.join(' ');
}

/**
 * "৫০,০০০" as "পঞ্চাশ হাজার টাকা".
 *
 * Read back before a large payment is sent, because the mistake a phone keypad
 * invites is one zero too many, and ৫০০০০ and ৫০০০ look alike in a small box
 * but not in words.
 */
export function amountInWords(amount: number): string {
  const poisha = Math.round(amount * 100);
  const whole = Math.floor(poisha / 100);
  const fraction = poisha % 100;
  const taka = `${spell(whole)} ${t('amountWords.taka')}`;
  return fraction ? `${taka} ${UNDER_HUNDRED[fraction]} ${t('amountWords.poisha')}` : taka;
}
