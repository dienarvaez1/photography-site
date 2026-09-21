# Photography Portfolio

A fast, free-to-host photography portfolio built with [Astro](https://astro.build). Organizes
work into categories (real estate, landscape, portrait, astro, pets, public events, other — easy to add
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
| `npm run test:record`           | Run both suites with reporters, then store the results in R2 (see Test results) |
| `npm run results:publish`       | Upload `test-results/` to R2 as one run (also `results:list`, `results:show`, `results:trend`, `results:prune`, or `npm run results -- help`) |
| `npm run results-api:dev`       | Run the results API locally at `localhost:8788` (see Admin page)    |
| `npm run results-api:deploy`    | Deploy the results API Worker (see Admin page)                      |
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

`npm test` builds the site once as static HTML from the **sample library** in `test-fixtures/photos`
(`PHOTOS_SNAPSHOT=1 npm run build`: the real site renders its photo pages when they are requested, from R2, so the
tests bake in sample photos instead), then checks that built output against twenty-four areas. The
production build is tested separately, in the real Workers runtime (`site-render.feature`). **Every page-level check runs
against every page in both English and Spanish**; expected text is read from
`src/i18n/<locale>.json`, so tests follow the page's own language.

- **`content-integrity.feature`** — (on the sample library; the real entries are checked by `photos:verify`)
  every entry is `<category>/images/<photo id>.md` (file name = its
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
- **`entry-sync.feature`** — the entries in R2 and their local mirror, through the real commands and a fake R2:
  adding, replacing, removing and filling in a camera line publish the entry's `.md` and the manifest
  (the `.md` first, the manifest last; on a removal or replacement the manifest changes *before* any photo file is
  deleted, so the site never lists a photo whose files are gone); an unchanged library writes nothing; a manifest
  that cannot be stored leaves the site as it was and keeps the local photo file; pulling gives a fresh folder every
  entry as the same text the tools write, picks up entries added or removed elsewhere, and refuses to overwrite
  changes never published (`--force` does); pushing publishes hand edits; `verify` also checks each entry's file;
  a manifest with an unusable entry is refused rather than silently losing it; and the manifest's format.
  **Where an uploaded photo's files end up:** `original.jpg` only in the private originals bucket (byte for byte the
  file sent, `image/jpeg`, cacheable forever), and the web sizes, the entry's `.md` (`photos/categories/<category>/<id>.md`,
  `no-cache`) and `photos/index.json` only in the public web bucket — each bucket holds *exactly* that, with nothing
  in the wrong one and no original ever public. `index.json` is checked for its exact content after one upload and
  after several (every field of every entry, sorted, older entries kept, a rotated photo at its displayed size), that
  each photo id is the hash of its original in R2, that each entry equals the front matter of its `.md` in R2, and
  that an upload's files go up in the order original → web sizes → entry file → manifest. Failures leave R2 safe: no
  original, a failed web size or a failed entry file publishes nothing, a failed manifest leaves the site as it was,
  and publishing again completes it. (These tests were also checked by breaking the code on purpose: an entry file in
  the wrong bucket, a manifest missing an entry and a manifest written first each fail them.)
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
- **`test-results.feature`** — the R2 results store, checked against real Cucumber output from a small
  fixture suite: accurate summaries (counts, per-feature results, each failure with its step and
  reason, slowest scenarios), sortable run ids, what a published run contains and where (only under
  `results/`, never cached), the index written last so it never names a missing file, retention and
  pruning, flaky-scenario trends, the command line, the runner's plan, and the GitHub workflow steps.
- **`admin.feature`** — a basic smoke test of the Admin page: it exists in both languages, "Admin" is
  linked immediately to the right of "Contact" and marked active on its own page, it has exactly two
  tabs ("Test Results", then "Pics Viewer") in a horizontal, labelled tab list wired to two panels with the
  first selected, a no-JavaScript fallback, and it is `noindex` and out of the sitemap.
- **`results-api.feature`** — the read-only API behind the Admin page's Test Results tab, called through its
  real request handler over runs published by the real publisher: every data route needs the admin
  token (missing, wrong, near-miss and Basic credentials are refused; no secret set means a 503), the
  health check, `index.json` and `latest.json` served exactly as stored (an empty store gives an empty
  list), signed file links (right content types, sandboxed HTML reports, zip downloads; a changed,
  removed, re-pointed or expired link, or one signed with an old token, opens nothing), path-escape
  attempts never reaching the bucket, GET-only, only allowed origins may read answers from a browser
  (and preflight), no response ever contains the token, nothing cached, and the Worker's config is
  bound to the right bucket, read-only, with origins matching the site's config. One scenario runs the same
  code in the real Workers runtime (workerd, via `wrangler dev`) over a real local R2 bucket.
- **`results-viewer.feature`** — the viewer's pure logic (which address shows the list or a run, durations,
  dates in both languages, totals wording, which API address is used and when `?api=` may override it,
  which links are ever followed, sorting a run's files) and what is built: the viewer in both languages
  pointed at the configured API, no token or bucket address in any page or script, the viewer only ever
  writes text (never HTML), and the token lives only in `sessionStorage`.
- **`pics-viewer.feature`** — the Pics Viewer's half of the API and its logic, against real JPEG files (real
  EXIF and XMP metadata, megabytes of picture data): the list holds exactly the `photos/<id>/original.*`
  files with their real sizes (other files never listed, pagination, an incomplete list says so); one
  photo's camera line, size, copyright (EXIF, XMP, an empty field is "none") and artist; only the first
  128 KB of a file is ever read; location, serial numbers, dates and everything else in the metadata are
  never passed on; no answer holds picture data; bad ids, access rules, read-only; the same code in the real
  Workers runtime over a local R2 bucket; file-size wording in both languages; how the list is joined with
  the site's photo entries; and that the built pages know every photo of the site, name the tab in both
  languages, and never name the originals bucket; thumbnails are the public web copies, scaled down, never up, and the viewer can make no image but that one.
