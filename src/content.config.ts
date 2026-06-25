import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Long-form writing. Drop a Markdown file in src/content/writing/ (see _example.md).
const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { writing };
