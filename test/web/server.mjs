import fs from 'node:fs';
fs.mkdirSync(process.env.COOK_GAMES_DIR, { recursive: true });
// Accounts left behind by an interrupted admin spec would put every later run behind a password.
fs.rmSync(`${process.env.COOK_DATA_DIR}/security/users.json`, { force: true });
await import('../../src/index.js');
