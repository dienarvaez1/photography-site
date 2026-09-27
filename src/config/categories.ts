import data from './categories.json' with { type: 'json' };

export interface Category {
  slug: string;
  // Set true to temporarily hide the category from nav/listings without deleting it.
  hidden?: boolean;
}

// The Admin page's Category Maintenance tab (src/lib/category-maintenance.ts, scripts/lib/category-form.mjs)
// reads and writes this list — and each category's `label`/`description` under "categories" in every locale
// file (src/i18n/*.json) — directly, on the owner's own computer (`astro dev`, the same way the New Photo
// form edits R2). It is real, checked-in source data, not user content: it still needs a commit and a deploy
// to reach the live site, the same as any other code change, but no hand-editing of these files.
export const CATEGORIES: Category[] = data;

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

// Categories to show in navigation and listings; excludes hidden ones.
export const VISIBLE_CATEGORIES = CATEGORIES.filter((c) => !c.hidden);
