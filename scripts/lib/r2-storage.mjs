// Real storage backend: Cloudflare R2 via the already-authenticated wrangler
// CLI (no API keys to manage), plus plain HTTPS for reading the public bucket.
// R2 has no "list" in wrangler, so nothing here lists — the .md files are the
// source of truth for which objects should exist.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PHOTOS_BASE_URL, PHOTO_BUCKETS } from '../../src/config/photos.ts';

const run = promisify(execFile);
// Run the project's own wrangler with the current Node (faster than npx, and no PATH assumptions).
const wranglerBin = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url));

async function wrangler(args) {
  try {
    return await run(process.execPath, [wranglerBin, ...args], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const detail = `${error.stderr ?? ''}${error.stdout ?? ''}`.trim().split('\n').slice(-6).join('\n');
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed:\n${detail || error.message}`);
  }
}

function privateBucket(bucket) {
  const target = (key) => `${bucket}/${key}`;
  return {
    async put(key, file, contentType, cacheControl) {
      await wrangler(['r2', 'object', 'put', target(key), '--file', file, '--content-type', contentType, '--cache-control', cacheControl, '--remote']);
    },
    /** Downloads an object; null when it doesn't exist. */
    async get(key) {
      const dir = await mkdtemp(join(tmpdir(), 'r2get-'));
      const out = join(dir, 'object');
      try {
        await wrangler(['r2', 'object', 'get', target(key), '--file', out, '--remote']);
        return await readFile(out);
      } catch (error) {
        if (/does not exist|not found|10007|NoSuchKey/i.test(error.message)) return null;
        throw error;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    async delete(key) {
      await wrangler(['r2', 'object', 'delete', target(key), '--remote']);
    },
  };
}

export function createR2Storage({ baseUrl = PHOTOS_BASE_URL } = {}) {
  const web = privateBucket(PHOTO_BUCKETS.web);
  return {
    originals: privateBucket(PHOTO_BUCKETS.originals),
    web: {
      put: web.put,
      delete: web.delete,
      /** Is the object served publicly? A network failure throws (never reads as "missing"). */
      async exists(key) {
        let response;
        try {
          response = await fetch(`${baseUrl}/${key}`, { method: 'HEAD' });
        } catch (error) {
          throw new Error(`Could not reach ${baseUrl} (offline?): ${error.message}`);
        }
        return response.ok;
      },
    },
  };
}
