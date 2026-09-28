// How the category page's "Sort by" control orders photos. Shared by the page's server render (so the first paint,
// and a visitor with no JS, already sees the default order) and its client script (which re-sorts on a change), so
// the two can never disagree about where a photo goes.
import type { PhotoData } from '../config/photo-manifest';

export const SORT_MODES = ['order', 'newest', 'oldest'] as const;
export type SortMode = (typeof SORT_MODES)[number];
export const DEFAULT_SORT: SortMode = 'newest';

/**
 * When the photo was taken (`takenAt`, from its EXIF — see photo-manifest.ts), as a number to compare, or NaN when
 * its entry has none. A value the camera recorded without a UTC offset is read as UTC, not as the reader's own time
 * zone: otherwise the server (UTC) and a visitor's browser could order the same photos differently.
 */
function takenTime(data: PhotoData): number {
  const takenAt = data.takenAt ?? '';
  return Date.parse(/[+-]\d{2}:\d{2}$/.test(takenAt) ? takenAt : `${takenAt}Z`);
}

/**
 * The entries in `mode`'s order, as a new array. "Newest first" / "Oldest first" go by when each photo was taken; a
 * photo with no date sorts after every dated one either way (it is neither new nor old), and ties — including every
 * undated photo — keep the curated order.
 */
export function sortPhotos<T extends { data: PhotoData }>(entries: T[], mode: SortMode): T[] {
  const direction = mode === 'newest' ? -1 : 1;
  return [...entries].sort((a, b) => {
    if (mode === 'order') return a.data.order - b.data.order;
    const [ta, tb] = [takenTime(a.data), takenTime(b.data)];
    const byDate = Number.isNaN(ta) || Number.isNaN(tb) ? Number(Number.isNaN(ta)) - Number(Number.isNaN(tb)) : direction * (ta - tb);
    return byDate || a.data.order - b.data.order;
  });
}
