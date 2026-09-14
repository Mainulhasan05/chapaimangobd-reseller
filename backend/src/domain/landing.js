'use strict';

/**
 * The public shop page as a landing page: which designs exist, and what content
 * they draw on.
 *
 * One content set, written by the owner, and several designs that each render
 * the parts of it they need. A reseller picks a design and nothing else, so
 * switching design never leaves a page half empty, and no reseller can publish
 * marketing copy the owner has not written. Contact details stay per reseller,
 * on the profile, where they already were.
 */

const TEMPLATES = Object.freeze({
  // Deep green, serif headings, carousel and packages. After matirsaad.bd.
  BAGAN: 'bagan',
  // Plain farm green, explanatory: features, ripening tips, review screenshots.
  // After grameengro.com.
  KRISHOK: 'krishok',
  // Bold accent, video first, discounts up front. After sidralife.com.
  OFFER: 'offer',
});

const DEFAULT_TEMPLATE = TEMPLATES.BAGAN;

/**
 * Icons are named, never uploaded or free text: the page maps each name to a
 * glyph it ships, so an owner cannot put a broken image into every shop at once.
 */
const ICONS = Object.freeze([
  'leaf',
  'shield',
  'truck',
  'star',
  'heart',
  'package',
  'clock',
  'sun',
  'check',
  'gift',
  'snowflake',
  'wallet',
]);

/** How much of each list a page can hold before it stops being read. */
const LIMITS = Object.freeze({
  heroImages: 6,
  badges: 4,
  whyUs: 8,
  features: 8,
  tips: 4,
  reviews: 12,
  faqs: 12,
});

/**
 * What a page shows before the owner has written anything.
 *
 * Only copy that is true of every shop on this platform. No rating, no customer
 * count and no reviews: a number or a quote nobody gave is a claim made to a
 * buyer on the owner's behalf, and it is the owner's to make.
 */
const DEFAULT_CONTENT = Object.freeze({
  headline: 'চাঁপাইনবাবগঞ্জের বাগান থেকে সরাসরি আম',
  subtitle: 'গাছ থেকে পেড়ে যত্ন করে প্যাক করা, ঘরে বসে ক্যাশ অন ডেলিভারিতে নিন',
  videoUrl: '',
  rating: null,
  customerCount: '',
  deliveryNote: 'সারা দেশে হোম ডেলিভারি',
  guaranteeNote: 'পণ্য হাতে পেয়ে দেখে টাকা পরিশোধ করুন',
  badges: [
    { icon: 'leaf', label: 'বাগান থেকে সরাসরি' },
    { icon: 'wallet', label: 'ক্যাশ অন ডেলিভারি' },
    { icon: 'truck', label: 'সারা দেশে ডেলিভারি' },
  ],
  whyUs: [
    'নিজস্ব তত্ত্বাবধানে বাগান থেকে সংগ্রহ',
    'পণ্য হাতে পেয়ে টাকা পরিশোধের সুবিধা',
    'যত্ন করে প্যাকিং, যেন পথে নষ্ট না হয়',
    'অর্ডারের পর ফোনে নিশ্চিত করা হয়',
  ],
  features: [],
  tips: [],
  faqs: [
    {
      q: 'কীভাবে অর্ডার করব?',
      a: 'নিচের ফর্মে পরিমাণ বেছে নিয়ে নাম, মোবাইল নম্বর ও ঠিকানা দিন। আমরা ফোন করে অর্ডার নিশ্চিত করব।',
    },
    {
      q: 'টাকা কখন দিতে হবে?',
      a: 'ক্যাশ অন ডেলিভারিতে পণ্য হাতে পাওয়ার পর ডেলিভারি ম্যানকে টাকা দিন।',
    },
  ],
});

const TEXT_LIMITS = Object.freeze({
  headline: 120,
  subtitle: 300,
  customerCount: 30,
  deliveryNote: 120,
  guaranteeNote: 160,
  badgeLabel: 40,
  listItem: 160,
  tipTitle: 60,
  tipText: 240,
  reviewName: 60,
  reviewText: 500,
  faqQuestion: 160,
  faqAnswer: 800,
  videoUrl: 300,
});

module.exports = { TEMPLATES, DEFAULT_TEMPLATE, ICONS, LIMITS, DEFAULT_CONTENT, TEXT_LIMITS };
