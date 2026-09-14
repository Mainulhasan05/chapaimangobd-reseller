import { mkdirSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { t, tStatus } from '@/lib/i18n/bn';
import { formatMoney } from '@/lib/format';
import {
  AUTH_DIR,
  OWNER_STATE,
  RESELLER_STATE,
  WEB,
  apiJson,
  button,
  cardWith,
  expectNoHorizontalScroll,
  field,
  lastOtp,
  makePng,
  mobileContext,
} from './support/harness';

/**
 * The whole business, in the order it happens, on a 360px phone in Bengali.
 *
 * Serial and stateful on purpose: each journey starts where the previous one
 * left the world, exactly as the real thing does. A failure skips the rest
 * rather than letting them fail for a reason that is not theirs.
 */
test.describe.configure({ mode: 'serial' });

const RUN = String(Date.now()).slice(-8);

const RESELLER = {
  phone: `019${RUN}`,
  name: 'ই২ই রিসেলার',
  // Latin, so the slug is readable and unique per run.
  shopName: `E2E Mango ${RUN}`,
  password: 'reseller-pass-123',
};

const CUSTOMER = { name: 'ই২ই ক্রেতা', phone: '01812345678', address: '১২ টেস্ট রোড, ধানমন্ডি', district: 'Dhaka' };

/** Catalog numbers, in taka and kilos, chosen so every total is obvious. */
const PRODUCT = { name: `হিমসাগর ${RUN}`, costPrice: 200, minOrderQty: 5, stockQty: 100 };
const SELL_PRICE = 250;
const DELIVERY_CHARGE = 100;
const OPENING_CREDIT = 5000;
const SOURCE_NAME = `বাগান ${RUN}`;

/** What confirm debits: cost of five kilos plus delivery. */
const CONFIRM_DEBIT = PRODUCT.costPrice * PRODUCT.minOrderQty + DELIVERY_CHARGE;
/** What the reseller keeps once a cash-on-delivery order is delivered. */
const MARGIN = (SELL_PRICE - PRODUCT.costPrice) * PRODUCT.minOrderQty;

type Shared = {
  slug: string;
  profileId: string;
  productId: string;
  sourceId: string;
  firstOrderCode: string;
};
const shared: Partial<Shared> = {};

let owner: BrowserContext;
let reseller: BrowserContext;

test.beforeAll(async ({ browser }) => {
  mkdirSync(AUTH_DIR, { recursive: true });
  owner = await mobileContext(browser, OWNER_STATE);
});

test.afterAll(async () => {
  await owner?.close();
  await reseller?.close();
});

/** The wallet's headline figure, read from its stat card rather than anywhere on the page. */
async function expectWalletBalance(page: Page, taka: number) {
  await page.goto('/reseller/wallet');
  const stat = page.locator('.card').filter({ has: page.getByText(t('wallet.balance'), { exact: true }) }).first();
  await expect(stat).toContainText(formatMoney(taka));
  await expectNoHorizontalScroll(page);
}

async function ownerOrderId(orderCode: string): Promise<string> {
  const { orders } = await apiJson<{ orders: { id: string; orderCode: string }[] }>(
    owner,
    'GET',
    `/owner/orders?q=${encodeURIComponent(orderCode)}&limit=5`
  );
  const match = orders.find((order) => order.orderCode === orderCode);
  if (!match) throw new Error(`owner cannot see order ${orderCode}`);
  return match.id;
}

async function resellerOrder(orderCode: string) {
  const { orders } = await apiJson<{
    orders: { id: string; orderCode: string; items: { product: string; quantity: number }[] }[];
  }>(reseller, 'GET', '/reseller/orders?limit=20');
  const match = orders.find((order) => order.orderCode === orderCode);
  if (!match) throw new Error(`reseller cannot see order ${orderCode}`);
  return match;
}

async function productStock(): Promise<number | null> {
  const { products } = await apiJson<{ products: { id: string; stockQty: number | null }[] }>(
    owner,
    'GET',
    '/owner/products'
  );
  return products.find((product) => product.id === shared.productId)?.stockQty ?? null;
}

test('1. a reseller registers with an SMS code and lands in the app', async ({ browser }) => {
  reseller = await mobileContext(browser);
  const page = await reseller.newPage();

  await page.goto('/register');
  await expectNoHorizontalScroll(page);
  await field(page, 'auth.phone').fill(RESELLER.phone);
  await button(page, 'auth.sendCode').click();

  // Step two only appears once the API has sent, so the code exists by now.
  await expect(field(page, 'auth.otp')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await field(page, 'auth.otp').fill(await lastOtp(RESELLER.phone, 'register'));
  await field(page, 'auth.name').fill(RESELLER.name);
  await field(page, 'auth.shopName').fill(RESELLER.shopName);
  await field(page, 'auth.password').fill(RESELLER.password);
  await button(page, 'auth.register').click();

  // A new account goes straight to KYC, the first thing it has to do.
  await expect(page).toHaveURL(/\/reseller\/kyc$/);
  await expect(page.getByRole('heading', { name: t('kyc.title') })).toBeVisible();

  await page.goto('/reseller');
  await expect(page.getByRole('heading', { level: 1, name: RESELLER.shopName })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const me = await apiJson<{ profile: { _id?: string; id?: string; slug: string } }>(reseller, 'GET', '/auth/me');
  shared.slug = me.profile.slug;
  shared.profileId = (me.profile._id ?? me.profile.id)!;
  await reseller.storageState({ path: RESELLER_STATE });
  await page.close();
});

test('2. the reseller submits KYC and the owner approves it', async () => {
  const page = await reseller.newPage();
  await page.goto('/reseller/kyc');

  for (const [key, name] of [
    ['kyc.nidFront', 'nid-front.png'],
    ['kyc.nidBack', 'nid-back.png'],
  ] as const) {
    const chooser = page.waitForEvent('filechooser');
    await field(page, key).click();
    await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: makePng() });
  }
  await expect(page.getByText(t('kyc.readyToSubmit'))).toBeVisible();
  await expectNoHorizontalScroll(page);
  await button(page, 'kyc.submit').click();
  await expect(page.getByText(t('kyc.pendingHelp'))).toBeVisible();

  const ownerPage = await owner.newPage();
  await ownerPage.goto('/owner/kyc');
  const submission = cardWith(ownerPage, RESELLER.shopName);
  await submission.getByRole('button', { name: t('kyc.viewDocuments') }).click();

  const review = ownerPage.getByRole('dialog', { name: RESELLER.shopName });
  // The scans come back through the (in-memory) signed URL path.
  await expect(review.getByRole('img', { name: 'nid_front' })).toBeVisible();
  await expectNoHorizontalScroll(ownerPage);
  await button(review, 'kyc.approve').click();
  await expect(review).toBeHidden();
  await expect(submission).toHaveCount(0);
  await ownerPage.close();

  await page.reload();
  await expect(page.getByText(t('kyc.approved')).first()).toBeVisible();
  await page.close();
});

test('3. the owner stocks the catalog and the reseller prices and lists a product', async () => {
  // Setup through the API: the owner's catalog forms are not this journey.
  const source = await apiJson<{ source: { _id?: string; id?: string } }>(owner, 'POST', '/owner/sources', {
    name: SOURCE_NAME,
    address: 'চাঁপাইনবাবগঞ্জ',
  });
  shared.sourceId = (source.source._id ?? source.source.id)!;

  await apiJson(owner, 'POST', '/owner/delivery-zones', {
    name: 'ঢাকা',
    districts: [CUSTOMER.district],
    charge: DELIVERY_CHARGE,
  });

  const created = await apiJson<{ product: { id: string } }>(owner, 'POST', '/owner/products', {
    name: PRODUCT.name,
    unit: 'kg',
    minOrderQty: PRODUCT.minOrderQty,
    costPrice: PRODUCT.costPrice,
    trackStock: true,
    stockQty: PRODUCT.stockQty,
    isAvailable: true,
  });
  shared.productId = created.product.id;

  // Enough balance for confirm to debit, posted the way the owner corrects books.
  await apiJson(owner, 'POST', `/owner/resellers/${shared.profileId}/ledger`, {
    amount: OPENING_CREDIT,
    direction: 'credit',
    note: 'e2e opening balance',
  });

  const page = await reseller.newPage();
  await page.goto('/reseller/catalog');
  const row = cardWith(page, PRODUCT.name);
  await expect(row).toBeVisible();
  await expectNoHorizontalScroll(page);

  await field(row, 'catalog.sellPrice').fill(String(SELL_PRICE));
  const listed = row.getByRole('switch', { name: t('catalog.listed') });
  await expect(listed).toHaveAttribute('aria-checked', 'false');
  await listed.click();
  await expect(listed).toHaveAttribute('aria-checked', 'true');
  await button(row, 'catalog.activate').click();

  await expect(page.getByText(t('catalog.activatedToast'))).toBeVisible();
  await expect(button(row, 'app.save')).toBeVisible();
  await page.close();
});

test('4. a customer orders cash on delivery from the shop and tracks it', async ({ browser }) => {
  const customer = await mobileContext(browser);
  const page = await customer.newPage();

  await page.goto(`/r/${shared.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: RESELLER.shopName })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const product = cardWith(page, PRODUCT.name);
  await expect(product).toContainText(formatMoney(SELL_PRICE));
  await button(product, 'catalog.increase').click();

  await field(page, 'shop.yourName').fill(CUSTOMER.name);
  await field(page, 'shop.yourPhone').fill(CUSTOMER.phone);
  await field(page, 'order.district').selectOption(CUSTOMER.district);
  await field(page, 'order.address').fill(CUSTOMER.address);
  await expect(field(page, 'order.paymentMode')).toHaveValue('cod');
  await expectNoHorizontalScroll(page);

  await button(page, 'shop.placeOrder').click();
  await expect(page.getByRole('heading', { name: t('shop.orderPlaced') })).toBeVisible();

  const track = page.getByRole('link', { name: t('shop.trackOrder') });
  const href = (await track.getAttribute('href')) ?? '';
  const code = new URLSearchParams(href.split('?')[1]).get('code');
  expect(code).toBeTruthy();
  shared.firstOrderCode = code!;
  await expect(page.getByText(code!, { exact: true })).toBeVisible();

  await track.click();
  await expect(page).toHaveURL(/\/track\?code=/);
  await expect(field(page, 'order.code')).toHaveValue(code!);
  await field(page, 'shop.yourPhone').fill(CUSTOMER.phone);
  await button(page, 'app.search').click();

  const result = cardWith(page, code!).last();
  await expect(result).toContainText(tStatus('pending'));
  await expect(result).toContainText(PRODUCT.name);
  await expect(result).toContainText(formatMoney(SELL_PRICE * PRODUCT.minOrderQty + DELIVERY_CHARGE));
  await expectNoHorizontalScroll(page);
  await customer.close();
});

test('5. the reseller confirms the order and the wallet is debited', async () => {
  const page = await reseller.newPage();
  await expectWalletBalance(page, OPENING_CREDIT);

  const order = await resellerOrder(shared.firstOrderCode!);
  await page.goto(`/reseller/orders/${order.id}`);
  await expect(page.getByRole('heading', { name: shared.firstOrderCode })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await button(page, 'app.confirm').click();

  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText(formatMoney(CONFIRM_DEBIT));
  await expect(sheet).toContainText(formatMoney(MARGIN));
  await expectNoHorizontalScroll(page);
  await button(sheet, 'app.confirm').click();
  await expect(page.getByText(t('order.confirmedToast'))).toBeVisible();
  await expect(sheet).toBeHidden();

  await expectWalletBalance(page, OPENING_CREDIT - CONFIRM_DEBIT);
  await page.close();
});

test('6. the owner accepts, packs, ships and delivers, and the margin lands', async () => {
  const page = await owner.newPage();
  await page.goto(`/owner/orders/${await ownerOrderId(shared.firstOrderCode!)}`);
  await expect(page.getByRole('heading', { name: shared.firstOrderCode })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Accept: choose where the crate comes from.
  await button(page, 'order.accept').click();
  const accept = page.getByRole('dialog');
  await accept
    .getByRole('combobox', { name: `${t('order.chooseSource')} · ${PRODUCT.name}` })
    .selectOption({ label: SOURCE_NAME });

  // No SMS gateway in this run: the customer SMS box is shown, off, and says why.
  const sms = accept.getByRole('switch', { name: new RegExp(t('customerSms.send')) });
  await expect(sms).toBeVisible();
  await expect(sms).toContainText(t('customerSms.unavailable'));
  await expect(sms).toBeDisabled();
  await expect(sms).toHaveAttribute('aria-checked', 'false');
  await expectNoHorizontalScroll(page);

  await button(accept, 'order.accept').click();
  await expect(page.getByText(t('order.acceptedToast'))).toBeVisible();
  await expect(accept).toBeHidden();

  // Pack.
  await button(page, 'order.pack').click();
  await expect(button(page, 'order.ship')).toBeVisible();

  // Ship with a courier and a tracking number.
  await button(page, 'order.ship').click();
  const ship = page.getByRole('dialog');
  await field(ship, 'order.courier').fill('Sundarban Courier');
  await field(ship, 'order.trackingNumber').fill(`SC-${RUN}`);
  await expect(ship.getByRole('switch', { name: new RegExp(t('customerSms.send')) })).toContainText(
    t('customerSms.unavailable')
  );
  await expectNoHorizontalScroll(page);
  await button(ship, 'order.ship').click();
  await expect(page.getByText(t('order.shippedToast'))).toBeVisible();
  await expect(ship).toBeHidden();

  // Deliver.
  await button(page, 'order.deliver').click();
  await expect(button(page, 'order.deliver')).toBeHidden();
  await expect(page.getByText(tStatus('delivered'), { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`SC-${RUN}`).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.close();

  const walletPage = await reseller.newPage();
  // Cash on delivery settles to the margin: the debit comes back plus the profit.
  await expectWalletBalance(walletPage, OPENING_CREDIT + MARGIN);
  await walletPage.close();
});

test('7. a shipped COD order comes back and the owner puts it back in stock', async ({ request }) => {
  // A second order walked to shipped through the API, as setup.
  const placed = await request.post(`${WEB}/api/public/shop/${shared.slug}/orders`, {
    data: {
      submissionId: crypto.randomUUID(),
      paymentMode: 'cod',
      customer: { ...CUSTOMER, name: 'ফেরত ক্রেতা' },
      items: [{ product: shared.productId, quantity: PRODUCT.minOrderQty }],
    },
  });
  expect(placed.status()).toBe(201);
  const { orderCode } = (await placed.json()).data as { orderCode: string };

  const pending = await resellerOrder(orderCode);
  await apiJson(reseller, 'POST', `/reseller/orders/${pending.id}/confirm`, {
    items: pending.items.map((item) => ({ product: item.product, quantity: item.quantity, sellPrice: SELL_PRICE })),
  });

  const id = await ownerOrderId(orderCode);
  const { order } = await apiJson<{ order: { items: { id: string }[] } }>(owner, 'GET', `/owner/orders/${id}`);
  await apiJson(owner, 'POST', `/owner/orders/${id}/accept`, {
    sources: order.items.map((item) => ({ itemId: item.id, sourceId: shared.sourceId })),
  });
  await apiJson(owner, 'POST', `/owner/orders/${id}/pack`, {});
  await apiJson(owner, 'POST', `/owner/orders/${id}/ship`, { courierName: 'Pathao', trackingNumber: `PT-${RUN}` });

  // Two confirmed orders of five kilos each have left the shelf.
  const shelved = PRODUCT.stockQty - 2 * PRODUCT.minOrderQty;
  expect(await productStock()).toBe(shelved);

  const page = await owner.newPage();
  await page.goto(`/owner/orders/${id}`);
  await expect(page.getByRole('heading', { name: orderCode })).toBeVisible();
  await button(page, 'order.return').click();

  const dialog = page.getByRole('dialog');
  const restock = dialog.getByRole('switch', { name: new RegExp(t('order.restock')) });
  // Off unless the owner, looking at the crate, turns it on.
  await expect(restock).toHaveAttribute('aria-checked', 'false');
  await restock.click();
  await expect(restock).toHaveAttribute('aria-checked', 'true');
  await field(dialog, 'order.returnReason').fill('ক্রেতা বাড়িতে ছিলেন না');
  await expectNoHorizontalScroll(page);
  await button(dialog, 'order.return').click();

  await expect(page.getByText(t('order.returnedToast'))).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(tStatus('returned'), { exact: true }).first()).toBeVisible();
  await page.close();

  await expect.poll(productStock).toBe(shelved + PRODUCT.minOrderQty);
});
