import { AfterAll, BeforeAll } from '@cucumber/cucumber';
import { execSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_DIR, ROOT, SNAPSHOT_BUILD_DIR, TEST_BUILDS_DIR } from './lib.js';

/** Is that process still running? (A run's build folder is named after its process.) */
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Build once before the whole suite runs, so every scenario tests the exact
// static output the site would deploy — the same thing a real visitor (or
// Cloudflare) would receive. This intentionally does not mock or stub
// anything: a broken build fails every "site pages" scenario immediately,
// which is itself a meaningful, correct test result.
BeforeAll({ timeout: 60_000 }, () => {
  // The snapshot build: every page static, from the sample library in test-fixtures/photos (the real site renders
// its photo pages when they are requested, from R2). The production build is tested separately, in workerd
// (see site-worker.js).
  // Into this run's own folder (lib.js BUILD_DIR), so another run building at the same time can't touch it. Folders
  // left by runs that were killed before their AfterAll are cleared first.
  let left = [];
  try {
    left = readdirSync(TEST_BUILDS_DIR);
  } catch {
    // none yet
  }
  for (const name of left) {
    const pid = Number(/^run-(\d+)$/.exec(name)?.[1]);
    if (pid && pid !== process.pid && !running(pid)) rmSync(join(TEST_BUILDS_DIR, name), { recursive: true, force: true });
  }
  execSync(`npm run build -- --outDir "${SNAPSHOT_BUILD_DIR}"`, { cwd: ROOT, stdio: 'pipe', env: { ...process.env, PHOTOS_SNAPSHOT: '1' } });
});

// Unless the folder was named (TEST_BUILD_DIR), it is this run's alone: nothing reads it afterwards.
AfterAll(() => {
  if (!process.env.TEST_BUILD_DIR) rmSync(BUILD_DIR, { recursive: true, force: true });
});
