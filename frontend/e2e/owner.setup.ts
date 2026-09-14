import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { t } from '@/lib/i18n/bn';
import {
  AUTH_DIR,
  OWNER,
  OWNER_STATE,
  button,
  expectNoHorizontalScroll,
  field,
  lastOtp,
  mobileContext,
} from './support/harness';

/**
 * The owner signs in once, from a browser the API has never seen, so the
 * new-device code (docs/adr/0014) is exercised for real. The saved state
 * carries the trusted-device cookie and the session, and every later owner
 * context starts from it.
 */
test('owner signs in on a new device with an SMS code', async ({ browser }) => {
  mkdirSync(AUTH_DIR, { recursive: true });
  const context = await mobileContext(browser);
  const page = await context.newPage();

  await page.goto('/login');
  await expectNoHorizontalScroll(page);
  await field(page, 'auth.phone').fill(OWNER.phone);
  await field(page, 'auth.password').fill(OWNER.password);
  await button(page, 'auth.login').click();

  await expect(page.getByRole('heading', { name: t('auth.deviceTitle') })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await field(page, 'auth.otp').fill(await lastOtp(OWNER.phone, 'owner_device'));
  await button(page, 'auth.verify').click();

  await expect(page).toHaveURL(/\/owner$/);
  await context.storageState({ path: OWNER_STATE });
  await context.close();
});
