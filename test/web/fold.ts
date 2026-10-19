import type { Locator } from '@playwright/test';

// Brings `target` on screen the way a person does: a server setting sits in one group at a
// time, so pick that group's chip first.
export async function reveal(target: Locator): Promise<Locator> {
  await target.first().waitFor({ state: 'attached' });
  const group = target.first().locator('xpath=ancestor::section[contains(concat(" ", @class, " "), " ss-group ")][1]');
  if (await group.count() && (await group.getAttribute('hidden')) !== null) {
    const name = await group.getAttribute('data-group');
    await target.page().locator('#ss-jump button').filter({ hasText: name! }).click();
  }
  return target;
}
