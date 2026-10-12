/** Title ids as patch pages write them. Only base games count: updates end in 800, DLC in 1000+. */
const ID_RE = /\b0100[0-9a-f]{12}\b/gi;

/** Every base title id in a page, upper-cased, in first-seen order. Pure. */
export function baseIdsIn(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(ID_RE)) {
    const tid = m[0].toUpperCase();
    if ((BigInt(`0x${tid}`) & 0x1fffn) === 0n && !out.includes(tid)) out.push(tid);
  }
  return out;
}
