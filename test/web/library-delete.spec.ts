import { test, expect, type Page } from '@playwright/test';
import { signIn } from './admin-sign-in';


const row = (kind: string, extra: Record<string, unknown>) => ({
  name: `Sample ${kind}`, kind, rel: `${kind}/sample`, size: 1024, mtime: 1700000000, ext: '', titleId: null, version: null,
  integrity: null, id: null, source: null, repo: null, ...extra,
});

// Each kind deletes through its own endpoint, after a confirmation, and the list loads again.
const cases: [string, Record<string, unknown>, string, Record<string, unknown>][] = [
  ['homebrew', { id: 'hand-app', source: 'manual' }, '/admin/api/homebrew/manual/remove', { id: 'hand-app' }],
  ['homebrew', { id: 'gh-app', source: 'github', repo: 'example/tool' }, '/admin/api/homebrew/remove', { repo: 'example/tool' }],
  ['homebrew', { rel: 'tools/loose.nro' }, '/admin/api/library/files/remove', { rel: 'tools/loose.nro' }],
  ['patch', { id: 'patch-1' }, '/admin/api/content/patch/remove', { id: 'patch-1' }],
  ['save', { id: 'save-1' }, '/admin/api/content/save/remove', { id: 'save-1' }],
  ['other', { rel: 'notes/a.txt' }, '/admin/api/library/other/remove', { rel: 'notes/a.txt' }],
  ['base', { rel: 'A/Game [0100000000010000][v0].nsp', integrity: 'ok' }, '/admin/api/library/files/remove', { rel: 'A/Game [0100000000010000][v0].nsp' }],
];

for (const [kind, extra, endpoint, body] of cases) {
  test(`the library list deletes a ${kind} item (${endpoint})`, async ({ page }) => {
    const counts = { base: 0, update: 0, dlc: 0, patch: 0, save: 0, homebrew: 0, other: 0 };
    await page.route('**/admin/api/library/browse?*', (route) => {
      const asked = new URL(route.request().url()).searchParams.get('kind') ?? 'base';
      const items = asked === kind ? [row(kind, extra)] : [];
      route.fulfill({ json: { items, total: items.length, page: 1, perPage: 50, pages: 1, sort: 'name', order: 'asc', counts } });
    });
    let sent: unknown = null;
    await page.route(`**${endpoint}`, (route) => { sent = route.request().postDataJSON(); route.fulfill({ json: { ok: true } }); });
    await signIn(page);
    await page.goto('/admin#library');
    // The list opens on 전체; each kind is picked from the type filter.
    await page.locator(`#lb-tab-${kind}`).click();
    await page.getByRole('button', { name: `Sample ${kind} 삭제` }).click();
    await page.locator('#ask-ok').click();
    await expect.poll(() => sent).toEqual(body);
    await expect(page.locator('#toast')).toContainText('삭제했습니다');
  });
}
