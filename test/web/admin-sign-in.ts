import { expect, type Cookie, type Page } from '@playwright/test';
import { generate } from 'otplib';

export const SECRET = 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU';
const STEP = 30;
const heading = (page: Page) => page.getByRole('heading', { name: 'CookingFoil 관리', exact: true });

// The server takes each authenticator code once: a code is good only for a later
// time step than the last one it took. Specs share one worker, so this module
// remembers the last step used and the admin session that came out of it.
let lastStep = -1;
let session: Cookie[] = [];

/** A code the server has not taken yet: the current step, the next one (±1 drift), or a wait for the step after. */
export async function freshCode(): Promise<string> {
  let now = Math.floor(Date.now() / 1000 / STEP);
  while (lastStep + 1 > now + 1) {
    await new Promise((r) => setTimeout(r, (now + 1) * STEP * 1000 - Date.now() + 200));
    now = Math.floor(Date.now() / 1000 / STEP);
  }
  const step = Math.max(now, lastStep + 1);
  lastStep = step;
  return generate({ secret: SECRET, epoch: step * STEP });
}

/** Opens the admin page signed in: the session from an earlier sign-in when it still works, else a fresh code. */
export async function signIn(page: Page): Promise<string> {
  const codeField = page.getByLabel('인증 앱 코드');
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
    session = await page.context().cookies();
  }
  return (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
}
