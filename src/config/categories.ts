export interface Category {
  slug: string;
  // Set true to temporarily hide the category from nav/listings without deleting it.
  hidden?: boolean;
}

// Add a new category by adding an entry here, then add its `label` and
// `description` under "categories" in every locale file (src/i18n/*.json)
// and create a matching folder under src/content/photos/<slug>/.
export const CATEGORIES: Category[] = [
  { slug: 'real-estate', hidden: true },
  { slug: 'landscape' },
  { slug: 'portrait' },
  { slug: 'astro' },
  { slug: 'pets' },
  { slug: 'nature' },
  { slug: 'events' },
];

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

// Categories to show in navigation and listings; excludes hidden ones.
export const VISIBLE_CATEGORIES = CATEGORIES.filter((c) => !c.hidden);
