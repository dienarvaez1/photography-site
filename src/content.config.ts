import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { CATEGORIES } from './config/categories';
import { PHOTO_ID_PATTERN } from './config/photos';

const categorySlugs = CATEGORIES.map((c) => c.slug) as [string, ...string[]];

const photos = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/photos' }),
  schema: z.object({
    title: z.string(),
    // Optional per-locale titles, e.g. `titles: { es: "..." }`. Locales
    // without an entry fall back to `title`.
    titles: z.record(z.string(), z.string()).optional(),
    category: z.enum(categorySlugs),
    // The photo itself lives in R2, not in the repo. `id` is the content hash of the
    // original and `width`/`height` its displayed size; run `npm run photos:add` to
    // create entries (see README). Astro's image helper is deliberately not used: it needs local files.
    photo: z.object({
      id: z.string().regex(PHOTO_ID_PATTERN, 'must be a 16-character hex content id'),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    // The camera line shown on the gallery, read from the photo's EXIF when it is added
    // (`npm run photos:add`). No copyright, dates, GPS or serial numbers are stored.
    camera: z.string().optional(),
    featured: z.boolean().default(false),
    // Lower numbers sort first within a category; ties fall back to date desc.
    order: z.number().default(0),
  }),
});

export const collections = { photos };
