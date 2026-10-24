import { test, expect } from '@playwright/test';
import { freshCode, signIn } from './admin-sign-in';

// Stage A of the admin redesign: every job has a real URL, the sidebar owns the
// menu tree, the phone gets the same tree in a drawer, and the old "#tab" links
// keep working by landing on the page that section now lives on.

const PAGES: [string, string, string][] = [
  ['/admin', 'tab-overview', '관리 개요'],
  ['/admin/games', 'tab-library', '게임 라이브러리'],
  ['/admin/upload', 'tab-upload', '올리기'],
  ['/admin/convert', 'tab-nsz', 'NSZ 압축'],
  ['/admin/inbox', 'tab-inbox', '수신함'],
  ['/admin/featured', 'tab-featured', '홈 화면 구성'],
  ['/admin/trash', 'tab-trash', '휴지통'],
  ['/admin/users', 'tab-users', '계정'],
  ['/admin/devices', 'tab-devices', '기기'],
  ['/admin/logs/downloads', 'tab-logs', '다운로드'],
  ['/admin/logs/clients', 'tab-logs', '클라이언트 로그'],
  ['/admin/logs/security', 'tab-logs', '차단과 거부'],
  ['/admin/notifications', 'tab-alerts', '알림 설정'],
  ['/admin/client', 'tab-overview', '클라이언트 배포'],
  ['/admin/settings/server', 'tab-settings', '서버 동작'],
  ['/admin/settings/integrations', 'tab-settings', '외부 서비스'],
  ['/admin/settings/login', 'tab-settings', '사용자 로그인'],
  ['/admin/settings/admin', 'tab-settings', '관리자 보안'],
  ['/admin/settings/automation', 'tab-settings', '자동화와 MCP'],
];

test('every page opens its own section, marks the sidebar and keeps its address on reload', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  for (const [path, section, label] of PAGES) {
    await page.goto(path);
    await expect(page.locator(`#${section}`), path).toBeVisible();
    await expect(page.locator(`aside.adm-side a[aria-current="page"]`), path).toContainText(label);
    expect(page.url().replace(/#.*$/, ''), path).toContain(path);
    await page.reload();
    await expect(page.locator(`#${section}`), `${path} after reload`).toBeVisible();
  }
});

test('the retro group lists its eight jobs as items with addresses of their own', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/retro?view=cores');
  await expect(page.locator('#tab-retro')).toBeVisible();
  await expect(page.locator('aside.adm-side a[aria-current="page"]')).toHaveText('코어');
  const items = page.locator('aside.adm-side .adm-grp[data-grp="retro"] .adm-task');
  await expect(items).toHaveCount(8);
  await expect(items.first()).toHaveAttribute('href', '/admin/retro?view=art');
});

test('a settings page opens its own area', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings/automation');
  await expect(page.locator('[data-set-panel="tokens"]')).toBeVisible();
  await expect(page.locator('[data-set-panel="server"]')).toBeHidden();
});

test('a deep address without a session shows the gate and returns to the same page after the check', async ({ page }) => {
  await page.goto('/admin/devices');
  await expect(page.getByRole('heading', { name: '관리 페이지 확인' })).toBeVisible();
  await page.getByLabel('인증 앱 코드').fill(await freshCode());
  await page.getByRole('button', { name: '들어가기', exact: true }).click();
  await expect(page.locator('#tab-devices')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/admin/devices');
});

test('an old "#tab" address lands on the page that section lives on now', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#users');
  await expect(page.locator('#tab-users')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/admin/users');
  await page.goto('/admin#nsz');
  await expect(page.locator('#tab-nsz')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/admin/convert');
});

test('an in-page hash link pushes the matching page, and back returns', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/games');
  await expect(page.locator('#tab-library')).toBeVisible();
  await page.evaluate(() => { location.hash = '#users'; });
  await expect(page.locator('#tab-users')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/admin/users');
  await page.goBack();
  await expect(page.locator('#tab-library')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/admin/games');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the drawer carries the same tree and closes by keyboard', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/games');
    await expect(page.locator('aside.adm-side')).toBeHidden();
    const menu = page.locator('#adm-menu');
    await menu.click();
    const drawer = page.locator('#adm-drawer');
    await expect(drawer).toBeVisible();
    // The dialog holds the focus, so Escape (its own close) is reachable.
    await expect(drawer.locator('a[href="/admin/upload"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });
});
