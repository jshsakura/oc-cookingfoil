/**
 * Imported first by the server: without COOK_SECRET_KEY nothing that keeps a
 * secret on disk can run (security/secret-box.js), so the server stops here
 * with the reason instead of failing later in some request.
 */
import dotenv from "dotenv";
import { assertKey } from "./secret-box.js";

// This runs before helpers/envs.js loads .env, so a key kept there would be missed.
dotenv.config({ path: "./.env", quiet: true });

try {
  assertKey();
} catch (err) {
  process.stderr.write(`[oc-cookingfoil] ${err.message}\n`);
  process.exit(1);
}
