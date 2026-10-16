import type { Page } from '@playwright/test';

/** Confirms every in-page question the admin page asks (its ask dialog), as a person clicking 확인 would. */
export const acceptAsks = (page: Page) =>
  page.addLocatorHandler(page.locator('#ask-dialog'), async () => { await page.locator('#ask-ok').click(); });
