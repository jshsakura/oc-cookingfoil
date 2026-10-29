import { spawn } from 'node:child_process';
import net from 'node:net';
import { laneEnv, SERVER_ENV, WORKERS } from './lanes.mjs';

const START_MS = 60_000;

const portFree = (port) => new Promise((resolve) => {
  const probe = net.createServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
  probe.listen(port, '127.0.0.1');
});

async function healthy(port, child) {
  for (const until = Date.now() + START_MS; Date.now() < until;) {
    if (child.exitCode !== null) throw new Error(`test server on ${port} exited with ${child.exitCode}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`test server on ${port} did not start in ${START_MS / 1000} s`);
}

// Playwright's global setup: one server per worker lane, each on empty folders (server.mjs). Returns the teardown.
export default async function startServers() {
  const children = [];
  const stop = () => { for (const child of children) child.kill('SIGTERM'); };
  try {
    await Promise.all(Array.from({ length: WORKERS }, async (_, lane) => {
      const env = laneEnv(lane);
      const port = Number(env.COOK_WEB_TEST_PORT);
      // A server already on the port is someone else's: fail rather than test against it.
      if (!(await portFree(port))) throw new Error(`port ${port} for lane ${lane} is taken`);
      const child = spawn(process.execPath, ['test/web/server.mjs'], {
        env: { ...process.env, ...SERVER_ENV, ...env, COOK_PORT: String(port) },
        stdio: ['ignore', 'ignore', 'inherit'],
      });
      children.push(child);
      await healthy(port, child);
    }));
  } catch (err) {
    stop();
    throw err;
  }
  return stop;
}
