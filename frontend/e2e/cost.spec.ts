import { expect, test, type BrowserContext } from '@playwright/test';
import { t } from '@/lib/i18n/bn';
import { formatMoney, formatNumber } from '@/lib/format';
import {
  OWNER_STATE,
  apiJson,
  button,
  expectNoHorizontalScroll,
  field,
  mobileContext,
} from './support/harness';

/**
 * The cost side, end to end, on a 360px phone in Bengali. PLAN-3, phase G.
 *
 * Serial and stateful like `journeys.spec.ts`: a purchase puts crates on the
 * shelf, a delivery takes them off, a payment clears the due, and the profit
 * report has to agree with all three. Each test starts where the last one left
 * the world.
 *
 * Signed in as the owner from the saved state; this whole feature is owner-only.
 */
test.describe.configure({ mode: 'serial' });

const RUN = String(Date.now()).slice(-8);

const CRATE = { name: `ক্যারেট ${RUN}`, unit: 'pcs' };
const PAPER = { name: `কাগজ ${RUN}`, unit: 'sheet' };
const PAYEE = { name: `ক্যারেট স্টোর ${RUN}` };

/** 100 crates at 80, plus 800 of charges, is 88 each. The number to prove. */
const CRATES = 100;
const CRATE_RATE = 80;
const VAN_HIRE = 600;
const LOADING = 200;
const LANDED = (CRATE_RATE * CRATES + VAN_HIRE + LOADING) / CRATES;

const nonce = () => `e2e-${RUN}-${Math.random().toString(36).slice(2, 10)}`;

let owner: BrowserContext;
const ids: { crate?: string; paper?: string; payee?: string; purchase?: string } = {};

test.beforeAll(async ({ browser }) => {
  owner = await mobileContext(browser, OWNER_STATE);
});

test.afterAll(async () => {
  await owner?.close();
});

test('1. the owner adds the things a parcel is packed with', async () => {
  const page = await owner.newPage();
  await page.goto('/owner/supplies');
  await expect(page.getByRole('heading', { name: t('supply.title') })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await button(page, 'supply.new').click();
  const dialog = page.getByRole('dialog');
  await field(dialog, 'supply.name').fill(CRATE.name);
  await dialog.getByLabel(new RegExp(t('supply.unit'))).selectOption(CRATE.unit);
  await expectNoHorizontalScroll(page);
  await button(dialog, 'app.save').click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText(CRATE.name)).toBeVisible();
  await page.close();

  // The second one through the API: the form is proved above and this suite is
  // about the money, not about typing the same dialog twice.
  const { supplies } = await apiJson<{ supplies: { id: string; nameBn: string }[] }>(
    owner,
    'GET',
    '/owner/supplies'
  );
  ids.crate = supplies.find((s) => s.nameBn === CRATE.name)!.id;

  const created = await apiJson<{ supply: { id: string } }>(owner, 'POST', '/owner/supplies', {
    nameBn: PAPER.name,
    unit: PAPER.unit,
  });
  ids.paper = created.supply.id;
});

