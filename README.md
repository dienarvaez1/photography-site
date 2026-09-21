# Photography Portfolio

A fast, free-to-host photography portfolio built with [Astro](https://astro.build). Organizes
work into categories (real estate, landscape, portrait, astro, pets, public events — easy to add
more), serves every photo from Cloudflare R2 (resized + converted to WebP when a photo is added),
and includes a lightbox gallery, SEO tags, sitemap, and a working contact form — all without a
paid backend.

## Commands

| Command                         | Action                                                              |
| :------------------------------ | :------------------------------------------------------------------ |
| `npm install`                   | Install dependencies                                                |
| `npm run dev`                   | Start the local dev server at `localhost:4321`                      |
| `npm run build`                 | Build the production site to `./dist/` (runs the key guard first)   |
| `npm run preview`               | Preview the production build locally                                |
| `npm run astro check`           | Type-check the project                                              |
| `npm run generate-types`        | Regenerate the Cloudflare binding types (`wrangler types`)          |
| `npm test`                      | Run the offline test suite (see Testing)                            |
| `npm run test:browser`          | Run the real-browser tests in Chromium (see Testing)                |
| `npm run deploy`                | **Guarded deploy**: keys + tests + photo check, build, deploy, live smoke check |
| `npm run deploy:unchecked`      | Build and deploy without the checks (emergencies only)              |
| `npm run smoke`                 | Check the live site (or `-- <url>`); `-- --wait` retries for 2 minutes |
| `npm run photos -- help`        | Add / replace / remove / verify photos in R2 (see Photos)           |

## Testing

Tests live in `features/` as Gherkin scenarios run by
[Cucumber.js](https://github.com/cucumber/cucumber-js). There are two suites:

```sh
npm test                # ~370 scenarios; builds the site, needs no network and no browser
npm run test:browser    # ~100 scenarios in real Chromium (Playwright); also offline
```

The browser tests need Chromium once: `npx playwright install chromium`. They stub every
network call — R2 photos, Web3Forms, Cloudflare's location lookup — so they never touch the
internet and can never send you a real message. CI runs both suites on every push.

`npm test` builds the site once (`npm run build`), then checks the actual built output — the
same static files that get deployed — against sixteen areas. **Every page-level check runs
against every page in both English and Spanish**; expected text is read from
`src/i18n/<locale>.json`, so tests follow the page's own language.

- **`content-integrity.feature`** — every entry is `<category>/images/<photo id>.md` (file name = its
  photo id), references its photo in R2 by a valid id and size, has no `exif`/`copyright` field (only
  `camera`), no GPS/serial data, and no photo files are stored in the repo; the site code never
  processes photos or calls R2 at build time; no duplicate photos within a category; frontmatter only
  uses schema fields; every photo has a title for each non-default locale.
- **`category-config.feature`** — category slugs are unique, every category has a label and
  description in every locale file, hidden categories are excluded from the visible list, every
  content folder maps to a configured category.
- **`site-pages.feature`** — every route builds without erroring, **the build output exactly
  matches the tested route list** (a new page that isn't listed fails), the nav menu and homepage
  category grid agree and stay alphabetical (in each language's own order), hidden categories
  still build (just unlinked, with the localized empty message), localized skip link / nav /
  footer, the contact form matches whether a Web3Forms key is set, every category page shows all
  its photos loaded from the R2 URL derived from each entry, with its camera line on hover (and
  no copyright), and homepage category covers use each category's first photo.
- **`contact-form-configuration.feature`** — `PUBLIC_WEB3FORMS_KEY` and `PUBLIC_WEB3FORMS_KEY_ES`
  are each set, look like valid keys and differ, both contact pages render the real form (not the
  fallback notice), each page's `access_key` matches its own language's key, it posts to the
  Web3Forms API, every required field is present, and the labels/button/status messages are in the
  page's language while option values stay English.
- **`deployment.feature`** — the release-build key guard (which builds count, key format, and that
  the real script fails the way Cloudflare's Git build would hit it), the guarded `deploy` script
  order, the GitHub workflows, `robots.txt`, the localized 404 pages and their Cloudflare setting,
  and the Content-Security-Policy (strict scripts, allows exactly what the pages load, and no page
  contains an inline script, handler or style attribute).
- **`smoke.feature`** — the post-deploy smoke checker, run against the built site served the way
  Cloudflare serves it: a healthy site passes, and ten different broken deploys (keyless form, shared
  key, missing photo, blank 404, wrong robots, missing CSP, lost hreflang, …) each fail the right check.
- **`seo.feature`** — every page has a complete absolute share image; the branded image is really
  1200×630; category pages share their first photo; error pages carry none; the home pages publish
  valid JSON-LD (in each language) with only facts already public.
- **`performance.feature`** — per-page HTML/script/style budgets, every image reserves its space,
  logo file sizes, the logo is prioritised, gallery and category-card `srcset`s are correct for each
  photo, only the first row loads eagerly, and the size ladder is well-formed.
- **`html-quality.feature`** — every page is valid under `html-validate`'s strict recommended rules
  (none switched off); every internal link, image, script and stylesheet resolves; anchors and ARIA
  references have targets; ids are unique; headings are in order; links and buttons have accessible
  names; external links are safe; the sitemap and pages agree.
- **`photo-storage.feature`** — the photo workflow (add / replace / remove / verify / sync)
  against an in-memory fake of R2: correct buckets and sizes, rotation, and that a failed or
  corrupted upload never writes an entry or deletes your local file.
- **`photo-cli.feature`** — the real command-line code (fake R2): every new entry lands in
  `<category>/images/<photo id>.md` for every configured category, entries can be referred to by id,
  title or path, removed options (`--copyright`, `--slug`) are rejected, and bad input (e.g. an unknown
  category) is refused before anything is uploaded, created or deleted.
- **`photo-exif.feature`** — the camera line built from real JPEGs' EXIF: formatting rules, what is
  (and is never) stored, overrides, replace behaviour, and filling in missing camera lines.
- **`localization.feature`** — locale files define identical keys, hreflang (`en`/`es`/`x-default`),
  canonical and `og:locale` are correct on every page, the switcher links to the equivalent page,
  pages never link into the other language, Spanish pages differ from their English twins, and the
  sitemap carries hreflang alternates.
- **`language-detection.feature`** — country→language map, precedence (own choice > known country >
  browser language when the country is unknown > English), Cloudflare trace parsing, the full
  redirect flow against a fake browser, and that only the English home page ships the detection script.
- **`accessibility-and-compatibility.feature`** — no CSS uses range media-query syntax that breaks on
  older Safari/Edge, the "Work" trigger is a real button, the language switcher is a labelled group,
  every gallery page has a dialog lightbox with localized control labels, every image has alt text,
  new-tab links are safe, `<html lang>` matches the URL, **WCAG contrast ratios** (text 4.5:1,
  form-field borders and focus ring 3:1), reduced-motion CSS, and the contact form's no-JavaScript
  fallback.
- **`documentation.feature`** — the README lists every feature file (including the browser ones),
  states the right number of test areas, and documents every npm script and `photos:*` command.

The browser suite (`features/browser/*.feature`, all tagged `@browser`) drives real Chromium against
the built site served like Cloudflare serves it (with its `_headers` and 404 handling):

- **`lightbox.feature`** — opening moves focus into the dialog; Escape closes and returns focus;
  arrow keys wrap around; Tab and Shift+Tab stay inside; backdrop and buttons close; page scroll is
  locked while open; Spanish labels; works on a phone.
- **`navigation.feature`** — the mobile menu opens and collapses (Escape returns focus to its
  button); the Work submenu; keyboard tab order; the dropdown on keyboard focus; the skip link; the
  active page is marked; works in Spanish.
- **`language-and-location.feature`** — the switcher goes to the equivalent page and remembers the
  choice; a remembered choice beats the country; a first visit lands in the country's language
  (Mexico → Spanish, USA stays); the browser-language fallback; query and anchor survive the
  redirect; only the English home page redirects; crawlers never do; blocked storage is harmless.
- **`contact-form.feature`** — a message is sent and confirmed in the page's language, the form
  clears, the payload carries the page's own key and English category value; failures and outages are
  reported without losing what was typed; the button state while sending; browser validation; the
  invisible spam trap; and a plain form post with JavaScript off.
- **`accessibility.feature`** — an **axe** WCAG 2 A/AA audit of every page (both languages, laptop
  and phone), no sideways scrolling on any page, reduced-motion, visible focus, labelled fields with
  visible borders, and usability at 200% zoom.
- **`security-and-performance.feature`** — every page loads under the real Content-Security-Policy
  with no violations, errors or blocked requests; the policy is provably enforced (an injected inline
  script is blocked); the browser picks the right image size for phone, laptop and sharp screens;
  layout shift stays under 0.02 with slow images; the logos take their final space before loading.
- **`not-found.feature`** — unknown URLs get a real 404 status and the page in the right language,
  its links lead back, and its language switcher goes to the other home page.

Add new scenarios in `features/*.feature` (or `features/browser/` with `@browser`) and their step
definitions in `features/step_definitions/`; shared helpers live in `features/support/`
(`lib.js` for built HTML, `static-server.js`, `browser.js`, `photo-helpers.js`).

## Photos (stored in Cloudflare R2)

Photos are **not** stored in this repo or on your disk. Each photo is one small Markdown file in
git that points at its photo in R2. The file is named after the photo's id, so it maps 1:1 to its
objects in R2 (`photos/<id>/...`):

```text
src/content/photos/<category>/images/<photo id>.md      e.g. nature/images/b997ba44c64e5158.md
```

```md
---
title: "Rockfish"
titles:
  es: "Pez roca"
category: "nature"
photo:
  id: "b997ba44c64e5158"   # first 16 hex chars of the original's SHA-256 — also the file name
  width: 4000              # size of the original as displayed (EXIF rotation applied)
  height: 2667
camera: "Nikon Z 7 · NIKKOR Z 70-200mm f/2.8 VR S · 140mm · f/5.6 · 1/125s · ISO 110"
featured: false
order: 3
---
```

That is every field an entry has. There is no `exif:` block and no `copyright:` line. The `camera`
line is the one piece of EXIF that is kept, because it is shown with each picture (see "Camera line"
below).

The `.md` holds no URL — the site builds URLs from `photo.id` and the base URL in
`src/config/photos.ts`, so moving to a custom domain later is a one-line change.

| Bucket                       | Access  | Holds                                               |
| :--------------------------- | :------ | :-------------------------------------------------- |
| `photography-site-originals` | private | `photos/<id>/original.jpg` — your full-resolution file |
| `photography-site-web`       | public (r2.dev) | `photos/<id>/{w400,thumb,cover,w1000,full}.webp` — the sizes the site shows (400 / 700 / 900 / 1000 / 2000 px wide) |

Keys are content-addressed, so a changed photo always gets a new id and web files are cached
forever (`immutable`). Your originals are never publicly reachable.

### Workflow

All commands use your existing `wrangler login` — no extra keys.

```sh
# Add a photo: uploads it, checks it arrived, reads the camera line from its EXIF, writes
# <category>/images/<photo id>.md, and deletes your local file.
# --category must be a slug from src/config/categories.ts (a typo is refused, nothing is created).
npm run photos:add -- ~/Desktop/rockfish.jpg --category nature --title "Rockfish" --title-es "Pez roca" --order 3
#   --camera "..." overrides the camera line built from EXIF

npm run photos:replace -- rockfish ~/Desktop/rockfish-v2.jpg   # new photo; the file is renamed to the new id
npm run photos:remove  -- rockfish                             # entry + its R2 files
npm run photos:camera                                          # fill in camera lines that are missing
npm run photos:verify                                          # is every entry's photo in R2?
npm run photos:verify -- --deep                                # also re-download originals and check hashes
npm run photos:sync                                            # rebuild missing web sizes from the original in R2
```

An `<entry>` (in `replace`, `remove`, `camera`) is its photo id, its title, or the path to its `.md`.

Then commit the `.md` (and deploy as usual). What keeps entry and R2 in sync:

- **Order of operations:** upload → read the original back and compare its hash → confirm the web
  sizes are served → *only then* write the `.md` → *only then* delete your local file. A failure at
  any point leaves no `.md` pointing at missing files and never removes your only copy.
- **Replace / remove** delete the old photo's R2 files, unless another entry uses the same photo.
  Replace also renames the entry's file to the new photo id.
- Adding the same photo to the same category twice is refused (the file name would be identical).
- **`photos:verify`** is read-only and exits 1 if anything is missing — run it before deploying.
  It needs network; `npm run build` and `npm test` never do.
- **`photos:sync`** is the repair tool, e.g. after changing `PHOTO_VARIANTS` widths.
- **`photos:camera`** fills in a *missing* camera line from the original in R2 (all entries, or one:
  `photos:camera rockfish`). An entry that already has a camera line is never touched.
- The same file added twice gets the same id, so uploads are idempotent and shared safely.
### Camera line

When a photo is added (or replaced), the camera line is built from its EXIF: camera, lens, focal
length, aperture, shutter speed and ISO — like
`Nikon Z 7 · NIKKOR Z 70-200mm f/2.8 VR S · 140mm · f/5.6 · 1/125s · ISO 110`. The gallery shows it
when you hover a picture.

- **Only the camera line is stored.** No `exif:` block, no `copyright:`, no dates. **GPS position,
  serial numbers, the artist name and the copyright are never read**, because the `.md` files are
  committed to git. The original in R2 keeps all of its EXIF untouched.
- **Overrides:** `--camera "..."` on `photos:add` / `photos:replace` sets the line by hand (say, to add
  `+ TC-2.0x`). On `replace` the line is `--camera`, else the new photo's EXIF, else the entry's
  existing line — a camera line is never lost.
- A photo without camera info in its EXIF simply gets no `camera` line.

### Notes on R2

- R2 can't be listed with wrangler, so the `.md` files are the source of truth. Files in R2 that no
  `.md` references (only possible if you delete objects by hand) aren't detected; remove photos with
  `photos:remove`, not the dashboard.

Builds and `npm test` need **no network access to R2** (and no photo files): the build only reads
the `.md` files and writes plain `<img>` URLs. The tests prove this by checking the site code never
processes photos or calls R2, and `photo-storage.feature` runs the whole workflow against a fake R2.

Notes:

- `category` must match one of the slugs in `src/config/categories.ts`.
- `featured: true` surfaces the photo in the homepage "Featured" section.
- `order` controls sort position within a category (lower first).
- Photos are already in git *history* from before the move to R2; clones stay large until that
  history is rewritten (not done automatically — it needs a force-push).
- The public bucket uses Cloudflare's `r2.dev` address, which Cloudflare rate-limits and doesn't
  recommend for heavy production traffic. To move to a custom domain later: add it to the web
  bucket (`wrangler r2 bucket domain add`) and update `PHOTOS_BASE_URL` in `src/config/photos.ts`.

### Adding a new category

Add an entry to `CATEGORIES` in `src/config/categories.ts` (slug, optional `hidden`), add its
`label` and `description` under `categories` in **every** locale file (`src/i18n/*.json`), then
create a matching `src/content/photos/<slug>/` folder with photo entries. Navigation, routing
(`/work/<slug>/`), and the homepage category grid all pick it up automatically.

## Languages (English / Spanish)

The site uses Astro's built-in i18n routing. English is the default and lives at the root
(`/about/`); Spanish is under `/es/` (`/es/about/`). Every page exists in both languages, the
header has a language switcher that links to the equivalent page, and each page emits
`hreflang` alternates (plus `x-default` → English), `og:locale` tags, and sitemap alternates.

- **UI copy** lives in `src/i18n/en.json` and `src/i18n/es.json`. Use `t('group.key')` from
  `useTranslations(locale)` in `src/i18n/index.ts`; `{name}` placeholders take values. `es.json`
  must have the same shape as `en.json` (type-checked by `astro check`, and enforced by tests).
- **Pages** are under `src/pages/[...lang]/` — one file serves both languages.
- **Photo titles**: add an optional `titles` map to a photo's frontmatter, e.g.
  `titles: { es: "Pez roca" }`. Photos without one fall back to `title`.
- **Adding a language**: add the code to `src/i18n/config.ts`, create `src/i18n/<code>.json`
  (copy `en.json`) and register it in `src/i18n/index.ts`.

### Location-based default language

First-time visitors to the English home page (`/`) are sent to the language of their country:
a visitor in Mexico lands on `/es/`, a visitor in the USA stays on `/`. The rules, in order:

1. **The visitor's own choice wins.** Clicking the `EN | ES` switcher remembers that choice
   (browser `localStorage`, key `preferred-locale`), and `/` never overrides it afterwards.
2. **Their country.** The browser asks Cloudflare `/cdn-cgi/trace` (served by Cloudflare on
   your own site — no third party, nothing stored) for the country of the visitor's IP.
3. **English** if the country isn't listed, or anything fails (offline, blocked storage,
   2.5 s timeout).

Design notes:

- The countries per language are one table, `LOCALE_COUNTRIES` in `src/i18n/geo.ts`. Spanish
  covers Spain, Latin America, Puerto Rico and Equatorial Guinea. To add a language, add its
  locale to `src/i18n/config.ts` and list its countries there.
- Detection only runs on `/`. Deep links (`/about/`, `/work/pets/`), `/es/...` pages, and
  crawlers are never redirected, so shared links and SEO (hreflang) behave predictably.
- It's a client-side check, so the site stays fully static; a first-time visitor in Mexico may
  briefly see the English page before being redirected. Returning visitors who chose a language
  skip the check entirely.
- Try it locally: in `astro dev`, open `http://localhost:4321/?geo=MX` (Cloudflare's trace
  endpoint doesn't exist locally). The override is not included in production builds. To reset
  a remembered choice, clear `preferred-locale` from your browser's local storage.

## Contact form (free, no backend)

The contact form uses [Web3Forms](https://web3forms.com/) — free, unlimited submissions
delivered straight to your email, no signup wall beyond entering your email for an access key.
Each language has its own Web3Forms form, so Spanish messages arrive separately from English ones:

| Page            | Environment variable       |
| :-------------- | :------------------------- |
| `/contact/`     | `PUBLIC_WEB3FORMS_KEY`     |
| `/es/contact/`  | `PUBLIC_WEB3FORMS_KEY_ES`  |

1. Get a free access key per form at https://web3forms.com/.
2. Copy `.env.example` to `.env` and set both variables.
3. In Cloudflare, add **the same two variables** under **Workers & Pages → photography-site →
   Settings → Builds → Variables and secrets**. `.env` is git-ignored, so Cloudflare's Git-connected
   build can't see it. **Until you do, every push makes that build fail** (see "Deploying safely"),
   which is the intended safety net: the last good deployment stays live.

Until a key is configured, the contact page shows a plain "email me directly" notice instead
of a non-functional form. Access keys are public by design (they appear in the page HTML).

## Deploying safely

Cloudflare builds and deploys on every `git push` (Workers Builds), and that build has no `.env`. It
used to publish the contact pages **without their Web3Forms keys** (a "not configured" notice instead
of the form) over a good local deploy. Three layers now prevent and detect that:

1. **A build guard.** `npm run build` first runs `scripts/check-build-env.mjs`. In a *release* build
   (Cloudflare's Git build — it sets `WORKERS_CI` — any CI, or `--require`) it fails unless both
   `PUBLIC_WEB3FORMS_KEY` and `PUBLIC_WEB3FORMS_KEY_ES` are set, look like keys, and differ. A failed
   build deploys nothing, so the previous good version stays live and the GitHub check turns red.
   Plain local builds are unaffected.
2. **A guarded deploy.** `npm run deploy` runs the key check, `npm test`, and `photos:verify`, then
   builds, deploys with wrangler, and finally smoke-checks the live site. Any failure stops it.
   `npm run deploy:unchecked` skips the checks; use it only if, say, R2 is unreachable.
3. **A smoke check.** `npm run smoke` fetches the live site as a visitor would: every page from the
   sitemap (lang, title, canonical, hreflang, not noindex), both contact forms (real form, own key,
   distinct keys, and — when the keys are in `.env` — exactly the configured ones), every R2 photo URL,
   real 404 pages in both languages, `robots.txt`, and all security headers. Point it at any URL:
   `npm run smoke -- https://example.com`; add `--wait` to retry while a deploy propagates.

**One-time setup you must do in the Cloudflare dashboard** (only you can; it's account settings):
Workers & Pages → photography-site → Settings → **Builds → Variables and secrets** → add
`PUBLIC_WEB3FORMS_KEY` and `PUBLIC_WEB3FORMS_KEY_ES` with the values from your `.env`. The keys are
public (they appear in the page HTML), so plain variables are fine. Then the Git build succeeds and
deploys the forms correctly on its own. The guard relies on that build using `npm run build`.

### Verifying that messages are delivered

The tests prove the forms are wired correctly, but **only a real message proves delivery** — Web3Forms
refuses server-side calls on the free plan, so a script can't check it. After any change to the keys,
send one real test message through `/contact/` and one through `/es/contact/` from a browser and
confirm both arrive in your inbox.

## Continuous integration and live monitoring

`.github/workflows/ci.yml` runs on every push and pull request: type-check, `npm test`, the browser
tests, and `npm audit`. On pushes to `main` it then waits five minutes for Cloudflare's build and
smoke-checks the live site. `.github/workflows/smoke.yml` runs the same smoke check every six hours
and on demand (Actions → Live smoke check → Run workflow); a failure emails the repo owner. CI uses
placeholder Web3Forms keys (the tests never send anything; the real keys stay in Cloudflare).

## Security headers

`public/_headers` sends HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, a referrer policy, a
permissions policy and a **Content-Security-Policy**: scripts only from the site itself (no inline,
no `eval`), images from the site and the R2 photo host, network calls only to the site and Web3Forms,
forms only to Web3Forms, no plugins, no framing. Astro is configured not to inline scripts
(`assetsInlineLimit: 0`) so this stays strict; styles may be inline. If you change the R2 address in
`src/config/photos.ts`, update the `img-src` host in `_headers` — a test fails if they disagree.

## Error pages

Unknown URLs get a real 404 status and a localized page (`src/pages/[...lang]/404.astro`, built as
`/404.html` and `/es/404.html`), via `assets.not_found_handling: "404-page"` in `wrangler.jsonc`.
Cloudflare serves the nearest `404.html`, so a mistyped `/es/...` URL gets Spanish. The pages are
`noindex`, carry no canonical or hreflang, stay out of the sitemap, and their language switcher
goes to the other language's home page. `robots.txt` is generated from `SITE.url`, so its sitemap
line can't drift from the real domain.

## SEO and sharing

Every page has an absolute `og:image` (with size and alt text) and matching `twitter:image`. Pages
share the branded `public/og-image.png` (1200×630); each category page shares its own first photo
(full size). The home pages (English and Spanish) also publish JSON-LD — a `WebSite` and a
`ProfessionalService` with the Portland address, email, and contact languages — containing only facts
already public on the site. Change the address in `SITE.address` (`src/config/site.ts`).

## Performance

Photos have five WebP sizes in R2 (`w400`, `thumb` 700, `cover` 900, `w1000`, `full` 2000). Gallery
thumbnails and category-card covers carry a `srcset` + `sizes`, so a phone downloads a smaller file
than a large screen (`photoSrcSet` never lists the same width twice for small photos). The first three
gallery photos load eagerly (the first with high priority); the rest lazily. Every image declares its
width and height so the page can't jump while loading; the header logos are right-sized (the small
icon went from 142 KB to 19 KB). `performance.feature` enforces per-page budgets (HTML 30 KB, scripts
10 KB, styles 25 KB — current pages are about half that). If you change `PHOTO_VARIANTS`, run
`npm run photos:sync` to create the new sizes for photos already in R2.

## Deployment to Cloudflare Pages (free)

This is a fully static site (`output: "static"`), which fits Cloudflare Pages' free tier:
unlimited requests/bandwidth, 500 builds/month, no cost until you outgrow it.

**Recommended: connect the GitHub repo (auto-deploys on every push)**

1. Push this project to a GitHub repository.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Build settings:
   - Framework preset: `Astro`
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Add both Web3Forms variables (see "Deploying safely"). Without them the build now fails on
   purpose, rather than publishing forms that can't send.
5. Deploy. You'll get a free `<project-name>.pages.dev` URL immediately.
6. Update `SITE.url` in `src/config/site.ts` (Astro's `site` setting and `robots.txt` follow it) to
   your real URL (needed for correct sitemap/canonical/OG URLs), then push again.

Every subsequent `git push` automatically rebuilds and redeploys — this is the whole
"add photos → commit → push" workflow described above.

**Alternative: deploy from your machine** (what this project's `npm run deploy` does, with checks):

```sh
npm run deploy
```

This asks you to log in to Cloudflare once, then uploads `dist/` directly. Useful for a first
deploy or one-off pushes if you'd rather not connect a git provider yet.

### Adding a custom domain later

Cloudflare Pages custom domains are also free. In your Pages project: **Custom domains → Set up
a domain**, and follow the DNS instructions (trivial if the domain's nameservers are already on
Cloudflare). No plan change needed.

### When you might start paying

The free tier covers a typical portfolio site indefinitely (Cloudflare Pages has no bandwidth
cap). You'd only consider a paid plan if you outgrow the platform's build-minutes limit or later
add server-side features (e.g. Cloudflare Workers-based APIs, R2 storage beyond the free 10GB) —
none of which this site currently needs.

## Project structure

```text
src/
├── config/
│   ├── categories.ts   # category taxonomy (add new categories here)
│   ├── photos.ts       # R2 buckets, public photo URL, web sizes, srcset helper, key layout
│   ├── site.ts         # language-independent site facts (URL, email, address)
│   └── web3forms.ts    # which Web3Forms key each language's form uses
├── content/
│   └── photos/<category>/images/   # one <photo id>.md per photo (the photo itself is in R2)
├── content.config.ts   # photo content collection schema
├── components/         # Header, Footer, Gallery (lightbox), SEO (+JSON-LD), CategoryCard, GeoRedirect
├── i18n/               # en.json, es.json, helpers, and geo.ts (location-based default language)
├── layouts/
│   └── BaseLayout.astro
└── pages/
    ├── robots.txt.ts   # generated from SITE.url
    └── [...lang]/      # one file serves both / and /es/
        ├── index.astro, about.astro, contact.astro, 404.astro
        └── work/[category].astro   # generates /work/<slug>/ for every category
public/                 # _headers (security headers + CSP), og-image.png, logos, favicon
scripts/
├── photos.mjs          # `npm run photos:*` entry point
├── check-build-env.mjs # release-build key guard (runs before `npm run build`)
├── smoke.mjs           # `npm run smoke`
└── lib/                # cli, photos (workflow), exif, r2-storage, build-env, smoke
features/               # Gherkin tests; features/browser/ = real-Chromium tests; support/ = helpers
.github/workflows/      # ci.yml (tests + live smoke on push), smoke.yml (every 6 hours)
cucumber.js             # default profile skips @browser; `--profile browser` runs only those
```
