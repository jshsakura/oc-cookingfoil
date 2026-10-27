import { defineConfig, devices } from '@playwright/test';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { SLOTS, webTestPort } from './test/web/ports.mjs';

// Each checkout gets its own port and folders: two worktrees running the suite at
// once would otherwise test against each other's server and files.
const slot = parseInt(crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 6), 16) % SLOTS;
const port = process.env.COOK_WEB_TEST_PORT ?? String(webTestPort(slot));
const root = path.join(os.tmpdir(), `cookingfoil-web-test-${slot}`);
process.env.COOK_WEB_TEST_PORT = port;
for (const [role, dir] of Object.entries({ DATA: 'data', GAMES: 'games', PATCHES: 'patches', SAVES: 'saves', HOMEBREW: 'homebrew', RETRO: 'retro' })) {
  process.env[`COOK_${role}_DIR`] ??= path.join(root, dir);
}
const base = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './test/web',
  // The admin spec turns the password lane on and off for the whole server,
  // so specs share one worker and run one at a time.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: base, trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: 'node test/web/server.mjs',
    url: `${base}/healthz`,
    // A server already on the port is someone else's: fail rather than test against it.
    reuseExistingServer: false,
    env: {
      COOK_PORT: port, COOK_STORAGE_DIR: '', COOK_TITLEDB_AUTO_FETCH: 'false',
      COOK_EXTRACT_ICONS: 'off', COOK_AUTH_USERS: '', COOK_DEVICE_PAIRING: 'true',
      COOK_UPLOADS_ENABLED: 'true', COOK_PLUGIN_INSTALL: '1', COOK_ESHOP_PRICES: 'false', COOK_ADMIN_TOTP_SECRET: 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU',
      COOK_FIRST_RUN_SETUP: 'false', COOK_VERIFY_HOURS: 'always', COOK_RETRO_META: 'false', COOK_RETRO_AUTO_CORES: 'false', COOK_RETRO_AUTO_ART: 'false', COOK_DEFAULT_PLUGINS: 'false', COOK_RATING_SYNC: 'false',
      // A fixed key for the test server's throwaway data; production sets its own in .env.
      COOK_SECRET_KEY: 'dGVzdC1rZXktbm90LWEtc2VjcmV0LTAxMjM0NTY3ODk=',
    },
  },
  projects: [{ name: 'web-chromium', use: { ...devices['Desktop Chrome'] } }],
});
