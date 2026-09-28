// Which code a build was made from, stamped into the site when it is built (see astro.config.mjs) and shown at the
// right of every page's footer.
//
// What the footer shows (`label`):
//   v1.2.0         built exactly at the commit tagged v1.2.0, with nothing uncommitted: a release
//   6ba484a        any other commit: its short hash
//   6ba484a-dirty  built with uncommitted changes, so no commit holds exactly this code
// To make a release, tag it before deploying: `git tag -a v1.2.0 -m v1.2.0 && git push origin v1.2.0`.
// `version` keeps the fuller `git describe --tags --always --dirty` ("v1.2.0-3-g6ba484a": 3 commits past v1.2.0).
import { execFileSync } from 'node:child_process';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryGit = (args, cwd) => {
  try {
    return git(args, cwd) || null;
  } catch {
    return null; // not a git checkout, git is not installed, or (for --exact-match) no tag on this commit
  }
};

/**
 * { label, version, commit, dirty, builtAt } for the checkout at `cwd`. `BUILD_VERSION` / `BUILD_COMMIT` in the
 * environment take precedence (for a build made somewhere without git history); with neither git nor those, the
 * label is "unknown" and commit null — a build never fails for want of a version.
 */
export function buildInfo({ cwd = process.cwd(), env = process.env, now = new Date() } = {}) {
  const version = env.BUILD_VERSION || tryGit(['describe', '--tags', '--always', '--dirty'], cwd);
  const commit = env.BUILD_COMMIT || tryGit(['rev-parse', 'HEAD'], cwd);
  const dirty = Boolean(version?.endsWith('-dirty'));
  const tag = dirty ? null : tryGit(['describe', '--tags', '--exact-match'], cwd);
  const short = tryGit(['rev-parse', '--short', 'HEAD'], cwd);
  const label = env.BUILD_VERSION || tag || (short ? `${short}${dirty ? '-dirty' : ''}` : null) || 'unknown';
  return { label, version: version || 'unknown', commit, dirty, builtAt: now.toISOString() };
}
