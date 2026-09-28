// Turning raw EXIF values into the camera settings, the one-line camera description shown on the gallery, and the
// photo's created date.
// Pure functions with no imports, so the photo tooling and the results Worker (which reads originals for
// the Admin page's Pics Viewer) share exactly the same wording.

export const text = (value) => {
  // Cameras pad and double-space strings; collapse that.
  const cleaned = typeof value === 'string' ? value.replace(/\0/g, '').replace(/\s+/g, ' ').trim() : '';
  return cleaned || undefined;
};

export const positive = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);

export const round1 = (value) => Math.round(value * 10) / 10;

/** Exposure time in seconds -> "1/125" for fast speeds, "2.5" / "30" for one second or longer. */
export function formatShutterSpeed(seconds) {
  const t = positive(seconds);
  if (!t) return undefined;
  return t >= 1 ? String(round1(t)) : `1/${Math.round(1 / t)}`;
}

/** Raw EXIF values (Make, Model, LensModel, FocalLength, FNumber, ExposureTime, ISO) -> { make, model, lens, focalLength, aperture, shutterSpeed, iso } with only the fields present, or undefined. */
export function pickCamera(raw) {
  if (!raw) return undefined;
  const values = {
    make: text(raw.Make),
    model: text(raw.Model),
    lens: text(raw.LensModel),
    focalLength: positive(raw.FocalLength) && round1(raw.FocalLength),
    aperture: positive(raw.FNumber) && round1(raw.FNumber),
    shutterSpeed: formatShutterSpeed(raw.ExposureTime),
    iso: positive(raw.ISO) && Math.round(raw.ISO),
  };
  const found = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  return Object.keys(found).length ? found : undefined;
}

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const EXIF_OFFSET = /^[+-]\d{2}:\d{2}$/;

/**
 * Raw EXIF values -> when the photo was created, as ISO 8601 ("2023-11-27T18:42:10", plus "-07:00" when the camera
 * recorded its offset), or undefined. DateTimeOriginal (shutter press) first, else CreateDate (when it was digitized);
 * never ModifyDate, which is when it was last edited. EXIF dates are the camera's local clock, so without an offset
 * the value is kept as local time rather than guessed into UTC. Blank ("0000:00:00 00:00:00") and impossible dates
 * are treated as absent.
 */
export function pickTakenAt(raw) {
  if (!raw) return undefined;
  for (const [dateTag, offsetTag] of [['DateTimeOriginal', 'OffsetTimeOriginal'], ['CreateDate', 'OffsetTimeDigitized']]) {
    const match = EXIF_DATE.exec(text(raw[dateTag]) ?? '');
    if (!match) continue;
    const [, y, mo, d, h, mi, s] = match.map(Number);
    const check = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
    const valid = y > 0 && check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d && h < 24 && mi < 60 && s < 60;
    if (!valid) continue;
    const offset = text(raw[offsetTag]);
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${offset && EXIF_OFFSET.test(offset) ? offset : ''}`;
  }
  return undefined;
}

const titleCase = (word) => (word.length > 3 && word === word.toUpperCase() ? word[0] + word.slice(1).toLowerCase() : word);

/** "NIKON CORPORATION" + "NIKON Z 7" -> "Nikon Z 7"; "SONY" + "ILCE-7M4" -> "Sony ILCE-7M4". */
export function cameraName(make, model) {
  const brand = (make ?? '').split(/\s+/)[0];
  if (!model) return brand ? titleCase(brand) : undefined;
  if (!brand) return model;
  const startsWithBrand = model.toLowerCase().startsWith(brand.toLowerCase());
  if (startsWithBrand) return titleCase(model.slice(0, brand.length)) + model.slice(brand.length);
  return `${titleCase(brand)} ${model}`;
}

/** The gallery's camera line, or undefined when nothing is known. */
export function formatCamera(exif) {
  if (!exif) return undefined;
  const parts = [
    cameraName(exif.make, exif.model),
    exif.lens,
    exif.focalLength && `${exif.focalLength}mm`,
    exif.aperture && `f/${exif.aperture}`,
    exif.shutterSpeed && `${exif.shutterSpeed}s`,
    exif.iso && `ISO ${exif.iso}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

