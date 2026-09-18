# Photography Portfolio

A fast, free-to-host photography portfolio built with [Astro](https://astro.build). Organizes
work into categories (real estate, landscape, portrait, astro, pets, public events — easy to add
more), auto-optimizes every photo (resized + converted to WebP at build time), and includes a
lightbox gallery, SEO tags, sitemap, and a working contact form — all without a paid backend.

## Commands

| Command             | Action                                         |
| :------------------- | :---------------------------------------------- |
| `npm install`        | Install dependencies                            |
| `npm run dev`         | Start local dev server at `localhost:4321`      |
| `npm run build`       | Build the production site to `./dist/`          |
| `npm run preview`     | Preview the production build locally            |
| `npm run astro check` | Type-check the project                          |
| `npm test`            | Run the automated test suite (see Testing below) |

## Testing

Automated tests live in `features/` as Gherkin scenarios run by
[Cucumber.js](https://github.com/cucumber/cucumber-js):

```sh
npm test
```

This builds the site once (`npm run build`), then checks the actual built output — the same
static files that get deployed — against seven areas. **Every page-level check runs against every
page in both English and Spanish** (the 20 routes listed in `features/support/lib.js`); expected
text is read from `src/i18n/<locale>.json`, so tests follow the page's own language.

- **`content-integrity.feature`** — every photo's image file exists, no duplicate images within
  a category, frontmatter only uses schema fields, no leftover placeholder titles, and every
  photo has a title for each non-default locale.
- **`category-config.feature`** — category slugs are unique, every category has a label and
  description in every locale file, hidden categories are excluded from the visible list, every
  content folder maps to a configured category.
- **`site-pages.feature`** — every route builds without erroring, **the build output exactly
  matches the tested route list** (a new page that isn't listed fails), the nav menu and homepage
  category grid agree and stay alphabetical (in each language's own order), hidden categories
  still build (just unlinked, with the localized empty message), localized skip link / nav /
  footer, the contact form matches whether `PUBLIC_WEB3FORMS_KEY` is set, every category page
  shows all its photos with hover metadata.
- **`contact-form-configuration.feature`** — `PUBLIC_WEB3FORMS_KEY` and `PUBLIC_WEB3FORMS_KEY_ES`
  are each set, look like valid keys and differ, both contact pages render the real form (not the
  fallback notice), each page's `access_key` matches its own language's key, it posts to the Web3Forms API, every required field is present, and the
  labels/button/status messages are in the page's language while option values stay English.
- **`localization.feature`** — locale files define identical keys, hreflang (`en`/`es`/`x-default`),
  canonical and `og:locale` are correct on every page, the switcher links to the equivalent page,
  pages never link into the other language, Spanish pages differ from their English twins, and the
  sitemap carries hreflang alternates.
- **`language-detection.feature`** — country→language map, precedence (own choice > country >
  English), Cloudflare trace parsing, the full redirect flow against a fake browser (Mexico →
  `/es/`, USA stays, failures/timeouts/bots/blocked storage stay put, query and hash preserved),
  and that only the English home page ships the detection script.
- **`accessibility-and-compatibility.feature`** — no CSS uses the modern range media-query syntax
  that breaks on Safari <16.4/legacy Edge, the "Work" trigger is a real button, the language
  switcher is a labelled group, every gallery page has a dialog lightbox with localized control
  labels, every image on every page has alt text, new-tab links use `noopener noreferrer`, every
  page's `<html lang>` matches its URL, `_headers` declares the baseline security headers.

Add new scenarios in `features/*.feature` and their step definitions in
`features/step_definitions/`; shared helpers (reading content files, parsing built HTML) live in
`features/support/lib.js`.

## Adding photos (git-based workflow)

Photos live in `src/content/photos/<category>/`, one Markdown file per photo, with the image
file colocated alongside it. To add a photo:

1. Drop your image file into `src/content/photos/<category>/images/` (any reasonable filename).
2. Create a Markdown file next to the category folder, e.g.
   `src/content/photos/landscape/yosemite-sunrise.md`:

   ```md
   ---
   title: "Yosemite Sunrise"
   category: "landscape"
   image: "./images/yosemite-sunrise.jpg"
   alt: "Sunrise over Half Dome, Yosemite Valley"
   description: "Shot from Tunnel View at first light."
   location: "Yosemite National Park, CA"
   camera: "Sony A7IV, 24-70mm"
   date: 2026-05-10
   featured: true
   order: 1
   ---
   ```

3. Commit and push. Cloudflare Pages rebuilds and redeploys automatically (see Deployment below).

Notes:

- `category` must match one of the slugs in `src/config/categories.ts`.
- `featured: true` surfaces the photo in the homepage "Featured" section.
- `order` controls sort position within a category (lower first); ties fall back to `date`.
- Delete the placeholder gradient images (`placeholder-*.md` / `placeholder-*.jpg`) in each
  category folder once you have real photos there — they only exist so the site isn't empty
  out of the box. `scripts/generate-placeholders.mjs` is the tool that generated them; delete
  the script too whenever you no longer need it.

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
3. In Cloudflare, add **the same variables** under **Settings → Environment variables** for the
   Production (and Preview) environment. `.env` is git-ignored, so a Git-connected Cloudflare
   build won't see it otherwise. If `PUBLIC_WEB3FORMS_KEY_ES` is missing there, the Spanish page
   quietly falls back to the English form (`npm test` will flag it locally, but can't see
   Cloudflare's settings).

Until a key is configured, the contact page shows a plain "email me directly" notice instead
of a non-functional form. Access keys are public by design (they appear in the page HTML).

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
4. Add the `PUBLIC_WEB3FORMS_KEY` environment variable (see above) if you're using the contact form.
5. Deploy. You'll get a free `<project-name>.pages.dev` URL immediately.
6. Update `site` in `astro.config.mjs` and `SITE.url` in `src/config/site.ts` to your real
   `.pages.dev` URL (needed for correct sitemap/canonical/OG URLs), then push again.

Every subsequent `git push` automatically rebuilds and redeploys — this is the whole
"add photos → commit → push" workflow described above.

**Alternative: deploy without connecting GitHub**

```sh
npm run build
npx wrangler pages deploy dist
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
│   └── site.ts         # site title, author, contact email, social links
├── content/
│   └── photos/<category>/   # one .md per photo + colocated images/
├── content.config.ts   # photo content collection schema
├── components/         # Header, Footer, Gallery (with lightbox), SEO, CategoryCard
├── layouts/
│   └── BaseLayout.astro
└── pages/
    ├── index.astro
    ├── about.astro
    ├── contact.astro
    └── work/[category].astro   # generates /work/<slug>/ for every category
```
