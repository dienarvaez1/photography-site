import { BeforeAll } from '@cucumber/cucumber';
import { execSync } from 'node:child_process';
import { ROOT } from './lib.js';

// Build once before the whole suite runs, so every scenario tests the exact
// static output the site would deploy — the same thing a real visitor (or
// Cloudflare) would receive. This intentionally does not mock or stub
// anything: a broken build fails every "site pages" scenario immediately,
// which is itself a meaningful, correct test result.
BeforeAll({ timeout: 60_000 }, () => {
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });
});
