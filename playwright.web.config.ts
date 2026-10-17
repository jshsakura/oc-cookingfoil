import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test/web',
  // The admin spec turns the password lane on and off for the whole server,
  // so specs share one worker and run one at a time.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3188', trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: 'node test/web/server.mjs',
    url: 'http://127.0.0.1:3188/healthz',
    reuseExistingServer: !process.env.CI,
    env: {
      COOK_PORT: '3188', COOK_DATA_DIR: '/tmp/cookingfoil-web-test-data',
      COOK_GAMES_DIR: '/tmp/cookingfoil-web-test-games', COOK_TITLEDB_AUTO_FETCH: 'false',
      COOK_EXTRACT_ICONS: 'off', COOK_AUTH_USERS: '', COOK_DEVICE_PAIRING: 'true',
      COOK_UPLOADS_ENABLED: 'true', COOK_ESHOP_PRICES: 'false', COOK_ADMIN_TOTP_SECRET: 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU',
      COOK_FIRST_RUN_SETUP: 'false', COOK_VERIFY_HOURS: 'always', COOK_RETRO_META: 'false', COOK_RATING_SYNC: 'false', COOK_CLIENT_RELEASE_REPO: '',
      // A fixed key for the test server's throwaway data; production sets its own in .env.
      COOK_SECRET_KEY: 'dGVzdC1rZXktbm90LWEtc2VjcmV0LTAxMjM0NTY3ODk=',
    },
  },
  projects: [{ name: 'web-chromium', use: { ...devices['Desktop Chrome'] } }],
});