test('2. a purchase shows what a crate really cost, not what was quoted', async () => {
  const payee = await apiJson<{ payee: { id: string } }>(owner, 'POST', '/owner/payees', {
    nameBn: PAYEE.name,
    kind: 'supplier',
  });
  ids.payee = payee.payee.id;

  const { purchase } = await apiJson<{
    purchase: {
      id: string;
      goodsCost: number;
      total: number;
      payeeTotal: number;
      otherCharge: number;
      lines: { landedUnitCost: number }[];
    };
  }>(owner, 'POST', '/owner/purchases', {
    payeeId: ids.payee,
    lines: [{ supplyId: ids.crate, quantity: CRATES, unitCost: CRATE_RATE }],
    charges: [
      // Billed by the crate seller, so it joins their due.
      { kind: 'loading', amount: LOADING, paidTo: 'payee' },
      // Cash to a van driver at the gate: raises the cost, owes the seller nothing.
      { kind: 'transport', amount: VAN_HIRE, paidTo: 'other' },
    ],
  });
  ids.purchase = purchase.id;

  expect(purchase.goodsCost).toBe(CRATE_RATE * CRATES);
  expect(purchase.total).toBe(CRATE_RATE * CRATES + VAN_HIRE + LOADING);
  // The seller is owed the goods and their own charge, and not the van.
  expect(purchase.payeeTotal).toBe(CRATE_RATE * CRATES + LOADING);
  expect(purchase.otherCharge).toBe(VAN_HIRE);
  // 88, not 80. This is the whole point of a landed cost.
  expect(purchase.lines[0].landedUnitCost).toBe(LANDED);

  const page = await owner.newPage();
  await page.goto('/owner/purchases');
  await expect(page.getByText(formatMoney(purchase.total)).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.close();
});

test('3. the shelf and the due both moved, and the screen says so', async () => {
  const page = await owner.newPage();
  await page.goto(`/owner/supplies/${ids.crate}`);
  await expect(page.getByText(formatNumber(CRATES)).first()).toBeVisible();
  // Valued at the landed cost, not the rate.
  await expect(page.getByText(formatMoney(LANDED)).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.close();

  const payees = await owner.newPage();
  await payees.goto(`/owner/payees/${ids.payee}`);
  await expect(payees.getByText(formatMoney(CRATE_RATE * CRATES + LOADING)).first()).toBeVisible();
  await expectNoHorizontalScroll(payees);
  await payees.close();
});

test('4. a box gets a recipe, fractions and all', async () => {
  // A product to hang the recipe on, and a variant to put it on.
  const { products } = await apiJson<{
    products: { id: string; name: string; variants: { id: string }[] }[];
  }>(owner, 'GET', '/owner/products');
  const product = products[0];
  expect(product, 'the journeys suite seeds a product this can borrow').toBeTruthy();

  const saved = await apiJson<{ packaging: { quantity: number }[] }>(
    owner,
    'PUT',
    `/owner/products/${product.id}/variants/${product.variants[0].id}/packaging`,
    {
      packaging: [
        { supplyId: ids.crate, quantity: 1 },
        // Fractional on purpose: this is why quantity is milli, not an integer.
        { supplyId: ids.paper, quantity: 1.5 },
      ],
    }
  );
  expect(saved.packaging.map((p) => p.quantity)).toEqual([1, 1.5]);

  // And it is readable on the product screen.
  const page = await owner.newPage();
  await page.goto('/owner/products');
  await expect(button(page, 'recipe.title').first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.close();
});

test('5. the crates come off the shelf at delivery, never before', async () => {
  const onHand = async () => {
    const { supply } = await apiJson<{ supply: { onHand: number } }>(
      owner,
      'GET',
      `/owner/supplies/${ids.crate}`
    );
    return supply.onHand;
  };

  const before = await onHand();

  // An order, walked to shipped. Nothing should have moved yet.
  const { orders } = await apiJson<{ orders: { id: string; status: string }[] }>(
    owner,
    'GET',
    '/owner/orders?status=shipped'
  );
  const shipped = orders[0];

  if (!shipped) {
    // The journeys suite left no shipped order; nothing to prove here rather
    // than inventing one and testing a fixture.
    test.skip(true, 'no shipped order in the seeded world');
    return;
  }

  expect(await onHand(), 'packing and shipping take no packaging').toBe(before);

  await apiJson(owner, 'POST', `/owner/orders/${shipped.id}/deliver`, {});

  // The recipe said one crate a box, so the shelf is down by the boxes delivered.
  const after = await onHand();
  expect(after).toBeLessThan(before);

  // And the order now carries what that cost, snapshotted.
  const { cost } = await apiJson<{ cost: { packaging: number } }>(
    owner,
    'GET',
    `/owner/orders/${shipped.id}`
  );
  expect(cost.packaging).toBeGreaterThan(0);

  const page = await owner.newPage();
  await page.goto(`/owner/orders/${shipped.id}`);
  await expect(page.getByText(t('cost.title'))).toBeVisible();
  await expect(page.getByText(t('packaging.title'))).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.close();
});

test('6. a stock take corrects the estimate, and is marked as counted', async () => {
  const page = await owner.newPage();
  await page.goto(`/owner/supplies/${ids.crate}`);

  await button(page, 'supply.stockTake').click();
  const dialog = page.getByRole('dialog');
  // The shelf really holds ten fewer than the books think.
  const { supply } = await apiJson<{ supply: { onHand: number } }>(
    owner,
    'GET',
    `/owner/supplies/${ids.crate}`
  );
  await field(dialog, 'supply.counted').fill(String(supply.onHand - 10));
  await expectNoHorizontalScroll(page);
  await button(dialog, 'app.save').click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText(formatNumber(supply.onHand - 10)).first()).toBeVisible();
  await page.close();

  // The correction is counted, not estimated: that distinction is what makes the
  // variance report worth reading. See docs/adr/0026.
  const { movements } = await apiJson<{
    movements: { kind: string; isEstimated: boolean; quantity: number }[];
  }>(owner, 'GET', `/owner/supplies/${ids.crate}/movements`);
  const correction = movements.find((m) => m.kind === 'ADJUSTMENT');
  expect(correction).toBeTruthy();
  expect(correction!.isEstimated).toBe(false);
  expect(correction!.quantity).toBe(-10);
});

test('7. paying the seller clears the due, and an overpayment is an advance', async () => {
  const page = await owner.newPage();
  await page.goto(`/owner/payees/${ids.payee}`);

  await button(page, 'payee.pay').click();
  const dialog = page.getByRole('dialog');
  await field(dialog, 'payee.payAmount').fill(String(CRATE_RATE * CRATES + LOADING));
  await expectNoHorizontalScroll(page);
  await button(dialog, 'app.save').click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText(formatMoney(0)).first()).toBeVisible();
  await page.close();

  // Paying further is never refused: it becomes an advance (বায়না).
  await apiJson(owner, 'POST', `/owner/payees/${ids.payee}/payments`, {
    amount: 500,
    nonce: nonce(),
  });
  const { payee } = await apiJson<{ payee: { due: number; isAdvance: boolean; advance: number } }>(
    owner,
    'GET',
    `/owner/payees/${ids.payee}`
  );
  expect(payee.due).toBe(-500);
  expect(payee.isAdvance).toBe(true);
  expect(payee.advance).toBe(500);
});

test('8. a period expense never lands on one parcel', async () => {
  await apiJson(owner, 'POST', '/owner/expense-categories/seed');
  const { categories } = await apiJson<{ categories: { id: string; nameBn: string; scope: string }[] }>(
    owner,
    'GET',
    '/owner/expense-categories'
  );
  const labour = categories.find((c) => c.scope === 'period')!;

  await apiJson(owner, 'POST', '/owner/expenses', { categoryId: labour.id, amount: 500 });

  const page = await owner.newPage();
  await page.goto('/owner/expenses');
  await expect(page.getByText(labour.nameBn).first()).toBeVisible();
  // Shown as a day's cost, kept apart from the per-order figure.
  await expect(page.getByText(t('expense.totalPeriod'))).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.close();
});

test('9. the profit report adds up, and prints', async () => {
  const { totals } = await apiJson<{
    totals: {
      revenue: number;
      orderCost: number;
      grossMargin: number;
      periodExpenses: number;
      netProfit: number;
    };
  }>(owner, 'GET', '/owner/reports/profit');

  // The identity the whole report rests on.
  expect(totals.grossMargin).toBe(totals.revenue - totals.orderCost);
  expect(totals.netProfit).toBe(totals.grossMargin - totals.periodExpenses);
  expect(totals.periodExpenses).toBeGreaterThan(0);

  // The printable sheet renders the same figures. `auto=0` so it does not open
  // the browser's print dialog and hang the run.
  const page = await owner.newPage();
  await page.goto('/owner/reports/print/profit');
  await expect(page.getByText(t('report.profit')).first()).toBeVisible();
  await expect(page.getByText(formatMoney(totals.revenue)).first()).toBeVisible();
  // Gross margin is never called profit; the net figure is the only one that is.
  await expect(page.getByText(t('profit.grossMargin'))).toBeVisible();
  await page.close();
});

test('10. payables and receivables are never netted into one figure', async () => {
  const position = await apiJson<{ receivable: number; payable: number }>(
    owner,
    'GET',
    '/owner/reports/position'
  );
  expect(position).not.toHaveProperty('net');

  const page = await owner.newPage();
  await page.goto('/owner/reports/print/payables');
  await expect(page.getByText(t('report.payables')).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.close();
});
