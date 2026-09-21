/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Build the whole site from the sample library as static pages (the tests do); see src/lib/photo-entries.ts. */
  readonly PHOTOS_SNAPSHOT: boolean;
}
