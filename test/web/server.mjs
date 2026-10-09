import fs from 'node:fs';
fs.mkdirSync(process.env.COOK_GAMES_DIR, { recursive: true });
// Accounts left behind by an interrupted admin spec would put every later run behind a password.
fs.rmSync(`${process.env.COOK_DATA_DIR}/security/users.json`, { force: true });
fs.rmSync(`${process.env.COOK_DATA_DIR}/featured.json`, { force: true });
// One base game so the featured picker has something to offer.
fs.writeFileSync(`${process.env.COOK_GAMES_DIR}/Test Game [0100000000010000][v0].nsp`, '');
await import('../../src/index.js');
