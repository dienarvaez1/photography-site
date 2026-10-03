#!/usr/bin/env node
// The dependency audit CI runs (`npm run audit`): `npm audit`, failing on any high or critical advisory, except the few
// accepted below for a written reason until a fix exists. Each exception names its issue; when a patched version of the
// package is published, the audit says so, and the exception should be removed (and the package updated).
//
//   node scripts/audit.mjs            exit 1 if any high/critical advisory remains after the exceptions
import { execFileSync } from 'node:child_process';

/** Advisories accepted for now: the GitHub advisory id, why, and the issue tracking it. */
export const ACCEPTED = [
  {
    id: 'GHSA-ch52-4w7c-c8xp',
    package: 'http-cache-semantics',
    issue: 'https://github.com/dienarvaez1/photography-site/issues/22',
    reason:
      'No patched version exists (<= 4.2.0, the newest). Astro uses it only for build-time caching of remote images ' +
      '(astro:assets), which this site does not use (features/content-integrity.feature forbids it), so the ' +
      'vulnerable code never runs in its builds or its Worker. The only "fix" npm offers is downgrading Astro 7 to 2.',
  },
];

const BLOCKING = new Set(['high', 'critical']);
const idOf = (advisory) => /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(advisory.url ?? '')?.[0] ?? String(advisory.source);

/** Every advisory in an `npm audit --json` report, once each (packages flagged only through others repeat them). */
export function advisories(report) {
  const found = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) if (typeof via === 'object') found.set(idOf(via), { ...via, id: idOf(via) });
  }
  return [...found.values()];
}

/** An accepted advisory whose package can now be fixed without a breaking change: time to update and drop the exception. */
export function fixableAccepted(report, accepted = ACCEPTED) {
  return accepted.filter((entry) => {
    const fix = report.vulnerabilities?.[entry.package]?.fixAvailable;
    return fix === true || (typeof fix === 'object' && fix && !fix.isSemVerMajor);
  });
}

/** The blocking advisories left once the accepted ones are set aside, and the accepted ones still present. */
export function judge(report, accepted = ACCEPTED) {
  const all = advisories(report).filter((advisory) => BLOCKING.has(advisory.severity));
  const isAccepted = (advisory) => accepted.some((entry) => entry.id.toLowerCase() === advisory.id.toLowerCase());
  return { blocking: all.filter((advisory) => !isAccepted(advisory)), accepted: all.filter(isAccepted) };
}

function runAudit() {
  try {
    return execFileSync('npm', ['audit', '--json'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (error) {
    // npm exits 1 whenever it finds anything; the report is still on stdout.
    if (error.stdout) return error.stdout;
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = JSON.parse(runAudit());
  const { blocking, accepted } = judge(report);
  for (const entry of fixableAccepted(report)) console.log(`A fix is now available for ${entry.package} (${entry.id}): run \`npm audit fix\`, then remove it from ACCEPTED in scripts/audit.mjs and close ${entry.issue}.`);
  for (const advisory of accepted) {
    const entry = ACCEPTED.find((e) => e.id.toLowerCase() === advisory.id.toLowerCase());
    console.log(`Accepted for now: ${advisory.id} (${advisory.name}, ${advisory.severity}) — ${entry.issue}`);
  }
  for (const entry of ACCEPTED) {
    if (!accepted.some((advisory) => advisory.id.toLowerCase() === entry.id.toLowerCase())) {
      console.log(`No longer reported: ${entry.id} (${entry.package}). Remove it from ACCEPTED in scripts/audit.mjs and close ${entry.issue}.`);
    }
  }
  if (blocking.length) {
    console.error(`\n${blocking.length} high or critical advisor${blocking.length === 1 ? 'y' : 'ies'} not accepted:`);
    for (const advisory of blocking) console.error(`  ${advisory.id}  ${advisory.name}  ${advisory.severity}  ${advisory.title}  ${advisory.url ?? ''}`);
    console.error('\nRun `npm audit` for the details and the fixes on offer.');
    process.exit(1);
  }
  console.log('Dependency audit: no high or critical advisories beyond those accepted above.');
}
