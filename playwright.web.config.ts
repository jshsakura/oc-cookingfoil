import { defineConfig, devices } from '@playwright/test';
import { laneEnv, WORKERS } from './test/web/lanes.mjs';

// Each worker gets its own server, port and folders (test/web/lanes.mjs), so specs run side by side
// without seeing each other's games, accounts or settings. The config is read again in every worker,
// where TEST_PARALLEL_INDEX names its lane; the specs read their folders from process.env at import.
const lane = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
Object.assign(process.env, laneEnv(lane));
const base = `http://127.0.0.1:${process.env.COOK_WEB_TEST_PORT}`;
export default defineConfig({
  testDir: './test/web',
  fullyParallel: false,
  workers: WORKERS,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: base, trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  // One server per worker, started before the first spec and stopped after the last.
  globalSetup: './test/web/servers.mjs',
  projects: [{ name: 'web-chromium', use: { ...devices['Desktop Chrome'] } }],
});
