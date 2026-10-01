// npm run access:geo-backfill [-- --dry-run]
// Adds `geo` to the production access log's entries that don't have it yet (see scripts/lib/access-geo.mjs): looks
// each such address up once with ipinfo.io, and writes each day's file back only if no visit was added to it meanwhile.
// It reaches the real bucket through a remote R2 binding (your wrangler login), so it can write conditionally.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { ACCESS_BUCKET } from '../src/config/access-log.ts';
import { backfill, lookUp } from './lib/access-geo.mjs';

const dryRun = process.argv.includes('--dry-run');
const dir = mkdtempSync(join(tmpdir(), 'access-geo-'));
const config = join(dir, 'wrangler.json');
writeFileSync(config, JSON.stringify({ name: 'access-geo-backfill', compatibility_date: '2026-09-17', r2_buckets: [{ binding: 'ACCESS', bucket_name: ACCESS_BUCKET, remote: true }] }));

const proxy = await getPlatformProxy({ configPath: config, remoteBindings: true });
try {
  const { days, lookedUp, placed } = await backfill(proxy.env.ACCESS, { lookup: (ip) => lookUp(ip), dryRun });
  for (const d of days) {
    const action = d.written ? 'written' : dryRun && d.added ? 'would write' : 'unchanged';
    console.log(`${d.day}: ${d.entries} entries, ${d.added} given geo, ${d.unplaced} unplaced (${action})`);
  }
  console.log(`${lookedUp} addresses looked up with ipinfo.io, ${placed} placed.${dryRun ? ' Dry run: nothing written.' : ''}`);
} finally {
  await proxy.dispose();
  rmSync(dir, { recursive: true, force: true });
}
