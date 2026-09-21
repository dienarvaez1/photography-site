// Reads a photo's EXIF for one purpose: building the camera line shown on the
// gallery ("Nikon Z 7 · NIKKOR Z 70-200mm f/2.8 VR S · 140mm · f/5.6 · 1/125s · ISO 110").
//
// Nothing else is kept. The .md files are committed to git, so only the camera
// settings below are ever read; GPS position, serial numbers, the artist,
// copyright and dates are deliberately never captured or stored.
import exifr from 'exifr';
import { pickCamera } from './exif-format.mjs';

export { cameraName, formatCamera, formatShutterSpeed } from './exif-format.mjs';
import { formatCamera } from './exif-format.mjs';

const PICK = ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO'];

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
  return pickCamera(raw);
}

/** Convenience: the camera line straight from a JPEG's bytes. */
export async function readCameraLine(buffer) {
  return formatCamera(await readExif(buffer));
}
