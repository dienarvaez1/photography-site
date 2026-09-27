// Calls the local Category Maintenance service (`/__categories/...`, scripts/lib/category-form.mjs), which
// exists only in `astro dev`. Shared by the Add, Edit and Remove Categories bars; the only place that makes
// these requests. Every answer is JSON and is put on the page as text. A near-duplicate of photo-service.ts
// (same shape, same reasoning) rather than a shared import: two tiny, independent local services, each with
// its own prefix, are simpler to keep straight than one generic one threaded through both.
export const SERVICE = '/__categories';

export class ServiceError extends Error {
  constructor(readonly code: string, message = '') {
    super(message);
  }
}

/** Calls the local Category Maintenance service. Anything that is not its JSON answer (the deployed site's 404 page, no server) is "unavailable". */
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

/** Is the local Category Maintenance service there? (Only while the site runs on the owner's computer.) */
export async function serviceAvailable(): Promise<boolean> {
  try {
    await call('/status');
    return true;
  } catch {
    return false;
  }
}
