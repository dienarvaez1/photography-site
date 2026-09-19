// Where photos live and how their URLs are built. Plain module with no imports
// so both the Astro site and the sync tool (scripts/photos.mjs) can use it.
//
// Photos are NOT stored in the repo. Each photo's .md holds only a content id
// (a hash of the original file) plus its dimensions; the files live in R2:
//   - originals bucket (private):  photos/<id>/original.jpg
//   - web bucket (public r2.dev):  photos/<id>/{thumb,cover,full}.webp
// Keys are content-addressed, so a changed photo always gets a new id and the
// URLs can be cached forever.

export const PHOTO_BUCKETS = {
  originals: 'photography-site-originals',
  web: 'photography-site-web',
} as const;

// Public base URL of the web bucket (its r2.dev address). To move to a custom
// domain later, change only this line — the .md files never contain URLs.
export const PHOTOS_BASE_URL = 'https://pub-b7007991d1ab46b99ecee4a08e5ead46.r2.dev';

/** Widths of the web variants, generated when a photo is added. */
export const PHOTO_VARIANTS = { thumb: 700, cover: 900, full: 2000 } as const;
export type PhotoVariant = keyof typeof PHOTO_VARIANTS;

export const PHOTO_ID_PATTERN = /^[0-9a-f]{16}$/;

/**
 * Where entries live: `src/content/photos/<category>/images/<photo id>.md`. Every
 * entry's file name is its photo id, so a file maps 1:1 to its R2 objects
 * (`photos/<id>/...`).
 */
export const ENTRY_FOLDER = 'images';

/** What a photo's .md stores: its content id and the (orientation-corrected) size of the original. */
export interface PhotoRef {
  id: string;
  width: number;
  height: number;
}

export type PhotoKind = 'original' | PhotoVariant;

/** Object key for one file of a photo. */
export function photoKey(id: string, kind: PhotoKind): string {
  return kind === 'original' ? `photos/${id}/original.jpg` : `photos/${id}/${kind}.webp`;
}

/** Every object key a photo needs: the original plus each web variant. */
export function photoKeys(id: string): { original: string; web: string[] } {
  return {
    original: photoKey(id, 'original'),
    web: (Object.keys(PHOTO_VARIANTS) as PhotoVariant[]).map((v) => photoKey(id, v)),
  };
}

/** Rendered size of a variant: the target width (never upscaled) with the original's aspect ratio. */
export function variantSize(photo: PhotoRef, variant: PhotoVariant): { width: number; height: number } {
  const width = Math.min(PHOTO_VARIANTS[variant], photo.width);
  return { width, height: Math.round((width * photo.height) / photo.width) };
}

/** Public URL plus size of a photo variant, for <img src width height>. */
export function photoVariant(
  photo: PhotoRef,
  variant: PhotoVariant,
  baseUrl: string = PHOTOS_BASE_URL
): { src: string; width: number; height: number } {
  return { src: `${baseUrl}/${photoKey(photo.id, variant)}`, ...variantSize(photo, variant) };
}
