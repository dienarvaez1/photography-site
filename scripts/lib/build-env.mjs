// Guards a release build against shipping contact forms without their Web3Forms keys.
//
// Without a key, Astro renders a "not configured" notice instead of the form. That already
// happened repeatedly: Cloudflare's Git build has no .env, so it deployed keyless pages over
// a good local deploy. This check makes such a build FAIL instead, so the good version stays live.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRED_KEYS = ['PUBLIC_WEB3FORMS_KEY', 'PUBLIC_WEB3FORMS_KEY_ES'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Variables as Vite sees them: the process environment wins over the .env file. */
export function loadEnv(root, env = process.env) {
  const file = join(root, '.env');
  const fromFile = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf-8').split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) fromFile[match[1]] = match[2].trim();
    }
  }
  return { ...fromFile, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== '')) };
}

/**
 * Is this a release build? Cloudflare's Git build (WORKERS_CI / CF_PAGES), any CI, or an
 * explicit `--require` (used by `npm run deploy`). Plain local `npm run build` is not,
 * so working without keys locally still shows the fallback notice.
 */
export function isReleaseBuild(env, argv = []) {
  return argv.includes('--require') || Boolean(env.WORKERS_CI || env.CF_PAGES || env.CI);
}

/** Problems with the contact-form keys, as human-readable lines (empty = fine). */
export function keyProblems(env) {
  const problems = [];
  for (const name of REQUIRED_KEYS) {
    const value = env[name];
    if (!value) problems.push(`${name} is not set`);
    else if (!UUID.test(value)) problems.push(`${name} does not look like a Web3Forms access key (a UUID)`);
  }
  const [en, es] = REQUIRED_KEYS.map((name) => env[name]);
  if (en && es && en === es) problems.push('PUBLIC_WEB3FORMS_KEY and PUBLIC_WEB3FORMS_KEY_ES are identical; each language needs its own form');
  return problems;
}

/** The whole decision: { ok, skipped, problems } for an environment and argument list. */
export function checkBuildEnv(env, argv = []) {
  if (!isReleaseBuild(env, argv)) return { ok: true, skipped: true, problems: [] };
  const problems = keyProblems(env);
  return { ok: problems.length === 0, skipped: false, problems };
}
