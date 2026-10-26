/**
 * Runs plugin code so that it cannot take the server with it, and knows which plugin a stray error
 * came from.
 *
 * runInPlugin(id, fn, { timeoutMs }) -> { ok: true, value } | { ok: false, error, timedOut }
 *   Never rejects. fn gets an AbortSignal that fires at the timeout; the plugin may ignore it, in
 *   which case its work is abandoned (JavaScript cannot stop it) and counted as a failure.
 *   Everything fn starts, awaited or not, carries the plugin id in AsyncLocalStorage.
 *
 * createProcessGuards(...) wires process-level handlers that use that id:
 *   unhandledRejection from a plugin  -> onPluginRejection(id, err), the server goes on
 *   uncaughtException from a plugin   -> writeCrash(id, err), then the process exits as it would
 *                                        have (the next start keeps that plugin off)
 *   anything else                     -> logged and the process exits, as Node does without a handler;
 *                                        the boot mark is cleared first, so the next start does not blame
 *                                        a plugin that was merely starting when the core fell over
 *
 * Attribution is by where the work started, not by whose bug it is: AsyncLocalStorage also tags a core
 * promise that rejects inside a plugin's context (the core's own function the plugin called, awaited
 * from plugin code). Such a rejection switches that plugin off. That is the price of not being able to
 * tell the two apart, and the safe side of it: the server goes on and the operator sees which plugin.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage();

/** The id of the plugin whose code is running right now, or null. */
export const currentPluginId = () => als.getStore()?.id ?? null;

export class PluginTimeout extends Error {
  constructor(id, ms) {
    super(`plugin ${id} did not finish in ${ms} ms`);
    this.name = "PluginTimeout";
  }
}

export async function runInPlugin(id, fn, { timeoutMs }) {
  const abort = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new PluginTimeout(id, timeoutMs));
    }, timeoutMs);
    timer.unref?.();
  });
  const work = als.run({ id }, async () => fn(abort.signal));
  try {
    return { ok: true, value: await Promise.race([work, timeout]) };
  } catch (error) {
    return { ok: false, error, timedOut: error instanceof PluginTimeout };
  } finally {
    clearTimeout(timer);
  }
}

/** The first line of an error, which is all the admin page and the log keep. */
export function firstLine(err) {
  const text = err instanceof Error ? (err.stack || err.message) : String(err);
  return text.split("\n").find((l) => l.trim())?.trim().slice(0, 300) ?? "";
}

export function createProcessGuards({ onPluginRejection, writeCrash, clearBooting = () => {}, log = (m) => process.stderr.write(`${m}\n`), exit = (code) => process.exit(code) }) {
  const fatal = (err, { blamed = false } = {}) => {
    if (!blamed) {
      try { clearBooting(); } catch { /* the exit goes on */ }
    }
    log(err instanceof Error ? (err.stack || err.message) : String(err));
    exit(1);
  };
  const handleRejection = (reason) => {
    const id = currentPluginId();
    if (!id) return fatal(reason);
    try { onPluginRejection(id, reason); } catch (err) { log(`plugin guard: ${err.message}`); }
  };
  const handleException = (err) => {
    const id = currentPluginId();
    if (id) {
      try { writeCrash(id, err); } catch (e) { log(`plugin guard: crash mark failed: ${e.message}`); }
      return fatal(err, { blamed: true });
    }
    fatal(err);
  };
  return {
    handleRejection,
    handleException,
    install() {
      process.on("unhandledRejection", handleRejection);
      process.on("uncaughtException", handleException);
      return () => {
        process.off("unhandledRejection", handleRejection);
        process.off("uncaughtException", handleException);
      };
    },
  };
}
