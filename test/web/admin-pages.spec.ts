import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { freshCode, signIn } from './admin-sign-in';

// Stage A of the admin redesign: every job has a real URL, the sidebar owns the
// menu tree, the phone gets the same tree in a drawer, and the old "#tab" links
// keep working by landing on the page that section now lives on.

const PAGES: [string, string, string][] = [
  ['/admin', 'tab-overview', '대시보드'],
  ['/admin/games', 'tab-library', '게임'],
  ['/admin/incoming', 'tab-upload', '업로드'],
  // Stage B first bundle: these pages carry only their own panel.
  ['/admin/convert', 'tab-nsz', '압축'],
  ['/admin/featured', 'tab-featured', '홈 화면'],
  ['/admin/trash', 'tab-trash', '휴지통'],
  ['/admin/users', 'tab-users', '계정'],
  ['/admin/devices', 'tab-devices', '기기'],
  ['/admin/logs/downloads', 'xf-cards', '전송 기록'],
  ['/admin/logs/clients', 'cl-list', '클라이언트 기록'],
  ['/admin/logs/security', 'lockouts', '보안 기록'],
  ['/admin/settings/notifications', 'tab-alerts', '알림 설정'],
  ['/admin/logs/alerts', 'al-history', '알림 기록'],
  ['/admin/client', 'tab-client', '클라이언트'],
  ['/admin/settings/server', 'ss-list', '서버 동작'],
  ['/admin/settings/integrations', 'intg-h', '외부 서비스'],
  ['/admin/settings/login', 'tab-settings', '구글 로그인'],
  ['/admin/settings/admin', 'tab-settings', '관리자 보안'],
  ['/admin/settings/automation', 'mcp-on', '자동화 토큰'],
  ['/admin/metadata/review', 'tab-meta-review', '검토 필요'],
  ['/admin/metadata/artwork', 'tab-meta-art', '아트워크'],
  ['/admin/metadata/titles', 'tab-meta-titles', '제목'],
  ['/admin/system/requirements', 'tab-requirements', '필수 파일'],
];

test('every page opens its own section, marks the sidebar and keeps its address on reload', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  for (const [path, section, label] of PAGES) {
    await page.goto(path);
    const sel = section.startsWith('h2:') ? section : `#${section}`;
    await expect(page.locator(sel), path).toBeVisible();
    // A page that shares its menu entry is marked in the tabs over it; one of its own, in the sidebar.
    await expect(page.locator('aside.adm-side > nav a[aria-current="page"]'), path).toHaveCount(1);
    const tab = page.locator('main .adm-rowtabs a[aria-current="page"]');
    await expect((await tab.count()) ? tab : page.locator('aside.adm-side > nav a[aria-current="page"]'), path).toContainText(label);
    expect(page.url().replace(/#.*$/, ''), path).toContain(path);
    await page.reload();
    await expect(page.locator(`#${section}`), `${path} after reload`).toBeVisible();
  }
});

test('the retro page lists its seven jobs as tabs, the files first, and keeps the chosen one in its address', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/retro?view=cores');
  await expect(page.locator('#tab-retro')).toBeVisible();
  await expect(page.locator('aside.adm-side > nav a[aria-current="page"]')).toHaveText('라이브러리');
  await expect(page.locator('main .adm-rowtabs a[aria-current="page"]')).toHaveText('레트로');
  await expect(page.locator('#retro-subtabs [data-sub="cores"]')).toHaveAttribute('aria-selected', 'true');
  const items = page.locator('#retro-subtabs [data-sub]');
  await expect(items).toHaveCount(7);
  await expect(items.first()).toHaveAttribute('data-sub', 'folder');
  await expect(items.last()).toHaveAttribute('data-sub', 'sets');
});

test('a settings page opens its own area', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/settings/automation');
  // The tokens panel is the page itself now, not a subtab of a settings section.
  await expect(page.locator('#mcp-on')).toBeAttached();
  await expect(page.locator('[data-set-panel="server"]')).toHaveCount(0);
});

test('homebrew and library task choices keep their addresses and selection on reload', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/homebrew?tab=apps');
  await page.locator('#homebrew-subtabs [data-sub="sources"]').click();
  expect(new URL(page.url()).searchParams.get('tab')).toBe('sources');
  await page.reload();
  await expect(page.locator('#homebrew-subtabs [data-sub="sources"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#hb-add')).toBeVisible();
  await page.goto('/admin/games');
  await page.locator('#lib-subtabs [data-lsub="info"]').click();
  expect(new URL(page.url()).searchParams.get('view')).toBe('info');
  await page.reload();
  await expect(page.locator('#gd-form')).toBeVisible();
});

