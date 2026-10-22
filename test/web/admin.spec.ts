import { test, expect, type Page } from '@playwright/test';
import { signIn as adminSignIn } from './admin-sign-in';
import fs from 'node:fs';
import { acceptAsks } from './ask';
import { removeAccount } from './web-session';
import { reveal } from './fold';

const NAME = 'e2e-user';
const PASSWORD = 'e2e-password-123';
const basic = (user: string, pass: string) => ({ Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') });

let adminCookie = '';

async function signIn(page: Page) {
  adminCookie = await adminSignIn(page);
}

test('an account created in the admin page signs in at /login, a password alone opens no API; removing it reopens the server', async ({ page, request }) => {
  await acceptAsks(page);
  await signIn(page);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-overview.png' });

  await page.getByRole('link', { name: '계정·기기' }).click();
  await page.getByLabel('사용자 이름').fill(NAME);
  await page.getByLabel('비밀번호', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '사용자 추가', exact: true }).click();

  const dialog = page.locator('#cred-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(PASSWORD);
  await page.screenshot({ path: 'out/web/admin-credential.png' });
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();

  for (const password of ['wrong-password', PASSWORD]) {
    const r = await request.get('/api/shop/sections', { headers: basic(NAME, password) });
    expect(r.status()).toBe(401);
    expect(r.headers()['www-authenticate']).toBeUndefined();
  }

  // With an account the web needs a session: the page is sent to /login (no
  // password popup) and comes back to the admin page after signing in.
  await page.waitForURL(/\/login\?next=/);
  expect((await request.get('/', { headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' }, maxRedirects: 0 })).headers()['www-authenticate']).toBeUndefined();
  await page.getByLabel(/^(아이디|Username)$/).fill(NAME);
  await page.getByLabel(/^(비밀번호|Password)$/).fill(PASSWORD);
  await page.screenshot({ path: 'out/web/login.png' });
  await page.getByRole('button', { name: /^(로그인|Sign in)$/ }).click();
  await expect(page.getByRole('heading', { name: 'CookingFoil 서버 관리', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '계정·기기' }).click();
  const row = page.locator('#users .ag-row', { hasText: NAME });
  await expect(row).toContainText('사용 중');
  await page.screenshot({ path: 'out/web/admin-users.png' });
  await row.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.locator('#users')).toContainText('아직 사용자가 없습니다');
  expect((await request.get('/api/shop/sections')).status()).toBe(200);
});

// Whatever happened above, leave the server without accounts for the other specs.
test.afterEach(async ({ request }) => {
  await removeAccount(request, NAME, PASSWORD, adminCookie);
});

test('library tab shows the catalog state and starts a rescan', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: '파일·정리', exact: true }).click();
  await page.getByRole('tab', { name: '서버' }).click();
  await expect(page.locator('#settings')).toContainText('버전');
  const rescan = page.getByRole('button', { name: '다시 스캔', exact: true });
  await rescan.click();
  await expect(page.locator('#toast')).toContainText('다시 스캔을 시작했습니다');
  // Pressed once, it stays pressed until the read ends, then says how long it took.
  await expect(rescan).toBeDisabled();
  await expect(page.locator('#toast')).toContainText('다시 스캔을 마쳤습니다', { timeout: 15000 });
  await expect(rescan).toBeEnabled();
  await expect(page.locator('#scan-status')).toBeVisible();
  await expect(page.locator('#scan-status')).toContainText('마지막으로 전부 읽은 때는');
});

test('a featured row picked in the admin page reaches the sections list by base id', async ({ page, request }) => {
  await signIn(page);
  await page.getByRole('link', { name: '파일·정리', exact: true }).click();
  await page.getByRole('link', { name: '홈 추천' }).click();
  await page.getByRole('button', { name: '추천 줄 추가', exact: true }).click();
  await page.getByLabel('줄 제목').fill('이번 주 추천');
  await page.getByLabel('추가할 게임').fill('Test Game · 0100000000010000');
  await page.getByRole('button', { name: '게임 추가', exact: true }).click();
  await expect(page.locator('#f-list .fgames')).toContainText('Test Game');
  await page.getByRole('button', { name: /^저장/ }).click();
  await expect(page.locator('#toast')).toContainText('추천을 저장했습니다');
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-featured.png' });

  await expect.poll(async () => (await (await request.get('/api/shop/sections')).json()).featured?.[0]?.title_ids)
    .toEqual(['0100000000010000']);
  await request.put('/admin/api/featured', { data: { collections: [] }, headers: { Cookie: adminCookie, Origin: new URL(page.url()).origin } });
});

test('admin API refuses changes without a session', async ({ request }) => {
  const response = await request.post('/admin/api/users', { data: { name: 'intruder' } });
  expect(response.status()).toBe(401);
});

test('files dropped into the upload box pick their own kind and go in one by one', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/admin#upload');
  await expect(page.locator('#up-form')).toBeHidden();
  // Before any file the places are on show: the Switch kinds, then every retro console as its own tile.
  await expect(page.locator('#up-hint')).toContainText('올릴 곳을 먼저 고릅니다');
  const consoles = page.locator('#up-systems [data-kind="retro"]');
  await expect(consoles.first()).toBeVisible();
  const first = consoles.first();
  const system = await first.getAttribute('data-system');
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#up-system')).toHaveValue(system!);
  await expect(page.locator('#up-hint')).toContainText('레트로 · ');
  // The other consoles fold away until "다른 기종" brings them back.
  await expect(consoles.nth(1)).toBeHidden();
  await page.locator('#up-systems .up-more-sys').click();
  await expect(consoles.nth(1)).toBeVisible();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  // A file that looks like something else keeps the picked place and says so.
  await page.locator('#up-file').setInputFiles({ name: 'Other [0100000000040000][v0].nsp', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#up-hint')).toContainText('고른 곳과 다른 종류');
  await expect(page.locator('#up-required-l')).toBeHidden();
  await page.screenshot({ path: 'out/web/admin-upload-retro.png' });
  await page.getByRole('button', { name: '다시 고르기' }).click();
  await expect(consoles.first()).toHaveAttribute('aria-pressed', 'false');
  await expect(consoles.nth(1)).toBeVisible();
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-upload-empty.png', fullPage: true });

  // A patch folder names its game; the form fills itself in.
  const dir = fs.mkdtempSync('/tmp/cf-up-');
  fs.mkdirSync(`${dir}/KoPatch/atmosphere/contents/0100000000010800/romfs`, { recursive: true });
  fs.writeFileSync(`${dir}/KoPatch/atmosphere/contents/0100000000010800/romfs/text.bin`, 'KO');
  await page.locator('#up-dir').setInputFiles(`${dir}/KoPatch`);
  await expect(page.locator('#up-kinds [data-kind="patch"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#up-game')).toHaveValue('Test Game [0100000000010000]');
  await expect(page.locator('#up-name')).toHaveValue('KoPatch');
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-upload-patch.png', fullPage: true });
  await page.getByRole('button', { name: '다시 고르기' }).click();
  await expect(page.locator('#up-form')).toBeHidden();

  // Several packages at once go up one after another.
  const names = ['E2E Up A [0100000000020000][v0].nsp', 'E2E Up B [0100000000030000][v0].nsp'];
  await page.locator('#up-file').setInputFiles(names.map((name) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from('x') })));
  await expect(page.locator('#up-kinds [data-kind="game"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#up-hint')).toContainText('2개를 하나씩');
  try {
    await page.getByRole('button', { name: '올리기', exact: true }).click();
    await expect(page.locator('#up-log .note:not(.warn)')).toHaveCount(2);
    await expect(page.locator('#up-form')).toBeHidden();
  } finally {
    for (const name of names) fs.rmSync(`/tmp/cookingfoil-web-test-games/${name}`, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    // Later specs count the library's games: wait until the two uploads have left it (other specs may add their own meanwhile).
    await request.post('/admin/api/library/rescan', { headers: { Cookie: adminCookie }, data: {} });
    await expect.poll(async () => (await (await request.get('/admin/api/library/files?q=E2E%20Up', { headers: { Cookie: adminCookie } })).json()).matched, { timeout: 15000 }).toBe(0);
  }
});

test('the admin writes a game description that the title detail shows instead of titledb', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/admin#library/info');
  await page.locator('#gd-game').fill('Test Game [0100000000010000]');
  await page.locator('#gd-game').dispatchEvent('change');
  await expect(page.locator('#gd-body')).toBeVisible();
  await page.locator('#gd-notes-ko').fill('게임 데이터 패치를 함께 설치해야 실행됩니다.');
  await page.locator('#gd-ko').fill('필수 패치와 함께 설치합니다.\n약 49GB 가 필요합니다.');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#gd-original')).toHaveText('직접 쓴 소개를 보여 주고 있습니다.');
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#gd-form').screenshot({ path: 'out/web/admin-description.png' });
  const detail = await (await request.get('/api/title/0100000000010000?lang=ko')).json();
  expect(detail.description).toBe('필수 패치와 함께 설치합니다.\n약 49GB 가 필요합니다.');
  expect(detail.notes).toBe('게임 데이터 패치를 함께 설치해야 실행됩니다.');
  await acceptAsks(page);
  await page.getByRole('button', { name: '소개를 titledb 것으로 되돌리기' }).click();
  await expect(page.locator('#gd-original')).not.toHaveText('직접 쓴 소개를 보여 주고 있습니다.');
  await expect(page.locator('#gd-notes-ko')).toHaveValue('게임 데이터 패치를 함께 설치해야 실행됩니다.');
  // The web detail shows the notes above the description.
  await page.goto('/');
  await page.locator('.game').first().click();
  await expect(page.locator('#modal-notes-text')).toHaveText('게임 데이터 패치를 함께 설치해야 실행됩니다.');
  await request.post('/admin/api/descriptions/0100000000010000/reset', { headers: { Cookie: adminCookie }, data: {} });
});

test('a patch is switched between required and optional from the patch list and from its game', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/admin#library/patches');
  const required = async (name: string) =>
    ((await (await request.get('/api/patches')).json()).patches as { name: string; required: boolean }[]).find((p) => p.name === name)?.required;
  const group = page.locator('#lib-patches .pt-game', { hasText: '0100000000010000' });
  await expect(group.locator('.pt-row')).toHaveCount(2);
  // The game's icon heads its group (the test server has none, so its tile stays empty).
  await expect(group.locator('header img.pt-ico')).toHaveCount(1);
  const data = group.getByRole('switch', { name: '게임 데이터 필수' });
  await expect(data).toHaveAttribute('aria-checked', 'true');
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#lib-patches').screenshot({ path: 'out/web/admin-patches.png' });

  await data.click();
  await expect(data).toHaveAttribute('aria-checked', 'false');
  await expect(data).toHaveText('비필수');
  expect(await required('게임 데이터')).toBe(false);

  await page.locator('#pt-q').fill('한글');
  await expect(page.locator('#lib-patches .pt-row')).toHaveCount(1);
  await page.locator('#pt-q').fill('');
  await page.locator('#pt-only').click();
  await expect(page.locator('#lib-patches')).toContainText('찾는 패치가 없습니다.');
  await page.locator('#pt-only').click();

  // The game editor lists the same game's patches with the same switch.
  await page.getByRole('tab', { name: '이름과 소개' }).click();
  await page.locator('#gd-game').fill('Test Game [0100000000010000]');
  await page.locator('#gd-game').dispatchEvent('change');
  const inGame = page.locator('#gd-patches').getByRole('switch', { name: '게임 데이터 필수' });
  await expect(inGame).toHaveAttribute('aria-checked', 'false');
  await inGame.click();
  await expect(inGame).toHaveAttribute('aria-checked', 'true');
  await page.locator('#gd-patches').screenshot({ path: 'out/web/admin-game-patches.png' });
  await page.getByRole('tab', { name: '패치' }).click();
  await expect(data).toHaveAttribute('aria-checked', 'true');
  expect(await required('게임 데이터')).toBe(true);
});

test('an uploaded patch and save are edited, moved to another game and deleted from the library tab', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/admin#library/patches');
  const patches = async (lang: string) => (await (await request.get(`/api/patches?lang=${lang}`)).json()).patches as { name: string; title_id: string; description: string | null }[];
  const row = page.locator('#lib-patches .pt-row', { hasText: '한글패치' });
  await row.getByRole('button', { name: '한글패치 편집' }).click();
  const dialog = page.locator('#ct-edit');
  await expect(dialog).toBeVisible();
  await page.locator('#ct-name').fill('Korean patch');
  await page.locator('#ct-name-ko').fill('한글패치');
  await page.locator('#ct-desc').fill('Turns the text Korean.');
  await page.locator('#ct-desc-ko').fill('글자를 한국어로 변경합니다.');
  await page.locator('#ct-author').fill('누군가');
  fs.mkdirSync('out/web', { recursive: true });
  await dialog.screenshot({ path: 'out/web/admin-content-edit.png' });
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await patches('ko')).find((p) => p.name === '한글패치')?.description).toBe('글자를 한국어로 변경합니다.');
  expect((await patches('en')).find((p) => p.description === 'Turns the text Korean.')?.name).toBe('Korean patch');

  await acceptAsks(page);
  await page.locator('#lib-patches .pt-row', { hasText: 'Korean patch' }).getByRole('button', { name: 'Korean patch 편집' }).click();
  await page.locator('#ct-move').fill('0100000000020000');
  await page.locator('#ct-move-go').click();
  await expect(page.locator('#lib-patches .pt-game', { hasText: '0100000000020000' })).toContainText('Korean patch');
  expect((await patches('en')).find((p) => p.name === 'Korean patch')?.title_id).toBe('0100000000020000');

  await page.locator('#lib-patches .pt-row', { hasText: 'Korean patch' }).getByRole('button', { name: 'Korean patch 편집' }).click();
  await page.locator('#ct-remove').click();
  await expect(page.locator('#lib-patches')).not.toContainText('Korean patch');
  expect((await patches('en')).some((p) => p.name === 'Korean patch')).toBe(false);

  await page.getByRole('tab', { name: '세이브' }).click();
  const save = page.locator('#lib-saves .pt-row', { hasText: 'All unlocked' });
  await save.getByRole('button', { name: 'All unlocked 편집' }).click();
  await page.locator('#ct-name-ko').fill('전부 열림');
  await page.locator('#ct-save-type').selectOption('device');
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(save).toContainText('전부 열림 · 기기 공용');
  const saves = (await (await request.get('/api/saves?lang=ko')).json()).saves as { name: string; saveType: string }[];
  expect(saves.find((s) => s.name === '전부 열림')?.saveType).toBe('device');
});

