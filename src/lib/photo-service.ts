// Calls the local photo service (`/__photos/...`, scripts/lib/photo-form.mjs), which exists only in `astro dev`: it needs
// the owner's Cloudflare login. Shared by the New Photo form, the Remove Photos bar and the Edit Photos (category
// change) bar; the only place that makes these requests. Every answer is JSON and is put on the page as text.

export const SERVICE = '/__photos';

export class ServiceError extends Error {
  constructor(readonly code: string, message = '') {
    super(message);
  }
}

/** Calls the local photo service. Anything that is not its JSON answer (the deployed site's 404 page, no server) is "unavailable". */
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${SERVICE}${path}`, init);
  } catch {
    throw new ServiceError('unreachable');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // not JSON: handled below
  }
  const info = body && typeof body === 'object' ? (body as { error?: string; message?: string }) : {};
  if (!response.ok) throw new ServiceError(info.error ?? 'unavailable', info.message ?? '');
  if (!body) throw new ServiceError('unavailable');
  return body as T;
}

/** Is the local photo service there? (Only while the site runs on the owner's computer.) */
export async function serviceAvailable(): Promise<boolean> {
  try {
    await call('/status');
    return true;
  } catch {
    return false;
  }
}
