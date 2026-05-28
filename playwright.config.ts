import { defineConfig, devices } from '@playwright/test';
import { parse } from 'dotenv';
import fs from 'fs';
import path from 'path';

/**
 * Important: do NOT call `dotenv.config()` here.
 *
 * Playwright's webServer subprocess inherits this process's env. If we
 * loaded the root .env into process.env, those values would leak into
 * the spawned server and silently override its own test/project/.env
 * (dotenv keeps existing env vars by default). The CI suite then runs
 * with the wrong auth/data/welcome settings — exactly how we used to lose
 * "The Server Works!!" and end up with /data EACCES errors.
 *
 * Instead, parse test/project/.env.example without injecting anything,
 * just to learn which port to poll. Anything more comes from
 * test/project/.env (staged by the workflow) at server boot time.
 */
const TEST_ENV_DEFAULTS = (() => {
  try {
    return parse(fs.readFileSync(path.resolve('./test/project/.env.example')));
  } catch {
    return {};
  }
})();

const PORT = process.env.COOK_PORT ?? TEST_ENV_DEFAULTS.COOK_PORT ?? '3001';
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './test',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  globalSetup: path.resolve(path.resolve(), './test/switch.setup.ts'),
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  /* Run your local dev server before starting the tests.
     The CI workflow stages test/project/.env from .env.example beforehand;
     the server reads that file from its CWD on boot. */
  webServer: {
    command: 'cd ./test/project/ && node ../../src/index.js',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
  },

  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
