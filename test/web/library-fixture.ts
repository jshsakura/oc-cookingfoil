import { test as base, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './admin-sign-in';

const GAMES = process.env.COOK_GAMES_DIR!;
const KINDS = 'base,update,dlc,patch,save,homebrew,other';

export async function adminHeaders(page: Page) {
  const cookie = await signIn(page);
  return { Cookie: cookie, Origin: new URL(page.url()).origin };
}

type Fixtures = {
  // A step that puts the shared server back as it was, run after the test in reverse order.
  undo: (step: () => Promise<unknown>) => void;
  // A file the test puts in the games folder; it leaves the disk and the library after the test.
  libraryFile: (rel: string, body?: string | Buffer) => string;
};

// The specs share one server. Teardown gets its own time after the test, so a test that timed out
// still puts back what it changed, and if it cannot, that test fails rather than the specs after it.
export const test = base.extend<Fixtures>({
  // Needs the page so that it is torn down before the page closes: the steps use it.
  undo: [async ({ page: _page }, use) => {
    const steps: Array<() => Promise<unknown>> = [];
    await use((step) => { steps.push(step); });
    for (const step of steps.reverse()) await step();
  }, { timeout: 30_000 }],

  libraryFile: async ({ page, undo }, use) => {
    const made: string[] = [];
    undo(async () => {
      if (!made.length) return;
      for (const file of made) fs.rmSync(file, { force: true });
      const headers = await adminHeaders(page);
      expect((await page.request.post('/admin/api/library/rescan', { headers, data: {} })).ok()).toBe(true);
      const listed = async () => {
        let n = 0;
        for (const file of made) {
          const q = encodeURIComponent(path.basename(file));
          n += (await (await page.request.get(`/admin/api/library/browse?kind=${KINDS}&q=${q}&counts_only=1`, { headers })).json()).total;
        }
        return n;
      };
      await expect.poll(listed, { timeout: 20_000, message: 'the library still lists files this test added' }).toBe(0);
    });
    await use((rel, body = '') => {
      const file = path.join(GAMES, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      made.push(file);
      return file;
    });
  },
});

export { expect };
