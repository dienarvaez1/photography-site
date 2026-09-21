import { BeforeAll } from '@cucumber/cucumber';
import { execSync } from 'node:child_process';
import { ROOT } from './lib.js';

// Build once before the whole suite runs, so every scenario tests the exact
// static output the site would deploy — the same thing a real visitor (or
// Cloudflare) would receive. This intentionally does not mock or stub
// anything: a broken build fails every "site pages" scenario immediately,
// which is itself a meaningful, correct test result.
BeforeAll({ timeout: 60_000 }, () => {
  // The snapshot build: every page static, from the sample library in test-fixtures/photos (the real site renders
// its photo pages when they are requested, from R2). The production build is tested separately, in workerd
// (see site-worker.js).
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, PHOTOS_SNAPSHOT: '1' } });
});