test("a homebrew app's patch is edited from the homebrew tab with the patch dialog", async ({ page, request }) => {
  await signIn(page);
  await page.goto('/admin#homebrew');
  const patch = async (lang: string) => ((await (await request.get(`/api/patches?lang=${lang}`)).json()).patches as
    { homebrew: string | null; name: string; description: string | null; version: string | null }[]).find((p) => p.homebrew === 'handapp');
  await expect.poll(async () => (await patch('en'))?.name).toBe('Turbo mod');
  const row = page.locator('#hb-apps .src-card', { hasText: 'Hand App' });
  await row.getByRole('button', { name: 'Turbo mod 편집' }).click();
  const dialog = page.locator('#ct-edit');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#ct-where')).toContainText('switch/handapp/');
  // Only the text: a homebrew patch has no update to pick and is moved or deleted from its row.
  await expect(page.locator('#ct-update')).toBeHidden();
  await expect(page.locator('#ct-move')).toBeHidden();
  await expect(page.locator('#ct-remove')).toBeHidden();
  await page.locator('#ct-name').fill('Turbo');
  await page.locator('#ct-desc').fill('Doubles the speed.');
  await page.locator('#ct-desc-ko').fill('속도를 두 배로 올립니다.');
  await page.locator('#ct-version').fill('1.1');
  fs.mkdirSync('out/web', { recursive: true });
  await dialog.screenshot({ path: 'out/web/admin-homebrew-patch-edit.png' });
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('Turbo · ');
  expect(await patch('en')).toMatchObject({ name: 'Turbo', description: 'Doubles the speed.', version: '1.1' });
  expect((await patch('ko'))?.description).toBe('속도를 두 배로 올립니다.');
  // A game patch opened afterwards gets its full dialog back.
  await page.goto('/admin#library/patches');
  await page.locator('#lib-patches .pt-row', { hasText: '게임 데이터' }).getByRole('button', { name: '게임 데이터 편집' }).click();
  await expect(page.locator('#ct-update')).toBeVisible();
  await expect(page.locator('#ct-remove')).toBeVisible();
});

