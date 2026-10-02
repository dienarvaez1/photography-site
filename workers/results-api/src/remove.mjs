// Removing recorded runs, for the Admin page's Remove Results (POST /runs/remove, POST /lighthouse/runs/remove): the
// API's only writes, and only to the runs' own store (results/ or lighthouse-results/ in photography-site-test). The
// same order as the publisher's own removal (scripts/lib/results.mjs removeRuns): the index and, when the newest run
// goes, latest.json first, so neither ever names a run whose files are gone, then every file of those runs.

/** The most runs one request may name (the stores keep at most 100). */
export const MAX_REMOVALS = 100;
/** R2 deletes up to this many objects in one call. */
const DELETE_BATCH = 1000;

/** Stored as the publisher stores them: pretty JSON, never cached. */
const writeJson = (bucket, key, value) =>
  bucket.put(key, `${JSON.stringify(value, null, 2)}\n`, { httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } });

async function readJson(bucket, key) {
  const object = await bucket.get(key);
  return object ? JSON.parse(await object.text()) : null;
}

/**
 * Removes these runs (by id) from the store under `prefix`. Ids the index doesn't list are reported as `missing` and
 * change nothing. A run whose files can't all be deleted is already off the index, and is reported in `failed`;
 * removing it again is safe. Resolves to { removed: [runId], missing: [runId], failed: [{ runId, error }] }.
 */
export async function removeStoredRuns(bucket, prefix, runIds) {
  const wanted = new Set(runIds);
  const index = (await readJson(bucket, `${prefix}index.json`)) ?? { updatedAt: null, runs: [] };
  const gone = index.runs.filter((run) => wanted.has(run.runId));
  const missing = [...wanted].filter((id) => !gone.some((run) => run.runId === id));
  if (!gone.length) return { removed: [], missing, failed: [] };

  const kept = index.runs.filter((run) => !wanted.has(run.runId));
  await writeJson(bucket, `${prefix}index.json`, { updatedAt: index.updatedAt, runs: kept });
  const latest = await readJson(bucket, `${prefix}latest.json`);
  if (!latest || wanted.has(latest.runId)) {
    const newest = kept[0] ? await readJson(bucket, `${prefix}runs/${kept[0].runId}/summary.json`) : null;
    if (newest) await writeJson(bucket, `${prefix}latest.json`, newest);
    else await bucket.delete(`${prefix}latest.json`);
  }

  // Every file of every run, in as few calls as R2 allows; only keys inside the store's own runs/ folder.
  const failed = [];
  for (const run of gone) {
    const keys = (run.files ?? []).filter((key) => key.startsWith(`${prefix}runs/${run.runId}/`));
    try {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) await bucket.delete(keys.slice(i, i + DELETE_BATCH));
    } catch (error) {
      failed.push({ runId: run.runId, error: error.message });
    }
  }
  return { removed: gone.map((run) => run.runId).filter((id) => !failed.some((f) => f.runId === id)), missing, failed };
}
