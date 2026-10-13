import fs from 'node:fs';
fs.mkdirSync(process.env.COOK_GAMES_DIR, { recursive: true });
// Accounts left behind by an interrupted admin spec would put every later run behind a password.
fs.rmSync(`${process.env.COOK_DATA_DIR}/security/users.json`, { force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/featured.json`, { force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/game-descriptions.json`, { force: true });
// One base game so the featured picker has something to offer.
fs.writeFileSync(`${process.env.COOK_GAMES_DIR}/Test Game [0100000000010000][v0].nsp`, '');
// Two patches for that game, one marked required, for the admin's patch switches.
process.env.COOK_PATCHES_DIR ??= '/tmp/cookingfoil-web-test-patches';
fs.rmSync(process.env.COOK_PATCHES_DIR, { recursive: true, force: true });
for (const [name, meta] of [['게임 데이터', { name: '게임 데이터', required: true }], ['한글패치', { name: '한글패치' }]]) {
  const dir = `${process.env.COOK_PATCHES_DIR}/0100000000010000/${name}`;
  fs.mkdirSync(`${dir}/atmosphere/contents/0100000000010000/romfs`, { recursive: true });
  fs.writeFileSync(`${dir}/atmosphere/contents/0100000000010000/romfs/data.bin`, 'x');
  fs.writeFileSync(`${dir}/patch.json`, JSON.stringify(meta));
}
await import('../../src/index.js');
