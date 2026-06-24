# Document Library – DCDD Policy Search & Collection Pages

## Overview

This repository holds the **source assets and compiled bundles** for two DCDD intranet pages rendered by [Squiz Matrix](https://www.squiz.net/platform/matrix), deployed via **Git File Bridge**:

| Page             | URL                                                                        | Role                                                             |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Document search  | `https://internal.nt.gov.au/dcdd/dev/policy-library/document-search`       | Filterable full-text Coveo search over all DCDD policy documents |
| Collection pages | e.g. `https://internal.nt.gov.au/dcdd/dev/policy-library/agency-templates` | Per-collection document listing pages (Agency Templates, etc.)   |

Both pages are part of the wider NTG (Northern Territory Government) intranet design system (`ntgc` prefix throughout). They share a common set of **CSS design tokens** defined in `src/css/tokens.css` and compiled into separate bundles by two independent Vite configs.

---

## Architecture at a glance

```
 GitHub repo (this)                              Squiz Matrix (production CMS)
 ──────────────────                              ─────────────────────────────
                                                 SEARCH PAGE paint layout
 src/css/tokens.css ──────────────────────┐      ├── <link>   search-page.css  ←── dist/search-page.css
 src/css/search-widget.css (imports tokens)┤      └── <script> search-page.js  ←── dist/search-page.js
 src/js/coveo-search.js ──────────────────┘
   ↓ vite.config.js (npm run build)              Nested containers (HTML fragments)
   └──────────────────────────────► dist/ ─ Git File Bridge ──► search-section.html (form)
                                                                 search-results.html (results)

 src/css/tokens.css ──────────────────────┐
 src/css/collection-page.css (imports ──  ┤      COLLECTION PAGE paint layout
   tokens)                                ┤      └── <link>   collection-page.css ←── dist/collection-page.css
   ↓ vite.collection.config.js (npm run build)
   └──────────────────────────────► dist/ (emptyOutDir: false — does NOT wipe search outputs)
```

**Key rule for agents and developers:** Edit source files in `src/css/`, `src/js/`, or `src/*.html`, then run `npm run build`. Always commit **both** `src/` changes and the regenerated `dist/` files together — the `dist/` files are what Git File Bridge delivers to Matrix.

**Dual-build rule:** `npm run build` chains two Vite builds: `vite build` (search bundle) then `vite build --config vite.collection.config.js` (collection bundle). The collection config **must** keep `emptyOutDir: false` to avoid wiping the search outputs. Never run the configs in parallel — they both write to `dist/`.

---

## Git File Bridge Deployment

[Git File Bridge](https://matrix.squiz.net/manuals/git-file-bridge) syncs specific files from this GitHub repository into Squiz Matrix file assets automatically on push.

**Files deployed to Matrix:**

| Local path                 | Matrix asset          | Used by                                                           |
| -------------------------- | --------------------- | ----------------------------------------------------------------- |
| `dist/search-page.js`      | `search-page.js`      | Search page paint layout `<script>` (after jQuery)                |
| `dist/search-page.css`     | `search-page.css`     | Search page paint layout `<link>`                                 |
| `dist/collection-page.css` | `collection-page.css` | Collection page paint layout `<link>`                             |
| `dist/search-section.html` | `search-section.html` | Squiz Matrix nested container — search form                       |
| `dist/search-results.html` | `search-results.html` | Squiz Matrix nested container — results area, filters, pagination |

> **`dist/` must be rebuilt before committing HTML fragment changes.** The `auto-rebuild-on-src-change` Vite plugin only watches `src/js/` and `src/css/`. Changes to `src/search-section.html` or `src/search-results.html` require a manual `npm run build` to update `dist/`.
>
> **`dist/collection-page.js`** is a tiny IIFE stub (< 1 kB). It is an artefact of the Vite IIFE bundle format and can be ignored. Only `dist/collection-page.css` is referenced by the collection page paint layout.

**`dist/` is intentionally committed to git.** Git File Bridge reads from the repository, so the built output must be present in the commit. It is **not** in `.gitignore`.

The HTML page template and vendor/third-party scripts are managed separately inside Matrix and are not deployed via this repository.

### Paint layout references

**Search page:**

```html
<!-- in the paint layout <head> -->
<link rel="stylesheet" href="%asset_file_path:search-page-css-asset-id%" />

<!-- at the bottom of the paint layout <body>, after jQuery -->
<script src="%asset_file_path:search-page-js-asset-id%"></script>
```

**Collection pages:**

```html
<!-- in the paint layout <head> -->
<link rel="stylesheet" href="%asset_file_path:collection-page-css-asset-id%" />
```

> **jQuery dependency:** The search page paint layout must load jQuery **before** `search-page.js`. The bundle is IIFE format and expects `$` / `jQuery` to be available as globals. `collection-page.css` is CSS-only and has no JS dependency.

### Nested containers (HTML fragments)

Both `dist/search-section.html` and `dist/search-results.html` are **bare HTML fragments** (no `<!DOCTYPE>`, `<html>`, `<head>`, or `<body>` tags). Each is pasted into a separate Squiz Matrix nested container asset on the document search page. The paint layout already loads `search-page.css` and `search-page.js`, so the fragments need no additional asset references.

| Fragment                   | Source                    | Matrix placement                 |
| -------------------------- | ------------------------- | -------------------------------- |
| `dist/search-section.html` | `src/search-section.html` | Nested container above main body |
| `dist/search-results.html` | `src/search-results.html` | Nested container in main body    |

Both HTML files are copied verbatim from `src/` to `dist/` by the `copy-search-section` Vite plugin — no transformation occurs.

### Matrix custom content relocation (`#asset-contents` → `#custom-content`)

The search results fragment contains a target container:

- `#custom-content` in `src/search-results.html` (propagated to `dist/search-results.html`, `search-section-preview.html`, and generated `index.html`).

At runtime, `src/js/coveo-search.js` initializes a relocation helper that moves child nodes from `#asset-contents` into `#custom-content`.
This is designed for Squiz Matrix scenarios where the source markup is injected after the page bundle has already executed.

Behaviour summary:

- Tries an immediate move on `$(document).ready(...)`.
- If `#asset-contents` is not present yet, uses `MutationObserver` to detect late insertion.
- Once source exists, observes child mutations and moves source children (move, not clone).
- Uses a one-time completion guard to prevent duplicate moves.
- Disconnects observers after success, with a bounded timeout fallback (30s) to prevent long-lived observers.

Operational note:

- Keep `#custom-content` in the template for this runtime hook. If the container ID changes, update the selectors in `src/js/coveo-search.js`.

### Vite plugins

1. **`copy-search-section`** (`closeBundle` hook): after each build, copies `src/search-section.html` → `dist/search-section.html` and `src/search-results.html` → `dist/search-results.html` verbatim, then calls `syncPreviewTemplate()` (see below).

2. **`auto-rebuild-on-src-change`** (`configureServer` hook, dev server only): watches `src/js/**/*.js`, `src/css/**/*.css`, and `src/*.html`. Behaviour varies by file type:
   - **JS or CSS change:** runs Vite's programmatic `build()` to regenerate `dist/search-page.js` and `dist/search-page.css` (or collection equivalents), then sends a full browser reload. A `building` guard prevents concurrent builds. Logged as `[auto-rebuild] <file> changed — rebuilding…`.
   - **HTML change (`src/*.html`):** recopies `src/search-section.html` and `src/search-results.html` to `dist/`, calls `syncPreviewTemplate()`, regenerates the pages using `scripts/generate-collection-pages.js`, then sends a full browser reload — no JS bundle rebuild needed. Logged as `[auto-rebuild] <file> changed — HTML recopied and pages generated, reloading browser`.

3. **`syncPreviewTemplate()`** (called by both of the above): reads the entirety of `src/search-results.html`, re-indents it to the 8-space indent used in `search-section-preview.html`, and replaces the matching `<div class="doc-search-outer">...</li>` block in-place. This keeps the dev preview's search results layout, filters, and card template in sync with the canonical source automatically — you never need to manually edit `search-section-preview.html` for structural changes to the search interface.

---

## GitHub Pages (Public Preview)

A static preview of the search and collection pages is automatically deployed to GitHub Pages on every push to `main`. This gives a publicly accessible version that runs entirely from mock data — no VPN or intranet access needed.

**Live URL:** `https://ntgovernment.github.io/document-library/`

| Page                 | URL                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------ |
| Search               | `https://ntgovernment.github.io/document-library/`                                   |
| Collection (example) | `https://ntgovernment.github.io/document-library/collection/gifts-and-benefits.html` |

### How it works

`npm run build` runs three steps:

```bash
vite build                                    # 1. Search bundle → dist/search-page.{js,css}
vite build --config vite.collection.config.js # 2. Collection bundle → dist/collection-page.css
node scripts/generate-collection-pages.js     # 3. Static HTML generation
```

Step 3 (`generate-collection-pages.js`) produces:

- **`index.html`** at the repo root — the search page, derived from `search-section-preview.html` with all NTG CDN asset refs replaced by local relative paths and the `<title>` updated.
- **`collection/<slug>.html`** — one page per collection (8 total), derived from `collection-page-preview.html` + the Coveo mock data. Each page gets the full document list, a back-to-search link, and a "Related policies" section linking to the other 7 collections.

GitHub Actions (`.github/workflows/deploy.yml`) then:

1. Runs `npm ci` and `npm run build`
2. Assembles a `_site/` staging directory, copying `index.html`, `.nojekyll`, `collection/*.html`, `dist/`, and all referenced `src/vendor/`, `src/css/`, `src/js/`, and `src/mock/` assets
3. Deploys `_site/` to the `gh-pages` branch via `actions/deploy-pages@v4`

### `scripts/generate-collection-pages.js`

This CommonJS Node.js script is the sole source of truth for both generated HTML outputs. Key points:

- **`rewriteVendorPaths(html, prefix)`** — replaces every NTG intranet CDN URL (jQuery, auds.js, fotorama, components.js, etc.) with a local relative path. `prefix` is `"./"` for root pages (`index.html`) and `"../"` for `collection/*.html`.
- **Back-to-search link** — each collection page renders `<a href="../index.html" onclick="if(history.length>1){history.back();return false;}">`. This uses browser history if available; otherwise navigates to `index.html`.
- **Related policies** — the "Related policies" section on each collection page links to all sibling collection pages (all except the current one) using relative `slug.html` hrefs.
- **Document grouping** — within each collection, results are grouped by `raw.resourcedoctype` (e.g. "Policy", "Procedure") and rendered as `<section class="policy-documents">` blocks. Each document title is rendered as `Title (TYPE SIZE)` (e.g. `Gifts and benefits policy (DOCX 389.1 KB)`) — matching the format produced by `formatFileMeta()` in `coveo-search.js` so that text fragment links from search result cards resolve correctly.
- **Excluded document types** — results with `raw.resourcedoctype === "Supporting document"` are skipped during the collection map build. They do not appear on any collection page. The same type is excluded at runtime in `coveo-search.js` via the `EXCLUDED_DOCTYPE` constant.
- **Google Analytics removal** — the script strips the `<script async src="https://www.googletagmanager.com/gtag/...">` block from `index.html` (GitHub Pages is a public preview, not a tracked environment).

To regenerate the collection slugs or add new collections, update `src/mock/coveo-search-rest-api-query.json` and run `npm run build`.

### `.nojekyll`

An empty `.nojekyll` file at the repo root prevents GitHub Pages from running Jekyll preprocessing. Without it, GitHub Pages would ignore directories whose names start with `_` (like `dist/`) — and would also fail to serve paths containing dots (like `src/vendor/css/`). **Do not delete this file.**

### Collection URL localisation and text fragment links

`buildCollectionUrl()` in `coveo-search.js` builds the final href for each "Collection:" link in search result cards. It does two things:

1. **Localises the URL** (dev/GitHub Pages only) — `localiseCollectionUrl()` rewrites intranet collection URLs to local relative paths:

   ```
   https://internal.nt.gov.au/.../collections/gifts-and-benefits
     → collection/gifts-and-benefits.html
   ```

   This runs whenever `window.location.hostname` is `localhost`, `127.0.0.1`, or ends with `.github.io`. On the production intranet the URL is left unchanged.

2. **Appends a text fragment** — `formatFileMeta(raw)` derives the file-type/size suffix (e.g. `(DOCX 612.4 KB)`) and encodes it as a [text fragment](https://developer.mozilla.org/en-US/docs/Web/URI/Fragment/Text_fragments) appended to the URL:
   ```
   …/recruitment-policy-guidelines
     → …/recruitment-policy-guidelines#:~:text=(DOCX%20612.4%20KB)
   ```
   When the user clicks a "Collection:" link, the browser scrolls to and highlights the matching document on the collection page. No fragment is appended when the document has no file-type or size metadata.

### GitHub Pages vs production

| Aspect           | GitHub Pages                      | Production (Matrix)   |
| ---------------- | --------------------------------- | --------------------- |
| Data source      | Mock JSON (36 results, static)    | Live Coveo REST API   |
| Hosting          | GitHub Pages static files         | Squiz Matrix CMS      |
| Authentication   | None (public)                     | NTG intranet login    |
| Collection pages | Static HTML (generated from mock) | Dynamic Matrix pages  |
| Purpose          | Development preview and demos     | Live intranet service |

> GitHub Pages is a **preview environment**, not a production mirror. It always serves the same mock results regardless of query, and collection page data is baked in at build time. Documents with `resourcedoctype` of `"Supporting document"` are excluded from both search results and collection pages.

---

## Local Development

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Setup

```bash
npm install
npm run build   # must run at least once first — preview page references dist/
npm run dev     # Vite dev server at http://localhost:3000 with HMR
npm run preview # serve the dist/ build locally for final checks
```

`npm run dev` opens `index.html` automatically — the static search page generated by `scripts/generate-collection-pages.js`. From there you can click through to any of the `collection/<slug>.html` collection pages.

**Search page (CMS chrome preview)** is at `http://localhost:3000/search-section-preview.html`. This page is generated from the `Document search _ DCDD intranet.html` snapshot with `./dist/search-page.css` and `./dist/search-page.js` injected. Navigate there manually.

**Agency Templates collection preview** is at `http://localhost:3000/collection-page-preview.html`. Navigate there manually — it does not auto-open.

**Auto-rebuild is active** — the watcher routes changes to the appropriate build:

| File changed                                                       | Rebuild action                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `src/js/**/*.js`                                                   | Rebuilds search bundle (`vite.config.js`)                                         |
| `src/css/search-widget.css` (or any non-token, non-collection CSS) | Rebuilds search bundle                                                            |
| `src/css/collection-page.css`                                      | Rebuilds collection bundle only (`vite.collection.config.js`)                     |
| `src/css/tokens.css`                                               | Rebuilds **both** bundles sequentially                                            |
| `src/*.html`                                                       | Recopies HTML to `dist/`, syncs preview template, reloads browser (no JS rebuild) |
| `collection-page-preview.html`                                     | Full browser reload only (no rebuild)                                             |
| `Gifts and benefits _ Resources.html`                              | Full browser reload only (no rebuild)                                             |

Run `npm run build` once before committing to ensure `dist/` reflects the final state.

### Mock data vs production API

| Environment                               | Data source                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `localhost` / `127.0.0.1`                 | `src/mock/coveo-search-rest-api-query.json` (36 results, no VPN needed) |
|                                           | `src/mock/matrix-asset-links.json` (page links, no VPN needed)          |
| `*.github.io` (GitHub Pages)              | `src/mock/coveo-search-rest-api-query.json` (same mock data, no VPN)    |
|                                           | `src/mock/matrix-asset-links.json` (same mock page links, no VPN)       |
| All other hostnames (production intranet) | Live Coveo REST API at `search-internal.nt.gov.au`                      |
|                                           | Live Squiz Matrix Management API at `internal.nt.gov.au`                |

The mock JSON always returns the same 36 results regardless of the query. It exercises the full rendering pipeline (filters, pagination, card/table view) without network access.

### Standard change workflow

```bash
# 1. Edit source files (search page)
code src/js/coveo-search.js
code src/css/search-widget.css
code src/search-section.html
code src/search-results.html

# 1. Edit source files (collection page)
code src/css/collection-page.css

# 1. Edit shared tokens (affects both bundles)
code src/css/tokens.css

# 2. Preview changes interactively
npm run dev
# Search page (static):         http://localhost:3000/index.html  (opens automatically)
# Search page (CMS chrome):      http://localhost:3000/search-section-preview.html
# Collection page (CMS chrome):  http://localhost:3000/collection-page-preview.html

# 3. Build the deployable bundles
npm run build

# 4. Commit source + built output together
git add src/ dist/
git commit -m "describe your change"
git push
# ↑ Git File Bridge picks up dist/ and syncs to Matrix automatically
```

### Build entry points

**Search page — [`src/search-page.js`](src/search-page.js)** (built by `vite.config.js`):

```js
import "./css/search-widget.css"; // widget styles (compiled → dist/search-page.css)
import "./js/coveo-search.js"; // search logic  (compiled → dist/search-page.js)
// Optional: import "./js/view-preference-metadata-patch.js";
// Persists search view preference to user metadata field #969752.
```

### Optional standalone patch: search view metadata persistence

`src/js/view-preference-metadata-patch.js` is a standalone IIFE patch that syncs the search view toggle preference with Squiz user metadata.

- Metadata field ID: `969752` (`user.view-preference`)
- Persisted values: `grid` (default) or `table`
- Compatibility key: keeps `localStorage.docSearchView` in `card`/`table` format for existing `coveo-search.js` behavior

Runtime behavior:

1. On load, it reads metadata via `js_api.getMetadata` and applies the resolved preference.
2. On view toggle/save actions, it writes the new preference via `js_api.setMetadata`.
3. On mobile (`max-width: 900px`), UI stays in card mode while the saved preference is preserved.

Integration:

- Preferred: import it from `src/search-page.js` so it is bundled into `dist/search-page.js`.
- Alternative: include it as a separate script in Matrix after main profile/search scripts.

**Collection page — [`src/collection-page.js`](src/collection-page.js)** (built by `vite.collection.config.js`):

```js
import "./css/collection-page.css"; // collection page styles (compiled → dist/collection-page.css)
```

> `collection-page.js` is CSS-only. No JS logic runs at page load from this bundle. The tiny `dist/collection-page.js` stub is an unavoidable Vite IIFE artefact — it is harmless and its `<script>` tag does not need to be added to the paint layout.

Both `search-widget.css` and `collection-page.css` import `src/css/tokens.css` at their top line. Editing `tokens.css` affects both bundles — the `auto-rebuild-on-src-change` watcher rebuilds both sequentially when `tokens.css` changes.

Output filenames are fixed (no content hashes) so Matrix file asset URLs stay stable across builds.

---

## Repository Structure

```
document-library/
│
├── src/                                      ← EDIT HERE — all source files are git-tracked
│   ├── search-page.js                        # ★ SEARCH BUILD ENTRY — imports search-widget.css + coveo-search.js
│   ├── collection-page.js                    # ★ COLLECTION BUILD ENTRY — imports collection-page.css only
│   ├── search-section.html                   # ★ Search form HTML fragment → dist/search-section.html
│   ├── search-results.html                   # ★ Results/filters HTML fragment → dist/search-results.html
│   ├── js/
│   │   ├── coveo-search.js                   # ★ Coveo REST API fetch, filtering, pagination, card/table rendering
│   │   └── view-preference-metadata-patch.js # Optional standalone patch: sync view preference to metadata #969752
│   ├── css/
│   │   ├── tokens.css                        # ★ Shared CSS custom properties: colours, typography, borders, spacing
│   │   ├── search-widget.css                 # ★ Search page styles (imports tokens.css)
│   │   ├── collection-page.css               # ★ Collection page styles (imports tokens.css)
│   │   ├── main.css                          # NTG central stylesheet (~13,900 lines) — loaded by Matrix, NOT bundled
│   │   └── status-toolbar.css                # Dev/test status toolbar styles — loaded by Matrix, NOT bundled
│   ├── mock/
│   │   ├── coveo-search-rest-api-query.json  # 43-result Coveo API snapshot for local dev
│   │   └── matrix-asset-links.json           # Mock upstream page-link responses keyed by assetId for local dev
│   └── vendor/                               ← Third-party locked dependencies — do not edit
│       ├── js/
│       │   ├── jquery-3.4.1.min.js           # jQuery 3.4.1 (loaded by Matrix paint layout before this bundle)
│       │   ├── jquery.sumoselect.min.js       # Styled multi-select dropdowns
│       │   ├── jquery.tablesort.min.js        # Lightweight table sort
│       │   ├── imageslider-fotorama.js        # Header carousel
│       │   ├── auds.js                        # Australian Government Design System JS
│       │   ├── ntg-central-update-user-profile.js  # NTG Central user profile sync
│       │   ├── moment.min.js                  # Date formatting (window.moment — optional)
│       │   ├── pagination.min.js              # Coveo pagination helper (legacy)
│       │   └── gtm.js                         # Google Tag Manager (GA4: G-WY2GK59DRN)
│       ├── css/
│       │   ├── all.css                        # Font Awesome 5 Pro (loaded by Matrix)
│       │   ├── roboto.css                     # Roboto web font (loaded by Matrix)
│       │   ├── imageslider-fotorama.css        # Fotorama slider styles (loaded by Matrix)
│       │   └── yht7rxj.css                    # Squiz Matrix / Adobe Fonts stylesheet (loaded by Matrix)
│       └── img/
│           ├── ntg-central-rose-petal-default.svg
│           ├── ntgc-image-mask-type-a.svg
│           ├── ntgc-image-mask-type-b.svg
│           └── ntgc-image-mask-type-c.svg
│
├── dist/                                     ← BUILD OUTPUT — committed; Git File Bridge deploys these
│   ├── search-page.js                        # ★ → Search page paint layout <script>
│   ├── search-page.css                       # ★ → Search page paint layout <link>
│   ├── collection-page.css                   # ★ → Collection page paint layout <link>
│   ├── collection-page.js                    # (IIFE stub artefact — not referenced in Matrix)
│   ├── search-section.html                   # ★ → Matrix nested container (form)
│   └── search-results.html                   # ★ → Matrix nested container (results)
│
├── scripts/
│   └── generate-collection-pages.js         # ★ Generates index.html + collection/*.html for GitHub Pages (step 3 of npm run build)
├── .agents/
│   └── workflows/                            # AI agent workflows (e.g., update-docs)
├── .github/
│   ├── copilot-instructions.md               # AI coding assistant conventions & instructions
│   ├── prompts/                              # AI workflow prompt definitions
│   └── workflows/
│       └── deploy.yml                        # GitHub Actions: build + assemble + deploy to GitHub Pages on push to main
│
├── index.html                                # ★ Generated static search page (GitHub Pages entry point) — do not edit manually
├── collection/                               # ★ Generated collection pages — do not edit manually (rebuilt by npm run build)
│   ├── gifts-and-benefits.html
│   ├── work-health-and-safety.html
│   ├── prepare-to-welcome-new-employees.html
│   ├── recruitment-policy.html
│   ├── fraud-and-corruption.html
│   ├── risk-management.html
│   ├── employment-screening.html
│   └── data-breaches.html
├── .nojekyll                                 # Prevents GitHub Pages from running Jekyll (required so dist/, src/ etc. are served)
│
├── search-section-preview.html               # Search page CMS-chrome dev preview (references ./dist/)
├── collection-page-preview.html              # Agency Templates collection page dev preview (references ./dist/collection-page.css)
├── Document search _ DCDD intranet.html      # CMS page snapshot used to generate search preview (gitignored)
├── Agency templates _ Resources.html         # CMS page snapshot used to generate collection preview (gitignored)
├── Document search _ DCDD intranet_files/    # Snapshot companion assets (gitignored, reference only)
├── Gifts and benefits _ Resources.html       # CMS collection page snapshot (gitignored)
├── Gifts and benefits _ Resources_files/     # Snapshot companion assets (gitignored, reference only)
├── vite.config.js                            # Vite: search bundle + dev server + copy-html + auto-rebuild watcher
├── vite.collection.config.js                 # Vite: collection bundle (emptyOutDir: false — NEVER change this)
├── package.json                              # npm scripts: dev / build / preview
├── .gitignore
└── README.md
```

### What to edit — quick reference

| Goal                                                       | File(s) to edit                                       | Then                                 |
| ---------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| Change search input markup                                 | `src/search-section.html`                             | `npm run build` → commit src+dist    |
| Change results/filters/pagination layout                   | `src/search-results.html`                             | `npm run build` → commit src+dist    |
| Change search logic, rendering, filters                    | `src/js/coveo-search.js`                              | `npm run build` → commit src+dist    |
| Change search widget styles                                | `src/css/search-widget.css`                           | `npm run build` → commit src+dist    |
| Change collection page styles                              | `src/css/collection-page.css`                         | `npm run build` → commit src+dist    |
| Change shared design tokens (colours, spacing, typography) | `src/css/tokens.css`                                  | `npm run build` → commit src+dist    |
| Add a file to the search bundle                            | Add `import './...'` to `src/search-page.js`          | `npm run build` → commit src+dist    |
| Add a file to the collection bundle                        | Add `import './...'` to `src/collection-page.js`      | `npm run build` → commit src+dist    |
| Change mock data for local testing                         | `src/mock/coveo-search-rest-api-query.json`           | No build needed (fetched at runtime) |
| Change mock page-link data for local testing               | `src/mock/matrix-asset-links.json`                    | No build needed (fetched at runtime) |
| Update GitHub Pages static page generation                 | `scripts/generate-collection-pages.js`                | `npm run build` → commit             |
| Update GitHub Actions deployment workflow                  | `.github/workflows/deploy.yml`                        | Commit; triggers on push to main     |
| Upgrade a vendor library                                   | Replace in `src/vendor/`; update Matrix page template | `npm run build` → commit             |

---

---

## CSS Token System

All CSS custom properties (design tokens) are declared in **[`src/css/tokens.css`](src/css/tokens.css)**. Both bundles import this file at their top line (`@import "./tokens.css";`). **Never declare `:root` variables in `search-widget.css` or `collection-page.css` directly** — put them in `tokens.css` so they're available to both.

### Colour tokens

| Token                    | Value     | Usage                                                                                                    |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------- |
| `--clr-primary`          | `#343741` | NTG body text                                                                                            |
| `--clr-text-default`     | `#102040` | Widget body text, links (`--clr-link-default` is an alias)                                               |
| `--clr-link-default`     | `#102040` | All link colours                                                                                         |
| `--clr-tertiary`         | `#167abe` | Search result title links, table title links, collection links, source row links, "Apply filters" button |
| `--clr-text-alt`         | `#384560` | Secondary text, input placeholder                                                                        |
| `--clr-text-emphasis`    | `#208820` | Emphasis / positive text (green)                                                                         |
| `--clr-border-subtle`    | `#d0e0e0` | Borders, outlines                                                                                        |
| `--clr-bg-default`       | `#ffffff` | Input background                                                                                         |
| `--clr-bg-shade`         | `#f5f5f7` | Card/item background (collection page)                                                                   |
| `--clr-bg-shade-alt`     | `#ecf0f0` | Results area background (search widget)                                                                  |
| `--clr-icon-subtle`      | `#878f9f` | Toggle pill (off state)                                                                                  |
| `--clr-icon-default`     | `#208820` | Prev/Next pagination icon hover                                                                          |
| `--clr-surface-selected` | `#107810` | Active pagination page / toggle (on)                                                                     |

### Typography tokens

| Token                    | Value              |
| ------------------------ | ------------------ |
| `--font-size-xs`         | `0.875rem` (14 px) |
| `--font-size-sm`         | `1rem` (16 px)     |
| `--font-size-md`         | `1.25rem` (20 px)  |
| `--font-size-lg`         | `1.375rem` (22 px) |
| `--font-size-xl`         | `1.625rem` (26 px) |
| `--font-size-2xl`        | `1.875rem` (30 px) |
| `--font-size-3xl`        | `2.25rem` (36 px)  |
| `--font-weight-regular`  | `400`              |
| `--font-weight-medium`   | `500`              |
| `--font-weight-semibold` | `600`              |
| `--font-weight-bold`     | `700`              |

### Border / radius tokens

| Token           | Value      |
| --------------- | ---------- |
| `--radius-sm`   | `4px`      |
| `--radius-lg`   | `1.75rem`  |
| `--radius-pill` | `3.125rem` |

### Spacing tokens

CSS spacing tokens are defined in `tokens.css`. Use these for margins, paddings, and gaps in **both** bundles.

| Token      | Value  | Common use                                                        |
| ---------- | ------ | ----------------------------------------------------------------- |
| `--sp-xs`  | `4px`  | Tight gaps                                                        |
| `--sp-sm`  | `8px`  | Icon gaps, tag horizontal padding                                 |
| `--sp-md`  | `12px` | Card element vertical spacing                                     |
| `--sp-lg`  | `16px` | Table cell padding                                                |
| `--sp-xl`  | `24px` | Back-to-search margin-bottom; card vertical padding               |
| `--sp-2xl` | `32px` | Card horizontal padding; `.related-policies__title` margin-bottom |
| `--sp-3xl` | `48px` | Section vertical padding (desktop)                                |
| `--sp-4xl` | `72px` | Large section separations                                         |

---

## Collection Page

Collection pages (e.g. "Agency Templates") list policy documents belonging to a single Coveo collection. They are styled by `dist/collection-page.css` and use class names defined in `src/css/collection-page.css`.

### Vite config: `vite.collection.config.js`

The collection bundle is a separate Vite build that runs **after** the search build. Critical settings:

```js
build: {
  outDir: "dist",
  emptyOutDir: false,   // CRITICAL: prevents wiping search-page.css / search-page.js
  cssCodeSplit: false,
  rollupOptions: {
    input: "src/collection-page.js",
    output: {
      format: "iife",
      name: "DCDDCollectionPage",
      entryFileNames: "collection-page.js",
      assetFileNames: (assetInfo) =>
        assetInfo.name?.endsWith(".css") ? "collection-page.css" : "[name][extname]",
    },
  },
}
```

**Never remove `emptyOutDir: false`.** Vite defaults to clearing the output directory before each build. Without this flag, the second build (`vite.collection.config.js`) would delete `dist/search-page.css` and `dist/search-page.js` every time.

### BEM classes

#### Back-to-search link (`.back-to-search`)

The "Back to search results" link at the top of every collection page. It is an `<a>` element with Font Awesome Pro left-arrow icon.

```html
<a
  href="/dcdd/dev/policy-library/document-search?searchterm="
  class="back-to-search"
>
  <i class="fas fa-arrow-left"></i>
  Back to search results
</a>
```

| Class                   | Rule                                                                                                                                                                                                                         | Notes                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.back-to-search`       | `display: inline-flex; align-items: center; gap: 8px; margin-bottom: var(--sp-xl) !important; font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--clr-link-default); text-decoration: none` | `!important` on `margin-bottom` overrides `main.css` link default margins                                                                                                                        |
| `.back-to-search + h2`  | `margin-top: 0 !important`                                                                                                                                                                                                   | Neutralises the `margin-top` that `main.css` applies to all `<h2>` elements; without this the gap between the back link and the `<h2>` cannot be controlled via the link's `margin-bottom` alone |
| `.back-to-search:hover` | `text-decoration: underline`                                                                                                                                                                                                 |                                                                                                                                                                                                  |

> **`main.css` conflict pattern.** The NTG central stylesheet (`main.css`) is loaded by every Matrix page and applies aggressive base styles to `<h2>`, `<a>`, and other elements. When you need to override these in collection-page styles, use `!important`. This is the documented pattern for this codebase — not a hack.

#### Policy documents (`section.policy-documents` / `.policy-document`)

A vertical stack of document cards. Each card links to an individual policy document.

```html
<section class="policy-documents">
  <article class="policy-document">
    <a href="/path/to/document">
      <div class="policy-document__wrapper">
        <div class="policy-document__icon">
          <i class="fas fa-file-pdf"></i>
        </div>
        <div class="policy-document__details">
          <!-- h4 or h3 depending on surrounding heading hierarchy -->
          <h4>Document title</h4>
          <span>Last updated: 5 March 2026</span>
        </div>
      </div>
    </a>
  </article>
</section>
```

| Class                                                        | Rule                                                                                                                                       | Notes                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `section.policy-documents`                                   | `display: flex; flex-direction: column; gap: 10px; width: 100%`                                                                            |                                                                                                                                                                                                 |
| `.policy-document`                                           | `display: flex; flex-direction: column; gap: 8px; padding: 16px; background: var(--clr-bg-shade); align-self: stretch`                     |
| `.policy-document a`                                         | `display: inline-flex; align-self: stretch; text-decoration: none`                                                                         |                                                                                                                                                                                                 |
| `.policy-document__wrapper`                                  | `display: inline-flex; align-self: stretch; align-items: center; gap: 8px`                                                                 |                                                                                                                                                                                                 |
| `.policy-document__icon`                                     | `display: flex; align-items: center; gap: 10px`                                                                                            |                                                                                                                                                                                                 |
| `.policy-document__details`                                  | `flex: 1 1 0; display: inline-flex; flex-direction: column; gap: 4px`                                                                      |                                                                                                                                                                                                 |
| `.policy-document__details h3, .policy-document__details h4` | `flex: 1 1 0; color: var(--clr-link-default); font-size: 16px; font-weight: 700; text-decoration: underline; line-height: 24px; margin: 0` | Both heading levels are styled identically. Use `h3` when the collection page title is an `h2`; use `h4` when a section subheading (`h3`) appears between the page title and the document list. |

#### Sidebar panels (`.sidebar` / `.sidebar-panel`)

Stacked bordered panels used in the right-hand sidebar column of collection pages. Matches the Figma bordered-panel design. Each panel has a title and a content block. Multiple panels stack vertically: the **first** panel uses a 3-sided border (left + top + right, open bottom) and subsequent panels use a full outline — this creates a seamless connected stack.

```html
<div class="col-12 col-md-3 offset-md-1">
  <div class="sidebar">
    <!-- First panel: 3-sided border (open bottom) -->
    <div class="sidebar-panel">
      <h5 class="sidebar-panel__title">Related web pages</h5>
      <div class="sidebar-panel__content">
        <div><a href="/path/to/page">Page name</a></div>
      </div>
    </div>

    <!-- Subsequent panels: full outline -->
    <div class="sidebar-panel">
      <h5 class="sidebar-panel__title">Contact</h5>
      <div class="sidebar-panel__content">
        <div>Team name</div>
        <div>Email: <a href="mailto:team@nt.gov.au">team@nt.gov.au</a></div>
      </div>
    </div>

    <div class="sidebar-panel">
      <h5 class="sidebar-panel__title">Last updated</h5>
      <div class="sidebar-panel__content">
        <div>16 March 2026</div>
      </div>
    </div>
  </div>
</div>
```

| Class                         | Rule                                                                                                                                                                                          | Notes                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `.sidebar`                    | `display: flex; flex-direction: column; width: 100%`                                                                                                                                          | Wrapper that stacks all `.sidebar-panel` children                                                       |
| `.sidebar-panel`              | `padding: 16px; outline: 1px solid var(--clr-border-subtle, #d0e0e0); outline-offset: -1px; display: flex; flex-direction: column; gap: 12px`                                                 | Default: full outline. Subsequent panels after the first.                                               |
| `.sidebar-panel:first-child`  | `outline: none; border-left: 1px solid var(--clr-border-subtle, #d0e0e0); border-top: 1px solid var(--clr-border-subtle, #d0e0e0); border-right: 1px solid var(--clr-border-subtle, #d0e0e0)` | First panel overrides outline with 3-sided border — no bottom edge, joins smoothly with the panel below |
| `.sidebar-panel__title`       | `color: var(--clr-text-default, #102040); font-size: var(--font-size-sm); font-weight: var(--font-weight-bold); line-height: 24px; margin: 0`                                                 | `<h5>` element; use `font-weight-bold` (700)                                                            |
| `.sidebar-panel__content`     | `display: flex; flex-direction: column; gap: 8px`                                                                                                                                             | Flex column with 8px gap between child items                                                            |
| `.sidebar-panel__content > *` | `color: var(--clr-link-default, #102040); font-size: var(--font-size-sm); line-height: 24px; word-wrap: break-word`                                                                           | Applies to all direct children (divs, spans, etc.)                                                      |
| `.sidebar-panel__content a`   | `text-decoration: underline; word-break: break-all`                                                                                                                                           | All links inside content are underlined                                                                 |

> **Panel count:** Use as many panels as needed. The `:first-child` rule handles the open-bottom styling automatically — no extra classes needed.

#### Related policies (`section.related-policies` / `.related-policy`)

A full-width shaded section below the main content listing related collection pages. Each card is entirely wrapped in an `<a>` — the whole card is clickable. Do **not** add a `<span class="related-policy__link">View</span>` button inside the card; the link wraps the card at the outer level.

```html
<section class="related-policies">
  <div class="container ntgc-pt-48 ntgc-pb-48">
    <h2 class="related-policies__title">Related policies</h2>
    <div class="row">
      <a href="/path/to/collection">
        <div class="col-12 col-md-6 col-lg-4">
          <div class="related-policy">
            <h3 class="related-policy__title">Policy name</h3>
            <p class="related-policy__description">
              Optional description text.
            </p>
          </div>
        </div>
      </a>
    </div>
  </div>
</section>
```

| Class                          | Rule                                                                                                                                                                                                                                                                                                | Notes                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `section.related-policies`     | `background: var(--clr-bg-shade-alt, #ecf0f0)`                                                                                                                                                                                                                                                      | Shaded section background                                                                                         |
| `.related-policies__title`     | `font-size: var(--font-size-xl); font-weight: var(--font-weight-semibold); color: var(--clr-text-default); margin: 0 0 var(--sp-2xl) !important`                                                                                                                                                    | `!important` overrides `main.css` heading top margin; bottom margin is 32px via `--sp-2xl`                        |
| `.related-policy`              | `display: flex; flex-direction: column; align-items: flex-start; gap: 24px; padding: 48px; background: var(--clr-bg-primary, white); outline: 1px solid var(--clr-border-subtle, #d0e0e0); outline-offset: -1px; margin-bottom: 24px`                                                               | Uses `outline` not `border` — avoids layout shift                                                                 |
| `.related-policy__title`       | `font-size: 32px; font-weight: 700; line-height: 36px; color: var(--clr-link-default, #102040); margin: 0; margin-top: 0 !important`                                                                                                                                                                | `!important` on `margin-top` overrides `main.css` heading margin                                                  |
| `.related-policy__description` | `font-size: 16px; font-weight: 400; line-height: 24px; color: var(--clr-text-body, #384560); margin: 0`                                                                                                                                                                                             | Can be empty                                                                                                      |
| `.related-policy__link`        | `display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; background: var(--clr-surface-selected, #107810); color: var(--clr-text-inverse, #ffffff); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); text-decoration: none; border-radius: var(--radius-sm)` | **Not currently used in HTML** — the `<a>` card wrapper is the only link; this class exists in CSS for future use |

### Preview page: `collection-page-preview.html`

A local dev snapshot of an Agency Templates collection page with `./dist/collection-page.css` injected:

```html
<link rel="stylesheet" href="./dist/collection-page.css" />
<!-- added just before </head> -->
```

Access it at `http://localhost:3000/collection-page-preview.html` during `npm run dev`. Changes to `collection-page-preview.html` trigger a full browser reload; changes to `src/css/collection-page.css` trigger a collection bundle rebuild then reload.

To regenerate this file from the latest production snapshot, replace the base HTML (`Agency templates _ Resources.html`) and inject the CSS link before `</head>`.

---

## Page Architecture

### CMS: Squiz Matrix

The HTML is rendered server-side by Squiz Matrix. Key Matrix-specific patterns:

| Pattern                                                           | Purpose                                                               |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `<!--coveo_no_index_start_XX-->` / `<!--coveo_no_index_end_XX-->` | Tells the Coveo crawler to skip indexing sections of the page         |
| `meta[name="ntgc.*"]`                                             | NTG-specific page metadata (asset ID, lineage, shortname)             |
| `meta[name="dcterms.*"]`                                          | Dublin Core metadata required by NTG publishing standards             |
| `data-user="…"` on `<body>`                                       | The logged-in user's Squiz Matrix asset ID                            |
| `pagedata` JS object                                              | Runtime page context injected by Matrix (asset IDs, URLs, variations) |

### Search: Coveo

Search results are fetched by `src/js/coveo-search.js` (compiled into `dist/search-page.js`).

**Production API endpoint:**

```
https://internal.nt.gov.au/dcdd/dev/policy-library/coveo/site/coveo-search-rest-api-query?searchterm=ENCODED_QUERY
```

This is a Squiz Matrix page asset on the same origin (`internal.nt.gov.au`) that returns the Coveo JSON response directly. It accepts only one caller-supplied parameter: `searchterm`. All other Coveo configuration (scope, result count, partial match, etc.) is baked into the Matrix asset server-side.

> **Do not use `?a=<assetId>` shorthand.** The `?a=944069` asset shorthand resolves to the document-search page itself and returns the full page HTML — not the Coveo JSON. This causes a `SyntaxError: Unexpected token '<'` in the fetch pipeline.

Sorting is performed **client-side** via `applySort()` after every fetch and after every sort radio button change — no re-fetch is needed. `originalResults` holds the API response order; `allResults` is a sorted copy used for rendering.

**Behaviour on page load:** `coveo-search.js` fires `runSearch()` unconditionally on `$(document).ready`. It reads `?searchterm=` and `?sort=` from the URL and pre-fills `#search` accordingly. The search form submit handler is attached only if `#policy-search-form` is present — its absence does not block results from loading.

**Date formatting:** Dates from `raw.resourceupdated` (`YYYY-MM-DD HH:mm:ss`) are formatted as `D MMMM YYYY` (e.g. `5 March 2026`) using a native JS regex — no external library. A non-breaking space (`\u00a0`) is inserted between the day number and month name so they never wrap onto separate lines.

**Search flow (submit → redirect → load):** When the form is submitted, the handler does **not** call `runSearch()` in-place. Instead it redirects to `window.location.pathname + "?searchterm=" + encodeURIComponent(query)`. The resulting page load reads `?searchterm=` and calls `runSearch()` via the normal init path. This keeps the URL bookmarkable and shareable with a single source of truth for the active query.

**Module state (inside the IIFE):**

| Variable                | Type   | Purpose                                                                                                                                                                                                                                                  |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `masterResults`         | Array  | Complete document corpus (all results for an empty query); populated once on the first `runSearch()` call and never cleared; provides the stable value list for all facets so Type/Category options do not disappear when a query narrows the result set |
| `originalResults`       | Array  | Raw API response order for the current query — restored when sort is set back to "Relevance"                                                                                                                                                             |
| `allResults`            | Array  | Sorted copy of `originalResults`; source for filter and render operations                                                                                                                                                                                |
| `filteredResults`       | Array  | Subset of `allResults` after applying active checkbox filters                                                                                                                                                                                            |
| `currentPage`           | Number | Current pagination page (1-based)                                                                                                                                                                                                                        |
| `activeTypeFilters`     | Set    | Checked values under the Type facet                                                                                                                                                                                                                      |
| `activeCategoryFilters` | Set    | Checked values under the Category facet                                                                                                                                                                                                                  |
| `currentSort`           | String | Active sort — `"relevancy"` \| `"date descending"` \| `"alpha ascending"` \| `"alpha descending"`                                                                                                                                                        |
| `currentQuery`          | String | Last query string passed to `runSearch()`                                                                                                                                                                                                                |
| `matrixMockCache`       | Object | Cached contents of `matrix-asset-links.json` (dev mode only); `null` until the first `fetchPageLinks()` call, then populated and reused for all subsequent calls on the same page load                                                                   |

**`data-ref` bindings** (attributes on elements inside `.search-template`, populated by `renderCardResults()`):

| `data-ref` value                | Coveo API field                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search-result-link`            | `raw.asseturl \|\| result.clickUri` — set as `href`                                                                                                                                                                 |
| `search-result-title`           | `raw.resourcefriendlytitle \|\| result.title` with `formatFileMeta()` suffix appended — e.g. `"My Document (PDF 354.2 KB)"`, `"My Document (DOCX)"`, or `"My Document (58.5 KB)"` when type/size fields are present |
| `search-result-extlink`         | **Unused — icon is permanently hidden.** The SVG is present in the template with `hidden` and `display: none`, but `coveo-search.js` no longer removes the `hidden` attribute.                                      |
| `search-result-description`     | `raw.description \|\| result.excerpt`                                                                                                                                                                               |
| `search-result-collection-row`  | Hidden (via `hidden` attribute) when `raw.collectionname` is absent/empty or the literal `"none"`, or when `raw.collectionurl` is absent — all three conditions must pass for the row to show                       |
| `search-result-collection`      | `raw.collectionname` — human-readable collection name set as the link text                                                                                                                                          |
| `search-result-collection-link` | `raw.collectionurl` — set as `href`; `raw.collectionname` is the link text. Row is hidden (not this element) when either field is absent or `"none"`.                                                               |
| `search-result-doctype`         | `raw.resourcedoctype` (rendered as a tag `<span>` — hidden via `hidden` attribute when absent/empty)                                                                                                                |
| `search-result-last-updated`    | `raw.resourceupdated` — formatted by `formatDate()` as `D\u00a0MMMM YYYY` (e.g. `5 March 2026`); non-breaking space prevents day/month line-break                                                                   |
| `search-result-page-row`        | Source row container `<div>` — hidden by default; unhidden when `raw.assetassetid` is present, then re-hidden if upstream link resolution finds no pages                                                            |
| `search-result-page-label`      | `<span>` containing `Source:` (singular) or `Sources:` (plural) — JS changes text to `Sources:` when more than one link is resolved                                                                                 |
| `search-result-page-ids`        | `<span>` populated with `<a>` links to resolved parent pages (comma-separated, HTML generated by `renderPageLinksHtml()`), or left empty (row hidden) when none found                                               |

**Source row (card view) — upstream link resolution:**

Each search result card displays a "Source:" or "Sources:" row showing which intranet pages contain the document. This is resolved at render time via the Squiz Matrix Management API (`/assets/{id}/links`).

**Source column (table view) — upstream link resolution:**

Table rows display the same page links as the card view, populated asynchronously in the Source column.

**Shared resolution chain** (both card and table views use `resolvePageLinks(assetId)` and `renderPageLinksHtml(pageLinks)`):

1. `fetchPageLinks(assetId)` — fetch upstream links for the document asset
2. Filter for `link_type === "reference"` → collect `major_id` values
3. For each reference `major_id`, fetch its links → filter for `link_type === "hidden"` entries
4. For each hidden entry, fetch asset details via `matrixApiFetch("assets/" + hid)`
5. If the asset has `attributes.name === "Page Contents"`, fetch `assets/{major_id - 1}` (the parent page)
6. Extract `attributes.short_name` (falling back to `attributes.name`) and `urls[0].path` from the parent asset
7. Filter out pages whose URL path contains "/news/", "/dev/", or "archive" (case-insensitive)
8. Render as comma-separated `<a>` links, deduplicated by URL path
9. On `internal.nt.gov.au` pages, apply a base-prefix visibility rule in the rendered DOM: keep only `<a>` links whose base prefix matches the current page base prefix (`scheme + host + first path segment`, e.g. `https://internal.nt.gov.au/dcdd`), while always keeping links that start with `https://ntgcentral.nt.gov.au/`, then rebuild the comma-separated HTML from kept links.

**Card view** — The source row is hidden when: no `assetassetid` is present, no reference links are found, the resolution chain yields only excluded/empty results, or post-render prefix filtering removes all links. The label is updated to "Source:" vs "Sources:" based on the number of links remaining after filtering.

**Table view** — The page cell initially shows "Loading…" when `raw.assetassetid` is present, then is populated with the resolved link HTML (or left empty when no pages are found). The page-link results are memoized per query and pre-fetched in the background for the full result set, so switching between card/table view, pagination, sorting, or filtering does not re-fetch the same data.

**API authentication:** All Matrix Management API calls use Bearer token `eeaa62869ea5c7e751446454327cf135` via `matrixApiFetch()`.

**Dev/mock mode:** When `isDev` is true (localhost, 127.0.0.1, or \*.github.io), `fetchPageLinks()` reads from `src/mock/matrix-asset-links.json` instead of calling the API. Hidden asset fetches return mock stubs.

**Shared helper functions:**

- `resolvePageLinks(assetId)` — returns `Promise<Array<{name, path}>>`. Encapsulates the upstream-link resolution chain, including /news/, /dev/, archive exclusion filtering and deduplication. Results are memoized in `pageLinksCache` for the lifetime of the current query, so repeated card/table renders reuse the same Promise and do not re-fetch the same asset links. In production, resolved page-link arrays are also persisted to `localStorage` under `dcdd-page-links:<assetId>`, so repeated page loads can serve cached page links without additional Matrix API fetches. When the current page URL contains `/_nocache` or `/_recache`, this persistent localStorage layer is bypassed (read and write), and fresh link data is fetched. When the URL specifically contains `/_recache`, the first uncached resolve for each unique `assetId` emits a debug console log (`[DCDD] /_recache page-links first-pass`) with the full resolved page-link JSON payload for that asset; subsequent cached resolves in the same page load do not re-log. Dev mode skips localStorage persistence and continues to use the static mock JSON cache.
- `renderPageLinksHtml(pageLinks)` — returns comma-separated HTML `<a>` string (or empty string when input is empty). Uses jQuery for HTML escaping to prevent XSS. Called by both render functions after `resolvePageLinks()` resolves.
- `filterPageLinksByPrefix($container)` — host-gated DOM post-filter that runs only when `window.location.hostname === "internal.nt.gov.au"`. After links are rendered, it keeps anchors whose `href` base prefix matches the current page base prefix and always keeps links starting with `https://ntgcentral.nt.gov.au/`; it then rebuilds the container HTML from kept links to prevent orphan commas and returns the remaining-link count to callers.
- `prefetchPageLinks(originalResults)` — starts background resolution for every unique `raw.assetassetid` in the search result set once the Coveo response arrives. This pre-warms the cache so pagination, sorting, filtering, and view toggles can show previously fetched page links instantly.

**`data-category` attribute:** Both card `<li>` elements (`renderCardResults()`) and table `<tr>` elements (`renderTableResults()`) carry a `data-category` attribute containing `raw.category` (empty string when absent). No visual display — this is a hidden data marker for DOM-level querying consistent with category filter values.

**External link detection:** External link detection logic is still present in `coveo-search.js` but the external-link icon is **permanently hidden** — `.doc-search-result__ext-icon` has `display: none` in CSS, the JS no longer removes the `hidden` attribute in card view, and the table view sets `extIcon = ""` (empty string). To re-enable: remove `display: none` from `.doc-search-result__ext-icon` in `search-widget.css`, restore the `removeAttr("hidden")` call in card rendering, and restore the conditional SVG string in table rendering.

**Sort change behaviour:** Changing the sort radio buttons (sidebar: `input[name="doc-search-sort"]`; mobile drawer: `input[name="doc-search-drawer-sort"]`) calls `applySort()` then `applyFilters()` — **no Coveo API re-fetch, no network request**. Active Type and Category filter checkboxes are preserved. Four options: **Relevance** (`relevancy`) restores the original API response order (`originalResults`); **Last updated** (`date descending`) sorts `allResults` by `raw.resourceupdated` descending using lexicographic comparison (the `YYYY-MM-DD HH:mm:ss` format makes lexicographic order identical to chronological order); **A – Z** (`alpha ascending`) and **Z – A** (`alpha descending`) sort by `raw.resourcefriendlytitle` (falling back to `result.title`) using `String.localeCompare()`.

### HTML fragments

#### `src/search-section.html` → `dist/search-section.html`

The search form fragment. Deployed as a Matrix nested container.

- Includes the full `<form id="policy-search-form" method="get">` markup in this fragment.
- Uses `<input type="text" name="searchterm" id="search">`.
- Uses a Font Awesome search icon span: `<span class="fal fa-search ntgc-search-section__icon"></span>`.
- The icon is styled in `src/css/search-widget.css` (`.ntgc-search-section__icon`) and rendered at 20px.

#### `src/search-results.html` → `dist/search-results.html`

The results area. Deployed as a separate Matrix nested container. Contains:

Important: `src/search-results.html` includes the literal Squiz keyword `%asset_contents%` as a CMS-managed placeholder for custom messaging content. Keep this token unchanged when editing templates or refactoring markup.

- `.doc-search-outer` / `.doc-search-layout` — outer wrapper and two-column flex container
- `#doc-search-results-col` — results column; `data-view="card"` or `data-view="table"` switches the active view
- `#initialLoadingSpinner` — CSS ring spinner; visible while fetch is in progress
- `#doc-search-user-message` — error / no-results message area; when a query yields zero results, `buildNoResultsHtml(query)` injects a structured block with a heading ("No results"), the bolded search term, and a suggestion to refine the search
- `#doc-search-results-summary` — "Showing X–Y of N results" text
- `#doc-search-mobile-filter-btn` — "Filters" pill button (hidden on desktop, visible ≤ 900 px); slides in the filter drawer
- `#doc-search-view-toggle` — card/table toggle pill button (`aria-pressed="true"` = table active)
- `#doc-search-results-list` — `<ul>` where card result `<li>` items are appended
- `#doc-search-table` / `#doc-search-table-body` — `<table>` rendered in table view (hidden on mobile)
- `#doc-search-pagination` — pagination `<nav>` (prev/next buttons + numbered pages with ellipsis)
- `#doc-search-sidebar` — filter sidebar containing Sort by (collapsible), Type, and Category facet groups; hidden on mobile
- `#doc-search-sort-group` — `<div role="radiogroup">` for sidebar sort; inputs use `name="doc-search-sort"` (values: `relevancy`, `date descending`, `alpha ascending`, `alpha descending`)
- `#doc-search-type-filters` — `<ul>` of checkbox filter items for `resourcedoctype`
- `#doc-search-category-filters` — `<ul>` of checkbox filter items for `category`
- `#doc-search-drawer` — slide-in filter drawer (`role="dialog" aria-modal="true"`); shown/hidden via `aria-hidden`
- `#doc-search-drawer-overlay` — semi-transparent backdrop; click closes the drawer
- `#doc-search-drawer-close` — × close button in the drawer header
- `#doc-search-drawer-sort-group` — drawer copy of the sort radio group; inputs use `name="doc-search-drawer-sort"`
- `#doc-search-drawer-type-filters` — drawer copy of the Type facet checkbox list
- `#doc-search-drawer-category-filters` — drawer copy of the Category facet checkbox list
- `#doc-search-drawer-clear` — "Clear all" button in the drawer body — resets sort + all checkboxes
- `#doc-search-drawer-apply` — "Apply filters" button in the drawer footer — syncs drawer state back to sidebar
- `.search-template` (`hidden`) — result card template `<li>` cloned by JS per result

---

## Key Element IDs

| ID                                    | Purpose                                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#policy-search-form`                 | Search form — submit triggers `runSearch()`                                                                                                                       |
| `#search`                             | Free-text input (`name="searchterm"`); pre-filled from `?searchterm=` URL param                                                                                   |
| `#doc-search-results-col`             | Results column; `data-view` attr controls card/table                                                                                                              |
| `#initialLoadingSpinner`              | Shown during fetch; hidden on response                                                                                                                            |
| `#doc-search-user-message`            | Error / no-results message; populated via `.html()` so it can contain the structured `buildNoResultsHtml()` block                                                 |
| `#doc-search-results-summary`         | "Showing X–Y of N results" line                                                                                                                                   |
| `#doc-search-sort`                    | Desktop sort dropdown select element `<select>`; change event triggers `applySort()` + `applyFilters()` (no API call)                                             |
| `#doc-search-mobile-filter-btn`       | Mobile-only "Filters" pill button (hidden on desktop); opens the filter drawer                                                                                    |
| `#doc-search-view-toggle`             | Card/table toggle pill button                                                                                                                                     |
| `#doc-search-results-list`            | Card results `<ul>`                                                                                                                                               |
| `#doc-search-table-body`              | Table results `<tbody>`                                                                                                                                           |
| `#doc-search-pagination`              | Pagination `<nav>`                                                                                                                                                |
| `#doc-search-sidebar`                 | Filter sidebar `<aside>` (hidden on mobile)                                                                                                                       |
| `#doc-search-sidebar-clear`           | "Clear all" button in desktop sidebar                                                                                                                             |
| `#doc-search-type-filters`            | Type facet checkbox list (sidebar)                                                                                                                                |
| `#doc-search-category-filters`        | Category facet checkbox list (sidebar)                                                                                                                            |
| `#doc-search-owner`                   | Content owner dropdown select (sidebar); change event fires `applyFilters()`                                                                                      |
| `#doc-search-drawer`                  | Slide-in filter drawer (`role="dialog"`, `aria-modal="true"`); shown/hidden via `aria-hidden`                                                                     |
| `#doc-search-drawer-overlay`          | Semi-transparent backdrop behind the drawer; click closes the drawer                                                                                              |
| `#doc-search-drawer-close`            | × close button in the drawer header                                                                                                                               |
| `#doc-search-drawer-sort`             | Drawer copy of the sort dropdown select; uses `name="doc-search-drawer-sort"`                                                                                     |
| `#doc-search-drawer-type-filters`     | Drawer copy of the Type facet checkbox list                                                                                                                       |
| `#doc-search-drawer-category-filters` | Drawer copy of the Category facet checkbox list                                                                                                                   |
| `#doc-search-drawer-owner`            | Drawer copy of the Content owner dropdown select                                                                                                                  |
| `#doc-search-drawer-clear`            | "Clear all" button in drawer body — resets sort to Relevance, clears all checkboxes                                                                               |
| `#doc-search-drawer-apply`            | "Apply filters" button in drawer footer — commits drawer sort + filter selections back to sidebar state                                                           |
| `#doc-search-drawer-item-count`       | `<p>` in `.doc-search-drawer__footer` above the Apply button; text set to "N items found" by `updateDrawerItemCount()` in real-time as drawer filters are toggled |

---

## CSS — search-widget.css

`src/css/search-widget.css` compiles to `dist/search-page.css`. It imports `src/css/tokens.css` at the top (`@import "./tokens.css";`) — do not re-declare `:root` inside this file. All design tokens live in `tokens.css` (see the [CSS Token System](#css-token-system) section above).

The document title suffix is rendered as `FILETYPE (filesize)` and is wrapped in a separate `.doc-search-result__file-meta` span. It inherits all styles from the parent `.doc-search-result__title-link` (font size, weight, colour, underline, and hover/focus colour) so it appears visually uniform with the title text. Spacing between the title text and the file meta is provided by the parent's `gap: 6px` flex gap — no extra margin is applied to `.doc-search-result__file-meta`.

### Internal card spacing

Spacing values inside the widget are written as direct pixel values (not token variables) in the class rules:

| Label   | Value  | Common uses in this widget                                                       |
| ------- | ------ | -------------------------------------------------------------------------------- |
| `sp-sm` | `12px` | Vertical gap between card elements (title → description → collection → meta row) |
| `sp-md` | `16px` | Table cell padding                                                               |
| `sp-lg` | `24px` | Card vertical padding                                                            |
| `sp-xl` | `32px` | Card horizontal padding                                                          |

When changing internal card spacing, use `12px` as the baseline for all bottom margins between elements — title link, description, collection row.

### BEM classes

#### Search form (`ntgc-search-section`)

| Class                                  | Element                                                           |
| -------------------------------------- | ----------------------------------------------------------------- |
| `.ntgc-search-section`                 | Outer wrapper — full-width, centred, padded                       |
| `.ntgc-search-section__container`      | Constrained inner container (max-width 1232px)                    |
| `.ntgc-search-section__input-wrapper`  | Input + button row (max-width 640px, outlined)                    |
| `.ntgc-search-section__input-field`    | Flex row — white background, overflow hidden                      |
| `.ntgc-search-section__text-input`     | `<input type="text">` — unstyled                                  |
| `.ntgc-search-section__submit-btn`     | `<button type="submit">` — transparent                            |
| `.ntgc-search-section__icon-container` | 24×24 icon wrapper                                                |
| `.ntgc-search-section__icon`           | Font Awesome search icon span (`fal fa-search`), rendered at 20px |

#### Results widget (`doc-search-*`)

| Class                                              | Element                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.doc-search-outer`                                | Outer section wrapper — shaded bg; `padding: 48px 0` on desktop; `padding-top: 16px` on mobile (≤ 900 px)                                                                                                                                                                                          |
| `.doc-search-layout`                               | Two-column flex (results col + sidebar)                                                                                                                                                                                                                                                            |
| `.doc-search-results-col`                          | Results column; `[data-view="table"]` activates table mode                                                                                                                                                                                                                                         |
| `.ntgc-callout` (inside `.doc-search-results-col`) | Governance contact callout — always visible above the results summary; background `#F5F5F7`, border-left `#102040`, `padding: 16px`, `line-height: 1.3`, `max-width: none`; overrides applied via `.doc-search-results-col .ntgc-callout` in `search-widget.css` with `!important`                 |
| `.doc-search-results-header`                       | Bar above results — summary text + controls. Uses `flex-direction: column` to stack summary text and controls row.                                                                                                                                                                                 |
| `.doc-search-results-summary`                      | "Showing X–Y of N results" `<p>` placed in its own row above controls.                                                                                                                                                                                                                             |
| `.doc-search-results-controls`                     | Flex row — contains the view toggle button (left) and the inline sort dropdown select (right).                                                                                                                                                                                                     |
| `.doc-search-view-toggle`                          | Card/table toggle pill `<button>`                                                                                                                                                                                                                                                                  |
| `.doc-search-view-toggle__pill`                    | The sliding oval indicator                                                                                                                                                                                                                                                                         |
| `.doc-search-view-toggle__label`                   | "Table view" / "Card view" text                                                                                                                                                                                                                                                                    |
| `.doc-search-spinner`                              | Loading spinner wrapper                                                                                                                                                                                                                                                                            |
| `.doc-search-spinner__ring`                        | CSS `@keyframes` ring animation                                                                                                                                                                                                                                                                    |
| `.doc-search-user-message`                         | Error / empty-state message; `padding: 0` (no vertical padding). Contains `.doc-search-no-results` block when a query yields zero results.                                                                                                                                                         |
| `.doc-search-no-results`                           | No-results wrapper `<div>` — `padding: 32px 0`                                                                                                                                                                                                                                                     |
| `.doc-search-no-results__heading`                  | "No results" `<h2>` — bold 20px heading                                                                                                                                                                                                                                                            |
| `.doc-search-no-results__detail`                   | "There were no results for **query**" `<p>` — search term wrapped in `<strong>`                                                                                                                                                                                                                    |
| `.doc-search-no-results__suggestion`               | "Try refining your search with some different key words" `<p>`                                                                                                                                                                                                                                     |
| `.doc-search-results-list`                         | Card results `<ul>`                                                                                                                                                                                                                                                                                |
| `.doc-search-result`                               | Single result card `<li>`                                                                                                                                                                                                                                                                          |
| `.doc-search-result__title-link`                   | Card title `<a>` — `display: flex` (block-level) so the following `<p>` sits flush below with no browser-default paragraph margin-top; `gap: 6px` spaces the title text from the file-meta suffix                                                                                                  |
| `.doc-search-result__title-text`                   | `<span>` wrapping the document title text — `text-decoration: underline`; underline removed on hover/focus                                                                                                                                                                                         |
| `.doc-search-result__file-meta`                    | `<span>` wrapping the `FILETYPE (filesize)` suffix — inherits all styles from `.doc-search-result__title-link`; `text-decoration: underline` matches `.doc-search-result__title-text`; underline removed on hover/focus. Style overrides are present but commented out in `search-widget.css`.     |
| `.doc-search-result__ext-icon`                     | Inline SVG external-link icon — **permanently hidden** via `display: none`. Present in the HTML template but suppressed. See _External link detection_ note above.                                                                                                                                 |
| `.doc-search-result__description`                  | Excerpt/description `<p>` — `margin: 12px 0 12px !important` overrides browser `<p>` default top margin                                                                                                                                                                                            |
| `.doc-search-result__collection-row`               | "Collection: …" row                                                                                                                                                                                                                                                                                |
| `.doc-search-result__collection-icon`              | Inline SVG folder icon preceding "Collection:" — 12×12, `stroke="currentColor"`, `aria-hidden="true"`, vertically aligned to text baseline                                                                                                                                                         |
| `.doc-search-result__collection-link`              | Link to the parent collection                                                                                                                                                                                                                                                                      |
| `.doc-search-result__page-row`                     | "Source: …" / "Sources: …" row — `font-size: var(--font-size-xs)`, `color: var(--clr-text-alt)`, `margin-bottom: 4px`; hidden by default, shown when upstream page links are resolved                                                                                                              |
| `.doc-search-result__page-row a`                   | Page link `<a>` inside the page row — `color: var(--clr-tertiary)`, underlined                                                                                                                                                                                                                     |
| `.doc-search-result__page-icon`                    | Inline SVG globe icon preceding "Source:" — 16×16, `stroke="currentColor"`, `aria-hidden="true"`, vertically aligned to text baseline                                                                                                                                                              |
| `.doc-search-result__meta`                         | Flex row — doctype tag + last-updated date                                                                                                                                                                                                                                                         |
| `.doc-search-result__tag`                          | Document type tag `<span>` (e.g. "Policy") — `display: inline-flex`, `outline: 1px solid var(--clr-border-subtle)` (not `border`), **no `border-radius`**, 12px/700 uppercase Roboto                                                                                                               |
| `.doc-search-result__updated`                      | Last-updated date wrapper `<div>` — contains literal text `Last updated:` and an inner `<span [data-ref="search-result-last-updated"]>` with the formatted date (card view only; table view renders plain text directly in `<td>`)                                                                 |
| `.doc-search-table-wrap`                           | Overflow wrapper for table (hidden in card view)                                                                                                                                                                                                                                                   |
| `.doc-search-table`                                | Results `<table>` (visible only when `data-view="table"`)                                                                                                                                                                                                                                          |
| `.doc-search-table__col-title`                     | Title column — 50% width                                                                                                                                                                                                                                                                           |
| `.doc-search-table__col-updated`                   | Last Updated column                                                                                                                                                                                                                                                                                |
| `.doc-search-table__col-type`                      | Type column                                                                                                                                                                                                                                                                                        |
| `.doc-search-table__col-collection`                | Collection column                                                                                                                                                                                                                                                                                  |
| `.doc-search-table__title-link`                    | Title `<a>` inside table row                                                                                                                                                                                                                                                                       |
| `.doc-search-table__tag`                           | Doctype `<span>` inside table row — same style as `.doc-search-result__tag` (`inline-flex`, `outline`, no `border-radius`); `white-space: nowrap` prevents multi-word types from line-breaking                                                                                                     |
| `.doc-search-pagination`                           | Pagination `<nav>`                                                                                                                                                                                                                                                                                 |
| `.doc-search-pagination__btn`                      | Page number / prev / next `<button>` — `border: none`, `border-radius: 0`, `background: transparent`. Number buttons show `--clr-bg-shade-alt` on hover.                                                                                                                                           |
| `.doc-search-pagination__btn--active`              | Currently selected page button — `background: var(--clr-surface-selected)` (dark green), white text, `pointer-events: none` (blocks hover and click). No border.                                                                                                                                   |
| `.doc-search-pagination__btn--prev`                | Prev button — contains an inline SVG chevron-left (`fill="currentColor"`). Icon color is `--clr-text-default` at rest; transitions to `--clr-icon-default` (#208820) on hover.                                                                                                                     |
| `.doc-search-pagination__btn--next`                | Next button — same SVG as Prev flipped horizontally via `transform: scaleX(-1)` CSS on the `<svg>`. Same hover colour behaviour.                                                                                                                                                                   |
| `.doc-search-pagination__ellipsis`                 | `…` gap `<span>` between page numbers                                                                                                                                                                                                                                                              |
| `.doc-search-sidebar`                              | Filter sidebar `<aside>` (hidden on mobile ≤ 900 px)                                                                                                                                                                                                                                               |
| `.doc-search-sidebar__header`                      | Wrapper for sidebar heading and clear button                                                                                                                                                                                                                                                       |
| `.doc-search-sidebar__heading`                     | Sidebar header `<h2>` ("Filters") with bold typography.                                                                                                                                                                                                                                            |
| `.doc-search-sidebar__clear`                       | "Clear all" `<button>` in the sidebar header                                                                                                                                                                                                                                                       |
| `.doc-search-filter-group`                         | A single filter section container (Type, Category, Content owner, etc.)                                                                                                                                                                                                                            |
| `.doc-search-filter-group__title`                  | Non-collapsible facet group heading `<h3>` or `<label>` (Type, Category, Content owner); `font-size: 16px !important`; `margin: 0 !important`                                                                                                                                                      |
| `.doc-search-filter-group--sort-inline`            | Modifier class for placing the Sort by dropdown inline in the results controls header. Flex row layout with select min-width 150px and height 40px.                                                                                                                                                |
| `.doc-search-sort-label`                           | Label for Sort select dropdown.                                                                                                                                                                                                                                                                    |
| `.doc-search-sort-select`                          | Wrapper `<div>` for the Sort dropdown select with outline styling and custom chevron.                                                                                                                                                                                                              |
| `.doc-search-sort-select__input`                   | `<select>` input element for sorting.                                                                                                                                                                                                                                                              |
| `.doc-search-mobile-filter-btn`                    | Mobile-only "Filters" pill button (`display: none` on desktop); contains icon SVG, label (with counter), and chevron                                                                                                                                                                               |
| `.doc-search-mobile-filter-btn__left`              | Left slot — wraps the sliders icon SVG and "Filters" text (with embedded counter span)                                                                                                                                                                                                             |
| `.doc-search-mobile-filter-btn__icon`              | Sliders/equalizer SVG (three vertical tracks with movable stops) on the left of the button; `fill="currentColor"` inherits `--clr-link-default`                                                                                                                                                    |
| `.doc-search-mobile-filter-btn__label`             | "Filter and sort" text `<span>` inside the mobile button                                                                                                                                                                                                                                           |
| `.doc-search-mobile-filter-btn__chevron`           | Right-pointing filled chevron SVG (`viewBox="0 0 15 24"`); `fill="currentColor"` inherits colour; indicates the drawer slides in from the right                                                                                                                                                    |
| `.doc-search-drawer`                               | Slide-in filter panel (`position: fixed`; slides in from the right); `aria-hidden` drives visibility; `z-index: 10002` — above the site header (`10000`) and overlay (`10001`)                                                                                                                     |
| `.doc-search-drawer-overlay`                       | Semi-transparent fixed overlay behind the drawer; click triggers close; `z-index: 10001` — above the site header (`10000`) but below the drawer panel (`10002`)                                                                                                                                    |
| `.doc-search-drawer__header`                       | Sticky header row — "Filters" title + × close button                                                                                                                                                                                                                                               |
| `.doc-search-drawer__title`                        | "Filters" heading `<span>`                                                                                                                                                                                                                                                                         |
| `.doc-search-drawer__close`                        | × close `<button>`; `align-self: stretch` fills the full header height; inset focus ring (`outline-offset: -4px`)                                                                                                                                                                                  |
| `.doc-search-drawer__body`                         | Scrollable region containing the sort group, Type facet, Category facet, and Clear button                                                                                                                                                                                                          |
| `.doc-search-drawer__footer`                       | Sticky footer containing the live item count (`#doc-search-drawer-item-count`) and the "Apply filters" button                                                                                                                                                                                      |
| `.doc-search-drawer__item-count`                   | Live result count `<p>` ("N items found") in the drawer footer; updated in real-time by `updateDrawerItemCount()` as the user toggles drawer checkboxes, changes the owner dropdown, or clears all — without mutating module filter state                                                          |
| `.doc-search-drawer__apply`                        | "Apply filters" `<button>` — syncs drawer selections to sidebar and fires `applyFilters()`                                                                                                                                                                                                         |
| `.doc-search-drawer__clear`                        | "Clear all" `<button>` inside `.doc-search-drawer__body`; resets sort to Relevance and unchecks all facets                                                                                                                                                                                         |
| `.doc-search-facet-list`                           | Checkbox list `<ul>`                                                                                                                                                                                                                                                                               |
| `.doc-search-facet-item`                           | Checkbox label wrapper `<label>`; `display: flex; align-items: center; justify-content: flex-start; gap: 8px` — count sits immediately after label text, not pushed to row end                                                                                                                     |
| `.doc-search-facet-item--disabled`                 | Applied to checkbox label wrapper `<label>` when count is `0`; reduces opacity to `0.5` and sets cursor to `not-allowed` to visually mute/disable the item.                                                                                                                                        |
| `.doc-search-facet-item input[type="checkbox"]`    | Custom checkbox (32×32 px); `appearance: none`; `margin-top: 0; margin-bottom: 0`; both states use SVG `background-image` — unchecked = white-fill square with `#102040` outline; checked = square with white tick on `#102040` fill; no native appearance                                         |
| `.doc-search-facet-item__label`                    | Facet value text; `font-weight: var(--font-weight-regular) !important` (400); `font-size: var(--font-size-sm) !important` (16px) — both `!important` to override external stylesheet inheritance                                                                                                   |
| `.doc-search-facet-item__count`                    | Result count `(N)` in parentheses                                                                                                                                                                                                                                                                  |
| `.doc-search-facet-hidden`                         | Applied to facet items beyond `MAX_FACET_VISIBLE` (7)                                                                                                                                                                                                                                              |
| `.doc-search-show-all`                             | **Toggle button** for facet overflow — renders as "Show all (N)" when collapsed, "Show less" when expanded; `data-total` and `data-max` attributes store original counts; clicking toggles `.doc-search-facet-hidden` on items beyond `MAX_FACET_VISIBLE` without removing the button from the DOM |
| `.search-template`                                 | Hidden `<li>` template — cloned per result by JS                                                                                                                                                                                                                                                   |
| `.doc-search-filter-group--owner`                  | Content owner filter group container (`gap: 8px`)                                                                                                                                                                                                                                                  |
| `.doc-search-owner-select`                         | Content owner dropdown wrapping div                                                                                                                                                                                                                                                                |
| `.doc-search-owner-select__input`                  | Select input for Content owner filter                                                                                                                                                                                                                                                              |
| `.doc-search-owner-select__chevron`                | Chevron icon inside the Content owner dropdown select                                                                                                                                                                                                                                              |

**Responsive breakpoints:** At ≤ 900 px, `.doc-search-layout` switches from row to column, the filter sidebar (`#doc-search-sidebar`) is hidden, and a "Filters" pill button (`#doc-search-mobile-filter-btn`) appears in the results column. Tapping it slides in the filter drawer (`#doc-search-drawer`) from the right. The table view toggle is also hidden at this breakpoint — only card view is available on mobile.

---

## User Session Data

Matrix injects the authenticated user's details into `localStorage` on page load:

| Key                      | Value                                                                             |
| ------------------------ | --------------------------------------------------------------------------------- |
| `intra-user-id`          | Squiz Matrix asset ID of the logged-in user                                       |
| `intra-user-info`        | JSON: `UIgivenName, sn, telephoneNumber, mail, title, location, departmentNumber` |
| `intra-user-displayName` | `'Yes'` if the display name should be shown                                       |

---

## Analytics

Google Analytics 4 via Google Tag Manager. Tag ID: `G-WY2GK59DRN`. GTM is loaded by the Matrix paint layout — it is not in this bundle.

---

## Squiz Matrix Asset IDs

| Asset                          | ID       |
| ------------------------------ | -------- |
| Current page (Document search) | `944140` |
| Site globe (DCDD intranet)     | `434727` |
| Site index                     | `434732` |
| Page variation (Page Contents) | `944141` |

---

## Known Quirks & Notes for Developers

- **Font Awesome is still required for the search form icon.** The search submit icon uses `<span class="fal fa-search">` in `src/search-section.html`, so Font Awesome Pro 5 CSS must be present on the page (typically via Matrix paint layout). Other UI icons in this widget remain inline SVG or CSS-based (for example: pagination chevrons, filter/drawer icons, spinner ring).

- **VPN required for production search.** The Coveo endpoint (`https://internal.nt.gov.au/...`) is only reachable on the NTG network. `coveo-search.js` automatically falls back to the mock JSON when `hostname` is `localhost` or `127.0.0.1`. Do not use a `?a=<assetId>` Matrix shorthand URL — it resolves to an HTML page, not JSON.

- **Mock data is static.** `src/mock/coveo-search-rest-api-query.json` always returns the same 36 results regardless of the query string. It is a snapshot used purely to exercise the rendering pipeline locally.

- **Sort is client-side; filters are preserved on sort change.** Changing the sort dropdown (`select[name="doc-search-sort"]` in the results header, or `select[name="doc-search-drawer-sort"]` in the mobile drawer) calls `applySort()` then `applyFilters()` — no API call, no filter reset. `originalResults` always holds the unmodified API response so "Relevance" can restore it cheaply. The mobile drawer has its own select that mirrors the header state; the "Apply filters" button syncs the drawer selection back to the header select before firing.

- **Mobile filter drawer.** On screens ≤ 900 px the filter sidebar is hidden and replaced by a "Filter and sort" pill button (`#doc-search-mobile-filter-btn`). Tapping it opens a slide-in drawer (`#doc-search-drawer`, `position: fixed`, slides from the right) with the full sort + facet UI duplicated. The drawer has its own sort dropdown (`name="doc-search-drawer-sort"`), its own Type/Category checkbox lists, and its own Content owner dropdown select (`name="doc-search-drawer-owner"`). On "Apply filters" (`#doc-search-drawer-apply`), `coveo-search.js` reads the drawer sort selection, syncs it to the sidebar select, reads the drawer checkboxes and Content owner dropdown selection, syncs them to the sidebar checkboxes/Content owner select, then calls `applySort()` + `applyFilters()`. On "Clear all" (`#doc-search-drawer-clear`), sort resets to `relevancy`, Content owner select resets to `""`, and all checkboxes are unchecked (in both drawer and sidebar). The desktop sidebar also has its own "Clear all" button (`#doc-search-sidebar-clear`) which immediately resets all filters and re-applies them. The overlay and close button both fire the same close routine.

  **Live item count in the drawer footer:** The drawer footer contains a `<p id="doc-search-drawer-item-count">` element above the "Apply filters" button that shows how many results the current drawer filter selections would yield (e.g. "42 items found" or "1 item found"). `updateDrawerItemCount()` reads the drawer checkboxes and owner select, runs the same AND/OR filter logic as `applyFilters()` against `allResults` (without mutating `filteredResults` or triggering a render), and sets the count text. It is called on drawer open (after `buildDrawerFilters()`), on every drawer checkbox change, on drawer owner select change, and on drawer "Clear all" — giving the user immediate feedback before committing with "Apply filters".

  **Z-index layering:** The drawer overlay is `z-index: 10001` and the drawer panel is `z-index: 10002`, placing them above the NTG intranet header (`z-index: 10000`). If the site header's z-index ever changes, update both values in `src/css/search-widget.css` to stay above it.

- **`runSearch()` fires unconditionally.** The `$(document).ready` handler calls `runSearch()` regardless of whether `#policy-search-form` exists on the page. The form submit handler is wired up separately, only if `#policy-search-form` is found — and it **redirects** to `?searchterm=<encoded_query>` rather than calling `runSearch()` directly. The redirect triggers a fresh page load which re-enters via the init path. This allows the results area to work as a standalone nested container without needing the form on the same page load, and keeps the URL bookmarkable.

- **`moment.js` is not used by this bundle.** `formatDate()` uses a native regex (`/^(\d{4})-(\d{2})-(\d{2})/`) to parse and reformat `raw.resourceupdated`. There is no `window.moment` dependency — dates display correctly whether or not moment.js is loaded by the Matrix page.

- **`@supports` CSS warning at build time.** Vite/esbuild emits `[WARNING] Expected identifier but found "@supports"` from `src/css/main.css`. This is a pre-existing IE-targeting vendor pattern (`-ms-ime-align`) and does not affect functionality. Safe to ignore — `main.css` is not in the bundle anyway.

- **Vendor SVGs in `src/vendor/img/`.** The four SVG mask files were previously referenced as `/?a=XXXXXX` Matrix asset URLs in production. They are now local files referenced by relative path from `src/css/main.css`. If the NTG design system is updated, replace the files in `src/vendor/img/` and rebuild.

- **`.oft` link handling.** `global-v2.js` (loaded by Matrix, not bundled) automatically adds a `download` attribute to any `<a>` pointing to a `.oft` (Outlook Template) file.

- **Card element vertical spacing is `12px` uniform (`sp-sm`).** Title link, description, and collection row each carry `margin-bottom: 12px`. The description `<p>` also carries `margin-top: 12px !important` — the `!important` is required because browsers default `<p>` to `margin-top: 1em` and the parent block context makes that apply even when the title link sets `margin-bottom: 0`.

- **`.doc-search-result__title-link` must be `display: flex`, not `display: inline-flex`.** As a block-level flex container it establishes a new block formatting context, preventing the browser's default `<p>` `margin-top: 1em` from appearing above the description. Changing it back to `inline-flex` reintroduces the unwanted top gap before the description.

- **Tags use `outline`, not `border`, and have no `border-radius`.** Both `.doc-search-result__tag` and `.doc-search-table__tag` use `outline: 1px var(--clr-border-subtle) solid; outline-offset: -1px` and `overflow: hidden` to achieve the rectangular border appearance. This matches the Figma "Default" variant of the tag component. Do not add `border-radius` — the design is intentionally square-cornered.

- **`search-section-preview.html` is auto-synced.** The `syncPreviewTemplate()` function in `vite.config.js` automatically extracts the entirety of `src/search-results.html` and patches it into `search-section-preview.html` on every build and on every `src/*.html` save during dev. You **never need to manually edit `search-section-preview.html`** for structural changes to the results or filters — edit `src/search-results.html` and save. If you need to fully regenerate `search-section-preview.html` from scratch (e.g. after the production CMS page chrome changes significantly): write a Node script that reads `Document search _ DCDD intranet.html`, replaces the CDN widget refs with `./dist/` paths, wraps the `ntgc-search-section` div in `<form id="policy-search-form">`, and injects the contents of `src/search-results.html` after the form.

- **`emptyOutDir: false` in `vite.collection.config.js` is non-negotiable.** Vite clears `outDir` before each build by default. The collection config writes to `dist/` — the same directory as the search config. Without `emptyOutDir: false`, running the second build (or doing `npm run build`) would silently delete `dist/search-page.css` and `dist/search-page.js`, leaving Matrix without its search assets. The collection config has a comment marking this; do not remove or change it.

- **`!important` overrides in `collection-page.css` are intentional.** `main.css` (the NTG central stylesheet, ~13 900 lines, loaded by the Matrix paint layout) applies aggressive base styles — `margin-top` on `<h2>` and `<h3>`, default link colours, paragraph spacing. These cannot be overridden without `!important` from a stylesheet that is loaded at the same cascade level. Current intentional `!important` usages:
  - `.back-to-search { margin-bottom: var(--sp-xl) !important }` — overrides `main.css` link default margins
  - `.back-to-search + h2 { margin-top: 0 !important }` — prevents unwanted gap below the back link
  - `.related-policies__title { margin: 0 0 var(--sp-2xl) !important }` — overrides `main.css` `<h2>` top margin
  - `.related-policy__title { margin-top: 0 !important }` — overrides `main.css` `<h3>` top margin

  Do not remove them.

- **Watcher routing in `vite.config.js`.** The `auto-rebuild-on-src-change` plugin detects which config to use based on the changed filename: `tokens.css` changes rebuild both configs sequentially; `collection-page.css` changes rebuild only `vite.collection.config.js`; all other CSS/JS changes rebuild only the search config (`vite.config.js`). HTML files in `src/*.html` are recopied to `dist/` with a full reload; `collection-page-preview.html` and `Gifts and benefits _ Resources.html` trigger a full reload only (no rebuild). The `isCollectionCss`, `isTokens`, `isSrcHtml`, and `isPreviewHtml` boolean flags in the `change` handler implement this routing. If you add new CSS files or new dev preview HTML files, update the watcher paths and flag logic in `vite.config.js` accordingly.

- **`index.html` and `collection/*.html` are generated files — do not edit them manually.** They are produced by `scripts/generate-collection-pages.js` as the third step of `npm run build`. Any manual edits will be overwritten on the next build. To change the structure, layout, or content of the GitHub Pages static pages, edit the generator script or its template sources (`search-section-preview.html`, `collection-page-preview.html`, `src/mock/coveo-search-rest-api-query.json`).

- **`buildCollectionUrl()` constructs collection links with text fragment markup.** This function in `coveo-search.js` calls `localiseCollectionUrl()` to rewrite intranet URLs to local relative paths on GitHub Pages (and localhost), then appends a [text fragment](https://developer.mozilla.org/en-US/docs/Web/URI/Fragment/Text_fragments) derived from `formatFileMeta(raw)` — e.g. `#:~:text=DOCX%20(612.4%20KB)`. When the user clicks a "Collection:" link, the browser scrolls to and highlights the matching document on the collection page. The fragment is omitted when the document has no file-type or size metadata. `localiseCollectionUrl()` remains the underlying URL-rewrite helper; `buildCollectionUrl()` is the call site used in `renderCardResults()`.

- **`.nojekyll` must remain in the repository root.** GitHub Pages will silently drop directories whose names begin with `_` (including `dist/`) if Jekyll processing is enabled. The `.nojekyll` file disables Jekyll. It is an empty file — its presence is all that matters. If GitHub Pages ever stops serving `dist/` or `src/`, check that `.nojekyll` is present and tracked in git.

- **The `_site/` directory in the CI workflow is ephemeral.** `deploy.yml` assembles `_site/` in the GitHub Actions runner workspace during the deployment job and uploads it as a Pages artifact. It is never committed to the repository. The `gh-pages` branch is also managed entirely by the GitHub Actions deployment and should not be edited directly.

- **`MOCK_URL` in `coveo-search.js` must be a relative path.** The value is `"./src/mock/coveo-search-rest-api-query.json"` — relative to the page, not to the js file. This works on both `localhost` (served by Vite from the repo root) and GitHub Pages (where the file is served from `_site/src/mock/...`). Do not change it to an absolute path or a root-relative path starting with `/`.