test('a homebrew app is turned off and on from the homebrew tab, which opens on the apps', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/admin#homebrew');
  const listed = async () => ((await (await request.get('/api/homebrew')).json()).homebrew as { file_name: string }[]).map((e) => e.file_name);
  await expect.poll(listed).toContain('handapp.nro');
  const row = page.locator('#hb-apps .src-card', { hasText: 'Hand App' });
  await expect(row.getByRole('button', { name: 'GitHub 연결' })).toBeVisible();
  // The apps open first; the GitHub form leads the followed repositories.
  await expect(page.getByRole('tab', { name: '앱', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-sub-panel="sources"]')).toBeHidden();
  await row.getByLabel('Hand App 켜기').locator('xpath=..').click();
  await expect(row).toHaveClass(/hb-off/);
  expect(await listed()).not.toContain('handapp.nro');
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#hb-apps').screenshot({ path: 'out/web/admin-homebrew-apps.png' });
  await row.getByLabel('Hand App 켜기').locator('xpath=..').click();
  await expect(row).not.toHaveClass(/hb-off/);
  expect(await listed()).toContain('handapp.nro');
});

test('a game file is found by name and deleted from the library tab', async ({ page, request }) => {
  const file = '/tmp/cookingfoil-web-test-games/Throwaway [0100000000030000][v0].nsp';
  fs.writeFileSync(file, '');
  await signIn(page);
  await request.post('/admin/api/library/rescan', { headers: { Cookie: adminCookie }, data: {} });
  await page.goto('/admin#library');
  // The one file browser finds it across every kind, with the type filter on 전체.
  await expect(page.locator('#lb-tab-all')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    await page.locator('#lb-q').fill('');
    await page.locator('#lb-q').fill('Throwaway');
    return page.locator('#lb-list .ag-row', { hasText: 'Throwaway' }).count();
  }, { timeout: 15000 }).toBe(1);
  await acceptAsks(page);
  await page.locator('#lb-list .ag-row', { hasText: 'Throwaway' }).getByRole('button', { name: /삭제$/ }).click();
  await expect(page.locator('#toast')).toContainText('삭제했습니다');
  expect(fs.existsSync(file)).toBe(false);
  await expect.poll(async () => (await (await request.get('/admin/api/library', { headers: { Cookie: adminCookie } })).json()).files, { timeout: 15000 }).toBe(1);
});

