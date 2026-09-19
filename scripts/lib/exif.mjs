// Reads a photo's EXIF for one purpose: building the camera line shown on the
// gallery ("Nikon Z 7 · NIKKOR Z 70-200mm f/2.8 VR S · 140mm · f/5.6 · 1/125s · ISO 110").
//
// Nothing else is kept. The .md files are committed to git, so only the camera
// settings below are ever read; GPS position, serial numbers, the artist,
// copyright and dates are deliberately never captured or stored.
import exifr from 'exifr';

const PICK = ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO'];

const text = (value) => {
  // Cameras pad and double-space strings; collapse that.
  const cleaned = typeof value === 'string' ? value.replace(/\0/g, '').replace(/\s+/g, ' ').trim() : '';
  return cleaned || undefined;
};

const positive = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);

const round1 = (value) => Math.round(value * 10) / 10;

/** Exposure time in seconds -> "1/125" for fast speeds, "2.5" / "30" for one second or longer. */
export function formatShutterSpeed(seconds) {
  const t = positive(seconds);
  if (!t) return undefined;
  return t >= 1 ? String(round1(t)) : `1/${Math.round(1 / t)}`;
}

/**
 * Reads the camera settings from a JPEG's bytes: { make, model, lens, focalLength,
 * aperture, shutterSpeed, iso } with only the fields present, or undefined when
 * there are none. Never throws: an unreadable EXIF is treated as absent.
 */
export async function readExif(buffer) {
  let raw;
  try {
    raw = await exifr.parse(buffer, { pick: PICK, reviveValues: false, translateValues: false });
  } catch {
    return undefined;
  }
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

/** Convenience: the camera line straight from a JPEG's bytes. */
export async function readCameraLine(buffer) {
  return formatCamera(await readExif(buffer));
}
