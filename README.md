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

## Sort controls

Sorting is client-side and does not trigger a new Coveo request.

- Desktop uses expanded `Sort by` radio buttons above the `Filters` heading in the sidebar.
- Mobile uses matching `Sort by` radio buttons inside the filter drawer.
- Desktop radios use `name="doc-search-sort"`; drawer radios use `name="doc-search-drawer-sort"` so drawer changes are staged until the dynamic `Show N results` button is clicked.
- The mobile drawer footer keeps the primary `Show N results` button and the secondary `Clear all` link visible while the filter controls scroll.
- Runtime button copy is count-aware: `Show 1 result` for one match, otherwise `Show N results`.
- Drawer `Clear all` resets staged controls only; results do not update until the user clicks `Show N results`.
- Sort values are `relevancy`, `date descending`, `alpha ascending`, and `alpha descending`.
- The results summary (`Showing X-Y of N results`) and table/card view toggle share one results header row: summary left, view toggle right. Keep the view toggle right-aligned where the old inline sort dropdown used to be.

## Search analytics

The search runtime now emits GA4 events for submitted searches and zero-result queries from `src/js/coveo-search.js`.

- Custom event: `policy_search`
- Custom event: `policy_search_zero_results`
- Custom parameters sent: `search_term`, `results_count`, `search_source`

Implementation notes:

- Events are query-scoped and only fire for submitted searches with a non-empty `searchterm` URL parameter.
- Zero-results tracking is limited to the initial submitted query outcome. Filter-driven empty states do not emit the zero-results event.
- The runtime fails safely when `window.gtag` is unavailable, so local/generated builds can still run without GA.

GA4 setup required:

1. In the GA4 web data stream, keep Enhanced Measurement enabled.
2. Add `searchterm` as an additional site-search query parameter so GA4 also collects the built-in `view_search_results` event for this page.
3. Register custom dimensions for `search_term`, `results_count`, and `search_source` on the custom events if you want to report on them in standard GA4 reports or Looker Studio.

### GA4 setup steps (recommended order)

1. Open GA4 Admin -> Data streams -> Web stream used by the search page.
2. Confirm Enhanced measurement is enabled and Site search is turned on.
3. In Site search advanced settings, add `searchterm` as an additional query parameter.
4. In Admin -> Custom definitions, create event-scoped custom dimensions:
  - `search_term`
  - `results_count`
  - `search_source`
5. In DebugView, run test searches and verify events:
  - `view_search_results` (built-in GA4 site-search event)
  - `policy_search` (custom event from this bundle)
  - `policy_search_zero_results` (custom zero-results event)
6. Wait for GA4 processing so custom definitions are available in standard reports and Looker Studio.

### Looker Studio reusable dashboard steps

1. Create a new report with the GA4 property as the data source.
2. Add report-level controls (not page-level only):
  - Date range control
  - Filter control for Event name
  - Filter control for Search source
3. Add calculated fields in the data source for reusable metrics:
  - `zero_result_flag`:
    `CASE WHEN Event name = "policy_search_zero_results" THEN 1 ELSE 0 END`
  - `search_event_flag`:
    `CASE WHEN Event name = "policy_search" OR Event name = "view_search_results" THEN 1 ELSE 0 END`
  - `zero_result_rate`:
    `SUM(zero_result_flag) / NULLIF(SUM(search_event_flag), 0)`
4. Build core charts:
  - Scorecards: total searches, zero-result searches, zero-result rate
  - Time series: searches vs zero-result searches
  - Table: top search terms by event count
  - Table: zero-result terms only (filter Event name = `policy_search_zero_results`)
5. Save this report as the template copy for other teams/properties.

### Reuse and handover checklist

1. Keep GA4 field names consistent (`search_term`, `results_count`, `search_source`) across properties.
2. Keep report-level controls in the template so copied dashboards behave consistently.
3. Add a hidden "Setup notes" page in Looker Studio with required events and dimensions.
4. When onboarding a new property, duplicate the template and swap the GA4 data source.
5. Validate one positive search and one zero-result search in DebugView before sharing dashboard links.

## File metadata and text fragments

File metadata is displayed as `TYPE (SIZE)`, for example `DOCX (615.5 KB)` or `PDF (283.4 KB)`.

- Search results render metadata outside the title link using `formatFileMetaHtml(raw)` in `src/js/coveo-search.js`.
- Collection page headings generated by `scripts/generate-collection-pages.js` use the same format, for example `DCDD recruitment guidelines DOCX (615.5 KB)`.
- Source and collection links append the plain `formatFileMeta(raw)` value as a browser text fragment, for example `#:~:text=DOCX%20(615.5%20KB)`, so the target page can scroll to and highlight the matching document text.

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
