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
- Search view metadata provider: `src/js/view-preference-metadata-patch.js`
- Search styles: `src/css/search-widget.css`
- Collection styles: `src/css/collection-page.css`
- Shared tokens: `src/css/tokens.css`

## View preference metadata

The search bundle persists the search view preference to Squiz user metadata:

- File: `src/js/view-preference-metadata-patch.js`
- Metadata field: `#969752` (`user.view-preference`)
- Canonical values saved: `grid` and `table` (default when no preference exists)
- Local compatibility key: `docSearchView` (`card`/`table`) remains in use

Behavior:

- Resolves the initial desktop view before rendering search results.
- Uses Squiz user metadata first, then the local `docSearchView` cache, then defaults to table view.
- Falls back after a bounded metadata request timeout so search loading cannot be blocked by the Matrix API.
- Starts from `data-view="pending"` in the canonical template so the results area does not paint table before preference resolution completes.
- Applies the view state to the existing **Show description** toggle (`grid`/card is on; table is off).
- Keeps the **Show description** toggle synced to the current results view, so table loads with the toggle off and card loads with it on.
- Writes changes back to metadata when user toggles view or clicks save.
- Seeds user metadata asynchronously when no remote preference exists.
- Preserves existing saved `grid`/card and `table` choices.
- On mobile (`<=900px`), keeps UI in card mode while preserving and restoring the saved desktop preference.

`src/search-page.js` imports the metadata provider before `src/js/coveo-search.js`, allowing the search initializer to await the preference before its first render.

## Matrix custom content slot

The search section template includes a populated `<span id="custom-content">...</span>` block in `src/search-section.html`.

Current default content:

```html
<div id="component_944142">
  <p>This library contains resources specific to the Department of Corporate and Digital Development (DCDD) only.</p>
  <p>For whole-of-government policies, go to <a href="https://ntgcentral.nt.gov.au/policy-library">NTG Central</a>.</p>
</div>
```

At runtime, `src/js/coveo-search.js` moves child nodes from `#asset-contents` into `#custom-content`.
This supports Squiz Matrix content that may be injected after page load.

Implementation details:

- The move is one-time and idempotent (no duplicate moves).
- If `#asset-contents` is not present immediately, a `MutationObserver` watches for late insertion.
- Observers disconnect after a successful move, with a safety timeout to avoid long-lived observers.

## Topic value format

`raw.topic` values are parsed as multi-value topics and support both comma and semicolon delimiters.

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
- The results summary (`Showing X-Y of N results`) and the **Show description** toggle share one results header row: summary left, toggle right.
- Toggle behavior on desktop: off (`aria-pressed="false"`) = table view, on (`aria-pressed="true"`) = card/grid view with descriptions.
- In table view, when search/filter results are `0`, the table wrapper is hidden so column headers are not shown.

## Search analytics

The search runtime now emits GA4 events for submitted searches and zero-result queries from `src/js/coveo-search.js`.

- Custom event: `policy_search`
- Custom event: `policy_search_zero_results`
- Custom parameters sent: `search_term`, `results_count`, `search_source`

Implementation notes:

- Events are query-scoped and only fire for submitted searches with a non-empty `policyterm` URL parameter.
- Zero-results tracking is limited to the initial submitted query outcome. Filter-driven empty states do not emit the zero-results event.
- The runtime fails safely when `window.gtag` is unavailable, so local/generated builds can still run without GA.

GA4 setup required:

1. In the GA4 web data stream, keep Enhanced Measurement enabled.
2. Add `policyterm` as an additional site-search query parameter so GA4 also collects the built-in `view_search_results` event for this page.
3. Register custom dimensions for `search_term`, `results_count`, and `search_source` on the custom events if you want to report on them in standard GA4 reports or Looker Studio.

### GA4 setup steps (recommended order)

1. Open GA4 Admin -> Data streams -> Web stream used by the search page.
2. Confirm Enhanced measurement is enabled and Site search is turned on.
3. In Site search advanced settings, add `policyterm` as an additional query parameter.
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

## Shared source cache (`/_nocache`, `/_recache`)

Resolved source links are shared through Squiz rather than stored in each user's browser:

- Normal production visits load `sources.json` from Squiz Text File asset `#979085` at `https://internal.nt.gov.au/__data/assets/text_file/0011/979085/sources.json` once per page load.
- If the primary file is unavailable or invalid, the script tries fallback asset `#979093`, then the read-only mock bundled from `src/mock/sources.json`.
- `pageLinksCache` memoizes resolved Promises for the current search so repeated card/table renders do not repeat work.
- Old `dcdd-page-links:*` localStorage values are ignored and can remain in users' browsers; no migration is required.

Source links are populated in `src/js/coveo-search.js` as follows:

- If a result includes both `raw.sourcepage` and `raw.sourceurl`, that source link is rendered immediately in the Source field (card and table) before async Matrix page-link resolution completes.
- When async Matrix page links resolve, they are merged with the immediate source link(s) (immediate first, deduped by URL path).
- Every valid shared source entry for the result's `raw.assetassetid` is rendered, including links to other agency sections and `ntgcentral.nt.gov.au`.
- The `/news/`, `/dev/`, and `archive` exclusions apply only while generating fresh entries through the live `/_nocache` or `/_recache` resolver; normal rendering does not remove valid entries already stored in `sources.json`.
- If the complete merged source list is empty in card view, the entire Sources row is hidden.

When the URL contains `/_nocache`, the resolver bypasses the shared files and fetches fresh links from the Matrix Management API for that page load without publishing them.

When an authorized editor loads `/_recache`, each unique result asset is resolved live and merged into the existing Squiz source map. The updater acquires the `attributes` lock on asset `#979085`, calls `setContentOfEditableFileAsset`, then releases the lock. Use an empty search for a complete rebuild. Requests use JSAPI key `1603940920` plus a nonce; the updater executes as `internal_content_api #508428`. A success logs `[DCDD] Shared sources updated`. A rejected or failed write logs `[DCDD] Shared sources update failed` with the Squiz response body when available.

If an individual live Management API lookup returns an error such as `403` or `404`, `/_recache` retains that asset's existing shared entry instead of replacing it with an empty array. The success log reports both `updatedAssets` and `retainedAssets`.

The bundled `src/mock/sources.json` fixture mirrors the complete authoritative source map for local display and final read fallback, including explicit empty arrays. Mock data is display-only. If neither Squiz source file can supply an authoritative merge base, `/_recache` aborts publication rather than writing bundled fixture data to asset `#979085`.

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
