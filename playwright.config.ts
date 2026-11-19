import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;

/** E2E smoke runs against the production build served by the real server (embedded PGlite). */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { NODE_ENV: 'test', PORT: String(PORT), ALLOWED_ORIGIN: `http://localhost:${PORT}` },
  },
});