test('a game is renamed from the game editor and every list shows the new name', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/admin#library/info');
  await page.locator('#gd-game').fill('Test Game [0100000000010000]');
  await page.locator('#gd-game').dispatchEvent('change');
  await page.locator('#gd-name-ko').fill('고친 이름');
  await page.locator('#gd-name-en').fill('Fixed Name');
  await page.locator('#gd-form').getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#gd-name-original')).toContainText('직접 정한 이름을 보여 주고 있습니다.');
  expect((await (await request.get('/api/title/0100000000010000?lang=ko')).json()).name).toBe('고친 이름');
  await expect.poll(async () => JSON.stringify(await (await request.get('/api/shop/sections')).json()), { timeout: 15000 }).toContain('고친 이름 (Fixed Name)');
  await page.locator('#gd-name-ko').fill('');
  await page.locator('#gd-name-en').fill('');
  await page.locator('#gd-form').getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#gd-name-original')).toContainText('비워 두면');
  expect((await (await request.get('/api/title/0100000000010000?lang=ko')).json()).name).not.toBe('고친 이름');
});

test('the admin password is set, changed and removed on the settings tab, and opens the admin page', async ({ page, browser }) => {
  await acceptAsks(page);
  await signIn(page);
  await page.goto('/admin#settings/security');
  await expect(page.locator('#ap-status')).toContainText('아직 관리자 비밀번호가 없습니다');
  await page.locator('#ap-new').fill('first-password-123');
  await page.locator('#ap-new2').fill('first-password-123');
  await page.getByRole('button', { name: '비밀번호 정하기' }).click();
  await expect(page.locator('#ap-status')).toContainText('여기서 정한 비밀번호가 있습니다');

  // A fresh browser gets in with the password instead of a code.
  const other = await browser.newPage();
  await other.goto('/admin?enrolled=1');
  await other.getByRole('button', { name: '관리자 비밀번호', exact: true }).click();
  await other.getByLabel('관리자 비밀번호').fill('first-password-123');
  await other.getByRole('button', { name: '들어가기', exact: true }).click();
  await expect(other.getByRole('heading', { name: 'CookingFoil 서버 관리', exact: true })).toBeVisible();
  await other.close();

  await page.locator('#ap-current').fill('wrong-password-000');
  await page.locator('#ap-new').fill('second-password-456');
  await page.locator('#ap-new2').fill('second-password-456');
  await page.getByRole('button', { name: '비밀번호 정하기' }).click();
  await expect(page.locator('#toast')).toContainText('지금 비밀번호가 맞지 않습니다');
  await page.locator('#ap-current').fill('first-password-123');
  await page.getByRole('button', { name: '비밀번호 정하기' }).click();
  await expect(page.locator('#toast')).toContainText('관리자 비밀번호를 정했습니다');

  await page.locator('#ap-current').fill('second-password-456');
  await page.getByRole('button', { name: '여기서 정한 비밀번호 삭제' }).click();
  await expect(page.locator('#ap-status')).toContainText('아직 관리자 비밀번호가 없습니다');
});

