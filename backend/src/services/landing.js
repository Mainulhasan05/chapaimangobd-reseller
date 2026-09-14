'use strict';

const LandingContent = require('../models/LandingContent');
const imageService = require('./images');
const { DEFAULT_CONTENT } = require('../domain/landing');

/**
 * Reads and presents the owner's landing content.
 *
 * Until the owner first saves there is no document, and the defaults stand in.
 * Once there is one it is taken as written: an owner who deletes every FAQ
 * wants no FAQ, not the defaults back.
 */

const load = () => LandingContent.findOne({ key: 'global' });

/** The document, created from the defaults the first time something is written. */
async function loadForWrite() {
  const existing = await load();
  if (existing) return existing;
  return new LandingContent({ key: 'global', ...DEFAULT_CONTENT });
}

/**
 * The content as both the public page and the owner's editor read it. Images
 * are presented, so nothing above this line knows where they are hosted.
 */
function present(doc) {
  const source = doc || DEFAULT_CONTENT;
  return {
    headline: source.headline || '',
    subtitle: source.subtitle || '',
    heroImages: doc ? imageService.presentMany(doc.heroImages) : [],
    videoUrl: source.videoUrl || '',
    rating: source.rating ?? null,
    customerCount: source.customerCount || '',
    deliveryNote: source.deliveryNote || '',
    guaranteeNote: source.guaranteeNote || '',
    badges: (source.badges || []).map((b) => ({ icon: b.icon, label: b.label })),
    whyUs: [...(source.whyUs || [])],
    features: [...(source.features || [])],
    tips: (source.tips || []).map((tip) => ({ icon: tip.icon, title: tip.title, text: tip.text })),
    reviews: doc
      ? doc.reviews.map((r) => ({
          id: String(r._id),
          name: r.name || '',
          text: r.text || '',
          image: r.image ? imageService.present(r.image) : null,
        }))
      : [],
    faqs: (source.faqs || []).map((f) => ({ q: f.q, a: f.a })),
  };
}

async function getLanding() {
  return present(await load());
}

module.exports = { load, loadForWrite, present, getLanding };
