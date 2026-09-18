import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { CATEGORIES } from './config/categories';

const categorySlugs = CATEGORIES.map((c) => c.slug) as [string, ...string[]];

const photos = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/photos' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      category: z.enum(categorySlugs),
      image: image(),
      camera: z.string().optional(),
      copyright: z.string().optional(),
      featured: z.boolean().default(false),
      // Lower numbers sort first within a category; ties fall back to date desc.
      order: z.number().default(0),
    }),
});

export const collections = { photos };