test('server behaviour is switched on the settings tab, applies at once and goes back to compose', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/admin#settings');
  const features = async () => (await (await request.get('/api/shop/info')).json()).features as string[];
  expect(await features()).toContain('device-pairing');
  // One group shows at a time, the first one to begin with.
  await expect(page.locator('#ss-jump').getByRole('tab', { name: '기기 연결' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ss-row[data-key="langPriority"]')).toBeHidden();
  const row = await reveal(page.locator('.ss-row[data-key="devicePairing"]'));
  await expect(row.getByRole('button', { name: 'compose 값으로' })).toHaveCount(0);
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#ss-list').screenshot({ path: 'out/web/admin-server-settings.png' });

  await row.locator('.ss-switch').click();
  await expect(row).toContainText('여기서 정한 값입니다. compose 값은 켜짐 입니다.');
  expect(await features()).not.toContain('device-pairing');

  const approval = page.locator('.ss-row[data-key="deviceApproval"] select');
  await approval.selectOption('manual');
  await expect(page.locator('.ss-row[data-key="deviceApproval"]')).toContainText('여기서 정한 값입니다');

  const lang = await reveal(page.locator('.ss-row[data-key="langPriority"] input'));
  await lang.fill('ko;bad');
  await lang.press('Enter');
  await expect(page.locator('#toast')).toContainText('이름 언어 순서 값이 맞지 않습니다');

  // The titledb address: a fork or mirror is set here, and cleared back to blawar/titledb.
  const source = await reveal(page.locator('.ss-row[data-key="titledbSource"]'));
  await source.locator('input').fill('https://raw.githubusercontent.com/someone/titledb/master');
  await source.locator('input').press('Enter');
  await expect(source).toContainText('여기서 정한 값입니다');
  await source.locator('input').fill('not a url');
  await source.locator('input').press('Enter');
  await expect(page.locator('#toast')).toContainText('다운로드 주소 값이 맞지 않습니다');
  await source.getByRole('button', { name: 'compose 값으로' }).click();
  await expect(source.locator('.ss-src')).toHaveCount(0);

  await (await reveal(row)).getByRole('button', { name: 'compose 값으로' }).click();
  await expect(row.locator('.ss-src')).toHaveCount(0);
  await page.locator('.ss-row[data-key="deviceApproval"]').getByRole('button', { name: 'compose 값으로' }).click();
  await expect(page.locator('.ss-row[data-key="deviceApproval"] .ss-src')).toHaveCount(0);
  expect(await features()).toContain('device-pairing');
});

test('the settings tab syncs every folder and makes a backup with one press each, and keeps their schedules', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#settings');
  const sync = await reveal(page.locator('.ss-row').filter({ hasText: '지금 동기화' }));
  await sync.getByRole('button', { name: '지금 동기화' }).click();
  await expect(page.locator('#toast')).toContainText('모든 폴더를 다시 읽고 있습니다');
  await expect(sync).toContainText('마지막으로 다 읽은 때', { timeout: 15000 });
  await expect(sync).toContainText('게임, 홈브류, 세이브, 패치, 레트로');

  const backup = page.locator('.ss-row').filter({ hasText: '지금 백업' });
  await backup.getByRole('button', { name: '지금 백업' }).click();
  await expect(page.locator('#toast')).toContainText('백업을 만들었습니다');
  await expect(backup).toContainText('백업 1개를 두고 있습니다');

  const days = page.locator('.ss-row[data-key="backupDays"] select');
  await days.selectOption('30');
  await expect(page.locator('.ss-row[data-key="backupDays"]')).toContainText('여기서 정한 값입니다. compose 값은 14일 (기본) 입니다.');
  await page.locator('.ss-row[data-key="backupDays"]').getByRole('button', { name: 'compose 값으로' }).click();
  await page.locator('.ss-row[data-key="syncHours"] select').selectOption('0');
  await expect(page.locator('.ss-row[data-key="syncHours"]')).toContainText('여기서 정한 값입니다');
  await page.locator('.ss-row[data-key="syncHours"]').getByRole('button', { name: 'compose 값으로' }).click();
  await expect(page.locator('.ss-row[data-key="syncHours"] .ss-src')).toHaveCount(0);
});

test('the automation token copy row stays out of sight until a token is made', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#settings/tokens');
  await expect(page.locator('#tok-form')).toBeVisible();
  await expect(page.locator('#tok-new')).toBeHidden();
});

