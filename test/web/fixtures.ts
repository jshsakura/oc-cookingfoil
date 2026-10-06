import { Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const games = [
  ['0100E5E01C098000', 'Darkest Dungeon II', 2, 1],
  ['01002FC00412C000', 'Little Nightmares', 3, 0],
  ['01003D90058FC000', 'CrossCode', 1, 1],
  ['01008D100DE46000', 'Cyber Shadow', 0, 1],
  ['01009440164AE000', 'Hunt the Night', 0, 0],
  ['01005FD017E60000', 'Warhammer 40,000: Boltgun', 1, 1],
  ['0100B5301A180000', 'Grim Guardians: Demon Purge', 0, 0],
  ['0100B99019412000', '마리오 vs. 동키콩', 0, 1],
  ['0100E46006708000', 'Terraria', 0, 1],
  ['01000EA014150000', 'FINAL FANTASY', 0, 0],
  ['01007CF00D5BA000', 'Devil May Cry 2', 0, 0],
  ['0100522014E10000', 'ISLANDERS', 0, 1],
  ['0100001019F6E000', 'Horizon Chase 2', 4, 1],
];
export const items = games.flatMap(([id, name, dlc, update], index) => {
  const base = { title_id: id, base_title_id: id, name, publisher: index ? 'CookingFoil' : 'Red Hook Studios Inc.', size: 4100000000, url: '/fixture-files/' + id + '.nsz', icon_url: '/fixture-icons/' + id + '.jpg', app_type: 'base', app_version: 0, added_at: 2000000000 - index, languages: ['ko', 'en'] };
  const files: any[] = [base];
  if (update) files.push({ ...base, url: '/fixture-files/' + id + '-update.nsz', app_type: 'update', app_version: 131072, size: 1300000000 });
  for (let i = 0; i < Number(dlc); ++i) files.push({ ...base, title_id: String(id).slice(0, -3) + String(i + 1).padStart(3, '0'), url: '/fixture-files/' + id + '-dlc' + i + '.nsp', name: index ? 'Additional content ' + (i + 1) : i ? 'Inhuman Bondage' : 'The Binding Blade', app_type: 'dlc', size: i ? 900000000 : 1300000000 });
  return files;
});
export async function catalogFixture(page: Page, metadata = true) {
  await page.route('**/api/shop/sections', (route) => route.fulfill({ json: { sections: [{ id: 'all', items: metadata ? items : items.map(({ languages, added_at, ...item }) => item) }] } }));
  await page.route('**/api/title/*', (route) => route.fulfill({ json: { description: '역마차를 이끌고 세상을 무너뜨린 근원이 있는 산으로 향하는 로그라이트 RPG입니다. 여정마다 파티를 새로 꾸리고, 영웅들 사이의 관계가 전투를 바꿉니다.', publisher: 'Red Hook Studios Inc.', screenshots: [] } }));
  await page.route('**/api/title/*/extras', (route) => route.fulfill({ json: { extras: [] } }));
  await page.route('**/api/art/*', (route) => route.fulfill({ json: { icon: false, banner: false, screens: [] } }));
  await page.route('**/api/uploads', (route) => route.fulfill({ json: { uploads: [] } }));
  await page.route('**/fixture-icons/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    const dir = process.env.COOKINGFOIL_REFERENCE_ICONS;
    if (dir && fs.existsSync(path.join(dir, name))) return route.fulfill({ path: path.join(dir, name), contentType: 'image/jpeg' });
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#FFC23D"/><rect x="50" y="70" width="156" height="110" rx="20" fill="#16161A"/><circle cx="96" cy="128" r="12" fill="white"/><circle cx="164" cy="128" r="12" fill="white"/></svg>' });
  });
}
