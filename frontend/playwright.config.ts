import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys at 360x740, the cheap Android phone this app is built for.
 *
 * `e2e/harness/server.mjs` is the web server: an in-memory MongoDB, the Express
 * API in-process, a loopback-only control port for OTP codes, and `next start`
 * on the production build. Build first: `npm run build`, then `npm run test:e2e`.
 * The header of e2e/harness/server.mjs says why it is shaped this way.
 */

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3222);
const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.output/results',
  // The journeys are one business flow with shared state, walked in order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: './e2e/.output/report', open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    ...devices['Pixel 5'],
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
    locale: 'bn-BD',
    timezoneId: 'Asia/Dhaka',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /owner\.setup\.ts/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'journeys',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { browserName: 'chromium' },
    },
  ],

  webServer: {
    command: 'node e2e/harness/server.mjs',
    url: `${BASE_URL}/login`,
    // Never: an existing server on this port could be a dev server on a real database.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