test('the operator guide reads as a page, and its raw text stays for helpers', async ({ page, request }) => {
  await signIn(page);
  await page.goto('/admin/guide');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('CookingFoil 운영 안내');
  await expect(page.locator('table').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('## ');
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-guide.png' });
  const raw = await request.get('/admin/guide.md', { headers: { Cookie: adminCookie } });
  expect(await raw.text()).toContain('# CookingFoil 운영 안내');
});

test('the header has one account circle that opens the account, the web page, the guide and sign out', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('#acct-list')).toBeHidden();
  await page.locator('#acct-btn').click();
  await expect(page.locator('#who')).not.toHaveText('불러오고 있습니다');
  await expect(page.locator('#acct-list').getByRole('menuitem', { name: '운영 안내' })).toHaveAttribute('href', '/admin/guide');
  await expect(page.locator('#acct-list').getByRole('menuitem', { name: '로그아웃' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#acct-list')).toBeHidden();
  await page.goto('/admin#overview');
  await expect(page.locator('#shop-url')).toHaveText(/^https?:\/\/[^/]+$/);
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-overview-connect.png' });
});

test('the admin account menu switches the theme and the web page keeps it too', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page);
  await page.locator('#acct-btn').click();
  const dark = page.locator('#acct-list').getByRole('menuitemcheckbox', { name: '어두운 테마' });
  await expect(dark).toHaveAttribute('aria-checked', 'true');
  await dark.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(dark).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(242, 241, 238)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f2f1ee');
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-theme-menu.png' });
  await page.evaluate(() => localStorage.setItem('cookingfoil:lang', 'ko'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#acct-btn').click();
  await expect(page.locator('#acct-list').getByRole('menuitemcheckbox', { name: '어두운 테마' })).toHaveAttribute('aria-checked', 'false');
});

test('the alerts tab sets up Telegram, picks events and shows what was told', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#alerts');
  await expect(page.locator('#al-status strong')).toHaveText('꺼져 있습니다');
  const boxes = page.locator('#al-events input');
  await expect(boxes).toHaveCount(9);
  await expect(page.locator('#al-events .al-event', { hasText: '위험한 접근' }).locator('input')).toBeChecked();
  await expect(page.locator('#al-events .al-event', { hasText: '보안 감시' }).locator('input')).toBeChecked();
  await expect(page.locator('#al-events .al-event', { hasText: '서버 시작' }).locator('input')).toBeChecked();
  await expect(page.locator('#al-history')).toContainText('아직 알림이 없습니다');

  // Only the chat and the events: still off without a token, and the choice is kept.
  await page.locator('#al-form [name="chatId"]').fill('915733248');
  await page.locator('#al-events .al-event', { hasText: '서버 시작' }).click();
  await page.locator('#al-events .al-event', { hasText: '구글 계정' }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#al-form [name="chatId"]')).toHaveValue('915733248');
  await expect(page.locator('#al-events .al-event', { hasText: '서버 시작' }).locator('input')).not.toBeChecked();
  await expect(page.locator('#al-events .al-event', { hasText: '구글 계정' }).locator('input')).not.toBeChecked();
  await page.getByRole('button', { name: '시험 메시지 보내기' }).click();
  await expect(page.locator('#al-msg')).toHaveText('봇 토큰과 채팅 ID 를 먼저 넣습니다');
  fs.mkdirSync('out/web', { recursive: true });
  await page.screenshot({ path: 'out/web/admin-alerts.png', fullPage: true });
  // Every tab fits the desktop bar without scrolling.
  expect(await page.locator('nav.tabs').evaluate((n) => n.scrollWidth - n.clientWidth)).toBe(0);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.screenshot({ path: 'out/web/admin-alerts-phone.png' });

  // The question is asked in the page's own dialog; cancelling keeps what is saved.
  await page.removeLocatorHandler(page.locator('#ask-dialog'));
  const chat = await page.locator('#al-form [name="chatId"]').inputValue();
  await page.getByRole('button', { name: '삭제' }).click();
  const ask = page.getByRole('dialog', { name: /저장한 알림 설정을 삭제할까요/ });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole('button', { name: '취소' })).toBeFocused();
  await page.screenshot({ path: 'out/web/admin-ask.png' });
  await ask.getByRole('button', { name: '취소' }).click();
  await expect(ask).toBeHidden();
  await expect(page.locator('#al-form [name="chatId"]')).toHaveValue(chat);
  await page.getByRole('button', { name: '삭제' }).click();
  await ask.getByRole('button', { name: '확인' }).click();
  await expect(page.locator('#al-form [name="chatId"]')).toHaveValue('');
});

test('the overview says where game names come from', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#overview');
  await expect(page.locator('#health .pill').first()).toContainText('게임 이름');
  await expect(page.locator('#health')).toContainText('titledb');
  await expect(page.locator('#health')).toContainText('NSP/XCI 추출');
  fs.mkdirSync('out/web', { recursive: true });
  await page.locator('#tab-overview').screenshot({ path: 'out/web/admin-overview-health.png' });
});

