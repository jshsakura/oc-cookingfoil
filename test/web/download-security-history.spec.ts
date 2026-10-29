import { test, expect } from '@playwright/test';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { signIn } from './admin-sign-in';

const file = () => path.join(process.env.COOK_DATA_DIR!, 'security', 'download-security.json');
test.afterEach(async () => { await unlink(file()).catch(() => {}); });

test('a host firewall block identifies the user on the overview and alert history without Telegram', async ({ page }) => {
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file(), JSON.stringify({ events: [{
    id: 'example-alert', at: Date.now(), action: 'blocked', reason: 'cookingfoil/dl-bad-link', count: 15,
    until: Date.now() + 600000, delivery: 'failed',
    users: [{ owner: 'alice', label: 'Living room', device: 'ab12cd34', match: 'request' }],
  }] }));
  await signIn(page);
  await page.goto('/admin');
  const row = page.locator('#ov-recent li[role=button]').filter({ hasText: 'alice' });
  // The overview caches its answer for ten seconds and refreshes every fifteen.
  await expect(row).toContainText('Living room', { timeout: 20000 });
  await row.click();
  await expect(page.locator('#ov-alert-body')).toContainText('cookingfoil/dl-bad-link');
  await expect(page.locator('#ov-alert-body')).toContainText('ab12cd34');
  await page.locator('#ov-alert').getByRole('link').click();
  await expect(page).toHaveURL(/\/admin\/logs\/alerts/);
  await expect(page.locator('#al-history')).toContainText('alice');
  await expect(page.locator('#al-history')).toContainText('cookingfoil/dl-bad-link');
});
