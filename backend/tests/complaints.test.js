'use strict';

/**
 * Complaints, and the orchard records they add up to.
 *
 * The thread running through these is the path the feature exists for: a
 * customer rings about one bad parcel, and the system has to be able to answer
 * "what else came out of the same orchard". That means a complaint must land on
 * the right source, must keep landing there after the source is renamed, and
 * must never count against an orchard that had nothing to do with it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { startDb, stopDb, resetDb } = require('./helpers/db');
const f = require('./helpers/factory');

const app = require('../src/app');
const Order = require('../src/models/Order');
const Source = require('../src/models/Source');

const { PAYMENT_MODE } = require('../src/domain/constants');

test.before(startDb);
test.after(stopDb);
test.beforeEach(resetDb);

async function signIn({ phone, password }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ phone, password });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return agent;
}

/** An owner, a reseller with headroom, one product and two orchards. */
async function scene() {
  const owner = await f.makeOwner();
  const agent = await signIn({ phone: owner.phone, password: owner.password });
  const reseller = await f.makeReseller({ creditLimit: 100000 });
  await f.makeZone({ districts: ['Dhaka'], charge: 80 });
  const product = await f.makeProduct({ cost: 55, minOrderQty: 5 });
  await f.listProduct(reseller.profile, product, 62);

  const kansat = await f.makeSource({ name: 'Kansat Orchard' });
  const shibganj = await f.makeSource({ name: 'Shibganj Orchard' });

  const shop = await signIn({ phone: reseller.phone, password: reseller.password });
  return { agent, shop, profile: reseller.profile, product, kansat, shibganj };
}

/** A confirmed order. Returns it as it is after confirm, with real line ids. */
async function confirmedOrder(setup) {
  const placed = await request(app)
    .post(`/api/public/shop/${setup.profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.COD,
      customer: f.customer(),
      items: [{ product: String(setup.product._id), quantity: 10 }],
    });
  assert.equal(placed.status, 201, JSON.stringify(placed.body));

  const order = await Order.findOne({ orderCode: placed.body.data.orderCode });
  const confirmed = await setup.shop.post(`/api/reseller/orders/${order._id}/confirm`).send({});
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  return Order.findById(order._id);
}

/** Confirmed, then accepted with every line sent to one orchard. */
async function acceptedOrder(setup, source) {
  const order = await confirmedOrder(setup);
  const accepted = await setup.agent
    .post(`/api/owner/orders/${order._id}/accept`)
    .send({ sources: f.sourcesFor(order, source) });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  return Order.findById(order._id);
}

const logComplaint = (setup, order, body) =>
  setup.agent.post(`/api/owner/orders/${order._id}/complaints`).send(body);

/* ----------------------------------------------------------------- logging */

test('a complaint lands on the orchard the line was collected from', async () => {
  const setup = await scene();
  const order = await acceptedOrder(setup, setup.kansat);

  const res = await logComplaint(setup, order, {
    kind: 'quality',
    note: 'Half the crate was overripe',
    itemIds: order.items.map((i) => String(i._id)),
  });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  const complaint = res.body.data.complaint;
  assert.equal(complaint.kind, 'quality');
  assert.equal(complaint.items.length, 1);
  assert.equal(String(complaint.items[0].source), String(setup.kansat._id));
  assert.equal(complaint.items[0].sourceName, 'Kansat Orchard');
  assert.equal(complaint.resolved, false);
});

test('renaming an orchard does not rewrite what was already said about it', async () => {
  const setup = await scene();
  const order = await acceptedOrder(setup, setup.kansat);
  await logComplaint(setup, order, {
    kind: 'damaged',
    note: 'Arrived crushed',
    itemIds: [String(order.items[0]._id)],
  });

  /*
   * The same reason a line snapshots its price. The record used to judge an
   * orchard must not move when somebody edits the orchard, or a rename would
   * quietly launder its history.
   */
  await Source.findByIdAndUpdate(setup.kansat._id, { name: 'Renamed Orchard' });

  const res = await setup.agent.get(`/api/owner/orders/${order._id}/complaints`);
  assert.equal(res.body.data.complaints[0].items[0].sourceName, 'Kansat Orchard');
});

test('a complaint before accept names no orchard, because none was chosen', async () => {
  const setup = await scene();
  const order = await confirmedOrder(setup);

  const res = await logComplaint(setup, order, {
    kind: 'late',
    note: 'Nobody has rung me back',
    itemIds: [String(order.items[0]._id)],
  });

  assert.equal(res.status, 201);
  // A source is chosen at accept (docs/adr/0006). Blaming one now would mean
  // inventing it.
  assert.equal(res.body.data.complaint.items[0].source, null);
  assert.equal(res.body.data.complaint.items[0].sourceName, null);
});

test('a complaint may name no lines at all', async () => {
  const setup = await scene();
  const order = await acceptedOrder(setup, setup.kansat);

  // A parcel three days late is nobody's fruit.
  const res = await logComplaint(setup, order, { kind: 'late', note: 'Three days late' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.complaint.items.length, 0);

  const record = await setup.agent.get(`/api/owner/sources/${setup.kansat._id}`);
  assert.equal(record.body.data.record.complaints, 0, 'blamed an orchard for the courier');
});

test('a line from another order cannot be blamed on this one', async () => {
  const setup = await scene();
  const mine = await acceptedOrder(setup, setup.kansat);
  const theirs = await acceptedOrder(setup, setup.shibganj);

  const res = await logComplaint(setup, mine, {
    kind: 'quality',
    note: 'Bad fruit',
    itemIds: [String(theirs.items[0]._id)],
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'UNKNOWN_ORDER_ITEM');
});

test('a note is required, because a bare count cannot be acted on later', async () => {
  const setup = await scene();
  const order = await acceptedOrder(setup, setup.kansat);

  const empty = await logComplaint(setup, order, { kind: 'quality', note: '' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error.code, 'VALIDATION_FAILED');

  const bogus = await logComplaint(setup, order, { kind: 'not-a-kind', note: 'Bad fruit' });
  assert.equal(bogus.status, 400);
});

test('an order nobody has confirmed cannot be complained about', async () => {
  const setup = await scene();
  const placed = await request(app)
    .post(`/api/public/shop/${setup.profile.slug}/orders`)
    .send({
      paymentMode: PAYMENT_MODE.COD,
      customer: f.customer(),
      items: [{ product: String(setup.product._id), quantity: 10 }],
    });
  const order = await Order.findOne({ orderCode: placed.body.data.orderCode });

  const res = await logComplaint(setup, order, { kind: 'quality', note: 'Bad fruit' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'ORDER_NOT_CONFIRMED');
});

test('a complaint changes nothing about the order and moves no money', async () => {
  const setup = await scene();
  const order = await acceptedOrder(setup, setup.kansat);
  const ResellerProfile = require('../src/models/ResellerProfile');
  const before = await ResellerProfile.findById(setup.profile._id);

  await logComplaint(setup, order, {
    kind: 'quality',
    note: 'Overripe',
    itemIds: [String(order.items[0]._id)],
  });

  /*
   * The order happened. A return or a refund is its own decision with its own
   * ledger entries; this is a record of what was said, so that it can be
   * counted, and nothing more.
   */
  const after = await Order.findById(order._id);
  assert.equal(after.status, order.status);
  const wallet = await ResellerProfile.findById(setup.profile._id);
  assert.equal(wallet.balancePoisha, before.balancePoisha);
});

/* ------------------------------------------------------------ the record */

test("an orchard's record counts distinct orders, not lines", async () => {
  const setup = await scene();
  await acceptedOrder(setup, setup.kansat);
  await acceptedOrder(setup, setup.kansat);

  const res = await setup.agent.get(`/api/owner/sources/${setup.kansat._id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.record.orders, 2);
  assert.equal(res.body.data.record.quantity, 20);
  // Nothing said about it yet, so the rate is a clean zero rather than null.
  assert.equal(res.body.data.record.complaintRate, 0);
});

