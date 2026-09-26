export interface Category {
  slug: string;
  // Set true to temporarily hide the category from nav/listings without deleting it.
  hidden?: boolean;
}

// Add a new category by adding an entry here, then add its `label` and
// `description` under "categories" in every locale file (src/i18n/*.json),
// and deploy once. Photos are added to it with `--category <slug>` (or the Admin
// page's New Photo form): their entries live in R2, so there is no folder to create.
export const CATEGORIES: Category[] = [
  { slug: 'real-estate' },
  { slug: 'landscape' },
  { slug: 'portrait' },
  { slug: 'astro' },
  { slug: 'pets' },
  { slug: 'nature' },
  { slug: 'events' },
  // Hidden from nav and the homepage grid at the owner's request; the category, its page and its
  // photos otherwise work exactly as before — a direct link to /work/other/ still shows them.
  { slug: 'other', hidden: true },
  { slug: 'cityscape' },
  { slug: 'abstract' },
  // Permanently hidden: never linked from the nav or the homepage grid, on purpose. It has no photos, so it keeps
  // the "hidden categories still build, and show the empty-state message" test (site-pages.feature) exercising
  // real behavior rather than skipping for lack of anything to check.
  { slug: 'drafts', hidden: true },
];

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

// Categories to show in navigation and listings; excludes hidden ones.
export const VISIBLE_CATEGORIES = CATEGORIES.filter((c) => !c.hidden);