test('every admin page draws its content at the same width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const widths = new Set<string>();
  for (const path of ['/admin', '/admin/games', '/admin/retro?view=ratings', '/admin/homebrew?tab=reco', '/admin/devices', '/admin/logs/security', '/admin/settings/admin']) {
    await page.goto(path);
    const b = (await page.locator('body.adm-shell > .wrap').boundingBox())!;
    widths.add(`${Math.round(b.x)}/${Math.round(b.width)}`);
  }
  expect([...widths]).toHaveLength(1);
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

test('a page starts at its own title: brand and menu in the sidebar, upload, language and account in the header band', async ({ page }) => {
  await signIn(page);
  for (const path of ['/admin', '/admin/games', '/admin/retro?view=cores', '/admin/settings/server']) {
    await page.goto(path);
    await expect(page.locator('body.adm-shell > .wrap header.adm-hdr'), path).toHaveCount(0);
    for (const id of ['#up-entry', '#lang-btn', '#acct-btn']) await expect(page.locator(`aside.adm-side ${id}`), `${path} ${id}`).toBeVisible();
  }
});

test('on a desktop the header band holds the account top right, its menus open down, and only the sidebar menu scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await signIn(page);
  await page.goto('/admin/settings/server');
  const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
  const acct = await box('#acct-btn');
  const brand = await box('aside.adm-side .brand');
  const band = await box('aside.adm-side .hdr-right');
  expect(Math.round(band.y)).toBe(0);
  expect(Math.round(band.height)).toBe(Math.round(brand.height));
  expect(acct.y + acct.height).toBeLessThanOrEqual(band.height);
  expect(1280 - (acct.x + acct.width)).toBeLessThan(40);
  expect((await box('#lang-btn')).x).toBeLessThan(acct.x);
  // The page's lead starts below the band (the band's path names the page).
  expect((await box('body.adm-shell > .wrap p.muted')).y).toBeGreaterThanOrEqual(band.height);

  await page.locator('#acct-btn').click();
  expect((await box('#acct-list')).y).toBeGreaterThan(acct.y + acct.height);
  await page.keyboard.press('Escape');

  // On a short window the menu is longer than the screen: it scrolls, the brand does not move.
  await page.setViewportSize({ width: 1280, height: 320 });
  const moved = await page.locator('aside.adm-side > nav').evaluate((nav) => {
    nav.scrollTop = nav.scrollHeight;
    return { scrolled: nav.scrollTop > 0, page: document.scrollingElement!.scrollTop };
  });
  expect(moved).toEqual({ scrolled: true, page: 0 });
  expect(Math.round((await box('aside.adm-side .brand')).y)).toBe(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the drawer carries the same tree and closes by keyboard', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/games');
    // The sidebar shrinks to the top bar: the brand and account stay, the menu tree moves to the drawer.
    await expect(page.locator('aside.adm-side #acct-btn')).toBeVisible();
    await expect(page.locator('aside.adm-side > nav')).toBeHidden();
    const menu = page.locator('#adm-menu');
    await menu.click();
    const drawer = page.locator('#adm-drawer');
    await expect(drawer).toBeVisible();
    // The dialog holds the focus, so Escape (its own close) is reachable.
    await expect(drawer.locator('a[href="/admin/games"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('the drawer fits the screen: square corners, and the last menu item scrolls fully into view', async ({ page }) => {
    await signIn(page);
    await page.goto('/admin/games');
    await page.locator('#adm-menu').click();
    const drawer = page.locator('#adm-drawer');
    await expect(drawer).toBeVisible();
    const fit = await drawer.evaluate((d) => {
      const nav = d.querySelector('nav') as HTMLElement;
      nav.scrollTop = nav.scrollHeight;
      const items = nav.querySelectorAll('.adm-item');
      const last = items[items.length - 1].getBoundingClientRect();
      const box = d.getBoundingClientRect();
      return { radius: getComputedStyle(d).borderRadius, bottom: box.bottom, screen: window.innerHeight, lastBottom: last.bottom, navBottom: nav.getBoundingClientRect().bottom };
    });
    expect(fit.radius).toBe('0px');
    expect(fit.bottom).toBeLessThanOrEqual(fit.screen);
    expect(fit.lastBottom).toBeLessThanOrEqual(fit.navBottom);
    // The close button is a small round outlined button like the header's, not a bare 44px glyph.
    const close = await page.locator('#adm-drawer-close').evaluate((b) => ({ w: b.getBoundingClientRect().width, border: getComputedStyle(b).borderTopWidth }));
    expect(close.w).toBeLessThanOrEqual(40);
    expect(close.border).toBe('1px');
  });
});

