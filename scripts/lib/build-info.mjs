// Which code a build was made from, stamped into the site when it is built (see astro.config.mjs) and shown in the
// Admin page's footer.
//
// The version is `git describe --tags --always --dirty`:
//   6ba484a              no release tag yet: the short commit hash
//   v1.2.0               built exactly at the commit tagged v1.2.0 (`git tag v1.2.0 && git push --tags`)
//   v1.2.0-3-g6ba484a    3 commits after v1.2.0, at commit 6ba484a
//   …-dirty              built with uncommitted changes, so no commit holds exactly this code
// It needs no step to remember and cannot drift from the code, unlike a number bumped by hand.
import { execFileSync } from 'node:child_process';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * { version, commit, dirty, builtAt } for the checkout at `cwd`. `BUILD_VERSION` / `BUILD_COMMIT` in the environment
 * take precedence (for a build made somewhere without git history); with neither git nor those, the version is
 * "unknown" and commit null — a build never fails for want of a version.
 */
export function buildInfo({ cwd = process.cwd(), env = process.env, now = new Date() } = {}) {
  let version = env.BUILD_VERSION || null;
  let commit = env.BUILD_COMMIT || null;
  try {
    version ??= git(['describe', '--tags', '--always', '--dirty'], cwd);
    commit ??= git(['rev-parse', 'HEAD'], cwd);
  } catch {
    // not a git checkout, or git is not installed
  }
  return { version: version || 'unknown', commit, dirty: Boolean(version?.endsWith('-dirty')), builtAt: now.toISOString() };
}
