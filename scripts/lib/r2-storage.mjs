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

const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * What went wrong in a failed wrangler call: `detail` is the short reason for humans (the ERROR
 * lines and what follows them, else the last few lines) and `output` is everything, colour codes removed. Wrangler writes
 * its ERROR to stderr, *before* stdout in the combined text, so taking only the last lines of the
 * combined text loses it.
 */
export function describeWranglerFailure(error) {
  const output = `${error.stderr ?? ''}\n${error.stdout ?? ''}`.replace(ANSI, '');
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  // From the first ERROR line on (the real reason often follows it), without wrangler's log-file footer.
  const first = lines.findIndex((l) => /\bERROR\b/.test(l));
  const relevant = first >= 0 ? lines.slice(first, first + 5).filter((l) => !/Logs were written/.test(l)) : lines.slice(-6);
  return { detail: relevant.join('\n'), output };
}

/** Is this failure "the object isn't there" (as opposed to a real problem like a bad token or no network)? */
export function isMissingObjectError(error) {
  return /does not exist|no such key|NoSuchKey|10007|not found/i.test(error.output ?? error.message ?? '');
}

async function wrangler(args) {
  try {
    return await run(process.execPath, [wranglerBin, ...args], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const { detail, output } = describeWranglerFailure(error);
    const failure = new Error(`wrangler ${args.slice(0, 3).join(' ')} failed:\n${detail || error.message}`);
    failure.output = output;
    throw failure;
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
        if (isMissingObjectError(error)) return null;
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

/** Read/write access to any private bucket by name (used for the test-results bucket). */
export function createBucketStorage(bucketName) {
  return privateBucket(bucketName);
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
