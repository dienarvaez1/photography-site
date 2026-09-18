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
static files that get deployed — against four areas:

- **`content-integrity.feature`** — every photo's image file exists, no duplicate images within
  a category, frontmatter only uses schema fields, no leftover placeholder titles.
- **`category-config.feature`** — category slugs are unique, hidden categories are excluded from
  the visible list, every content folder maps to a configured category.
- **`site-pages.feature`** — every route builds without erroring, the nav menu and homepage
  category grid agree and stay alphabetical, hidden categories still build (just unlinked), the
  contact form matches whether `PUBLIC_WEB3FORMS_KEY` is set, gallery hover metadata is present.
- **`accessibility-and-compatibility.feature`** — no CSS uses the modern range media-query syntax
  that breaks on Safari <16.4/legacy Edge, the header dropdown trigger is a real focusable
  button, the lightbox has dialog ARIA semantics, every image has an alt attribute, `_headers`
  declares the baseline security headers.

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

Add an entry to `CATEGORIES` in `src/config/categories.ts` (slug, label, description), then
create a matching `src/content/photos/<slug>/` folder with photo entries. Navigation, routing
(`/work/<slug>/`), and the homepage category grid all pick it up automatically.

## Contact form (free, no backend)

The contact form uses [Web3Forms](https://web3forms.com/) — free, unlimited submissions
delivered straight to your email, no signup wall beyond entering your email for an access key.

1. Get a free access key at https://web3forms.com/.
2. Copy `.env.example` to `.env` and set `PUBLIC_WEB3FORMS_KEY`.
3. In Cloudflare Pages, add the same variable under **Settings → Environment variables** for
   the Production (and Preview) environment.

Until this key is configured, the contact page shows a plain "email me directly" notice instead
of a non-functional form.

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
