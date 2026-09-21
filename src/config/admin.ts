// How long the Admin page may sit untouched before it signs out (forgets the admin token). Any click, key
// press, pointer movement, scroll or touch on the page counts as being there. Plain module (no imports)
// so tests can read it.
export const ADMIN_IDLE_TIMEOUT_MINUTES = 5;
