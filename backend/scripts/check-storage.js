'use strict';

/*
 * Proves the R2 configuration actually works: uploads a tiny object under the
 * app's prefix, fetches it back through a signed URL, checks it is NOT readable
 * without one, then deletes it.
 *
 * Run with: npm run check:storage
 */

const storage = require('../src/config/storage');
const env = require('../src/config/env');

const line = (label, value) => console.log(`  ${label.padEnd(20)} ${value}`);

function reportConfig() {
  console.log('\nR2 configuration');
  line('private bucket', env.R2_BUCKET || '(unset)');
  line('public bucket', env.R2_PUBLIC_BUCKET || 'not set, product images refused');
  line('public base url', env.R2_PUBLIC_BASE_URL || 'not set, product images refused');
  line('prefix', storage.ROOT);
  line('credentials', storage.isConfigured() ? 'present' : 'MISSING');
}

/**
 * R2 public access is bucket wide, so one bucket cannot hold both. Sharing would
 * make every national ID scan readable by anyone who guesses a key.
 */
function bucketsAreSeparate() {
  if (env.R2_PUBLIC_BUCKET && env.R2_PUBLIC_BUCKET === env.R2_BUCKET) {
    line('bucket separation', 'DANGER: public and private are the same bucket');
    console.log(
      '\n  R2 public access cannot be scoped to a prefix. Sharing one bucket\n' +
        '  exposes every KYC scan in it. Create a second bucket for images.\n'
    );
    return false;
  }
  return true;
}

async function privateRoundTrip() {
  const body = Buffer.from(`chapaimango storage check ${new Date().toISOString()}`);

  console.log('\nPrivate round trip (what KYC and deposit uploads do)');

  let key;
  try {
    const uploaded = await storage.uploadBuffer(body, {
      folder: storage.FOLDERS.DEPOSIT,
      contentType: 'image/png',
    });
    key = uploaded.key;
    line('upload', `ok, ${key}`);
  } catch (err) {
    line('upload', `FAILED: ${err.message}`);
    console.log('\n  Check the bucket name and that the API token may write to it.\n');
    return false;
  }

  let ok = true;

  try {
    const url = await storage.signedUrl(key, { expiresInSeconds: 60 });
    const res = await fetch(url);
    const matches = (await res.text()) === body.toString();
    line('signed read', res.ok && matches ? 'ok, content matches' : `FAILED: HTTP ${res.status}`);
    if (!res.ok || !matches) ok = false;
  } catch (err) {
    line('signed read', `FAILED: ${err.message}`);
    ok = false;
  }

  // If the private bucket also answers unsigned requests, public access is on and
  // every uploaded national ID is exposed.
  if (env.R2_PUBLIC_BASE_URL) {
    try {
      const res = await fetch(storage.publicUrl(key));
      if (res.ok) {
        line('privacy', 'DANGER: readable without a signature');
        console.log(
          '\n  The private bucket is publicly readable. Turn public access off on\n' +
            `  ${env.R2_BUCKET} and serve images from the separate public bucket.\n`
        );
        ok = false;
      } else {
        line('privacy', `ok, unsigned read refused (HTTP ${res.status})`);
      }
    } catch {
      line('privacy', 'ok, unsigned read refused');
    }
  }

  try {
    await storage.destroy(key);
    line('cleanup', 'ok, test object deleted');
  } catch (err) {
    line('cleanup', `FAILED, delete ${key} by hand: ${err.message}`);
  }

  return ok;
}

async function publicRoundTrip() {
  console.log('\nPublic round trip (what product photos do)');

  if (!env.R2_PUBLIC_BUCKET || !env.R2_PUBLIC_BASE_URL) {
    line('skipped', 'public bucket or base url not set');
    return null;
  }

  const body = Buffer.from('chapaimango public check');
  let key;
  try {
    const uploaded = await storage.uploadBuffer(body, {
      folder: storage.FOLDERS.PRODUCT,
      contentType: 'image/png',
    });
    key = uploaded.key;
    line('upload', `ok, ${key}`);
  } catch (err) {
    line('upload', `FAILED: ${err.message}`);
    return false;
  }

  let ok = true;
  try {
    // A customer is anonymous and cannot sign anything, so this must work unsigned.
    const res = await fetch(storage.publicUrl(key));
    line('unsigned read', res.ok ? 'ok, customers can load images' : `FAILED: HTTP ${res.status}`);
    if (!res.ok) {
      ok = false;
      console.log(
        '\n  The public bucket is not actually public, or R2_PUBLIC_BASE_URL is\n' +
          '  wrong. It must be the r2.dev URL or your custom domain, never the\n' +
          '  S3 API endpoint, which requires a signature.\n'
      );
    }
  } catch (err) {
    line('unsigned read', `FAILED: ${err.message}`);
    ok = false;
  }

  try {
    await storage.destroy(key);
    line('cleanup', 'ok, test object deleted');
  } catch (err) {
    line('cleanup', `FAILED, delete ${key} by hand: ${err.message}`);
  }

  return ok;
}

function nextSteps() {
  if (env.R2_PUBLIC_BUCKET && env.R2_PUBLIC_BASE_URL) return;

  console.log(
    'Product images need a SECOND, public bucket. In the Cloudflare dashboard:\n' +
      '  1. Create a bucket, for example chapaimango-public.\n' +
      '  2. Open it, go to Settings, enable the r2.dev development URL\n' +
      '     or connect a custom domain.\n' +
      '  3. Set R2_PUBLIC_BUCKET to its name and R2_PUBLIC_BASE_URL to that URL.\n' +
      `Leave ${env.R2_BUCKET || 'the private bucket'} private: it holds the KYC scans.\n`
  );
}

async function main() {
  reportConfig();

  if (!storage.isConfigured()) {
    console.log('\nSet R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.\n');
    process.exitCode = 1;
    return;
  }

  if (!bucketsAreSeparate()) {
    process.exitCode = 1;
    return;
  }

  const privateOk = await privateRoundTrip();
  const publicOk = await publicRoundTrip();

  if (!privateOk || publicOk === false) process.exitCode = 1;

  console.log(
    process.exitCode
      ? '\nStorage is NOT ready. Fix the failures above.\n'
      : '\nPrivate storage is ready for KYC documents and deposit screenshots.\n'
  );

  nextSteps();
}

main().catch((err) => {
  console.error('\ncheck failed:', err.message, '\n');
  process.exit(1);
});