- **`photo-form.feature`** — the Admin page's New Photo form, through its real request handler with a fake R2
  and a temporary content folder: a photo is read for its id, its size as displayed (rotation applied) and its
  camera line, uploading and writing nothing; the order suggested is one past the highest in the category (not
  the count; 1 for an empty category), a typed order wins and two photos sent at once get different orders;
  the entry is written exactly like the site's others (the same text, in `<category>/images/<photo id>.md` in the local mirror, and published to R2), the
  original goes to the private bucket byte for byte and every web size to the public one; an edited or emptied
  camera line is respected; the same photo can join another category but not the same one twice; a PNG, a
  text file, a missing title, an unknown category, a bad order or an over-large upload is refused with
  nothing uploaded or written; a failed upload writes no entry; only the form's own page on localhost may use it;
  it is added to the dev server only and never built into the site; the built pages offer every category in
  the page's language; the messages match in English and Spanish; and the form's code only talks to its own
  service, writes text (never HTML) and never sends the admin token. With the entries in R2 the form is held to the
  same guarantees as the command: the original, the web sizes, the entry file and `index.json` each in the right
  bucket, the manifest exact (older entries untouched, the new one with its EXIF camera line), and a photo whose
  upload fails part-way is not listed.
- **`site-render.feature`** — the production build in the real Workers runtime (workerd, via `wrangler dev`) over a
  local copy of the web bucket that is changed while the site runs: the home, category and Admin pages are left to the
  Worker (and listed in the sitemap) while about, contact and the error pages are built; category pages list the
  bucket's photos in order, in the right language, from the public photo address; the home page shows featured photos
  and a cover per category; **a photo published to the bucket is on the site at once, and gone once removed, with no
  build and no deploy**; a missing, unreadable or wrong-version manifest is a 500, never an empty gallery; one unusable
  entry is skipped; unknown addresses get the localized 404 page with a real 404 status; `/work/astro` redirects to
  `/work/astro/`; and pages the Worker renders carry the security headers of `public/_headers` (Cloudflare applies that
  file to files only), are never cached, and pass the same HTML, SEO and no-inline-script checks.
