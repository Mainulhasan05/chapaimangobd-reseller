import path from 'node:path';
import zlib from 'node:zlib';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, devices } from '@playwright/test';
import { t, type DictKey } from '@/lib/i18n/bn';
import type { District } from '@/lib/districts';

/** Ports match e2e/harness/server.mjs. */
export const WEB = `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? 3222}`;
const CONTROL = `http://127.0.0.1:${process.env.E2E_CONTROL_PORT ?? 3223}`;

/** Seeded by the harness. */
export const OWNER = { phone: '01700000000', password: 'ownerpass123' };

export const AUTH_DIR = path.join(__dirname, '..', '.output', 'auth');
export const OWNER_STATE = path.join(AUTH_DIR, 'owner.json');
export const RESELLER_STATE = path.join(AUTH_DIR, 'reseller.json');

/** The phone this app is built for. */
export const MOBILE = {
  ...devices['Pixel 5'],
  viewport: { width: 360, height: 740 },
  isMobile: true,
  hasTouch: true,
  locale: 'bn-BD',
  timezoneId: 'Asia/Dhaka',
  baseURL: WEB,
};

/** A fresh phone-sized browser context, optionally signed in from a saved state. */
export function mobileContext(browser: Browser, storageState?: string): Promise<BrowserContext> {
  return browser.newContext({ ...MOBILE, ...(storageState ? { storageState } : {}) });
}

/**
 * The last OTP the API sent to a phone, read through the harness's loopback
 * control port. There is no API endpoint for this, on purpose.
 */
export async function lastOtp(phone: string, purpose: string): Promise<string> {
  const res = await fetch(`${CONTROL}/otp?phone=${encodeURIComponent(phone)}&purpose=${purpose}`);
  if (!res.ok) throw new Error(`no OTP for ${phone} (${purpose}): ${res.status}`);
  const body = (await res.json()) as { code: string };
  return body.code;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A form control by its Bengali label. Anchored, because a field's label is also
 * a prefix of other accessible names on the page ("পাসওয়ার্ড" and the reveal
 * button's "পাসওয়ার্ড দেখুন"). A required field's label ends in an asterisk.
 */
export function field(scope: Page | Locator, key: DictKey): Locator {
  return scope.getByLabel(new RegExp(`^${escape(t(key))}\\s*\\*?$`));
}

export function button(scope: Page | Locator, key: DictKey): Locator {
  return scope.getByRole('button', { name: t(key), exact: true });
}

/**
 * Picking a district from the searchable combobox.
 *
 * Not a `<select>`, so there is nothing to `selectOption`: the field is a button
 * that opens a search box over all sixty-four districts. Typing the English
 * name narrows the list to one row, which is exactly how a reseller uses it.
 * See components/ui/district-field.tsx.
 */
export async function selectDistrict(scope: Page | Locator, district: District): Promise<void> {
  await field(scope, 'order.district').click();
  const search = scope.getByPlaceholder(t('district.search'));
  await search.fill(district.value);
  await scope.getByRole('option', { name: district.bn }).first().click();
}

/** A `Card` holding the given text, for rows that repeat the same controls. */
export function cardWith(page: Page, text: string): Locator {
  return page.locator('.card').filter({ hasText: text });
}

/**
 * No page in these journeys may scroll sideways on a 360px phone. Polled, so a
 * layout still settling after data arrives is judged once it has settled.
 */
export async function expectNoHorizontalScroll(
  page: Page,
  { knownBug }: { knownBug?: string } = {}
): Promise<void> {
  if (knownBug) {
    // A reported layout bug in a file this suite may not change. Recorded on the
    // test rather than failing it, and flagged loudly once it has been fixed.
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    test.info().annotations.push({
      type: width > 360 ? 'known-bug' : 'known-bug-fixed',
      description: `${knownBug} (scrollWidth ${width} on ${new URL(page.url()).pathname})`,
    });
    if (width <= 360) console.warn(`known bug appears fixed, remove knownBug: ${knownBug}`);
    return;
  }
  try {
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth), { timeout: 5_000 })
      .toBeLessThanOrEqual(360);
  } catch (error) {
    // Name the elements that stick out, so the failure points at the layout bug.
    const offenders = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((el) => el.getBoundingClientRect().right > 360.5)
        // A fixed bar spans whatever the page widened to; it is the symptom.
        .filter((el) => {
          for (let node: HTMLElement | null = el; node; node = node.parentElement) {
            if (getComputedStyle(node).position === 'fixed') return false;
          }
          return true;
        })
        .slice(0, 10)
        .map((el) => {
          const box = el.getBoundingClientRect();
          const cls = typeof el.className === 'string' ? el.className.slice(0, 80) : '';
          return `<${el.tagName.toLowerCase()} class="${cls}"> right=${Math.round(box.right)} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
        })
    );
    throw new Error(
      `horizontal scroll at 360px on ${page.url()}\n  ${offenders.join('\n  ')}\n${(error as Error).message}`
    );
  }
}

/** A small, valid, solid-colour PNG, standing in for a photographed document. */
export function makePng(size = 32, rgb: [number, number, number] = [240, 170, 40]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  // compression, filter and interlace stay 0

  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).fill(Buffer.from(rgb))]);
  const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** JSON from the API through the web origin, as a signed-in browser would call it. */
export async function apiJson<T>(
  context: BrowserContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  data?: unknown
): Promise<T> {
  const response = await context.request.fetch(`${WEB}/api${url}`, {
    method,
    ...(data !== undefined ? { data } : {}),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok()) {
    throw new Error(`${method} ${url} -> ${response.status()} ${JSON.stringify(body)}`);
  }
  return body.data as T;
}
