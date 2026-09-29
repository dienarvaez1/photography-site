// The index page of a Lighthouse run (test-results/lighthouse/index.html): every page measured, on each device, with
// its scores, timings, size and browser errors, whether it met its budget (and what it missed), and a link to its full
// Lighthouse report. One self-contained HTML file with no scripts and nothing fetched, so it opens straight from disk
// and can be published next to the reports. A pure function of the results, so it is tested without running Lighthouse.

const escape = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const DEVICE_NAMES = { mobile: 'Phone', desktop: 'Laptop' };
const SCORES = [
  ['performance', 'Perf'],
  ['accessibility', 'A11y'],
  ['best-practices', 'Best pr.'],
  ['seo', 'SEO'],
];
const METRICS = [
  ['first-contentful-paint', 'FCP'],
  ['largest-contentful-paint', 'LCP'],
  ['total-blocking-time', 'TBT'],
  ['cumulative-layout-shift', 'CLS'],
];

/** Lighthouse's own colour bands: 90–100 good, 50–89 needs work, 0–49 poor. */
const band = (score) => (score >= 0.9 ? 'good' : score >= 0.5 ? 'average' : 'poor');
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const metricText = (id, value) => (id === 'cumulative-layout-shift' ? value.toFixed(3) : id === 'total-blocking-time' ? `${Math.round(value)} ms` : seconds(value));
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
const utc = (date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const allMisses = (misses) => [...misses.scores, ...misses.metrics, ...misses.bytes, ...misses.console.map((e) => `Browser error — ${e}`)];

/**
 * The run's results as data (test-results/lighthouse/summary.json, published to R2 with the reports and read by the
 * Admin page's Lighthouse tab): the same rows, in the same order, the index page shows. Scores are 0–100; times are
 * milliseconds; `misses` is every way the measurement missed its budget, as sentences (empty when it passed).
 */
export function summarizeRun({ baseUrl, runs, generatedAt, results }) {
  const pageOrder = [...new Set(results.map((r) => r.path))];
  const rows = [...results]
    .sort((a, b) => pageOrder.indexOf(a.path) - pageOrder.indexOf(b.path) || (a.device === 'mobile' ? -1 : 1) - (b.device === 'mobile' ? -1 : 1))
    .map((r) => {
      const { categories, audits } = r.lhr;
      const misses = allMisses(r.misses);
      return {
        path: r.path,
        device: r.device,
        report: r.report,
        scores: Object.fromEntries(SCORES.map(([id]) => [id, Math.round(categories[id].score * 100)])),
        metrics: Object.fromEntries(METRICS.map(([id]) => [id, id === 'cumulative-layout-shift' ? Number(audits[id].numericValue.toFixed(3)) : Math.round(audits[id].numericValue)])),
        bytes: Math.round(audits['total-byte-weight'].numericValue),
        errors: r.misses.console.length,
        ok: misses.length === 0,
        misses,
      };
    });
  const withinBudget = rows.filter((r) => r.ok).length;
  return {
    baseUrl,
    measuredAt: generatedAt.toISOString(),
    runsPerPage: runs,
    ok: withinBudget === rows.length,
    totals: { measurements: rows.length, withinBudget, overBudget: rows.length - withinBudget },
    results: rows,
  };
}

/**
 * The index page's HTML. `results`: [{ path, device ("mobile" | "desktop"), report (file name), lhr, misses (from
 * checkBudget), budget (from budgetFor) }]. Pages keep the order they were first measured in; phone before laptop.
 */
export function renderIndex({ baseUrl, runs, generatedAt, results }) {
  const pageOrder = [...new Set(results.map((r) => r.path))];
  const sorted = [...results].sort((a, b) => pageOrder.indexOf(a.path) - pageOrder.indexOf(b.path) || (a.device === 'mobile' ? -1 : 1) - (b.device === 'mobile' ? -1 : 1));
  const passed = sorted.filter((r) => allMisses(r.misses).length === 0).length;
  const allPassed = passed === sorted.length;

  const rows = sorted.map((r) => {
    const { categories, audits } = r.lhr;
    const failedScores = new Set(Object.entries(r.budget.scores).filter(([id, min]) => !(categories[id].score >= min)).map(([id]) => id));
    const failedMetrics = new Set(Object.entries(r.budget.metrics).filter(([id, max]) => !(audits[id].numericValue <= max)).map(([id]) => id));
    const bytes = audits['total-byte-weight'].numericValue;
    const errors = r.misses.console.length;
    const ok = allMisses(r.misses).length === 0;
    const scoreCells = SCORES.map(([id]) => {
      const score = categories[id].score;
      return `<td class="num"><span class="score ${band(score)}${failedScores.has(id) ? ' over' : ''}" title="Budget ${Math.round((r.budget.scores[id] ?? 0) * 100)}">${Math.round(score * 100)}</span></td>`;
    }).join('');
    const metricCells = METRICS.map(([id]) => {
      const value = audits[id].numericValue;
      return `<td class="num${failedMetrics.has(id) ? ' over' : ''}" title="Budget ${escape(metricText(id, r.budget.metrics[id]))}">${escape(metricText(id, value))}</td>`;
    }).join('');
    return `<tr${ok ? '' : ' class="missed"'}>
        <th scope="row"><a href="${escape(baseUrl + r.path)}">${escape(r.path)}</a></th>
        <td>${DEVICE_NAMES[r.device] ?? escape(r.device)}</td>
        ${scoreCells}
        ${metricCells}
        <td class="num${r.misses.bytes.length ? ' over' : ''}" title="Budget ${kb(r.budget.bytes)}">${kb(bytes)}</td>
        <td class="num${errors ? ' over' : ''}">${errors}</td>
        <td><span class="pill ${ok ? 'pass' : 'fail'}">${ok ? 'Within budget' : 'Over budget'}</span></td>
        <td><a href="${escape(r.report)}">Report</a></td>
      </tr>`;
  }).join('\n      ');

  // Each distinct problem once, with every page and device it happened on: one error on every page reads as one
  // problem to fix, not a dozen. Problems keep the order they were first seen in.
  const problems = new Map(); // text -> ["/ · Phone", ...]
  for (const r of sorted) {
    for (const miss of allMisses(r.misses)) {
      if (!problems.has(miss)) problems.set(miss, []);
      problems.get(miss).push(`${r.path} · ${DEVICE_NAMES[r.device] ?? r.device}`);
    }
  }
  const missList = problems.size
    ? `<section aria-labelledby="missed-heading">
    <h2 id="missed-heading">What was over budget</h2>
    <ul class="misses">
      ${[...problems].map(([miss, where]) => `<li><span class="miss">${escape(miss)}</span><span class="where">${where.length === sorted.length && where.length > 1 ? `Every page measured (${where.length})` : where.map(escape).join(', ')}</span></li>`).join('\n      ')}
    </ul>
  </section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lighthouse results</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f5f3ee; --surface: #ffffff; --sunken: #ece8de; --fg: #1b1a16; --muted: #5e5a51; --rule: #ddd7c9; --accent: #7a6634;
    --good: #0c7a3e; --good-bg: #dff3e6; --average: #a3580b; --average-bg: #fbe9d3; --poor: #b3261e; --poor-bg: #f9dedc;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #0a0a09; --surface: #161513; --sunken: #11100e; --fg: #f2f1ee; --muted: #a6a5a0; --rule: #29271f; --accent: #d9c9a3;
      --good: #7fd6a0; --good-bg: #13291c; --average: #f0b46a; --average-bg: #2d2111; --poor: #f28b82; --poor-bg: #321715;
    }
  }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; padding-inline: 20px; }
  main { max-width: 1180px; margin-inline: auto; padding-block: 40px 64px; display: grid; gap: 32px; }
  header { display: grid; gap: 10px; }
  h1 { font: 400 2rem/1.15 Georgia, 'Times New Roman', serif; margin: 0; }
  h2 { font: 600 1.05rem/1.3 inherit; margin: 0 0 10px; }
  a { color: var(--accent); }
  .meta { color: var(--muted); margin: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; }
  .meta b { color: var(--fg); font-weight: 600; }
  .summary { font-size: 1.05rem; margin: 0; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--rule); border-radius: 6px; background: var(--surface); }
  table { border-collapse: collapse; width: 100%; min-width: 980px; font-size: 0.9rem; font-variant-numeric: tabular-nums; }
  th, td { padding: 9px 10px; border-bottom: 1px solid var(--rule); text-align: left; white-space: nowrap; }
  tbody tr:last-child > * { border-bottom: none; }
  thead th { font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); background: var(--sunken); font-weight: 600; }
  thead .group { text-align: center; border-bottom: 1px solid var(--rule); }
  tbody th { font-weight: 600; }
  .num { text-align: right; }
  td.over { color: var(--poor); font-weight: 600; }
  tr.missed { background: color-mix(in srgb, var(--poor-bg) 45%, transparent); }
  .score { display: inline-block; min-width: 2.2em; text-align: center; padding: 2px 6px; border-radius: 999px; font-weight: 600; }
  .score.good { color: var(--good); background: var(--good-bg); }
  .score.average { color: var(--average); background: var(--average-bg); }
  .score.poor { color: var(--poor); background: var(--poor-bg); }
  .score.over { outline: 2px solid var(--poor); outline-offset: 1px; }
  .pill { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 0.78rem; font-weight: 600; }
  .pill.pass { color: var(--good); background: var(--good-bg); }
  .pill.fail { color: var(--poor); background: var(--poor-bg); }
  .misses { margin: 0; padding-left: 1.1em; display: grid; gap: 12px; }
  .misses li { display: grid; gap: 2px; overflow-wrap: anywhere; }
  .miss { font-weight: 600; }
  .where { color: var(--muted); font-size: 0.9rem; }
  footer { color: var(--muted); font-size: 0.85rem; border-top: 1px solid var(--rule); padding-top: 14px; }
  code { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 0.9em; }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <header>
    <h1>Lighthouse results</h1>
    <p class="meta"><span>Site <b>${escape(baseUrl)}</b></span><span>Measured <b>${utc(generatedAt)}</b></span><span><b>${runs}</b> run${runs === 1 ? '' : 's'} per page, median shown</span></p>
    <p class="summary"><span class="pill ${allPassed ? 'pass' : 'fail'}">${passed} of ${sorted.length} within budget</span></p>
  </header>

  <section aria-labelledby="results-heading">
    <h2 id="results-heading">Every page measured</h2>
    <div class="table-wrap">
    <table>
      <thead>
        <tr><th scope="col" rowspan="2">Page</th><th scope="col" rowspan="2">Device</th><th scope="colgroup" colspan="4" class="group">Scores</th><th scope="colgroup" colspan="4" class="group">Timings</th><th scope="col" rowspan="2" class="num">Size</th><th scope="col" rowspan="2" class="num">Errors</th><th scope="col" rowspan="2">Budget</th><th scope="col" rowspan="2">Full report</th></tr>
        <tr>${SCORES.map(([, label]) => `<th scope="col" class="num">${label}</th>`).join('')}${METRICS.map(([, label]) => `<th scope="col" class="num">${label}</th>`).join('')}</tr>
      </thead>
      <tbody>
      ${rows}
      </tbody>
    </table>
    </div>
  </section>

  ${missList}

  <footer>
    Scores are coloured on Lighthouse's own scale (90–100 good, 50–89 needs work, 0–49 poor); a value in red missed its
    budget (hover it for the budget). FCP and LCP are First and Largest Contentful Paint, TBT Total Blocking Time, CLS
    Cumulative Layout Shift. The budgets are in <code>features/support/lighthouse.js</code>; run
    <code>npm run test:lighthouse</code> to measure again.
  </footer>
</main>
</body>
</html>
`;
}
