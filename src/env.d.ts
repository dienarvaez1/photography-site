/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Build the whole site from the sample library as static pages (the tests do); see src/lib/photo-entries.ts. */
  readonly PHOTOS_SNAPSHOT: boolean;
  /** Web3Forms access keys (public by design); see src/config/web3forms.ts. Unset in an environment with no key. */
  readonly PUBLIC_WEB3FORMS_KEY: string | undefined;
  readonly PUBLIC_WEB3FORMS_KEY_ES: string | undefined;
  /** Which code this build is, stamped in by astro.config.mjs (see scripts/lib/build-info.mjs): its label (the release
   *  tag, else the short commit hash), the full commit hash (null when unknown) and when it was built (ISO 8601, UTC). */
  readonly BUILD_LABEL: string;
  readonly BUILD_COMMIT: string | null;
  readonly BUILD_TIME: string;
}

/** The dev box (`development`: the owner's computer) or `production`; stamped in by astro.config.mjs from SITE_ENV
 *  (scripts/lib/build-env.mjs siteEnv). Decides which Admin buttons show. */
declare const __SITE_ENV__: 'development' | 'production';
