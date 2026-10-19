import type { Locator } from '@playwright/test';

// Opens the folded section around `target` the way a person does, by clicking its heading.
export async function reveal(target: Locator): Promise<Locator> {
  await target.first().waitFor({ state: 'attached' });
  const fold = target.first().locator('xpath=ancestor::details[contains(concat(" ", @class, " "), " fold ")][1]');
  if (await fold.count() && (await fold.getAttribute('open')) === null) await fold.locator('xpath=./summary').click();
  return target;
}
