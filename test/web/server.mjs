import fs from 'node:fs';
fs.mkdirSync(process.env.COOK_GAMES_DIR, { recursive: true });
// Accounts left behind by an interrupted admin spec would put every later run behind a password.
fs.rmSync(`${process.env.COOK_DATA_DIR}/security/users.json`, { force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/featured.json`, { force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/game-descriptions.json`, { force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/security/server-settings.json`, { force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/security/admin-password.json`, { force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/inbox`, { recursive: true, force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/backups`, { recursive: true, force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/nsz-queue.json`, { force: true });
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
// A homebrew app's patch with no patch.json, for the homebrew tab's edit dialog.
fs.mkdirSync(`${process.env.COOK_PATCHES_DIR}/homebrew/handapp/Turbo mod`, { recursive: true });
fs.writeFileSync(`${process.env.COOK_PATCHES_DIR}/homebrew/handapp/Turbo mod/config.ini`, 'speed=2');
// The patch information store: imported again from the patch.json files above.
fs.rmSync(`${process.env.COOK_DATA_DIR}/patches`, { recursive: true, force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/patches-cache.json`, { force: true });
// One save for that game, for the admin's edit dialog.
process.env.COOK_SAVES_DIR ??= '/tmp/cookingfoil-web-test-saves';
fs.rmSync(process.env.COOK_SAVES_DIR, { recursive: true, force: true });
fs.mkdirSync(`${process.env.COOK_SAVES_DIR}/0100000000010000/All unlocked`, { recursive: true });
fs.writeFileSync(`${process.env.COOK_SAVES_DIR}/0100000000010000/All unlocked/save.dat`, 'x');
// One hand-placed homebrew app, for the homebrew tab's on/off switch.
process.env.COOK_HOMEBREW_DIR ??= '/tmp/cookingfoil-web-test-homebrew';
fs.rmSync(process.env.COOK_HOMEBREW_DIR, { recursive: true, force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/homebrew/disabled.json`, { force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/homebrew/media`, { recursive: true, force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/homebrew/media.json`, { force: true });
fs.mkdirSync(`${process.env.COOK_HOMEBREW_DIR}/handapp`, { recursive: true });
{
  // The smallest .nro the server reads: header, asset header and a control block naming the app.
  const head = Buffer.alloc(0x100); head.write('NRO0', 0x10); head.writeUInt32LE(0x100, 0x18);
  const aset = Buffer.alloc(0x38); aset.write('ASET', 0); aset.writeBigUInt64LE(0x38n, 0x18); aset.writeBigUInt64LE(0x4000n, 0x20);
  const nacp = Buffer.alloc(0x4000); nacp.write('Hand App', 0); nacp.write('someone', 0x200); nacp.write('1.0', 0x3060);
  fs.writeFileSync(`${process.env.COOK_HOMEBREW_DIR}/handapp/handapp.nro`, Buffer.concat([head, aset, nacp]));
}
// A retro folder with two versions of one game and an arcade parent with its clone.
process.env.COOK_RETRO_DIR ??= '/tmp/cookingfoil-web-test-retro';
fs.rmSync(process.env.COOK_RETRO_DIR, { recursive: true, force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/retro-variants.json`, { force: true });
for (const rel of ['roms/md/더 슈퍼 시노비 2 (Super Shinobi II, The) [J-K v20130609].zip', 'roms/md/더 슈퍼 시노비 2 (Super Shinobi II, The) [Japan, Korea].zip',
  'roms/arcade/gunbird.zip', 'roms/arcade/gunbirdj.zip']) {
  fs.mkdirSync(`${process.env.COOK_RETRO_DIR}/${rel.slice(0, rel.lastIndexOf('/'))}`, { recursive: true });
  fs.writeFileSync(`${process.env.COOK_RETRO_DIR}/${rel}`, 'x');
}
// What the retro metadata loop would have collected for the official release.
fs.mkdirSync(process.env.COOK_DATA_DIR, { recursive: true });
fs.writeFileSync(`${process.env.COOK_DATA_DIR}/retro-meta.json`, JSON.stringify({ version: 1, builtAt: Date.now(), games: {
  'md/더 슈퍼 시노비 2 (Super Shinobi II, The) [Japan, Korea]': {
    source: 'launchbox', description: { en: 'Joe Musashi returns to rescue his bride.' },
    publisher: 'Sega', developer: 'Sega', releaseDate: 19900000, numberOfPlayers: 1, genres: ['Action'],
  },
} }));
await import('../../src/index.js');