test('the header names every page by its menu path', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/admin/retro?view=ratings');
  await expect(page.locator('#adm-crumb')).toHaveText(/라이브러리\s*레트로\s*평점/);
  await page.goto('/admin/devices');
  await expect(page.locator('#adm-crumb')).toHaveText(/사용자\s*기기\s*승인 대기/);
  await expect(page.locator('#adm-crumb .adm-crumb-i')).toHaveText('승인 대기');
  await page.goto('/admin');
  await expect(page.locator('#adm-crumb')).toHaveText('대시보드');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/admin/retro?view=ratings');
  await expect(page.locator('#adm-crumb .adm-crumb-i')).toBeVisible();
  await expect(page.locator('#adm-crumb').filter({ hasText: '레트로' })).toBeVisible();
  await expect(page.locator('#adm-crumb .adm-crumb-far').first()).toBeHidden();
});

test('dictionary text keeps its links and never shows a raw key or source', async ({ page }) => {
  await signIn(page);
  // The old address of the alerts page still lands on it, now under the settings.
  await page.goto('/admin/notifications');
  await expect(page).toHaveURL(/\/admin\/settings\/notifications(?:#alerts)?$/);
  await expect(page.locator('#tab-alerts a[href="https://t.me/BotFather"]')).toBeVisible();
  await page.goto('/admin/settings/integrations');
  await expect(page.locator('.intg-steps a').first()).toBeVisible();
  expect(await page.locator('.intg-steps').evaluateAll((ns) => ns.some((n) => (n as HTMLElement).innerText.includes('<a ')))).toBe(false);
  await page.goto('/admin/games');
  await expect(page.locator('#fb-rows')).toContainText('Test Game');
  await expect(page.locator('#fb')).not.toContainText('fb.col');
});

test('the addresses the menu plan retired redirect to where their job lives now', async ({ page }) => {
  await signIn(page);
  const moved: [string, string][] = [
    ['/admin/titles', '/admin/games?view=info'],
    ['/admin/integrity', '/admin/games?view=verify'], ['/admin/organize', '/admin/incoming#organize'],
    ['/admin/upload?kind=patch', '/admin/incoming?kind=patch#upload'], ['/admin/inbox', '/admin/incoming#inbox'], ['/admin/incoming/temp', '/admin/incoming#organize'],
  ];
  for (const [from, to] of moved) {
    const res = await page.request.get(from, { maxRedirects: 0 });
    expect(res.status(), from).toBe(302);
    expect(res.headers().location, from).toBe(to);
  }
  // Patches and saves were views of the games page: their old links land on the pages of their own.
  for (const name of ['patches', 'saves']) {
    for (const old of [`/admin/games?view=${name}`, `/admin/games#library/${name}`]) {
      await page.goto(old);
      await expect(page, old).toHaveURL(new RegExp(`/admin/${name}(#|\\?|$)`));
      await expect(page.locator(`#${name}-subtabs [data-sub="list"]`)).toHaveAttribute('aria-selected', 'true');
    }
  }
  // The games page opens on its 파일 tab again: its old folder links stay there, the folder kept.
  const kept = `${process.env.COOK_GAMES_DIR}/fb-old`;
  fs.mkdirSync(kept, { recursive: true });
  for (const [old, want] of [
    ['/admin/games?tab=folder&path=fb-old', /\/admin\/games\?tab=folder&path=fb-old(#|$)/],
    ['/admin/games?view=folder', /\/admin\/games(\?|#|$)/], ['/admin/games#library/folder', /\/admin\/games(\?|#|$)/],
  ] as [string, RegExp][]) {
    await page.goto(old);
    await expect(page, old).toHaveURL(want);
    await expect(page.locator('#fb'), old).toBeVisible();
  }
  fs.rmSync(kept, { recursive: true, force: true });
  // An old /admin/files link lands on that folder's own 파일 tab, the games folder's when it names none.
  const files: [string, string][] = [
    ['/admin/files', '/admin/games?tab=folder'], ['/admin/files?tab=folder&path=fb-old', '/admin/games?tab=folder&path=fb-old'],
    ['/admin/files?root=retro', '/admin/retro?tab=folder'],
    ['/admin/files?root=homebrew', '/admin/homebrew?tab=folder'], ['/admin/files?root=patches', '/admin/patches?tab=folder'],
    ['/admin/files?root=saves', '/admin/saves?tab=folder'], ['/admin/files?root=incoming', '/admin/incoming#organize'],
  ];
  for (const [from, to] of files) {
    const res = await page.request.get(from, { maxRedirects: 0 });
    expect(res.status(), from).toBe(302);
    expect(res.headers().location, from).toBe(to);
  }
});

// Every library page has a "파일" tab: the file browser of its own folder, no root switcher, the crumb starting at the folder.
const FOLDER_PAGES: [string, string, string][] = [
  ['/admin/games', 'games', '#lib-subtabs [data-lsub="folder"]'], ['/admin/retro', 'retro', '#retro-subtabs [data-sub="folder"]'],
  ['/admin/homebrew', 'homebrew', '#homebrew-subtabs [data-sub="folder"]'], ['/admin/patches', 'patches', '#patches-subtabs [data-sub="folder"]'],
  ['/admin/saves', 'saves', '#saves-subtabs [data-sub="folder"]'],
];
const FOLDER_NAMES: Record<string, string> = { games: '게임', retro: '레트로 게임', homebrew: '홈브류', patches: '패치', saves: '세이브' };
for (const [path, root, tab] of FOLDER_PAGES) {
  test(`the ${root} page has a 파일 tab that lists its folder and keeps the place in the address`, async ({ page }) => {
    await signIn(page);
    const dir = { games: process.env.COOK_GAMES_DIR, retro: process.env.COOK_RETRO_DIR, homebrew: process.env.COOK_HOMEBREW_DIR, patches: process.env.COOK_PATCHES_DIR, saves: process.env.COOK_SAVES_DIR }[root];
    expect(dir, `${root} folder of the test server`).toBeTruthy();
    const name = `folder-tab-${root}.txt`;
    fs.mkdirSync(dir!, { recursive: true });
    fs.writeFileSync(`${dir}/${name}`, 'x');
    try {
      await page.goto(path);
      await page.locator(tab).click();
      await expect(page.locator(tab)).toHaveText('파일');
      await expect(page).toHaveURL(/tab=folder/);
      await expect(page.locator('#fb-rows tr', { hasText: name })).toBeVisible();
      await expect(page.locator('#fb-roots')).toHaveCount(0);
      await expect(page.locator('#fb-crumb li').first()).toHaveText(FOLDER_NAMES[root]);
      await page.reload();
      await expect(page.locator('#fb-rows tr', { hasText: name })).toBeVisible();
    } finally {
      fs.rmSync(`${dir}/${name}`, { force: true });
    }
  });
}

test('the sidebar holds its entries in the agreed order, and each entry opens its jobs as tabs over its pages', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin');
  const side = page.locator('aside.adm-side > nav');
  const hrefs = (loc: ReturnType<typeof page.locator>) => loc.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(await hrefs(side.locator('a.adm-item'))).toEqual(['/admin', '/admin/incoming', '/admin/games', '/admin/metadata/review', '/admin/users', '/admin/featured', '/admin/convert', '/admin/settings/server']);
  await expect(side.locator('a.adm-item[href="/admin/incoming"] [data-top]')).toHaveText('업로드');
  await expect(side.locator('a.adm-item[href="/admin/convert"] [data-top]')).toHaveText('시스템');
  await expect(side.locator('a.adm-item[href="/admin/metadata/review"] [data-top]')).toHaveText('메타데이터');
  const tabs: [string, string[]][] = [
    ['/admin/games', ['/admin/games', '/admin/retro', '/admin/homebrew', '/admin/patches', '/admin/saves', '/admin/trash']],
    ['/admin/metadata/review', ['/admin/metadata/review', '/admin/metadata/artwork', '/admin/metadata/titles']],
    ['/admin/users', ['/admin/users', '/admin/devices', '/admin/client']],
    ['/admin/convert', ['/admin/convert', '/admin/system/requirements', '/admin/logs/downloads', '/admin/logs/clients', '/admin/logs/security', '/admin/logs/alerts']],
    ['/admin/settings/server', ['/admin/settings/server', '/admin/settings/login', '/admin/settings/admin', '/admin/settings/notifications', '/admin/settings/integrations', '/admin/settings/plugins', '/admin/settings/automation']],
  ];
  for (const [path, want] of tabs) {
    await page.goto(path);
    expect(await hrefs(page.locator('main .adm-rowtabs a')), path).toEqual(want);
  }
  await expect(page.locator('main .adm-rowtabs a[href="/admin/settings/login"]')).toHaveText('구글 로그인');
  await expect(page.locator('main .adm-rowtabs a[href="/admin/settings/automation"]')).toHaveText('자동화 토큰');
  for (const alone of ['/admin/featured', '/admin/incoming']) {
    await page.goto(alone);
    await expect(page.locator('main .adm-rowtabs'), alone).toHaveCount(0);
  }
});

test('업로드 holds uploading, the temp share and the temp folder on one page, and the old addresses open their part', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/incoming');
  await expect(page.locator('#up-entry .up-entry-t')).toHaveText('업로드');
  await expect(page.locator('#adm-crumb')).toHaveText('업로드');
  await expect(page.locator('.inc-h')).toHaveText(['업로드', '임시 공유', '임시 폴더']);
  await expect(page.locator('#organize-subtabs [role="tab"]')).toHaveText(['파일', '정리']);
  for (const part of ['#up-drop', '#ib-list', '#fb-rows']) await expect(page.locator(part)).toBeAttached();
  await expect(page.locator('#tab-upload')).toBeVisible();
  await expect(page.locator('#tab-inbox')).toBeVisible();
  await expect(page.locator('#tab-organize')).toBeVisible();
  // An old address lands on the same page, scrolled to its part.
  await page.goto('/admin/inbox');
  await expect(page).toHaveURL(/\/admin\/incoming(\?[^#]*)?#inbox$/);
  await expect(page.locator('#inc-inbox .inc-h')).toBeInViewport();
  await page.goto('/admin/incoming/temp');
  await expect(page).toHaveURL(/\/admin\/incoming(\?[^#]*)?#organize/);
  await expect(page.locator('#inc-organize .inc-h')).toBeInViewport();
});

test('the client page stands alone and the games server tab moved to the server settings', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/client');
  await expect(page.locator('#cr-form')).toBeVisible();
  await expect(page.locator('#tab-overview')).toHaveCount(0);
  await page.goto('/admin/games');
  await expect(page.locator('#lib-subtabs [data-lsub="server"]')).toHaveCount(0);
  for (const from of ['/admin/games?view=server', '/admin/games#library/server']) {
    await page.goto(from);
    await expect(page.locator('#ss-list'), from).toBeVisible();
    expect(new URL(page.url()).pathname, from).toBe('/admin/settings/server');
  }
  await expect(page.locator('#ss-about-kv dt')).toHaveCount(3);
});

test('the account menu hugs its content on a desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page);
  await page.goto('/admin');
  await page.locator('#acct-btn').click();
  const box = await page.locator('#acct-list').boundingBox();
  expect(box!.width).toBeLessThanOrEqual(320);
  const swatches = await page.locator('.theme-pick [data-theme-pick]').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().left));
  const gaps = swatches.slice(1).map((x, i) => x - swatches[i]);
  expect(Math.max(...gaps)).toBeLessThanOrEqual(48);
});

test('addresses read plainly: this server, mapped v4, private ranges chipped, empty as a dash', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/users');
  const read = (ip: string | null) => page.evaluate((v) => { const n = ipNode(v); return { text: n.textContent, title: n.querySelector('.ip')?.getAttribute('title') ?? '', chip: !!n.querySelector('.ip-lan') }; }, ip);
  expect(await read('::1')).toMatchObject({ text: '이 서버', title: '::1', chip: false });
  expect(await read('127.0.0.1')).toMatchObject({ text: '이 서버', title: '127.0.0.1' });
  expect(await read('::ffff:192.0.2.7')).toMatchObject({ text: '192.0.2.7', title: '::ffff:192.0.2.7', chip: false });
  expect(await read('192.0.2.5')).toMatchObject({ text: '192.0.2.5', chip: false });
  expect(await read('2001:db8::1')).toMatchObject({ text: '2001:db8::1', chip: false });
  for (const lan of ['10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.20', '::ffff:10.0.0.4', 'fd00::5', 'fe80::1']) { // privacy-ok: private-range samples, not real hosts
    expect((await read(lan)).chip, lan).toBe(true);
    expect((await read(lan)).text, lan).toContain('내부망');
  }
  expect((await read('172.32.0.1')).chip).toBe(false);
  expect(await read('')).toMatchObject({ text: '—', chip: false });
});
