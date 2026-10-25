import type { Locator } from '@playwright/test';

// Brings `target` on screen the way a person does: a server setting sits in one group at a
// time, so pick that group's chip first.
export async function reveal(target: Locator): Promise<Locator> {
  await target.first().waitFor({ state: 'attached' });
  const group = target.first().locator('xpath=ancestor::section[contains(concat(" ", @class, " "), " ss-group ")][1]');
  if (await group.count() && (await group.getAttribute('hidden')) !== null) {
    const name = await group.getAttribute('data-group');
    // data-group holds the stable id; the button text is the translated title.
    await target.page().locator(`#ss-jump button[data-group="${name}"]`).click();
  }
  return target;
}