test('the settings tab shows one area at a time, opens the one in the address and keeps it on reload', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#settings');
  await expect(page.locator('#ss-list')).toBeVisible();
  await expect(page.locator('#tok-form')).toBeHidden();
  await expect(page.locator('#ap-form')).toBeHidden();
  await page.locator('#set-subtabs [data-ssub="tokens"]').click();
  await expect(page.locator('#tok-form')).toBeVisible();
  await expect(page.locator('#ss-list')).toBeHidden();
  expect(page.url()).toContain('#settings/tokens');
  await page.reload();
  await expect(page.locator('#tok-form')).toBeVisible();
  await expect(page.locator('#set-subtabs [data-ssub="tokens"]')).toHaveAttribute('aria-selected', 'true');
  await page.goto('/admin#settings/security');
  await expect(page.locator('#ap-form')).toBeVisible();
  await expect(page.locator('#ap-status')).not.toHaveText('불러오고 있습니다');
  await page.screenshot({ path: 'out/web/admin-settings-tabs.png' });
});

test('the devices tab shows one area at a time, and the address opens a given one', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#devices/approved');
  await expect(page.locator('[data-sub-panel="approved"]')).toBeVisible();
  await expect(page.locator('#approve-code')).toBeHidden();
  await page.getByRole('tab', { name: '승인 대기' }).click();
  await expect(page.locator('#approve-code')).toBeVisible();
  await expect(page).toHaveURL(/#devices\/pending$/);
});

