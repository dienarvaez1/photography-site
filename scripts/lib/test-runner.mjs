// What `npm run test:record` runs: each suite with a JSON and an HTML reporter writing to the results folder.
export const SUITES = {
  offline: { file: 'offline', args: [] },
  browser: { file: 'browser', args: ['--profile', 'browser'] },
};

/**
 * The plan for a run: which suites, the cucumber arguments for each, and whether to publish.
 * Throws on an unknown --suite so a typo can't silently run nothing.
 */
export function planRun(argv, dir) {
  const suiteIndex = argv.indexOf('--suite');
  const wanted = suiteIndex >= 0 ? argv[suiteIndex + 1] : 'all';
  const names = wanted === 'all' ? Object.keys(SUITES) : [wanted];
  for (const name of names) if (!SUITES[name]) throw new Error(`Unknown suite "${wanted}". Use offline, browser or all.`);
  return {
    publish: !argv.includes('--no-publish'),
    suites: names.map((name) => ({
      name,
      args: [...SUITES[name].args, '--format', 'progress', '--format', `json:${dir}/${SUITES[name].file}.json`, '--format', `html:${dir}/${SUITES[name].file}.html`],
    })),
  };
}
