// How long the Admin page may sit untouched before it signs out (forgets the admin token). Any click, key
// press, pointer movement, scroll or touch on the page counts as being there. Plain module (no imports)
// so tests can read it.
export const ADMIN_IDLE_TIMEOUT_MINUTES = 5;

// How many photos the Pics Viewer draws at a time. It lists the first page, and draws the next one as the page is scrolled
// down to the end of the list (or "Show more" is pressed), so a big bucket never means hundreds of rows and thumbnails at once.
export const PICS_PAGE_SIZE = 20;

