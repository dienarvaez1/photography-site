// The category page's client-side category switcher (work/[category].astro) needs every category's
// photos, not just the one the server rendered — but it can't read the manifest from the photo host
// directly: that public bucket sends no `Access-Control-Allow-Origin` header, so a cross-origin
// browser request to it is blocked by CORS (a same-origin <img src> isn't subject to that check,
// which is why the gallery's own images load from there just fine). This endpoint re-serves
// getPhotos() — the exact same source of truth every page already renders from, with its own
// production caching — from the site's own origin instead, so the client's request stays same-origin
// and CSP's default `connect-src 'self'` already covers it; no bucket CORS configuration is needed.
import type { APIRoute } from 'astro';
import { getPhotos } from '../../lib/photo-entries';
import type { ManifestEntry } from '../../config/photo-manifest';

export const GET: APIRoute = async () => {
  const entries = await getPhotos();
  // Back to the manifest's own shape (category/id split out, not joined into one string) since
  // that's what the client-side code already expects from the manifest it used to read directly.
  const body: ManifestEntry[] = entries.map(({ data }) => ({ category: data.category, id: data.photo.id, data }));
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
};