test('an orchard nobody has bought from has no rate, rather than a clean one', async () => {
  const setup = await scene();

  const res = await setup.agent.get(`/api/owner/sources/${setup.shibganj._id}`);
  assert.equal(res.body.data.record.orders, 0);
  // Zero would read as a spotless record, which is a different claim entirely.
  assert.equal(res.body.data.record.complaintRate, null);
  assert.equal(res.body.data.record.returnRate, null);
});

test('one orchard being complained about does not mark the other', async () => {
  const setup = await scene();
  const bad = await acceptedOrder(setup, setup.kansat);
  await acceptedOrder(setup, setup.shibganj);

  await logComplaint(setup, bad, {
    kind: 'quality',
    note: 'Sour',
    itemIds: [String(bad.items[0]._id)],
  });

  const kansat = await setup.agent.get(`/api/owner/sources/${setup.kansat._id}`);
  const shibganj = await setup.agent.get(`/api/owner/sources/${setup.shibganj._id}`);

  assert.equal(kansat.body.data.record.complaints, 1);
  assert.equal(kansat.body.data.record.complaintRate, 100);
  assert.equal(shibganj.body.data.record.complaints, 0);
  assert.equal(shibganj.body.data.record.complaintRate, 0);
});

test('a late delivery does not move an orchard\'s rate', async () => {
  const setup = await scene();
  const order = await acceptedOrder(setup, setup.kansat);

  await logComplaint(setup, order, {
    kind: 'late',
    note: 'Came on Thursday, promised Tuesday',
    itemIds: [String(order.items[0]._id)],
  });

  const res = await setup.agent.get(`/api/owner/sources/${setup.kansat._id}`);
  const record = res.body.data.record;

  /*
   * The complaint is counted and shown — it happened and it named this line —
   * but a traffic jam is not the orchard's doing, and letting it move the rate
   * would have the owner dropping a good orchard over the courier.
   */
  assert.equal(record.complaints, 1);
  assert.equal(record.fruitComplaints, 0);
  assert.equal(record.complaintRate, 0);
});

