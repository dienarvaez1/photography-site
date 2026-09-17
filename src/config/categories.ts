export interface Category {
  slug: string;
  label: string;
  description: string;
}

// Add a new category by adding an entry here, then create a matching
// folder under src/content/photos/<slug>/ with your photo entries.
export const CATEGORIES: Category[] = [
  {
    slug: 'real-estate',
    label: 'Real Estate',
    description: 'Interior and exterior photography for listings and properties.',
  },
  {
    slug: 'landscape',
    label: 'Landscape',
    description: 'Natural scenery, wide vistas, and travel landscapes.',
  },
  {
    slug: 'portrait',
    label: 'Portrait',
    description: 'Individual and group portraits, studio and on-location.',
  },
  {
    slug: 'astro',
    label: 'Astrophotography',
    description: 'Night sky, stars, and long-exposure celestial photography.',
  },
  {
    slug: 'pets',
    label: 'Pets',
    description: 'Portraits and candid moments of animal companions.',
  },
  {
    slug: 'events',
    label: 'Social Events',
    description: 'Weddings, parties, and gatherings.',
  },
];

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}
