// An approved console for a server under test: written into its security
// database before it starts, and the headers that console sends on each request.
import { seedRecords } from "./security-db.js";
import { hashAccessKey } from "../../src/security/pairing.js";

export const CONSOLE_KEY = "AB".repeat(32);
const ACCESS_KEY = "test-console-access-key";

/** The headers of the console seedConsole approves. */
export const CONSOLE = Object.freeze({ "X-Device-Key": CONSOLE_KEY, "X-Access-Key": ACCESS_KEY });

/** Approves the test console in `dataDir` (approved by `addedBy`); call before the server starts. */
export async function seedConsole(dataDir, { addedBy = "alice" } = {}) {
  await seedRecords(dataDir, "device", {
    [CONSOLE_KEY]: { label: "test console", addedAt: 1, addedBy, accessKeyHash: hashAccessKey(ACCESS_KEY) },
  });
  return CONSOLE;
}
