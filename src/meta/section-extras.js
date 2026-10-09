// Small titledb fields the Switch client sorts its home rows by. Only sane
// values are emitted so the sections payload stays lean and trustworthy.
const MAX_PLAYERS = 64;

function positiveInt(value, max = Number.MAX_SAFE_INTEGER) {
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isInteger(n) && n > 0 && n <= max ? n : undefined;
}

/** `rank` is the eShop popularity rank (lower is more popular). */
export function sectionExtras(entry) {
  const extras = {};
  const rank = positiveInt(entry?.rank);
  if (rank) extras.rank = rank;
  const players = positiveInt(entry?.numberOfPlayers, MAX_PLAYERS);
  if (players) extras.players = players;
  return extras;
}
