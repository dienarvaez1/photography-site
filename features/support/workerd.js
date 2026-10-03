import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { ROOT } from './lib.js';

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

/**
 * The results Worker's own wrangler.jsonc, minus its Workers AI binding: wrangler opens a remote session for that binding
 * when it starts, which needs a Cloudflare login, and CI has none (issue #21). These scenarios only read the R2 buckets,
 * never translate. Written into the scenario's temporary folder, with `main` pointing back at the real code.
 */
function localConfig(dir) {
  const source = readFileSync(join(ROOT, 'workers/results-api/wrangler.jsonc'), 'utf-8');
  const local = source.replace(/^\s*"ai"\s*:\s*\{[^}]*\},?\s*$\n/m, '').replace('"main": "src/index.mjs"', `"main": ${JSON.stringify(join(ROOT, 'workers/results-api/src/index.mjs'))}`);
  if (local.includes('"ai"') || !local.includes(join(ROOT, 'workers/results-api/src/index.mjs'))) throw new Error('could not make a local copy of the results Worker config');
  const file = join(dir, 'wrangler.jsonc');
  writeFileSync(file, local);
  return file;
}

/**
 * Runs the results Worker in the real Workers runtime (workerd, via `wrangler dev`) over local R2 buckets
 * seeded from `seed` = { RESULTS: Map(key -> { body }), ORIGINALS: Map(key -> { body }) }.
 * Returns { base, stop }.
 */
export async function startWorker({ token, origins, seed, siteEnv }) {
  const dir = mkdtempSync(join(tmpdir(), 'results-workerd-'));
  const config = localConfig(dir);
  // The same local R2 simulation `wrangler dev` uses, filled with what the fakes hold.
  const proxy = await getPlatformProxy({ configPath: config, persist: { path: join(dir, 'v3') } });
  for (const [binding, objects] of Object.entries(seed)) for (const [key, object] of objects) await proxy.env[binding].put(key, object.body);
  await proxy.dispose();

  const port = await freePort();
  const args = ['dev', '-c', config, '--local', '--persist-to', dir, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(await freePort()), '--var', `ADMIN_TOKEN:${token}`, '--var', `ALLOWED_ORIGINS:${origins}`, ...(siteEnv ? ['--var', `SITE_ENV:${siteEnv}`] : [])];
  const child = spawn(process.execPath, [join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), ...args], { stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  const base = `http://127.0.0.1:${port}`;
  const stop = () => {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  };
  for (let i = 0; i < 200; i++) {
    if (await fetch(`${base}/health`).then((r) => r.ok, () => false)) return { base, stop };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stop();
  throw new Error('the Worker did not start in the local Workers runtime');
}
