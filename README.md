# DCDD Policy Library

Short guide for working on the Document Search and Collection pages.

## What this repo is

This project powers two DCDD intranet experiences in Squiz Matrix:

- Document search page (Coveo-backed)
- Collection pages (document listings like Gifts and Benefits)

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Build once (required before first preview):

```bash
npm run build
```

3. Start local dev:

```bash
npm run dev
```

## Useful local URLs

- Search page preview (auto-opens):
  - http://localhost:3000/
- Search page with CMS chrome:
  - http://localhost:3000/search-section-preview.html
- Collection page preview:
  - http://localhost:3000/collection-page-preview.html

## Everyday workflow

1. Edit source files in `src/`.
2. Run `npm run build`.
3. Commit both `src/` and `dist/` changes together.

`dist/` is intentionally committed because Git File Bridge deploys from repository files.

## What to edit

- Search form markup: `src/search-section.html`
- Search results layout: `src/search-results.html`
- Search logic: `src/js/coveo-search.js`
- Search view metadata patch (standalone): `src/js/view-preference-metadata-patch.js`
- Search styles: `src/css/search-widget.css`
- Collection styles: `src/css/collection-page.css`
- Shared tokens: `src/css/tokens.css`

## View preference metadata patch (standalone)

This repo includes a standalone script to persist the search view preference to Squiz user metadata:

- File: `src/js/view-preference-metadata-patch.js`
- Metadata field: `#969752` (`user.view-preference`)
- Canonical values saved: `grid` (default) and `table`
- Local compatibility key: `docSearchView` (`card`/`table`) remains in use

Behavior:

- Reads preference from user metadata on load (cross-device restore).
- Applies the view state to the existing search UI toggle.
- Writes changes back to metadata when user toggles view or clicks save.
- Uses `grid` as default when no metadata value exists.
- On mobile (`<=900px`), keeps UI in card mode while preserving the saved preference.

Integration options:

1. Bundle it into `dist/search-page.js` by importing it in `src/search-page.js`.
2. Or include it as a separate script in Matrix after the main search/profile scripts.

The script is standalone (IIFE) and can be merged into `global-v2.js` later if desired.

## Matrix custom content slot

The search results template includes `<span id="custom-content"></span>` in `src/search-results.html`.

At runtime, `src/js/coveo-search.js` moves child nodes from `#asset-contents` into `#custom-content`.
This supports Squiz Matrix content that may be injected after page load.

Implementation details:

- The move is one-time and idempotent (no duplicate moves).
- If `#asset-contents` is not present immediately, a `MutationObserver` watches for late insertion.
- Observers disconnect after a successful move, with a safety timeout to avoid long-lived observers.

## Category value format

`raw.category` values are parsed as multi-value categories and support both comma and semicolon delimiters.

- Multi-value input may be comma-delimited (Coveo default) or semicolon-delimited.
- Comma split rule: split only when the next non-space character starts with an uppercase letter.
- Example split: `Fraud and corruption, Finance and travel`.
- Example no-split: `Conduct, integrity and risk`.
- Search facet counts and filtering in `src/js/coveo-search.js` follow this contract.

## Page-link cache behavior (`/_nocache`, `/_recache`)

Page links resolved by `src/js/coveo-search.js` use two cache layers:

- In-memory per page load: `pageLinksCache` (always used for deduping repeated resolves).
- Persistent cache: `localStorage` keys prefixed with `dcdd-page-links:`.

Page-link visibility also applies a runtime prefix rule in `src/js/coveo-search.js`:

- If a result includes both `raw.sourcepage` and `raw.sourceurl`, that source link is rendered immediately in the Source field (card and table) before async Matrix page-link resolution completes.
- When async Matrix page links resolve, they are merged with the immediate source link(s) (immediate first, deduped by URL path).
- On `internal.nt.gov.au` pages, page links are rendered first, then non-matching links are hidden in the DOM when their base prefix differs from the current page base prefix.
- Links whose URL starts with `https://ntgcentral.nt.gov.au/` are always kept (not hidden by prefix filtering).
- Base prefix means: `scheme + host + first path segment` (example: `https://internal.nt.gov.au/dcdd`).
- Existing path exclusions still apply (`/news/`, `/dev/`, and `archive`).
- On local/dev hosts (`localhost`, `127.0.0.1`, `*.github.io`), this prefix filter is not enforced.
- The rendered Sources markup is rebuilt from the remaining links so commas/separators stay correct; if no links remain in card view, the entire Sources row is hidden.

When the current URL contains `/_nocache` or `/_recache`, the page-link resolver bypasses the persistent `localStorage` layer and fetches fresh link data instead. The in-memory `pageLinksCache` remains active during that page load so card/table rendering, pagination, sorting, and filtering still reuse the same in-flight/resolved Promise.

When the current URL contains `/_recache`, the first uncached resolve per unique `assetId` logs a debug console entry (`[DCDD] /_recache page-links first-pass`) that includes the full resolved page-link JSON payload for that asset. Because `pageLinksCache` memoizes each Promise, subsequent renders for the same `assetId` in the same page load do not re-log.

## Build commands

```bash
npm run dev      # local development
npm run build    # build search + collection + generated pages
npm run preview  # serve built output
```

## Deployment note

On push, Git File Bridge syncs deployed files from `dist/` into Matrix assets.

## Need the deep technical details?

See the full technical documentation:

- [docs/technical-reference.md](docs/technical-reference.md)

It includes architecture, build internals, Matrix details, Coveo integration, CSS token system, and full implementation notes.
