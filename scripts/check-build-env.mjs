#!/usr/bin/env node
// Runs before `npm run build` (npm's "prebuild" hook) and before deploys. See lib/build-env.mjs.
import { fileURLToPath } from 'node:url';
import { checkBuildEnv, loadEnv } from './lib/build-env.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const result = checkBuildEnv(loadEnv(root), argv);

if (!result.ok) {
  console.error('✗ Refusing to build: the contact forms would ship without their Web3Forms keys.\n');
  for (const problem of result.problems) console.error(`  - ${problem}`);
  console.error(`
Set both variables where this build runs:
  • Cloudflare:  Workers & Pages → photography-site → Settings → Builds → Variables and secrets
  • Locally:     in .env (see .env.example)
The keys are public (they appear in the page HTML), so a plain variable is fine.`);
  process.exit(1);
}
if (!result.skipped) console.log('✓ Contact-form keys present for a release build');
