/**
 * Every error a user can see, in Bengali.
 *
 * The API speaks English and returns a stable `code` with each failure. The code
 * is the contract; the wording lives here. That way a server message never leaks
 * to a shopkeeper in a language they cannot read, and transport failures, which
 * the server can never report because it was never reached, get real wording too.
 *
 * A code missing from this table falls back to the server text, so a new API error
 * degrades to English rather than to nothing.
 */

export type ErrorCopy = {
  /** What the user reads. Plain language, says what to do next where possible. */
  message: string;
  /** Shown only in development, to say what actually broke. */
  hint?: string;
};

/* ------------------------------------------------------- transport failures */

/** The request never reached the API, so there is no server code to key off. */
export const TRANSPORT = {
  OFFLINE: {
    message: 'ইন্টারনেট সংযোগ নেই। সংযোগ ঠিক করে আবার চেষ্টা করুন।',
  },
  SERVER_UNREACHABLE: {
    message: 'সার্ভারের সাথে সংযোগ করা যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।',
    hint: 'The API server did not respond. Is the backend running on port 4000?',
  },
  SERVER_DOWN: {
    message: 'সার্ভার এখন কাজ করছে না। একটু পরে আবার চেষ্টা করুন।',
    hint: 'The API returned a non-JSON error page. The backend is probably not running.',
  },
  TIMEOUT: {
    message: 'সার্ভার সাড়া দিতে অনেক সময় নিচ্ছে। আবার চেষ্টা করুন।',
  },
  BAD_RESPONSE: {
    message: 'সার্ভার থেকে ভুল ধরনের উত্তর এসেছে। আবার চেষ্টা করুন।',
    hint: 'Response body was not valid JSON.',
  },
} as const satisfies Record<string, ErrorCopy>;

/* ------------------------------------------------------------- API failures */

