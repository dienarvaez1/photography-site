#!/usr/bin/env node
// Smoke-checks a running site (default: the production URL). See lib/smoke.mjs.
//   npm run smoke                       check production once
//   npm run smoke -- --wait             retry for up to 2 minutes (edge propagation after a deploy)
//   npm run smoke -- https://host       check another URL
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/config/site.ts';
import { loadEnv } from './lib/build-env.mjs';
import { runSmoke } from './lib/smoke.mjs';

const args = process.argv.slice(2);
const baseUrl = (args.find((a) => /^https?:\/\//.test(a)) ?? SITE.url).replace(/\/$/, '');
const wait = args.includes('--wait');
const timeoutSeconds = Number(args[args.indexOf('--timeout') + 1]) || 120;

// If the keys are known (a local deploy), each form must use exactly its configured key.
const env = loadEnv(fileURLToPath(new URL('..', import.meta.url)));
const expectedKeys = { en: env.PUBLIC_WEB3FORMS_KEY, es: env.PUBLIC_WEB3FORMS_KEY_ES };

const deadline = Date.now() + timeoutSeconds * 1000;
let attempt = 0;
console.log(`Smoke check: ${baseUrl}`);
for (;;) {
  attempt += 1;
  const { ok, checks } = await runSmoke({ baseUrl, expectedKeys });
  if (ok) {
    for (const c of checks) console.log(`✓ ${c.name}`);
    console.log(`\n✓ ${checks.length} checks passed${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
    break;
  }
  if (!wait || Date.now() > deadline) {
    for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : ` — ${c.detail}`}`);
    console.error(`\n✗ ${checks.filter((c) => !c.ok).length} of ${checks.length} checks failed`);
    console.error('If this is right after a deploy, Cloudflare\'s Git build may have replaced it: check the build variables.');
    process.exit(1);
  }
  console.log(`  not ready yet (${checks.filter((c) => !c.ok).length} failing); retrying in 10s…`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
