# Copilot Instructions – dcdd-policy-library

This repository contains the source code, preview files, and build scripts for the NT Government DCDD (Department of Corporate and Digital Development) intranet Document Search and Collection pages.

## Project Overview

- **Document Search Page**: A filterable full-text Coveo search interface built for DCDD policy documents.
- **Collection Pages**: Static document listing pages generated dynamically (e.g., Agency Templates, Gifts and Benefits) from mock data for previews or configured via Squiz Matrix in production.
- **Target Platform**: Squiz Matrix CMS, synced using Squiz Matrix Git File Bridge.
- **Design Tokens**: Standardized CSS custom properties defined in `src/css/tokens.css`.

---

## Directory Structure

```
document-library/
├── src/                          # Source code (EDIT HERE)
│   ├── search-page.js            # Entry point for Search Page bundle
│   ├── collection-page.js        # Entry point for Collection Page bundle
│   ├── search-section.html       # HTML fragment for search input form
│   ├── search-results.html       # HTML fragment for search results & filters
│   ├── js/
│   │   └── coveo-search.js       # Search logic, Coveo REST API fetch, UI rendering
│   ├── css/
│   │   ├── tokens.css            # Central CSS custom properties / design tokens
│   │   ├── search-widget.css     # CSS specific to Search page
│   │   └── collection-page.css   # CSS specific to Collection pages
│   └── mock/                     # Mock data JSON files for local development
├── dist/                         # Rebuilt bundles (committed to git for Git File Bridge)
├── scripts/                      # Build-related scripts (e.g., HTML generator)
└── index.html                    # Auto-generated preview page for GitHub Pages
```

---

## Development & Build Commands

- **Local Development**: `npm run dev` (starts Vite dev server at `http://localhost:3000`).
- **Production Build**: `npm run build`
  Runs three builds in sequence:
  1. `vite build` — Builds the search bundle to `dist/search-page.js` and `dist/search-page.css`.
  2. `vite build --config vite.collection.config.js` — Builds the collection bundle CSS to `dist/collection-page.css`.
  3. `node scripts/generate-collection-pages.js` — Generates static HTML previews (`index.html` and `collection/*.html`) from mock data.
- **Preview Output**: `npm run preview` — Starts a local server serving the built `dist/` and preview files.

---

## Key Architectural Decisions

1. **Matrix Git File Bridge Integration**:
   - The compiled files in `dist/` must be committed to git. Do **not** gitignore the `dist/` directory.
   - The Vite configs do not use content-hashes in output names (`search-page.js`, `search-page.css`, `collection-page.css`) so Matrix asset references remain stable.

2. **Dual Vite Configs**:
   - The second build `vite.collection.config.js` must have `emptyOutDir: false` to prevent wiping the first build's files (`search-page.*`) from `dist/`.

3. **Coveo Search Logic**:
   - In production (on non-local hostnames), fetches data from the Coveo REST API.
   - Locally or on GitHub Pages, falls back to `src/mock/coveo-search-rest-api-query.json` automatically.
   - Sorting is performed client-side using the retrieved results without triggering new API requests.

4. **Desktop vs. Mobile Drawer Filters**:
   - **Desktop Layout**: Filters sidebar includes "Filters" heading (`.doc-search-sidebar__heading`) at the top, followed by checkbox facets (Type, Category) and dropdown select facet (Owner).
   - **Inline Sort**: The desktop Sort selector is placed in the results header control row (right side) instead of the sidebar. It uses `.doc-search-filter-group--sort-inline` modifier and is rendered as a `<select>` element.
   - **Mobile Layout (<= 900px)**: The filters sidebar and table view toggle are hidden. A mobile filter button (`#doc-search-mobile-filter-btn`) appears, which opens a slide-in drawer (`#doc-search-drawer`). The drawer contains a duplicate Sort selector (as a dropdown select) and the facet checkboxes/selectors. When "Apply filters" is clicked, drawer states are synced back to the hidden sidebar states, and the query is re-filtered.

---

## Conventions & Gotchas

- **Three-File HTML Synchronization**:
  - `src/search-results.html` is the source template.
  - `index.html` (root) and `search-section-preview.html` are standalone files.
  - The programmatic builder (`syncPreviewTemplate`) in `vite.config.js` automatically copies the card `<li>` template from `src/search-results.html` to `search-section-preview.html` on changes. However, structural changes to the search results or filters HTML should be built or double-checked to ensure they sync.
- **CSS Tokens**:
  - Never declare `:root` variables in `search-widget.css` or `collection-page.css` directly. Always place them in `tokens.css`.
- **`!important` CSS Overrides**:
  - Conflicting styles from the NTG central stylesheet (`main.css`, loaded by Squiz Matrix) require `!important` to be overridden correctly. This is an expected pattern in this repository.
- **No Font Awesome in Bundles**:
  - Standard UI icons should be inline SVGs using `fill="currentColor"` or `stroke="currentColor"` so they adapt to theme colors and load instantly without asset dependencies.
- **Muted/Disabled Checkmark Filters**:
  - Checkmark filters with a count of `0` receive the `disabled` attribute on their input and the class `doc-search-facet-item--disabled` on the label wrapper. They are styled with `opacity: 0.5` and `cursor: not-allowed` (using `!important` to override defaults), and the custom checkbox background SVGs are replaced with muted gray versions.
