import { test } from '@playwright/test';
test('shot', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('cookingfoil:lang', 'ko'); } catch { /* none */ } });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#retro-home');
  await page.locator('#retro-rows .home-row .recent > .game').first().waitFor();
  await page.waitForTimeout(800);
  await page.locator('#retro-rows .home-row').first().screenshot({ path: '/tmp/claude-3000/-home-jshsakura-workspace-oc-cookingfoil/8928e3b4-daee-45b4-852d-917d970b82c9/scratchpad/retro-row.png' });
});
