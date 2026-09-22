/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Build the whole site from the sample library as static pages (the tests do); see src/lib/photo-entries.ts. */
  readonly PHOTOS_SNAPSHOT: boolean;
  /** Web3Forms access keys (public by design); see src/config/web3forms.ts. Unset in an environment with no key. */
  readonly PUBLIC_WEB3FORMS_KEY: string | undefined;
  readonly PUBLIC_WEB3FORMS_KEY_ES: string | undefined;
}
