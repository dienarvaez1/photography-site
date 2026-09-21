// What a page returns when the address fits its route but is not one of the site's pages (`/nothing-here/` fits
// `[...lang]`): an empty 404 marked for the middleware (src/middleware.ts), which swaps in the localized 404 page.
export const NOT_FOUND_HEADER = 'x-site-not-found';
export const notFound = () => new Response(null, { status: 404, headers: { [NOT_FOUND_HEADER]: '1' } });
