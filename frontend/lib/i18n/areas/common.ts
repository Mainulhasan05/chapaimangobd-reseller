/**
 * Shared vocabulary added by PLAN-4. Add keys only; never redefine one from bn.ts.
 *
 * The verbs here exist to end one word meaning four things. "বাতিল" used to be
 * dismiss, reject, rejected and cancelled at once, so a reject dialog could show
 * three buttons with the same label. Now: dismiss is "ফিরে যান", reject is
 * "নামঞ্জুর", archive is "সরিয়ে রাখুন", and "বাতিল" is only ever a cancelled
 * order or the dismiss of an ordinary form.
 */
export const common = {
  'app.dismiss': 'ফিরে যান',
  'app.archive': 'সরিয়ে রাখুন',
  'app.restore': 'আবার চালু করুন',
  'app.archived': 'সরিয়ে রাখা',
  'app.showArchived': 'সরিয়ে রাখাগুলো দেখুন',
  'app.undo': 'ফিরিয়ে আনুন',
  'app.call': 'কল করুন',
  'app.details': 'বিস্তারিত দেখুন',
  'app.filters': 'ফিল্টার',
  'app.clearFilters': 'ফিল্টার মুছুন',
  'app.filteredEmpty': 'এই ফিল্টারে কিছু নেই',
  'app.filteredEmptyHelp': 'ফিল্টার বা তারিখ বদলে দেখুন',
  'app.unsavedBar': 'অসংরক্ষিত পরিবর্তন আছে',
  'app.unsavedLeave': 'সংরক্ষণ না করে বেরিয়ে গেলে পরিবর্তনগুলো হারিয়ে যাবে। বেরোবেন?',
  'app.fieldsMissing': '{count}টি ঘর বাকি',
  'app.fixFields': 'লাল দাগ দেওয়া ঘরগুলো ঠিক করুন',
  'app.minChars': 'কমপক্ষে {count} অক্ষর লিখুন',
  'app.updatedAgo': 'আপডেট: {time}',
  'app.justNow': 'এইমাত্র',
  'app.minutesAgo': '{count} মিনিট আগে',
  'app.loadFailed': 'লোড করা যায়নি',
  'app.notAvailable': '—',
  'app.next': 'পরের',
  'app.previous': 'আগের',
  'app.selectedCount': '{count}টি বাছাই করা',
  'app.clearSelection': 'বাছাই মুছুন',
  'app.progress': '{done}/{total}',
  'app.before': 'আগে',
  'app.after': 'পরে',
  'app.reason': 'কারণ',
  'app.reasonRequired': 'কারণ লিখুন',
  'app.otherReason': 'অন্য কারণ',
  'app.scrollMore': 'আরও দেখতে পাশে সরান',
  'range.thisWeek': 'এই সপ্তাহ',
  'range.season': 'এই মৌসুম',
  'status.deposit.pending': 'অপেক্ষায়',
  'status.deposit.approved': 'অনুমোদিত',
  'status.deposit.rejected': 'নামঞ্জুর',
  'method.bkash': 'বিকাশ',
  'method.nagad': 'নগদ (Nagad)',
  'method.rocket': 'রকেট',
  'method.bank': 'ব্যাংক',
  'method.cash': 'হাতে নগদ (ক্যাশ)',
} as const;
