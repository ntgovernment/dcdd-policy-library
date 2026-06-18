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
- Search styles: `src/css/search-widget.css`
- Collection styles: `src/css/collection-page.css`
- Shared tokens: `src/css/tokens.css`

## Matrix custom content slot

The search results template includes `<span id="custom-content"></span>` in `src/search-results.html`.

At runtime, `src/js/coveo-search.js` moves child nodes from `#asset-contents` into `#custom-content`.
This supports Squiz Matrix content that may be injected after page load.

Implementation details:

- The move is one-time and idempotent (no duplicate moves).
- If `#asset-contents` is not present immediately, a `MutationObserver` watches for late insertion.
- Observers disconnect after a successful move, with a safety timeout to avoid long-lived observers.

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