- **Idle sign-out** — (in `admin.feature`) the timeout is 5 minutes, configured in one place and documented,
  which events count as being there, the reminder is translated with the minutes filled in from the
  configuration, and the built pages contain the timeout.
- **Header buttons** — (in `results-viewer.feature`) the built pages hold Refresh and Sign out in the header
  beside the title, hidden until a sign-in and never inside a tab, in both languages; and only those buttons
  can refresh or sign out.
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
- **`admin.feature`** (browser) — the two tabs really sit side by side on laptop and phone; clicking,
  arrow keys, Home/End (with wrap-around), deep links like `/admin/#pics-viewer`, Spanish, no-JavaScript, and
  the header link to the right of Contact all behave, with no errors or CSP violations.
- **`results-viewer.feature`** (browser) — the Test Results tab against the real results API code and a
  fake bucket: the token gate (wrong, forgotten on sign-out, expired, no token on the server, keyboard
  only), `latest.json` and `index.json` as the only requests to start, opening every run (list, latest
  card, Back button, reload, direct links, unknown run, keyboard), suites, failures shown as plain text
  (a failure message containing HTML stays text), reports opening in new tabs from the API, screenshot
  and trace evidence, empty store, unreachable API and recovery, no requests while another tab is
  showing, Spanish, an axe audit and no sideways scrolling in every state, no errors or CSP violations.