test('an approved console gets a 관리자 기기 switch, off until the admin turns it on', async ({ page, request }) => {
  const KEY = 'E7'.repeat(32);
  await signIn(page);
  const origin = { Origin: new URL(page.url()).origin };
  const pending = await (await request.get('/api/pair/status', { headers: { 'X-Device-Key': KEY } })).json();
  expect((await page.request.post('/admin/api/devices/approve', { data: { code: pending.pairCode, label: '관리 콘솔' }, headers: origin })).status()).toBe(200);
  const flag = async () => (await (await page.request.get('/admin/api/devices')).json()).approved.find((d: { deviceKey: string }) => d.deviceKey === KEY)?.admin;
  try {
    // A new load: the list was read when the page opened, before the approval.
    await page.goto('/admin#devices/approved');
    await page.reload();
    const sw = page.getByRole('checkbox', { name: '관리 콘솔 관리자 기기' });
    await expect(sw).not.toBeChecked();
    await sw.check({ force: true });
    await expect(page.locator('#toast')).toContainText('관리 콘솔 에서 항목 설정을 바꿀 수 있습니다.');
    await expect.poll(flag).toBe(true);
    await page.getByRole('checkbox', { name: '관리 콘솔 관리자 기기' }).uncheck({ force: true });
    await expect(page.locator('#toast')).toContainText('관리 콘솔 은(는) 다시 읽기만 합니다.');
    await expect.poll(flag).toBe(false);
  } finally {
    await page.request.post('/admin/api/devices/revoke', { data: { deviceKey: KEY }, headers: origin });
  }
});

test('server behaviour shows one group at a time and keeps the one picked after a reload', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin#settings/server');
  await page.locator('#ss-jump').getByRole('tab', { name: '다운로드' }).click();
  await expect(page.locator('.ss-row[data-key="devicePairing"]')).toBeHidden();
  await expect(page.locator('#ss-list .ss-group:not([hidden])')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#ss-jump').getByRole('tab', { name: '다운로드' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ss-row[data-key="devicePairing"]')).toBeHidden();
});