test('the orchard report puts the worst rate first, not the biggest count', async () => {
  const setup = await scene();

  // Shibganj: two orders, one complaint. 50%.
  const smallBad = await acceptedOrder(setup, setup.shibganj);
  await acceptedOrder(setup, setup.shibganj);
  await logComplaint(setup, smallBad, {
    kind: 'quality',
    note: 'Sour',
    itemIds: [String(smallBad.items[0]._id)],
  });

  // Kansat: four orders, two complaints, and the higher count. 50% as well,
  // so make it plainly better by adding two more clean orders.
  const a = await acceptedOrder(setup, setup.kansat);
  const b = await acceptedOrder(setup, setup.kansat);
  await acceptedOrder(setup, setup.kansat);
  await acceptedOrder(setup, setup.kansat);
  await acceptedOrder(setup, setup.kansat);
  await acceptedOrder(setup, setup.kansat);
  for (const order of [a, b]) {
    await logComplaint(setup, order, {
      kind: 'damaged',
      note: 'Crushed',
      itemIds: [String(order.items[0]._id)],
    });
  }

  const res = await setup.agent.get('/api/owner/reports/sources');
  assert.equal(res.status, 200);
  const supplying = res.body.data.sources.filter((row) => row.orders > 0);

  // Kansat has more complaints; Shibganj has the worse record. Sorting by
  // count would put them the wrong way round, which is the whole point.
  assert.equal(supplying[0].name, 'Shibganj Orchard');
  assert.equal(supplying[0].complaintRate, 50);
  assert.ok(supplying[1].complaintRate < 50, 'Kansat should look better per order');
  assert.ok(supplying[1].complaints > supplying[0].complaints, 'but have more complaints');
});

/* -------------------------------------------------------------- the trail */

test('an orchard leads back to every order it supplied', async () => {
  const setup = await scene();
  await acceptedOrder(setup, setup.kansat);
  await acceptedOrder(setup, setup.shibganj);

  // The link an orchard's page offers. This is the question a complaint always
  // raises and the one that had no answer before.
  const res = await setup.agent.get(`/api/owner/orders?source=${setup.kansat._id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.total, 1);
});

test('complaints can be listed by orchard and closed out', async () => {
  const setup = await scene();
  const order = await acceptedOrder(setup, setup.kansat);
  const logged = await logComplaint(setup, order, {
    kind: 'short_weight',
    note: 'Four kilos short',
    itemIds: [String(order.items[0]._id)],
  });
  const id = logged.body.data.complaint.id;

  const open = await setup.agent.get(`/api/owner/complaints?source=${setup.kansat._id}`);
  assert.equal(open.body.data.total, 1);
  assert.equal(open.body.data.open, 1);

  const resolved = await setup.agent
    .post(`/api/owner/complaints/${id}/resolve`)
    .send({ resolution: 'Sent four kilos with the next parcel' });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.complaint.resolved, true);

  // Closed, never deleted: the whole value of this record is that it adds up.
  const after = await setup.agent.get(`/api/owner/complaints?source=${setup.kansat._id}`);
  assert.equal(after.body.data.total, 1);
  assert.equal(after.body.data.open, 0);

  const record = await setup.agent.get(`/api/owner/sources/${setup.kansat._id}`);
  assert.equal(record.body.data.record.complaints, 1, 'resolving erased the history');
  assert.equal(record.body.data.record.openComplaints, 0);
});

test('open complaints are counted on the dashboard', async () => {
  const setup = await scene();
  const order = await acceptedOrder(setup, setup.kansat);
  await logComplaint(setup, order, { kind: 'quality', note: 'Sour fruit' });

  const res = await setup.agent.get('/api/owner/reports/dashboard');
  assert.equal(res.body.data.openComplaints, 1);
});

test('a reseller can neither see nor log complaints', async () => {
  const setup = await scene();
  const order = await acceptedOrder(setup, setup.kansat);

  // A reseller must not learn how an orchard is judged, nor be able to move it.
  for (const path of [
    '/api/owner/complaints',
    `/api/owner/orders/${order._id}/complaints`,
    `/api/owner/sources/${setup.kansat._id}`,
    '/api/owner/reports/sources',
  ]) {
    const res = await setup.shop.get(path);
    assert.equal(res.status, 403, `${path} let a reseller in`);
  }

  const write = await setup.shop
    .post(`/api/owner/orders/${order._id}/complaints`)
    .send({ kind: 'quality', note: 'Bad fruit' });
  assert.equal(write.status, 403);
});
