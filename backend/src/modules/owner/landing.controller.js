'use strict';

const landing = require('../../services/landing');
const imageService = require('../../services/images');
const audit = require('../../services/audit');
const { ok } = require('../../middleware/error');
const { badRequest, notFound } = require('../../utils/errors');
const { LIMITS, TEMPLATES } = require('../../domain/landing');

/**
 * The owner's editor for the content every public shop page is built from.
 *
 * Text is one JSON save. Hero photographs and reviews are their own multipart
 * routes, because a picture has to reach the image host before there is
 * anything to store, and a failed upload must not throw away a paragraph.
 */

const respond = (res, doc) =>
  ok(res, { landing: landing.present(doc), templates: Object.values(TEMPLATES) });

async function get(_req, res) {
  return respond(res, await landing.load());
}

const TEXT_FIELDS = [
  'headline',
  'subtitle',
  'videoUrl',
  'rating',
  'customerCount',
  'deliveryNote',
  'guaranteeNote',
  'badges',
  'whyUs',
  'features',
  'tips',
  'faqs',
];

async function update(req, res) {
  const doc = await landing.loadForWrite();
  const changed = TEXT_FIELDS.filter((field) => req.body[field] !== undefined);

  changed.forEach((field) => {
    doc[field] = req.body[field];
  });
  await doc.save();

  if (changed.length > 0) {
    // Which sections moved, not their text: the copy itself is on the page.
    await audit.record({
      actor: req.user._id,
      action: 'landing.update',
      targetType: 'LandingContent',
      targetId: doc._id,
      after: { fields: changed },
      ip: req.ip,
    });
  }

  return respond(res, doc);
}

async function addHeroImages(req, res) {
  const files = req.files || [];
  if (files.length === 0) throw badRequest('NO_FILE', 'Choose an image first');

  const doc = await landing.loadForWrite();
  if (doc.heroImages.length + files.length > LIMITS.heroImages) {
    throw badRequest('TOO_MANY_IMAGES', `A page holds at most ${LIMITS.heroImages} photos`);
  }

  const uploaded = await imageService.uploadManyPublic(files, { kind: imageService.KINDS.ASSET });
  doc.heroImages.push(...uploaded);
  await doc.save();

  return respond(res, doc);
}

async function removeHeroImage(req, res) {
  const doc = await landing.loadForWrite();
  const image = doc.heroImages.find((img) => (img.id || img.key) === req.params.imageId);
  if (!image) throw notFound('Image not found');

  doc.heroImages = doc.heroImages.filter((img) => img !== image);
  await doc.save();
  await imageService.remove(image);

  return respond(res, doc);
}

/** A quote, a screenshot of one, or both. Neither is an empty review. */
async function addReview(req, res) {
  const { name, text } = req.body;
  if (!text && !req.file) {
    throw badRequest('VALIDATION_FAILED', 'Write the review or add a screenshot', {
      text: 'Write the review or add a screenshot',
    });
  }

  const doc = await landing.loadForWrite();
  if (doc.reviews.length >= LIMITS.reviews) {
    throw badRequest('TOO_MANY_REVIEWS', `A page holds at most ${LIMITS.reviews} reviews`);
  }

  const image = req.file
    ? await imageService.uploadPublic(req.file, { kind: imageService.KINDS.ASSET })
    : null;

  doc.reviews.push({ name, text, image });
  await doc.save();

  return respond(res, doc);
}

async function removeReview(req, res) {
  const doc = await landing.loadForWrite();
  const review = /^[0-9a-f]{24}$/i.test(req.params.reviewId)
    ? doc.reviews.id(req.params.reviewId)
    : null;
  if (!review) throw notFound('Review not found');

  const image = review.image;
  review.deleteOne();
  await doc.save();
  if (image) await imageService.remove(image);

  return respond(res, doc);
}

module.exports = { get, update, addHeroImages, removeHeroImage, addReview, removeReview };
