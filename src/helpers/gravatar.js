/**
 * The Gravatar picture of a Google account, for the account button. The browser
 * loads it from gravatar.com with the SHA-256 of the email (Gravatar's own
 * scheme); d=404 means no picture comes back when there is none, so the page
 * keeps its plain icon.
 */
import crypto from "crypto";

export function gravatarUrl(email, size = 80) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  const hash = crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return `https://gravatar.com/avatar/${hash}?s=${size}&d=404`;
}
