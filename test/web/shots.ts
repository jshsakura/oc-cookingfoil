import type { Locator, Page } from '@playwright/test';

type Options = Parameters<Page['screenshot']>[0] & Parameters<Locator['screenshot']>[0];

/** A picture for a person to look at, taken only when COOK_WEB_SHOTS=1. Assertions never read it. */
export async function shot(target: Page | Locator, options: Options): Promise<void> {
  if (process.env.COOK_WEB_SHOTS !== '1') return;
  await target.screenshot(options);
}
