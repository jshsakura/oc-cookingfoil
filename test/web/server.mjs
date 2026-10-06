import fs from 'node:fs';
fs.mkdirSync(process.env.COOK_GAMES_DIR, { recursive: true });
await import('../../src/index.js');
