'use strict';

/**
 * Landing pages: one owner-written content set, a design chosen per reseller,
 * and a struck-through regular price the reseller may set. See domain/landing.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const { DEFAULT_CONTENT, TEMPLATES } = require('../src/domain/landing');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

async function signIn({ phone, password }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, password });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return agent;
}

async function openShop() {
  const reseller = await f.makeReseller();
  const product = await f.makeProduct({ cost: 50 });
  await f.listProduct(reseller.profile, product, 80);
  return { reseller, product };
}

test('a shop page carries the default design and content before the owner writes any', async () => {
  const { reseller } = await openShop();

  const res = await request(app).get(`/api/public/shop/${reseller.profile.slug}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.template, TEMPLATES.BAGAN);
  assert.equal(res.body.data.landing.headline, DEFAULT_CONTENT.headline);
  // No invented trust: no rating, no customer count, no reviews by default.
  assert.equal(res.body.data.landing.rating, null);
  assert.equal(res.body.data.landing.customerCount, '');
  assert.deepEqual(res.body.data.landing.reviews, []);
});

test('the owner writes the content once and every shop page shows it', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);
  const { reseller } = await openShop();

  const saved = await agent.patch('/api/owner/landing').send({
    headline: 'কড়া মিষ্টি কাটিমন আম',
    rating: 4.9,
    customerCount: '৫,০০০+',
    badges: [{ icon: 'leaf', label: 'কেমিক্যাল মুক্ত' }],
    whyUs: ['বাগান থেকে সরাসরি'],
    tips: [{ icon: 'snowflake', title: 'সংরক্ষণ', text: 'পাকলে ফ্রিজে রাখুন' }],
    faqs: [],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.landing.headline, 'কড়া মিষ্টি কাটিমন আম');

  const page = await request(app).get(`/api/public/shop/${reseller.profile.slug}`);
  const { landing } = page.body.data;
  assert.equal(landing.headline, 'কড়া মিষ্টি কাটিমন আম');
  assert.equal(landing.rating, 4.9);
  assert.deepEqual(landing.badges, [{ icon: 'leaf', label: 'কেমিক্যাল মুক্ত' }]);
  // Emptied on purpose stays empty; the defaults do not come back.
  assert.deepEqual(landing.faqs, []);
  // A field the owner did not send keeps the default it was created from.
  assert.equal(landing.subtitle, DEFAULT_CONTENT.subtitle);
});

test('landing content is validated: unknown icons, stray fields and bad links are refused', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);

  const icon = await agent.patch('/api/owner/landing').send({ badges: [{ icon: 'skull', label: 'x' }] });
  assert.equal(icon.status, 400);

  const stray = await agent.patch('/api/owner/landing').send({ template: 'offer' });
  assert.equal(stray.status, 400);

  const video = await agent.patch('/api/owner/landing').send({ videoUrl: 'not a link' });
  assert.equal(video.status, 400);

  const tooMany = await agent
    .patch('/api/owner/landing')
    .send({ badges: Array.from({ length: 5 }, () => ({ icon: 'star', label: 'x' })) });
  assert.equal(tooMany.status, 400);
});

test('a reseller cannot edit the landing content', async () => {
  const { phone, password } = await f.makeReseller();
  const agent = await signIn({ phone, password });
  const res = await agent.patch('/api/owner/landing').send({ headline: 'mine now' });
  assert.equal(res.status, 403);
});

test('the owner adds a text review and removes it again', async () => {
  const owner = await f.makeOwner();
  const agent = await signIn(owner);

  const empty = await agent.post('/api/owner/landing/reviews').field('name', 'রিয়া');
  assert.equal(empty.status, 400, 'a review with neither text nor screenshot was accepted');

  const added = await agent
    .post('/api/owner/landing/reviews')
    .field('name', 'রিয়া')
    .field('text', 'আম খুব মিষ্টি ছিল');
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const [review] = added.body.data.landing.reviews;
  assert.equal(review.text, 'আম খুব মিষ্টি ছিল');

  const removed = await agent.delete(`/api/owner/landing/reviews/${review.id}`);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.data.landing.reviews, []);

  const missing = await agent.delete('/api/owner/landing/reviews/not-an-id');
  assert.equal(missing.status, 404);
});

test('a reseller chooses a design, and only a known one', async () => {
  const { reseller } = await openShop();
  const agent = await signIn(reseller);

  const chosen = await agent.patch('/api/reseller/profile').send({ landingTemplate: TEMPLATES.OFFER });
  assert.equal(chosen.status, 200);

  const page = await request(app).get(`/api/public/shop/${reseller.profile.slug}`);
  assert.equal(page.body.data.template, TEMPLATES.OFFER);

  const unknown = await agent.patch('/api/reseller/profile').send({ landingTemplate: 'neon' });
  assert.equal(unknown.status, 400);
});

test('a regular price must be above the sell price, and is public only beside a visible price', async () => {
  const { reseller, product } = await openShop();
  const agent = await signIn(reseller);
  const url = `/api/reseller/catalog/${product._id}`;

  const low = await agent.put(url).send({ sellPrice: 80, regularPrice: 80 });
  assert.equal(low.status, 400);
  assert.ok(low.body.error.fields.regularPrice);

  const set = await agent.put(url).send({ sellPrice: 80, regularPrice: 100 });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.listing.regularPrice, 100);

  const catalog = await agent.get('/api/reseller/catalog');
  assert.equal(catalog.body.data.products[0].regularPrice, 100);

  let page = await request(app).get(`/api/public/shop/${reseller.profile.slug}`);
  assert.equal(page.body.data.products[0].regularPrice, 100);

  // A hidden price takes its regular price with it.
  await agent.put(url).send({ sellPrice: 80, hidePrice: true });
  page = await request(app).get(`/api/public/shop/${reseller.profile.slug}`);
  assert.equal(page.body.data.products[0].regularPrice, undefined);
  assert.equal(page.body.data.products[0].price, undefined);

  // Zero clears it.
  const cleared = await agent.put(url).send({ sellPrice: 80, hidePrice: false, regularPrice: 0 });
  assert.equal(cleared.body.data.listing.regularPrice, null);
  page = await request(app).get(`/api/public/shop/${reseller.profile.slug}`);
  assert.equal(page.body.data.products[0].regularPrice, undefined);
});
