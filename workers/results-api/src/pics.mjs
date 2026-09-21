// Read-only view of the private originals bucket (photos/<id>/original.<ext>) for the Admin page's Pics
// Viewer. It never returns a photo: only its size and a few facts from its metadata block (camera, copyright).
import exifr from 'exifr/dist/full.esm.mjs';
import { formatCamera, pickCamera, text } from '../../../scripts/lib/exif-format.mjs';

const PREFIX = 'photos/';
// Enough for the EXIF/XMP blocks at the start of a JPEG; the rest of the (large) file is never read.
const HEADER_BYTES = 128 * 1024;
const MAX_PAGES = 20;
const ORIGINAL_KEY = /^photos\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/original\.[A-Za-z0-9]{1,8}$/;

export const PHOTO_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Every original in the bucket: [{ id, key, size, uploaded }], ordered by id. */
export async function listOriginals(bucket) {
  const photos = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const listing = await bucket.list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const object of listing.objects) {
      const match = ORIGINAL_KEY.exec(object.key);
      if (match) photos.push({ id: match[1], key: object.key, size: object.size, uploaded: object.uploaded?.toISOString?.() ?? null });
    }
    if (!listing.truncated) return { photos, complete: true };
    cursor = listing.cursor;
  }
  return { photos, complete: false };
}

/** A copyright or author value from EXIF (a string), XMP (a string or { lang, value }), or a list of those. */
function claim(value) {
  if (Array.isArray(value)) return claim(value.find((v) => claim(v)));
  if (value && typeof value === 'object') return claim(value.value);
  return typeof value === 'string' ? text(value) : undefined;
}

/** What the tooltip shows for one original, or null when it is not there. Reads only the file's first bytes. */
export async function describeOriginal(bucket, id) {
  const listing = await bucket.list({ prefix: `${PREFIX}${id}/original.`, limit: 5 });
  const head = listing.objects.find((o) => ORIGINAL_KEY.exec(o.key)?.[1] === id);
  if (!head) return null;

  let raw;
  try {
    const object = await bucket.get(head.key, { range: { offset: 0, length: HEADER_BYTES } });
    const bytes = new Uint8Array(await object.arrayBuffer());
    // No `pick`: it only applies to the TIFF tags, and copyright is often in the XMP block.
    raw = await exifr.parse(bytes, { xmp: true, iptc: true, gps: false, interop: false, ifd1: false, makerNote: false, userComment: false, reviveValues: false, translateValues: false });
  } catch {
    raw = undefined; // unreadable metadata is the same as none
  }
  const camera = pickCamera(raw) ?? null;
  return {
    id,
    key: head.key,
    size: head.size,
    camera,
    cameraLine: formatCamera(camera) ?? null,
    copyright: claim([raw?.Copyright, raw?.CopyrightNotice, raw?.rights]) ?? null,
    artist: claim([raw?.Artist, raw?.creator]) ?? null,
  };
}