- **`pics-viewer.feature`** (browser) — the Pics Viewer against the real API code and fake buckets: Refresh
  and Sign out at the top of the page (across from the title, only while signed in, Refresh reloads only the
  tab showing, Sign out signs out of both, keyboard, Spanish, phone); the
  Upload Photos and Remove Photos buttons across from the counter (order, icons, size, keyboard, Remove Photos
  showing a message and asking for nothing, also with an empty bucket, in Spanish and on a phone); one
  sign-in for both tabs (sign-in and sign-out apply to each other), nothing requested until the tab is
  shown, the list by category and title (files the site doesn't use last) with a small thumbnail at the start of each row ("No thumbnail" where the site has no copy), the tooltip on hover, keyboard
  focus and tap (camera, size, copyright and artist; missing values say so; no picture in the tooltip), one tooltip at a time,
  Escape, moving away and clicking elsewhere close it, the pointer can move onto it, each file looked up
  once, the only pictures requested are the public 400-pixel copies (never an original) and only file headers are read, an empty bucket, a vanished file, an
  unreachable API, Spanish, an axe audit and no sideways scrolling in every state.
- **`photo-form.feature`** (browser) — the New Photo form in Chromium, with the dev server's real service behind
  it: Upload Photos opens it above the list (once; Close returns focus to the button; signing out closes it), it says
  it only works on your computer where there is no local service (the deployed site), choosing a photo shows
  its id, size and camera line, the order follows the category unless typed by hand, adding stores the photo and
  writes the entry (shown on screen), the camera line and order can be changed, a photo already in the category or a
  failed upload is reported with what was typed kept, a photo added with the entries in R2 ends up in the right buckets and the manifest, Spanish, every state passes the accessibility audit and
  fits a phone, and nothing but the site and the results API is requested.
- **`admin-timeout.feature`** (browser) — with the page's clock under the test's control: still signed in at
  4:55 and signed out at 5:00 (both tabs, whichever is showing, header buttons gone, token forgotten, tooltip
  closed, no more requests); a mouse move, key press, scroll, click or tap restarts the 5 minutes but the
  page's own refresh does not; a tab left longer than 5 minutes and reloaded is signed out, one reloaded
  sooner stays signed in; the reminder goes away on the next sign-in and never shows after a manual sign-out;
  it works with storage blocked, in Spanish, is announced to screen readers and passes the accessibility audit.
- **`failure-artifacts.feature`** — a browser scenario that fails (run for real, on purpose) leaves a
  real screenshot, a replayable Playwright trace and notes; a passing one leaves nothing; and those
  files are stored with the run in R2.
- **`not-found.feature`** — unknown URLs get a real 404 status and the page in the right language,
  its links lead back, and its language switcher goes to the other home page.

Add new scenarios in `features/*.feature` (or `features/browser/` with `@browser`) and their step
definitions in `features/step_definitions/`; shared helpers live in `features/support/`
(`lib.js` for built HTML, `static-server.js`, `browser.js`, `site-worker.js` for the production site in workerd,
`photo-helpers.js`, `memory-storage.js`).
`test-fixtures/` holds the tiny suites the results tests run for real.

## Test results in R2

Test reports are not kept in git or piled up on your disk: they go to a **private** R2 bucket,
`photography-site-test`, under `results/`.

```sh
npm run test:record                  # run both suites with reporters, then publish
npm run test:record -- --suite offline
npm run test:record -- --no-publish  # just write test-results/ (git-ignored)
npm run results:publish              # publish what is already in test-results/
npm run results:list                 # recent runs, newest first, with pass counts
npm run results:show                 # the latest run (or `-- <run id>`): failures with their step and reason
npm run results:trend                # scenarios that failed recently, and which look flaky
npm run results:prune -- --keep 50   # delete the oldest runs (the newest 100 are kept automatically)
```

What is stored for each run, at `results/runs/<run id>/` (the id is
`2026-09-21T04-30-12Z-<commit>-local`, with `-dirty` when there were uncommitted changes, or `-ci`):

- `offline.json` / `offline.html` and `browser.json` / `browser.html` — the Cucumber reports,
  and `smoke.json` when the smoke check was saved (`npm run smoke -- --out test-results/smoke.json`);
- `artifacts/browser/` — for every **failed** browser scenario, a full-page screenshot, a Playwright
  trace (open it with `npx playwright show-trace <file>.zip`) and a notes file (page, status, reason,
  console errors, CSP violations, blocked requests);
- `summary.json` — what ran and how it went: commit, branch, source, per-feature results, each
  failure with its step and reason, the slowest scenarios, and the list of files.

`results/index.json` (the list of runs, written last so it never names something that isn't there) and
`results/latest.json` sit beside `runs/`. Nothing is cached, so the newest results are always the ones read.

Uploads use your existing `wrangler login`, so locally there is nothing to configure. The bucket has
no public address and no page or header refers to it. View reports with `npx wrangler r2 object get
photography-site-test/results/runs/<run id>/offline.html --file report.html --remote`.

**Letting GitHub CI store results too (optional, needs you).** CI writes the reports either way; it
uploads them only if these two repository secrets exist (Settings → Secrets and variables → Actions):

1. `CLOUDFLARE_ACCOUNT_ID` — your account id (dashboard → Workers & Pages → right sidebar).
2. `CLOUDFLARE_API_TOKEN` — create it at dashboard → My Profile → API Tokens → Create Token → custom,
   with **Account · Workers R2 Storage · Edit**, ideally limited to this account. It can write to R2,
   so treat it as a secret.

Without them the "Store the test results in R2" step is skipped and CI behaves as before. The scheduled
smoke check stores its result the same way.

## Photos (stored in Cloudflare R2)

Photos **and their entries** live in Cloudflare R2 — nothing about a photo is in git, and showing a new photo needs
**no commit, no build and no deploy**. The site renders its home, category and Admin pages *when they are requested*,
reading the entries from R2, so a photo is on the site as soon as its entry is published (within a few seconds:
each running Worker keeps the entries for 10 seconds). Only the pages that show no photos (About, Contact, the error
pages) are built as static files.

Each photo has one small Markdown **entry** in the public web bucket, named after the photo's id, so it maps 1:1 to
the photo's objects (`photos/<id>/...`); next to them is a **manifest** listing every entry, which is what the site reads:

```text
photography-site-web/photos/categories/<category>/<photo id>.md   e.g. nature/b997ba44c64e5158.md   (one per entry)
photography-site-web/photos/index.json                 every entry's data in one sorted file (the site reads this)
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

The entry holds no URL — the site builds URLs from `photo.id` and the base URL in
`src/config/photos.ts`, so moving to a custom domain later is a one-line change.

| Bucket                       | Access  | Holds                                               |
| :--------------------------- | :------ | :-------------------------------------------------- |
| `photography-site-originals` | private | `photos/<id>/original.jpg` — your full-resolution file |
| `photography-site-web`       | public (r2.dev) | `photos/<id>/{w400,thumb,cover,w1000,full}.webp` — the sizes the site shows (400 / 700 / 900 / 1000 / 2000 px wide); `photos/categories/<category>/<id>.md` and `photos/index.json` — the entries |

Keys are content-addressed, so a changed photo always gets a new id and web files are cached
forever (`immutable`). Your originals are never publicly reachable. The entries and the manifest change, so they
are stored with `Cache-Control: no-cache`. (The entries are public, like the pages that show them: title, category,
order and camera line.)

### How the site reads them

`wrangler.jsonc` gives the Worker a binding, `WEB`, to the web bucket. A request for a page that shows photos makes
the Worker read `photos/index.json` (one read; kept for 10 seconds by each running Worker) and render the page from it
(`src/lib/photo-entries.ts`). Because Cloudflare's `_headers` file only applies to files, `src/middleware.ts` gives
those pages the same security headers, redirects `/work/nature` to `/work/nature/`, and serves the localized 404 page.

- **A missing or unreadable manifest is an error (a 500 page), never an empty gallery.** One entry the site cannot use
  is skipped (and logged); the rest still show.
- **In `npm run dev`** the pages read the same manifest over the bucket's public address, so you see your real photos.
- **Adding a category:** the pages find its photos by `category`; nothing else to do (see "Adding a new category").
- **The tests** build the site as static pages from the sample library in `test-fixtures/photos`
  (`PHOTOS_SNAPSHOT=1`), and run the real production build in workerd against a local bucket
  (`site-render.feature`).

### Workflow

All commands use your existing `wrangler login` — no extra keys. (You can also add a photo from the Admin page's
**New Photo form** while `npm run dev` is running: see *Admin page → Pics Viewer tab*.)

```sh
# Add a photo: uploads it, checks it arrived, reads the camera line from its EXIF, publishes its entry
# (photos/categories/<category>/<photo id>.md and the manifest), and deletes your local file. It is on the site now.
# --category must be a slug from src/config/categories.ts (a typo is refused, nothing is created).
npm run photos:add -- ~/Desktop/rockfish.jpg --category nature --title "Rockfish" --title-es "Pez roca" --order 3
#   --camera "..." overrides the camera line built from EXIF

npm run photos:replace -- rockfish ~/Desktop/rockfish-v2.jpg   # new photo; the entry moves to the new id
npm run photos:remove  -- rockfish                             # entry + its R2 files
npm run photos:camera                                          # fill in camera lines that are missing
npm run photos:verify                                          # is every entry's photo and entry file in R2?
npm run photos:verify -- --deep                                # also re-download originals and check hashes
npm run photos:sync                                            # rebuild missing web sizes from the original in R2
npm run photos:pull                                            # make the local mirror match R2 (--force discards local edits)
npm run photos:push                                            # publish the mirror (after editing an entry by hand)
```

An `<entry>` (in `replace`, `remove`, `camera`) is its photo id, its title, or the path to its `.md`.

**The local mirror.** The commands work on a folder of `.md` files, `.photo-entries/` (git-ignored), which is only a
mirror of R2: every command first makes it match R2 (`pull`) and, if it changes an entry, publishes it (`push`). To
change an entry by hand, run `photos:pull`, edit the `.md` in `.photo-entries/<category>/images/`, then run
`photos:push`. A pull refuses to overwrite edits that were never pushed (`--force` discards them). One machine at a
time: two computers changing entries at once could overwrite each other's manifest.

What keeps entry and R2 in sync:

- **Order of operations:** upload → read the original back and compare its hash → confirm the web
  sizes are served → *only then* publish the entry (its `.md`, then the manifest, which is what makes the photo
  appear) → *only then* delete your local file. A failure at any point leaves no entry pointing at missing files
  and never removes your only copy.
- **Replace / remove** publish the change *first* and only then delete the old photo's R2 files (unless another entry
  uses the same photo), so the live site never lists a photo whose files are gone.
- Adding the same photo to the same category twice is refused (the entry's name would be identical).
- **`photos:verify`** is read-only and exits 1 if anything is missing (including an entry's `.md`) — run it before
  deploying. It needs network; `npm run build` and `npm test` never do.
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
  serial numbers, the artist name and the copyright are never read**, because the entries are public.
  The original in R2 keeps all of its EXIF untouched.
- **Overrides:** `--camera "..."` on `photos:add` / `photos:replace` sets the line by hand (say, to add
  `+ TC-2.0x`). On `replace` the line is `--camera`, else the new photo's EXIF, else the entry's
  existing line — a camera line is never lost.
- A photo without camera info in its EXIF simply gets no `camera` line.

### Notes on R2

- R2 can't be listed with wrangler, so the **manifest is the registry** of entries. Files in R2 that the manifest
  doesn't list (only possible if you delete or add objects by hand) aren't detected; use the commands, not the dashboard.
- **Back up the entries.** They are no longer in git history. `photos:pull` gives you a copy in `.photo-entries/`; copy
  that folder somewhere safe now and then (the photos themselves are already in R2).

Builds and `npm test` need **no network access to R2** (and no photo files): the production build never reads an entry
(it is the Worker that does, per request), and the tests use a fake R2 (`photo-storage.feature`, `entry-sync.feature`)
or a local one (`site-render.feature`). The tests also prove the site code never processes photos at build time.

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
`label` and `description` under `categories` in **every** locale file (`src/i18n/*.json`), and deploy once
(the category's page and menu entry are part of the site). Then add photos with it (`--category <slug>`). Navigation,
routing (`/work/<slug>/`), and the homepage category grid all pick it up automatically.

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
- Detection is for visitors *arriving* on `/`: someone navigating within the site (a same-site referrer, e.g.
  clicking "EN" on the Spanish home page) is never guessed at, so they can't be bounced back even when
  their browser can't remember a choice. A remembered choice still always applies.
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
no `eval`), images from the site, the R2 photo host and the results API, network calls only to the site, Web3Forms and the results API,
forms only to Web3Forms, no plugins, no framing. Astro is configured not to inline scripts
(`assetsInlineLimit: 0`) so this stays strict; styles may be inline. If you change the R2 address in
`src/config/photos.ts`, update the `img-src` host in `_headers` — a test fails if they disagree.

## Admin page

`/admin/` (and `/es/admin/`) is linked in the header, to the right of Contact, and has two tabs side
by side: **Test Results** and **Pics Viewer** (in Spanish: *Resultados de pruebas* and *Visor de fotos*). The
tabs follow the WAI-ARIA tabs pattern: arrow keys, Home and End move between them, the selected tab is
in the URL (`/admin/#pics-viewer`), and without JavaScript both panels are shown.

**The Admin page signs out after 5 minutes of inactivity** (`src/config/admin.ts`): the token is forgotten,
both tabs return to the token form, and the form says why. Moving the pointer, pressing a key, scrolling,
clicking or touching the page counts as being there and restarts the 5 minutes; requests the page makes by
itself do not. A tab left for longer than that and then reloaded is signed out too. (While the tab is in the
background the browser slows timers down, so the sign-out happens when you come back to it at the latest.)

**Refresh and Sign out** are at the top of the page, across from the "Admin" title (they appear only while
you are signed in). Refresh reloads whichever tab is showing; Sign out forgets the admin token for both tabs.

### Test Results tab

It shows the runs stored in R2 (`photography-site-test`, under `results/`; see *Test results in R2*).
It starts from the store's two entry points — `latest.json` (the newest run, shown as a card) and
`index.json` (every run, newest first) — and any run can be opened: the address becomes
`/admin/#test-results/run/<run id>` (so a run can be linked to, and the browser's Back button works).
A run shows its result, commit, branch and source, a table of the suites (offline, browser, live
smoke), every failure with its feature, scenario, step and reason, the slowest scenarios, links to the
full HTML and JSON reports, and the screenshots, traces and notes saved for failed browser scenarios.

The results bucket stays **private**. The page reads it through a small read-only Worker,
`workers/results-api/` (deployed as `photography-site-results`; for the results it can only read
under `results/`). The page asks for an **admin token**, keeps it only for that browser tab
(`sessionStorage`; *Sign out* forgets it) and sends it in an `Authorization` header — never in an
address. Reports and screenshots open through short-lived (15 minute) signed links the Worker hands
out with each run, so nothing else needs the token; HTML reports are served sandboxed.

**One-time setup (needs you — it deploys a Worker and sets a secret):**

```bash
npm run results-api:deploy                                        # creates the Worker
npx wrangler secret put ADMIN_TOKEN -c workers/results-api/wrangler.jsonc   # 16+ characters, kept in Cloudflare only
npm run deploy                                                    # the site, so its CSP allows the Worker
```

Until the secret exists the Worker refuses everything. If the Worker gets another address, update
`src/config/results.ts` **and** `public/_headers` (a test fails if they disagree). To try it locally
with real data: `npm run results-api:dev` and open `http://localhost:4321/admin/?api=http://localhost:8788`
(the `?api=` override only works on localhost); the local Worker needs `--var ADMIN_TOKEN:<token>` or a
`.dev.vars` file (git-ignored).

### Pics Viewer tab

It lists the original photos in the private `photography-site-originals` bucket
(`photos/<id>/original.*`). Each file is a link named after its photo on the site (its title and
category, or "not on the site" for a file no entry uses) with its path. Each row starts with a small thumbnail of the photo. **Hover over a row, focus it with the
keyboard, or tap it** and a tooltip shows the file's camera information (the same line as the gallery),
its file size, and its copyright (and the artist, when the file has one); Escape, moving away or clicking
elsewhere closes it. Where the file has no camera data or no copyright notice, the tooltip says so.

Across from the photo counter ("20 original photos"), at the right, are two buttons: **Upload Photos**
(upload icon) and **Remove Photos** (trash icon). Upload Photos opens the **New Photo form** (below). Remove
Photos **does nothing yet**: it just says it isn't available (the API is read-only, so no removal can happen).

#### New Photo form

Press **Upload Photos** and a form opens above the list. It does what `npm run photos:add` does, from the browser:

1. **Photo (JPEG)** — choose the file. The form reads what the photo itself knows and shows it: its **photo id**
   (the first 16 characters of the file's SHA-256), its **size** as displayed (EXIF rotation applied) and its
   **camera line** (`Nikon Z 8 · NIKKOR Z 100-400mm f/4.5-5.6 VR S + TC-2.0x · 800mm · f/11 · 1/125s · ISO 640`),
   which you can edit or empty. Nothing else is kept from the EXIF (no copyright, dates, GPS or serial numbers).
2. **Title**, and optionally the **Spanish title**, and **Featured**.
3. **Category** — one of the slugs in `src/config/categories.ts`, named in the page's language.
4. **Order** — filled in as **one past the highest order already in the chosen category** (1 for an empty
   category), and updated when you change the category. Type your own number to keep it. Lower numbers show first.

**Add photo** uploads the original to the private originals bucket (`photos/<id>/original.jpg`) and the web
sizes to the public bucket, checks they arrived, and **publishes the entry to R2** (`photos/categories/<category>/<photo id>.md`
and the manifest), e.g.

```yaml
---
title: "Half Moon"
titles:
  es: "Media luna"
category: "astro"
photo:
  id: "4c4f46c18b70c4b5"
  width: 4505
  height: 2608
camera: "Nikon Z 8 · NIKKOR Z 100-400mm f/4.5-5.6 VR S + TC-2.0x · 800mm · f/11 · 1/125s · ISO 640"
featured: false
order: 3
---
```

The form shows the entry it published. **The photo is on the site now** — nothing to commit or deploy (pages may take
a few seconds to show it).
The same photo can be in more than one category, but not twice in the same one; only JPEGs are accepted (up to 100 MB).

**It only works on your own computer, in `npm run dev`.** Adding a photo needs your Cloudflare login (`wrangler login`,
the same as `photos:add`), and it works on the local mirror of the entries (`.photo-entries/`, brought up to date from
R2 before each request), so the form's service (`/__photos/`, in
`scripts/lib/photo-form.mjs`) is added to the dev server only: the build never includes it, and on the deployed
site the form says it only works while the site runs on your computer. Even in dev it answers only on `localhost`
and only requests coming from its own page (a page open in another tab cannot use it).

**The private originals are never shown, or even sent to the page.** The thumbnails are the site's own
public 400-pixel web copies of the photos (from the public photo host, the same files the gallery uses,
loaded lazily; a file the site has no entry for shows "No thumbnail"). The Worker lists the bucket and, for one file
at a time, reads only its first 128 KB to find the metadata (EXIF, and XMP for copyrights written there);
it returns numbers and text, nothing else — no location, serial number or date. It uses the same admin
token as the Test Results tab (one sign-in serves both), and its `ORIGINALS` binding is read-only.
After pulling this change, redeploy the Worker so it gets that binding: `npm run results-api:deploy`
(the token stays as it is).

**The page itself is still public.** This is a static site with no login, so anyone who knows the
address can open it and see the token prompt. It is marked `noindex` and left out of the sitemap, but
that is not protection; the token is what protects the results. For a real login in front of the whole
page, use [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/).

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
10 KB, styles 25 KB — current pages are about half that; the Admin pages, which carry the results
viewer and are opened only by you, may have 30 KB of scripts). If you change `PHOTO_VARIANTS`, run
`npm run photos:sync` to create the new sizes for photos already in R2.

## Deployment to Cloudflare Pages (free)

The site is deployed as a Cloudflare Worker with static assets (`npm run deploy`). Its About, Contact and error pages
are static files; the home, category and Admin pages are rendered by the Worker when requested, from R2 (see
"Photos"), which stays within Cloudflare's free tier for a portfolio's traffic (100,000 Worker requests a day).
Adding photos never needs a deploy.

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
│   ├── photo-manifest.ts # where entries live in R2, the manifest format and its checks
│   ├── results.ts      # the results API's address and the origins it accepts
│   ├── site.ts         # language-independent site facts (URL, email, address)
│   └── web3forms.ts    # which Web3Forms key each language's form uses
├── content.config.ts   # the entry schema, and the sample-library collection the tests build from
├── middleware.ts       # security headers, trailing slashes and the 404/500 pages for pages rendered on request
├── components/         # Header, Footer, Gallery (lightbox), SEO (+JSON-LD), CategoryCard, GeoRedirect
├── lib/                # photo-entries (reads the manifest from R2), the Admin viewers: admin-common, results-view/-viewer, pics-view/-viewer; logging
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
├── run-tests.mjs       # `npm run test:record`
├── results.mjs         # `npm run results:*`
└── lib/                # cli, photos (workflow), exif, exif-format, r2-storage, build-env, smoke, results, results-cli, test-runner
workers/results-api/    # read-only Worker serving the private results bucket to the Admin page
test-fixtures/          # tiny suites the results tests run for real
features/               # Gherkin tests; features/browser/ = real-Chromium tests; support/ = helpers
.github/workflows/      # ci.yml (tests + live smoke on push), smoke.yml (every 6 hours)
cucumber.js             # default profile skips @browser; `--profile browser` runs only those
```
