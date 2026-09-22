// Pure helpers for the Admin page's Pics Viewer (no DOM, so they can be tested in Node).

export type Original = { id: string; key: string; size: number; uploaded: string | null };
/** What the site knows about a photo (from its content entry): a title and its category. */
/** `thumb` is the site's own small public copy of the photo (never the private original). */
export type KnownPhoto = { title: string; category: string; thumb?: { src: string; width: number; height: number } };
export type PicRow = Original & { title: string | null; category: string | null };

/** "3.5 MB", "820 KB", "12 B": the size in the largest unit that keeps it above 1, with the page's number format. */
export function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value);
  return `${number} ${units[unit]}`;
}

/** The exact size with thousands separators: "3,635,121 bytes". */
export const formatExactBytes = (bytes: number, locale: string, unitWord: string) => `${new Intl.NumberFormat(locale).format(bytes)} ${unitWord}`;

/**
 * The listing joined with what the site knows: photos of the site first, by category then title, then
 * originals the site has no entry for, by id. Nothing is dropped and nothing is listed twice.
 */
export function joinPhotos(originals: Original[], known: Record<string, KnownPhoto>, locale = 'en'): PicRow[] {
  const rows = originals.map((o) => ({ ...o, title: known[o.id]?.title ?? null, category: known[o.id]?.category ?? null }));
  const collator = new Intl.Collator(locale);
  return rows.sort((a, b) => {
    if ((a.title === null) !== (b.title === null)) return a.title === null ? 1 : -1;
    return collator.compare(a.category ?? '', b.category ?? '') || collator.compare(a.title ?? '', b.title ?? '') || collator.compare(a.id, b.id);
  });
}

export const PICS_TAB = 'pics-viewer';

/**
 * How many rows to draw: at least one page, whole pages, and enough to include the first `needed` rows (say, the last one
 * that is ticked, so a refreshed list still shows it); never more than there are.
 */
export function rowsToShow(total: number, needed: number, pageSize: number): number {
  return Math.min(total, Math.max(pageSize, Math.ceil(needed / pageSize) * pageSize));
}

/** The size to show a picture of `width` x `height` at, scaled down to fit a `max` pixel square (never scaled up). */
export function thumbSize(width: number, height: number, max = 96): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: max, height: max };
  const scale = Math.min(1, max / width, max / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
