import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { SLOTS, webTestPort } from './ports.mjs';

// How many specs run at once, each against its own server (COOK_WEB_WORKERS to change it).
export const WORKERS = Math.max(1, Number(process.env.COOK_WEB_WORKERS) || 4);
const MAX_LANES = 8;

// Each checkout gets its own block of ports and folders: two worktrees running the suite at
// once would otherwise test against each other's server and files.
const slot = parseInt(crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 6), 16) % SLOTS;

/** The port and folders of lane `lane`: what its server listens on and reads, and what its specs touch. */
export function laneEnv(lane) {
  const root = path.join(os.tmpdir(), `cookingfoil-web-test-${slot}-${lane}`);
  const dirs = { DATA: 'data', GAMES: 'games', PATCHES: 'patches', SAVES: 'saves', HOMEBREW: 'homebrew', RETRO: 'retro' };
  return {
    COOK_WEB_TEST_PORT: String(webTestPort(slot * MAX_LANES + (lane % MAX_LANES))),
    ...Object.fromEntries(Object.entries(dirs).map(([role, dir]) => [`COOK_${role}_DIR`, path.join(root, dir)])),
  };
}

// What every test server runs with besides its lane.
export const SERVER_ENV = {
  COOK_STORAGE_DIR: '', COOK_TITLEDB_AUTO_FETCH: 'false',
  COOK_EXTRACT_ICONS: 'off', COOK_AUTH_USERS: '', COOK_DEVICE_PAIRING: 'true',
  COOK_UPLOADS_ENABLED: 'true', COOK_PLUGIN_INSTALL: '1', COOK_ESHOP_PRICES: 'false', COOK_ADMIN_TOTP_SECRET: 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU',
  COOK_FIRST_RUN_SETUP: 'false', COOK_VERIFY_HOURS: 'always', COOK_RETRO_META: 'false', COOK_RETRO_AUTO_CORES: 'false', COOK_RETRO_AUTO_ART: 'false', COOK_RATING_SYNC: 'false',
  // A fixed key for the test server's throwaway data; production sets its own in .env.
  COOK_SECRET_KEY: 'dGVzdC1rZXktbm90LWEtc2VjcmV0LTAxMjM0NTY3ODk=',
};
