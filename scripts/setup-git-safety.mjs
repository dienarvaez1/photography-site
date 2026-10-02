import { spawnSync } from 'node:child_process';

const settings = [
  ['pull.ff', 'only'],
  ['push.default', 'simple'],
  ['fetch.prune', 'true'],
  ['merge.conflictStyle', 'diff3'],
];

const runGit = (args, cwd) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (result.error) throw result.error;
  return result;
};

const rootResult = runGit(['rev-parse', '--show-toplevel'], process.cwd());
if (rootResult.status !== 0) {
  console.error(`Could not find the repository root: ${rootResult.stderr.trim()}`);
  process.exit(1);
}

const root = rootResult.stdout.trim();
const conflicts = [];
const missing = [];

for (const [key, value] of settings) {
  const result = runGit(['config', '--local', '--get-all', key], root);
  if (result.status === 0) {
    const values = result.stdout.trimEnd().split('\n');
    if (values.some((existing) => existing !== value)) conflicts.push([key, values]);
  } else if (result.status === 1 && !result.stderr) {
    missing.push([key, value]);
  } else {
    console.error(`Could not read repository-local ${key}: ${result.stderr.trim()}`);
    process.exit(1);
  }
}

if (conflicts.length > 0) {
  console.error('No settings were changed. These repository-local settings have different values:');
  for (const [key, values] of conflicts) console.error(`  ${key}=${values.join(', ')}`);
  console.error('Review them, then update them intentionally before running this setup again.');
  process.exit(1);
}

for (const [key, value] of missing) {
  const result = runGit(['config', '--local', key, value], root);
  if (result.status !== 0) {
    console.error(`Could not set repository-local ${key}: ${result.stderr.trim()}`);
    process.exit(1);
  }
  console.log(`Set ${key}=${value}`);
}

if (missing.length === 0) console.log('All repository-local Git safety defaults are already set.');
