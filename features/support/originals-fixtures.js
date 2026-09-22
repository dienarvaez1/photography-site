import sharp from 'sharp';
import { IFD, exifValue } from './photo-helpers.js';

const xmpPacket = ({ rights, creator }) =>
  `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
  (rights === undefined ? '' : `<dc:rights><rdf:Alt>${rights ? `<rdf:li xml:lang="x-default">${rights}</rdf:li>` : ''}</rdf:Alt></dc:rights>`) +
  (creator ? `<dc:creator><rdf:Seq><rdf:li>${creator}</rdf:li></rdf:Seq></dc:creator>` : '') +
  `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

/** Splices an XMP block into a JPEG right after its start marker. */
function withXmp(jpeg, fields) {
  const body = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'), Buffer.from(xmpPacket(fields))]);
  const segment = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/**
 * A JPEG with the given EXIF tags ({ Make: 'NIKON', Copyright: '...' }), optionally an XMP block
 * ({ rights, creator }) and `padding` extra bytes after the picture (to make the file large).
 */
export async function jpegWith({ exif = {}, xmp, padding = 0, seed = 0 } = {}) {
  const tags = { IFD0: {}, IFD2: {}, IFD3: {} };
  for (const [tag, value] of Object.entries(exif)) {
    if (!IFD[tag]) throw new Error(`Unknown EXIF tag in test: ${tag}`);
    tags[IFD[tag]][tag] = exifValue(tag, value);
  }
  const withTags = Object.fromEntries(Object.entries(tags).filter(([, v]) => Object.keys(v).length));
  let image = sharp({ create: { width: 24, height: 16, channels: 3, background: { r: seed & 255, g: 90, b: 140 } } }).jpeg();
  if (Object.keys(withTags).length) image = image.withExif(withTags);
  let bytes = await image.toBuffer();
  if (xmp) bytes = withXmp(bytes, xmp);
  return padding ? Buffer.concat([bytes, Buffer.alloc(padding, 0x41)]) : bytes;
}

/**
 * A fake originals bucket with the read API of an R2 binding (list with prefix/cursor/limit, get with an optional range).
 * `calls` records every read; there is no put or delete, so a write attempt fails loudly.
 * files = [{ id, ext?, body }] -> object keys photos/<id>/original.<ext>.
 */
// `objects` shares an existing map of key -> { body, uploaded? } (say, the photo service's fake originals bucket), so both see the same photos.
export function fakeOriginals(files, { pageSize, objects: shared } = {}) {
  const objects = shared ?? new Map(files.map((f) => [f.key ?? `photos/${f.id}/original.${f.ext ?? 'jpg'}`, { body: f.body, uploaded: new Date('2026-09-01T12:00:00Z') }]));
  const calls = [];
  const binding = {
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      calls.push({ op: 'list', prefix });
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const size = Math.min(limit, pageSize ?? limit);
      const page = keys.slice(start, start + size);
      const more = start + size < keys.length;
      return { objects: page.map((key) => ({ key, size: objects.get(key).body.length, uploaded: objects.get(key).uploaded ?? new Date('2026-09-01T12:00:00Z') })), truncated: more, cursor: more ? String(start + size) : undefined };
    },
    async get(key, options) {
      calls.push({ op: 'get', key, range: options?.range });
      const object = objects.get(key);
      if (!object) return null;
      const { offset = 0, length = object.body.length } = options?.range ?? {};
      const bytes = object.body.subarray(offset, offset + length);
      return { key, size: object.body.length, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length); } };
    },
  };
  return { binding, calls, objects };
}

const LARGE = 3_000_000; // megabytes of "picture" after the metadata, so reading a whole file would show

const METADATA = {
  full: () => ({
    exif: {
      Make: 'NIKON CORPORATION', Model: 'NIKON Z 6', LensModel: 'NIKKOR Z 24-70mm f/4 S', FocalLength: '24', FNumber: '4', ExposureTime: '25', ISOSpeedRatings: '3200',
      Copyright: 'Copyright 2026 Diego Narvaez', Artist: 'Diego Narvaez',
      // Never to be passed on:
      BodySerialNumber: 'SECRET-SERIAL-123', DateTimeOriginal: '2023:11:27 18:42:10',
      GPSLatitudeRef: 'N', GPSLatitude: '45/1 31/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '122/1 40/1 0/1',
    },
    padding: LARGE,
  }),
  'xmp copyright': () => ({ exif: { Make: 'Canon', Model: 'Canon EOS R5' }, xmp: { rights: '© 2026 XMP Owner (Unicode ok)', creator: 'Xmp Author' }, padding: 200_000 }),
  'empty rights': () => ({ exif: { Make: 'NIKON CORPORATION', Model: 'NIKON Z 6', FocalLength: '24', FNumber: '4', ExposureTime: '25', ISOSpeedRatings: '3200', Artist: 'Someone     555-1234' }, xmp: { rights: '' }, padding: 50_000 }),
  nothing: () => ({ padding: 10_000 }),
};

export async function sampleFile(metadata, seed) {
  if (metadata === 'not a picture') return Buffer.from('this is not a JPEG file '.repeat(1000));
  return jpegWith({ ...METADATA[metadata](), seed });
}

