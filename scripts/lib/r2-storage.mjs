// Real storage backend: Cloudflare R2 via the already-authenticated wrangler
// CLI (no API keys to manage), plus plain HTTPS for reading the public bucket. For
// many objects at once, createApiBucketStorage makes the same API requests itself
// with wrangler's login, instead of starting wrangler for each object.
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

// Deliberately matches the ANSI CSI escape sequence, to strip wrangler's color codes from its output before
// showing it to a person or writing it to a log.
// eslint-disable-next-line no-control-regex
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

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

/** wrangler's --json output, without anything it printed before it. */
const parseJsonOutput = (stdout) => JSON.parse(stdout.slice(stdout.indexOf('{')));

/**
 * The owner's Cloudflare credentials, as wrangler has them: its current token (`wrangler auth token`, which refreshes
 * an expired OAuth login) and the account (CLOUDFLARE_ACCOUNT_ID, else the login's only account, from `wrangler whoami`).
 * Two wrangler calls, at the same time.
 */
export async function wranglerCredentials() {
  const fromEnv = process.env.CLOUDFLARE_ACCOUNT_ID;
  const [auth, who] = await Promise.all([wrangler(['auth', 'token', '--json']), fromEnv ? null : wrangler(['whoami', '--json'])]);
  const { token } = parseJsonOutput(auth.stdout);
  if (!token) throw new Error('wrangler has no token: run `npx wrangler login`.');
  if (fromEnv) return { token, accountId: fromEnv };
  const { accounts = [] } = parseJsonOutput(who.stdout);
  if (accounts.length !== 1) throw new Error(`The wrangler login has ${accounts.length} accounts: set CLOUDFLARE_ACCOUNT_ID to choose one.`);
  return { token, accountId: accounts[0].id };
}

/**
 * A private bucket through Cloudflare's R2 API directly (the same requests `wrangler r2 object …` makes), for work that
 * touches many objects at once — the Admin page's Remove Results. Each wrangler call is a new process that takes about
 * a second to start; a request here takes a fraction of that. The credentials are asked of wrangler once
 * (`credentials`), and again only when Cloudflare refuses them (401: an OAuth token expired). When they can't be had at
 * all, every call goes through wrangler as before (`fallback`). Same interface as privateBucket.
 */
export function createApiBucketStorage(bucket, { credentials = wranglerCredentials, fetchImpl = fetch, fallback = privateBucket(bucket), log = () => {} } = {}) {
  let pending = null;
  const credentialsNow = (fresh = false) => {
    if (!pending || fresh) {
      pending = credentials().catch((error) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
  const objectUrl = (accountId, key) => `${CLOUDFLARE_API}/accounts/${accountId}/r2/buckets/${bucket}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;

  /** The API's answer, or null when there are no credentials (the call then goes through wrangler). */
  async function request(method, key, { headers = {}, body } = {}) {
    let creds;
    try {
      creds = await credentialsNow();
    } catch (error) {
      log(`R2 API unavailable (${error.message}); using wrangler`);
      return null;
    }
    for (let retried = false; ; retried = true) {
      const response = await fetchImpl(objectUrl(creds.accountId, key), { method, body, headers: { ...headers, Authorization: `Bearer ${creds.token}` } });
      if (response.status !== 401 || retried) return response;
      creds = await credentialsNow(true); // the token expired: wrangler refreshes it
    }
  }
  const failure = async (what, key, response) => {
    const said = await response.text().catch(() => '');
    return new Error(`R2 ${what} ${bucket}/${key} failed: ${response.status} ${response.statusText}${said ? ` — ${said.slice(0, 300)}` : ''}`);
  };

  return {
    /** Gets the credentials ready ahead of the first real call (e.g. while runs are being chosen); never fails. */
    warm() {
      credentialsNow().catch(() => {});
    },
    async put(key, file, contentType, cacheControl) {
      const response = await request('PUT', key, { body: await readFile(file), headers: { 'content-type': contentType, 'cache-control': cacheControl, 'cf-r2-data-catalog-check': 'true' } });
      if (!response) return fallback.put(key, file, contentType, cacheControl);
      if (!response.ok) throw await failure('put', key, response);
    },
    /** Downloads an object; null when it doesn't exist. */
    async get(key) {
      const response = await request('GET', key);
      if (!response) return fallback.get(key);
      if (response.status === 404) return null;
      if (!response.ok) throw await failure('get', key, response);
      return Buffer.from(await response.arrayBuffer());
    },
    /** Deletes an object; one that isn't there is already deleted. */
    async delete(key) {
      const response = await request('DELETE', key, { headers: { 'cf-r2-data-catalog-check': 'true' } });
      if (!response) return fallback.delete(key);
      if (!response.ok && response.status !== 404) throw await failure('delete', key, response);
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
      /** Downloads an object from the web bucket (through wrangler, so it is never a stale copy from a cache); null when missing. */
      get: web.get,
      delete: web.delete,
      /** Is the object served publicly? A network failure throws (never reads as "missing"). */
      async exists(key) {
        let response;
        try {
          response = await fetch(`${baseUrl}/${key}`, { method: 'HEAD' });
        } catch (error) {
          throw new Error(`Could not reach ${baseUrl} (offline?): ${error.message}`, { cause: error });
        }
        return response.ok;
      },
    },
  };
}