const COPY: Record<string, ErrorCopy> = {
  /* auth and access */
  UNAUTHENTICATED: { message: 'আপনি লগইন করা নেই। আবার লগইন করুন।' },
  FORBIDDEN: { message: 'এই কাজটি করার অনুমতি আপনার নেই।' },
  PHONE_TAKEN: { message: 'এই মোবাইল নম্বর দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে। লগইন করুন।' },
  INVALID_PHONE: { message: 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন, যেমন ০১৭১২৩৪৫৬৭৮।' },
  RATE_LIMITED: { message: 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন।' },

  /* shop identity */
  INVALID_SLUG: { message: 'দোকানের ঠিকানায় শুধু ছোট হাতের ইংরেজি অক্ষর, সংখ্যা আর হাইফেন দিন।' },
  RESERVED_SLUG: { message: 'এই ঠিকানাটি সংরক্ষিত। অন্য একটি ঠিকানা বেছে নিন।' },
  SLUG_TAKEN: { message: 'এই ঠিকানাটি আগেই কেউ নিয়ে নিয়েছে। অন্যটি চেষ্টা করুন।' },

  /* pricing */
  BELOW_COST: { message: 'আপনার বিক্রয় মূল্য মালিকের দামের চেয়ে কম হতে পারবে না।' },
  ABOVE_MAX: { message: 'আপনার বিক্রয় মূল্য সর্বোচ্চ অনুমোদিত দামের চেয়ে বেশি হতে পারবে না।' },
  BAD_MAX: { message: 'সর্বোচ্চ দাম মূল দামের চেয়ে কম হতে পারবে না।' },

  /* quantity and catalog */
  BELOW_MINIMUM: { message: 'সর্বনিম্ন অর্ডারের পরিমাণের চেয়ে কম দেওয়া যাবে না।' },
  INVALID_STEP: { message: 'এই পণ্যের অনুমোদিত ধাপ অনুযায়ী পরিমাণ দিন।' },
  INVALID_QUANTITY: { message: 'পরিমাণ সঠিকভাবে লিখুন।' },
  UNAVAILABLE: { message: 'পণ্যটি এখন পাওয়া যাচ্ছে না।' },
  NOT_LISTED: { message: 'পণ্যটি এই দোকানে বিক্রির জন্য নেই।' },
  OUT_OF_STOCK: { message: 'পর্যাপ্ত স্টক নেই।' },
  EMPTY_ORDER: { message: 'অন্তত একটি পণ্য যোগ করুন।' },
  DUPLICATE_LINE: { message: 'একই পণ্য একাধিকবার যোগ করা হয়েছে।' },

  /* delivery */
  NO_ZONE: { message: 'এই জেলায় আমরা এখনো ডেলিভারি করি না।' },
  DISTRICT_TAKEN: { message: 'এই জেলা আগেই অন্য একটি এলাকায় যোগ করা আছে।' },
  COURIER_REQUIRED: { message: 'কুরিয়ারের নাম লিখুন।' },

  /* money */
  CREDIT_LIMIT_EXCEEDED: {
    message: 'আপনার ক্রেডিট সীমা শেষ। অর্ডার নিশ্চিত করতে আগে টাকা জমা দিন।',
  },
  INSUFFICIENT_BALANCE: { message: 'আপনার ব্যালেন্স যথেষ্ট নয়।' },
  INVALID_AMOUNT: { message: 'সঠিক টাকার পরিমাণ লিখুন।' },
  ZERO_AMOUNT: { message: 'টাকার পরিমাণ শূন্যের বেশি হতে হবে।' },
  WITHDRAWAL_PENDING: { message: 'আপনার একটি উত্তোলনের অনুরোধ এখনো অপেক্ষায় আছে।' },
  LEDGER_DUPLICATE: { message: 'এই হিসাবটি আগেই যোগ করা হয়েছে। পাতা রিফ্রেশ করুন।' },

  /* orders */
  ALREADY_HANDLED: { message: 'এই অর্ডারটি এর মধ্যেই পরিবর্তন করা হয়েছে। পাতা রিফ্রেশ করুন।' },
  INVALID_TRANSITION: { message: 'অর্ডারের বর্তমান অবস্থা থেকে এই কাজটি করা যাবে না।' },
  UNKNOWN_TRANSITION: { message: 'অর্ডারের এই কাজটি চেনা যায়নি।' },
  ORDER_CODE: { message: 'অর্ডার নম্বর তৈরি করা যায়নি। আবার চেষ্টা করুন।' },

  /* kyc and uploads */
  ALREADY_APPROVED: { message: 'এটি আগেই অনুমোদন করা হয়েছে।' },
  NO_DOCUMENTS: { message: 'অন্তত একটি কাগজ আপলোড করুন।' },
  BAD_DOC_TYPE: { message: 'কাগজের ধরনটি সঠিক নয়।' },
  BAD_FILE_TYPE: { message: 'শুধু ছবি বা পিডিএফ ফাইল দিন।' },
  FILE_TOO_LARGE: { message: 'ফাইলটি অনেক বড়। ছোট ফাইল দিন।' },
  UPLOAD_FAILED: { message: 'ফাইল আপলোড করা যায়নি। আবার চেষ্টা করুন।' },
  NOT_CONFIGURED: {
    message: 'এই সুবিধাটি এখনো চালু করা হয়নি।',
    hint: 'A required integration (Cloudinary, SMS or Telegram) has no credentials.',
  },

  /* generic */
  VALIDATION_FAILED: { message: 'কিছু তথ্য সঠিক নয়। নিচে দেখুন।' },
  DUPLICATE: { message: 'এই তথ্যটি আগেই ব্যবহার করা হয়েছে।' },
  NOT_FOUND: { message: 'যা খুঁজছেন তা পাওয়া যায়নি।' },
  INVALID_ID: { message: 'ঠিকানাটি সঠিক নয়।' },
  INTERNAL: { message: 'সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।' },
  UNKNOWN: { message: 'অজানা সমস্যা হয়েছে। আবার চেষ্টা করুন।' },
};

/** Bengali copy for a server error code, or undefined to fall back to the server. */
export const copyFor = (code: string): ErrorCopy | undefined => COPY[code];

/**
 * Field-level messages come from zod and from validators, in English. The common
 * ones are translated by their exact text so form fields read correctly too.
 */
const FIELD_COPY: Record<string, string> = {
  Required: 'এই ঘরটি পূরণ করুন',
  'Already registered': 'এই নম্বরটি আগেই ব্যবহৃত',
  'Already in use': 'এটি আগেই ব্যবহৃত',
  'Name is required': 'নাম লিখুন',
  'Phone number is required': 'মোবাইল নম্বর লিখুন',
  'Use at least 8 characters': 'অন্তত ৮টি অক্ষর দিন',
  'Enter a valid Bangladeshi mobile number': 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন',
};

export const translateField = (text: string): string => FIELD_COPY[text] ?? text;
