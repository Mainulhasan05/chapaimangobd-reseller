'use strict';

const mongoose = require('mongoose');
const publicImageSchema = require('./publicImage');
const { ICONS } = require('../domain/landing');

/**
 * Singleton. The marketing half of every public shop page, written once by the
 * owner and rendered by whichever design each reseller chose. See
 * domain/landing.js for why it is one set rather than one per design.
 *
 * Its own collection rather than a block on Setting: Setting is read and cached
 * on nearly every request, and this carries image records and paragraphs that
 * only the public page and one owner screen ever want.
 *
 * Absent until the owner first saves. Until then services/landing.js serves the
 * defaults, so a fresh deployment still has a presentable page.
 */
const iconField = { type: String, enum: ICONS, default: 'check' };

const landingContentSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },

    headline: { type: String, trim: true },
    subtitle: { type: String, trim: true },
    heroImages: { type: [publicImageSchema], default: [] },
    // A YouTube link or a direct video file. The page decides how to embed it.
    videoUrl: { type: String, trim: true },
    // Owner-stated trust figures. Null and blank mean "do not show".
    rating: { type: Number, min: 0, max: 5, default: null },
    customerCount: { type: String, trim: true },
    deliveryNote: { type: String, trim: true },
    guaranteeNote: { type: String, trim: true },

    badges: [{ _id: false, icon: iconField, label: { type: String, trim: true } }],
    whyUs: { type: [String], default: [] },
    features: { type: [String], default: [] },
    tips: [
      {
        _id: false,
        icon: iconField,
        title: { type: String, trim: true },
        text: { type: String, trim: true },
      },
    ],
    // A review is a quote, a screenshot, or both. Real ids, because the owner
    // deletes one at a time and an index shifts under a concurrent edit.
    reviews: [
      {
        name: { type: String, trim: true },
        text: { type: String, trim: true },
        image: { type: publicImageSchema, default: null },
      },
    ],
    faqs: [{ _id: false, q: { type: String, trim: true }, a: { type: String, trim: true } }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('LandingContent', landingContentSchema);
