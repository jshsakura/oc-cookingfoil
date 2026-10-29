/**
 * A number that moves whenever something the retro index shows changes in the server's memory:
 * an admin's name, a patch record, a ROM or content hash, an achievements record. The index is
 * rebuilt when it moved, so an unchanged library is not rebuilt per request. Hand edits to the
 * JSON stores are seen through their file stamps instead (routes/retro.js indexStamp).
 */
let revision = 0;

export const bump = () => { revision++; };
export const current = () => revision;
