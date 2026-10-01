// Read-only view of the site's access log for the Admin page's Access Info tab: which days have a file, and one day's
// entries. The format is the site's own (src/config/access-log.ts); the site's Worker writes it, this one only reads.
import { ACCESS_PREFIX, DAY, DAY_KEY, dayKey, readDay } from '../../../src/config/access-log.ts';

/** At most this many days are listed (newest first): over a year of them. */
const MAX_DAYS = 400;

/** Every day with a log file, newest first: { days: [{ day, size, updatedAt }], complete }. */
export async function listDays(bucket) {
  const days = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: ACCESS_PREFIX, cursor });
    for (const object of page.objects) {
      const match = DAY_KEY.exec(object.key);
      if (match) days.push({ day: `${match[1]}T00:00:00.000Z`, size: object.size, updatedAt: object.uploaded ? new Date(object.uploaded).toISOString() : null });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  days.sort((a, b) => b.day.localeCompare(a.day));
  return { days: days.slice(0, MAX_DAYS), complete: days.length <= MAX_DAYS };
}

export const isDay = (day) => DAY.test(day ?? '') && !Number.isNaN(Date.parse(day));

/** One day's file as { day, entries } (oldest entry first), or null when that day has none. */
export async function readAccessDay(bucket, day) {
  const object = await bucket.get(dayKey(day));
  return object ? readDay(await object.text(), day) : null;
}
