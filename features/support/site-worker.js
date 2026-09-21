import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const PRODUCTION_DIR = join(ROOT, 'dist-prod');
let built = false;

/** Builds the site the way `npm run deploy` does (no snapshot), once, into dist-prod/. */
export function buildProduction() {
  if (built) return;
  execSync('npx astro build --outDir dist-prod', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, PHOTOS_SNAPSHOT: '' } });
  built = true;
}

/**
 * Runs the real, production-built site (`npm run build`, no snapshot: home, category and Admin pages are rendered
 * when requested) in the real Workers runtime (workerd, via `wrangler dev`), over a local copy of the web bucket
 * holding `objects` (a Map of key -> string or Buffer). Returns { base, put(key, body), remove(key), stop }.
 * `put` and `remove` change the bucket while the site is running, the way the photo tools do in production.
 */
export async function startSite({ objects = new Map(), cacheSeconds = 0 } = {}) {
  buildProduction();
  const config = join(PRODUCTION_DIR, 'server/wrangler.json');
  const dir = mkdtempSync(join(tmpdir(), 'site-workerd-'));
  const persist = { path: join(dir, 'v3') };
  const seed = await getPlatformProxy({ configPath: config, persist });
  for (const [key, body] of objects) await seed.env.WEB.put(key, body);
  await seed.dispose();

  const port = await freePort();
  const args = ['dev', '-c', config, '--local', '--persist-to', dir, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(await freePort()), '--var', `MANIFEST_CACHE_SECONDS:${cacheSeconds}`];
  const child = spawn(process.execPath, [join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd: ROOT, stdio: process.env.SITE_DEBUG ? 'inherit' : 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    child.kill('SIGTERM');
    rmSync(dir, { recursive: true, force: true });
  };
  // The bucket, changed from outside the running site with wrangler's own local R2 commands (same storage folder).
  const wrangler = (...more) =>
    new Promise((resolve, reject) => {
      const run = spawn(process.execPath, [join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), ...more, '-c', config, '--local', '--persist-to', dir], { cwd: ROOT, stdio: 'pipe', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
      let output = '';
      run.stdout.on('data', (chunk) => (output += chunk));
      run.stderr.on('data', (chunk) => (output += chunk));
      run.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler ${more.slice(0, 3).join(' ')} failed:\n${output}`))));
    });
  const put = async (key, body) => {
    const file = join(dir, 'upload');
    writeFileSync(file, body);
    await wrangler('r2', 'object', 'put', `photography-site-web/${key}`, '--file', file);
  };
  const remove = (key) => wrangler('r2', 'object', 'delete', `photography-site-web/${key}`);
  for (let i = 0; i < 240; i++) {
    if (await fetch(`${base}/about/`).then((r) => r.ok, () => false)) {
      return { base, put, remove, stop };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stop();
  throw new Error('the site did not start in the local Workers runtime');
}
