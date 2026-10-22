import { expect, type Cookie, type Page } from '@playwright/test';
import { generate } from 'otplib';
import fs from 'node:fs';
import path from 'node:path';

export const SECRET = 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU';
const STEP = 30;
const heading = (page: Page) => page.getByRole('heading', { name: 'CookingFoil 서버 관리', exact: true });

// The server takes each authenticator code once: a code is good only for a later
// time step than the last one it took. Playwright starts a new worker for each
// --repeat-each round and after a failure, so the last step used and the admin
// session that came out of it live in a file, not in this module. The file sits in
// the test server's data folder, which server.mjs empties when the server starts.
const STATE = path.join(process.env.COOK_DATA_DIR!, 'web-test-admin-sign-in.json');
type State = { lastStep: number; session: Cookie[] };
function load(): State {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { lastStep: -1, session: [] }; }
}
const save = (s: State) => fs.writeFileSync(STATE, JSON.stringify(s));

/** A code the server has not taken yet: the current step, the next one (±1 drift), or a wait for the step after. */
export async function freshCode(): Promise<string> {
  const { lastStep, session } = load();
  let now = Math.floor(Date.now() / 1000 / STEP);
  while (lastStep + 1 > now + 1) {
    await new Promise((r) => setTimeout(r, (now + 1) * STEP * 1000 - Date.now() + 200));
    now = Math.floor(Date.now() / 1000 / STEP);
  }
  const step = Math.max(now, lastStep + 1);
  save({ lastStep: step, session });
  return generate({ secret: SECRET, epoch: step * STEP });
}

/** Opens the admin page signed in: the session from an earlier sign-in when it still works, else a fresh code. */
export async function signIn(page: Page): Promise<string> {
  const codeField = page.getByLabel('인증 앱 코드');
  const { session } = load();
  if (session.length) {
    await page.context().addCookies(session);
    await page.goto('/admin');
    await heading(page).waitFor({ timeout: 2000 }).catch(() => {});
  }
  if (!session.length || !(await heading(page).isVisible())) {
    await page.goto('/admin?enrolled=1');
    await codeField.fill(await freshCode());
    await page.getByRole('button', { name: '들어가기', exact: true }).click();
    await expect(heading(page)).toBeVisible();
    save({ ...load(), session: await page.context().cookies() });
  }
  return (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
}
