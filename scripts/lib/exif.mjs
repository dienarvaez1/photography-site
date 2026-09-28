// Reads a photo's EXIF for two purposes: building the camera line shown on the
// gallery ("Nikon Z 7 · NIKKOR Z 70-200mm f/2.8 VR S · 140mm · f/5.6 · 1/125s · ISO 110"),
// and the photo's created date (`takenAt`).
//
// Nothing else is kept. The entries are public (they sit in the web bucket), so only
// the camera settings and the capture date below are ever read; GPS position, serial
// numbers, the artist and copyright are deliberately never captured or stored.
import exifr from 'exifr';
import { pickCamera, pickTakenAt } from './exif-format.mjs';

export { cameraName, formatCamera, formatShutterSpeed, pickTakenAt } from './exif-format.mjs';
import { formatCamera } from './exif-format.mjs';

const PICK = ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO'];
const DATE_PICK = ['DateTimeOriginal', 'OffsetTimeOriginal', 'CreateDate', 'OffsetTimeDigitized'];

/** exifr's raw values for `pick`, or undefined. Never throws: an unreadable EXIF is treated as absent. */
async function parse(buffer, pick) {
  try {
    return await exifr.parse(buffer, { pick, reviveValues: false, translateValues: false });
  } catch {
    return undefined;
  }
}

/**
 * Reads the camera settings from a JPEG's bytes: { make, model, lens, focalLength,
 * aperture, shutterSpeed, iso } with only the fields present, or undefined when
 * there are none. Never throws: an unreadable EXIF is treated as absent.
 */
export async function readExif(buffer) {
  return pickCamera(await parse(buffer, PICK));
}

/** Convenience: the camera line straight from a JPEG's bytes. */
export async function readCameraLine(buffer) {
  return formatCamera(await readExif(buffer));
}

/** When the photo was created, from a JPEG's bytes (see pickTakenAt), or undefined. Never throws. */
export async function readTakenAt(buffer) {
  return pickTakenAt(await parse(buffer, DATE_PICK));
}
