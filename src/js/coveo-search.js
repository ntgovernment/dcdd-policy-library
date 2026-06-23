/**
 * coveo-search.js — DCDD Document Search: Coveo REST API integration
 *
 * ── OVERVIEW ─────────────────────────────────────────────────────────────────
 * Fetches all matching documents from the Coveo Search REST API in a single
 * request, then performs client-side filtering, sorting, and pagination.
 * Results are rendered by cloning a hidden .search-template element.
 *
 * Results with raw.resourcedoctype === "Supporting document" are hard-excluded:
 * they are filtered out of every result array (originalResults, masterResults) at
 * API response ingestion time and never appear in search results, pagination
 * counts, or facet filter lists. Change EXCLUDED_DOCTYPE to adjust this.
 *
 * The Type and Category filter sidebars always show the complete list of values
 * from the full document corpus (masterResults), regardless of the active search
 * query. Only the count numbers beside each value change. Values with a count of
 * zero are shown as disabled so users understand they exist but yield no results.
 *
 * ── API ENDPOINT ─────────────────────────────────────────────────────────────
 * Production:  https://internal.nt.gov.au/dcdd/dev/policy-library/coveo/site/coveo-search-rest-api-query
 *   Squiz Matrix page asset — same-origin (internal.nt.gov.au); returns the
 *   Coveo JSON response directly. Only one param is accepted:
 *     ?searchterm=<encoded query>   — omit or empty → returns all documents
 *   Do NOT use the ?a=<assetId> proxy shorthand — that resolves to the
 *   document-search page itself and returns HTML, not JSON.
 * Dev/local:   /src/mock/coveo-search-rest-api-query.json  (static fixture)
 *
 * Dev detection: window.location.hostname is "localhost" or "127.0.0.1"
 *
 * ── SQUIZ MATRIX MANAGEMENT API (page links) ────────────────────────────────
 * Each search result has a raw.assetassetid field (the Squiz Matrix asset ID
 * of the document). For card results, the script fetches upstream link
 * relationships from the Squiz Matrix Management API to determine which pages
 * reference the document:
 *   Production:  GET https://internal.nt.gov.au/__management_api/v1/assets/{assetId}/links?direction=up
 *   Dev/local:   /src/mock/matrix-asset-links.json  (static fixture keyed by assetId)
 * Authorization: Bearer token (MATRIX_API_TOKEN constant).
 * The response is an array of link objects; only entries with
 * link_type === "reference" are displayed. Their major_id values are shown
 * comma-separated in the "Page:" row on each card.
 * Fetches are non-blocking — cards render immediately with "Loading…" text
 * in the Page row; the row is hidden if no reference links exist.
 *
 * Sorting is performed client-side after the full result set is received:
 *   applySort() is called after every fetch and after every sort radio button change.
 *   "relevancy"         — preserves the original API response order (originalResults)
 *   "date descending"   — sorts allResults by raw.resourceupdated descending
 *   "alpha ascending"   — sorts allResults by raw.resourcefriendlytitle A–Z (localeCompare)
 *   "alpha descending"  — sorts allResults by raw.resourcefriendlytitle Z–A (localeCompare)
 *   raw.resourceupdated format is "YYYY-MM-DD HH:mm:ss"; lexicographic comparison
 *   produces the correct chronological order for that format.
 *
 * ── COVEO RESULT FIELDS USED ─────────────────────────────────────────────────
 * result.title                        — fallback title
 * result.clickUri                     — fallback URL
 * result.excerpt                      — fallback description
 * result.raw.resourcefriendlytitle    — display title
 * result.raw.asseturl                 — primary document URL
 * result.raw.description              — card description (falls back to result.excerpt)
 * result.raw.resourcedoctype          — "Type" facet value and tag label
 * result.raw.category                 — "Category" facet value(s). Coveo maps multiple <meta name="category">
 *                                       tags as a single comma-separated string (e.g. "Protocols, Governance and
 *                                       accountability"). splitFieldValues() is used throughout to split on ","
 *                                       so each token is treated as an independent category. The raw string is
 *                                       stored as the data-category attribute on rendered card <li> and table <tr>
 *                                       elements; filtering matches any token against activeCategoryFilters.
 * result.raw.collectionname           — human-readable collection name; used as display text in card and table views
 * result.raw.collectionassetid        — Squiz asset ID for the collection (not used in rendering)
 * result.raw.collectionurl            — direct collection URL; used as href in both card and table view
 * result.raw.resourceupdated          — last-updated date (YYYY-MM-DD HH:mm:ss)
 * result.raw.resourcetype             — file type key (e.g. "pdf_file", "word_doc"); mapped to uppercase label
 * result.raw.resourcefilesize         — human-readable file size (e.g. "354.2 KB")
 * result.raw.assetassetid              — Squiz Matrix asset ID; used to fetch upstream
 *                                        page links from the Matrix Management API
 *
 * ── DOM CONTRACT ─────────────────────────────────────────────────────────────
 * IDs and attributes that must exist in the page HTML:
 *
 *   #search                       text input — holds the search query
 *   #policy-search-form           form element (optional); submit triggers search
 *   #initialLoadingSpinner        shown/hidden via .d-none during fetch
 *   #doc-search-results-col       wrapper; data-view="card" | "table"
 *   #doc-search-results-list      <ul> populated with card results
 *   #doc-search-table-body        <tbody> populated with table rows
 *   #doc-search-results-summary   receives "Showing X–Y of Z results" text
 *   #doc-search-pagination        receives prev/page-number/next buttons
 *   select[name="doc-search-sort"] dropdown; values: "relevancy" | "date descending" | "alpha ascending" | "alpha descending"
 *   #doc-search-view-toggle       button; aria-pressed="true" = table view active
 *   #doc-search-type-filters      <ul> receives Type facet checkboxes
 *   #doc-search-category-filters  <ul> receives Category facet checkboxes
 *   #doc-search-user-message      receives error / no-results HTML (see buildNoResultsHtml())
 *   .search-template[hidden]      card template element, cloned per result
 *
 * Card template data-ref slots (inside .search-template):
 *   [data-ref="search-result-link"]            <a> href = asseturl
 *   [data-ref="search-result-title"]           document title with formatFileMeta() suffix
 *                                                e.g. "My Document (PDF 354.2 KB)"
 *   [data-ref="search-result-extlink"]         external-link icon — permanently hidden (display:none in CSS; JS does not remove hidden attr)
 *   [data-ref="search-result-description"]     description / excerpt text
 *   [data-ref="search-result-page-row"]         entire row hidden when no reference page links;
 *                                               contains a 16×16 document icon SVG
 *                                               (.doc-search-result__page-icon) and a text span.
 *                                               Populated asynchronously after card render.
 *   [data-ref="search-result-page-ids"]         comma-separated <a> links to parent intranet pages,
 *                                               each with a text fragment appended so the browser
 *                                               scrolls to and highlights the matching document:
 *                                               e.g. …/recruitment-policy-guidelines#:~:text=DOCX%20(612.4%20KB)
 *   [data-ref="search-result-collection-row"]  entire row hidden when no collection; contains a static
 *                                               16×16 folder icon SVG (.doc-search-result__collection-icon)
 *                                               positioned 3px above the text baseline (top: -3px) with a
 *                                               2px right margin; JS does not modify the icon element
 *   [data-ref="search-result-collection"]      collection name text (raw.collectionname)
 *   [data-ref="search-result-collection-link"] <a> href = buildCollectionUrl(raw.collectionurl, raw)
 *                                               — localised URL with a text fragment appended so the
 *                                               browser scrolls to and highlights the matching document:
 *                                               e.g. …/recruitment-policy-guidelines#:~:text=DOCX%20(612.4%20KB)
 *   [data-ref="search-result-doctype"]         doctype badge text
 *   [data-ref="search-result-last-updated"]    formatted last-updated date
 *
 * Table columns (built by renderTableResults into #doc-search-table-body <tr> rows):
 *   .doc-search-table__col-title       title cell — <a class="doc-search-table__title-link">
 *                                        title text includes formatFileMeta() suffix
 *   .doc-search-table__col-updated     last-updated plain text
 *   .doc-search-table__col-type        doctype — <span class="doc-search-table__tag"> or empty
 *   .doc-search-table__col-collection  pages — comma-separated <a> links to parent intranet
 *                                        pages, resolved asynchronously from the Squiz Matrix
 *                                        Management API (same chain as the card view's page row).
 *                                        Initially shows "Loading\u2026" when raw.assetassetid is
 *                                        present; populated empty when no pages are resolved or
 *                                        when raw.assetassetid is absent. Pages whose URL path
 *                                        contains "/news/", "/dev/", or "archive" are excluded.
 *
 * Facet items (built by buildFacet into #doc-search-type-filters / #doc-search-category-filters):
 *   input[data-facet][data-value]       checkbox; data-facet = raw field name, data-value = raw value
 *   .doc-search-facet-item              <label> wrapper
 *   .doc-search-facet-item__label       human-readable value text
 *   .doc-search-facet-item__count       occurrence count "(n)"
 *   .doc-search-facet-hidden            items beyond MAX_FACET_VISIBLE; removed on "Show all" click
 *   .doc-search-show-all                "Show all (n)" toggle button; data-facet-container = containerId
 *
 * ── URL PARAMETERS READ ON INIT ──────────────────────────────────────────────
 *   ?searchterm=<string>  pre-fills #search and immediately runs a search
 *   ?sort=<string>        pre-selects sort; must match a select option value:
 *                           "relevancy" | "date descending" | "alpha ascending" | "alpha descending"
 *
 * ── KEY CONSTANTS ────────────────────────────────────────────────────────────
 *   RESULTS_PER_PAGE_CARD   10      — cards shown per page
 *   RESULTS_PER_PAGE_TABLE  15      — rows shown per page in table view
 *   MAX_FACET_VISIBLE        7      — facet items visible before "Show all"
 *   MATRIX_API_BASE         String  — Squiz Matrix Management API base URL
 *   MATRIX_API_TOKEN        String  — Bearer token for the Management API
 *   MATRIX_MOCK_URL         String  — local mock JSON for dev page-link lookups
 *   FILE_TYPE_LABELS        Object  — maps raw.resourcetype keys to uppercase display labels
 *                                     (e.g. "pdf_file" → "PDF", "word_doc" → "DOCX")
 *                                     Add entries here to support additional file types.
 *
 * ── TITLE COMPOSITION ────────────────────────────────────────────────────────
 * Card and table titles are both composed as:
 *   (raw.resourcefriendlytitle || result.title) + formatFileMeta(raw)
 * formatFileMeta() appends a suffix when raw.resourcetype and/or
 * raw.resourcefilesize are present — for example:
 *   "My Document PDF (354.2 KB)"    — both type and size present
 *   "My Document DOCX"              — type only (size absent)
 *   "My Document (58.5 KB)"         — size only (type unmapped or absent)
 *   "My Document"                   — neither present
 * To add a new file type mapping, add an entry to FILE_TYPE_LABELS.
 *
 * ── MODULE STATE ─────────────────────────────────────────────────────────────
 *   EXCLUDED_DOCTYPE      String  — resourcedoctype value hard-excluded from all result arrays
 *                                   ("Supporting document"). Documents with this type are stripped
 *                                   from originalResults and masterResults at ingestion time.
 *   masterResults         Array   — complete document corpus (all results for an empty query),
 *                                   excluding EXCLUDED_DOCTYPE documents. Populated once on the
 *                                   first runSearch() call and never cleared. Provides the stable
 *                                   value list for all facets so that Type and Category options
 *                                   do not disappear when a search query narrows the result set.
 *   originalResults       Array   — raw API response order for the current query;
 *                                   restored as allResults when sort = "relevancy"
 *   allResults            Array   — current display order (sorted copy of originalResults)
 *   filteredResults       Array   — subset of allResults after checkbox filters applied
 *   currentPage           Number  — active pagination page (1-based)
 *   activeTypeFilters     Set     — checked "Type" facet values (raw.resourcedoctype)
 *   activeCategoryFilters Set     — checked "Category" facet values; each entry is a single trimmed token
 *                                   derived from splitting raw.category on "," via splitFieldValues()
 *   currentSort           String  — "relevancy" | "date descending" | "alpha ascending" | "alpha descending"
 *   currentQuery          String  — last query string passed to runSearch()
 *   matrixMockCache       Object  — cached contents of matrix-asset-links.json (dev mode only;
 *                                   populated on first fetchPageLinks() call, null until then)
 *
 * ── SEARCH FLOW ──────────────────────────────────────────────────────────────
 * On form submit: the handler redirects to
 *   window.location.pathname + "?searchterm=" + encodeURIComponent(query)
 * This triggers a fresh page load, which then reads ?searchterm= on init.
 * runSearch() is therefore always driven by the URL parameter, never called
 * directly from the submit handler.
 *
 * runSearch() fetch strategy:
 *   • Dev (localhost/127.0.0.1): always fetches MOCK_URL; masterResults is seeded
 *     from the mock response (which already contains all documents).
 *   • Prod, empty query: fetches buildCoveoUrl("") which returns all documents;
 *     masterResults is seeded from that same response.
 *   • Prod, non-empty query, first call: fires TWO fetches in parallel via
 *     Promise.all — one for the real query, one for buildCoveoUrl("") to seed
 *     masterResults. The extra fetch only happens once per page load.
 *   • Prod, non-empty query, subsequent calls: masterResults is already populated;
 *     only the real query fetch is issued.
 *
 * ── FACET STRATEGY ───────────────────────────────────────────────────────────
 * buildFacet(results, field, containerId, activeSet) uses TWO data sources:
 *   • masterResults  → the canonical set of all possible values for `field`.
 *                      Guarantees that every Type/Category is always rendered.
 *   • results        → the current (query-filtered) result set; used only for
 *                      computing per-value counts shown next to each label.
 * Values present in masterResults but absent from results receive a count of 0
 * and are rendered with the `disabled` attribute on their checkbox. They are
 * still visible so users understand the full taxonomy, but cannot be selected
 * (selecting a zero-count value would empty the results list).
 * Items are sorted descending by count; alphabetical tiebreak. Items beyond
 * MAX_FACET_VISIBLE receive the class doc-search-facet-hidden and a "Show all"
 * toggle button is appended.
 *
 * ── DEPENDENCIES ─────────────────────────────────────────────────────────────
 *   jQuery (window.$)  — must be loaded before this script executes
 *   moment.js          — optional; dates fall back to raw string if absent
 */

(function ($) {
  "use strict";

  // ── Environment ──────────────────────────────────────────────────────────────
  var isDev =
    ["localhost", "127.0.0.1"].includes(window.location.hostname) ||
    window.location.hostname.endsWith(".github.io");

  var COVEO_BASE_URL =
    "https://internal.nt.gov.au/dcdd/dev/policy-library/coveo/site/coveo-search-rest-api-query";
  var MOCK_URL = "./src/mock/coveo-search-rest-api-query.json";

  // ── Squiz Matrix Management API (page-link lookups) ──────────────────────────
  var MATRIX_API_BASE = "https://internal.nt.gov.au/__management_api/v1/";
  var MATRIX_API_TOKEN = "eeaa62869ea5c7e751446454327cf135";
  var MATRIX_MOCK_URL = "./src/mock/matrix-asset-links.json";
  var matrixMockCache = null;

  // Per-page-load cache of resolved page-link Promises, keyed by assetId.
  // Both card and table renders call resolvePageLinks(assetId), which returns
  // the cached Promise on subsequent calls — so pagination, sorting, filtering,
  // and switching between card/table view never re-fetch the same data.
  // Cleared at the start of every runSearch() to avoid stale data across queries.
  var pageLinksCache = {};

  // localStorage key prefix for persisting resolved page-link arrays across
  // page loads. Each value is a JSON-stringified Array<{name, path}>.
  var PAGE_LINKS_STORAGE_PREFIX = "dcdd-page-links:";

  /**
   * Reads a previously resolved page-link array for an assetId from
   * localStorage. Returns null when no entry exists, when localStorage is
   * unavailable (e.g. private browsing), or when the stored value is invalid.
   * @param {string} assetId
   * @returns {Array<{name: string, path: string}>|null}
   */
  function loadPageLinksFromStorage(assetId) {
    try {
      var raw = window.localStorage.getItem(
        PAGE_LINKS_STORAGE_PREFIX + assetId,
      );
      if (raw == null) return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Persists a resolved page-link array for an assetId to localStorage.
   * Silently no-ops when localStorage is unavailable or the quota is exceeded.
   * @param {string} assetId
   * @param {Array<{name: string, path: string}>} pageLinks
   */
  function savePageLinksToStorage(assetId, pageLinks) {
    try {
      window.localStorage.setItem(
        PAGE_LINKS_STORAGE_PREFIX + assetId,
        JSON.stringify(pageLinks),
      );
    } catch (e) {
      /* localStorage disabled or full — skip persistence */
    }
  }

  /**
   * Fetch wrapper for the Squiz Matrix Management API.
   * Sets the Authorization header with the bearer token.
   * @param {string} path  Relative path appended to MATRIX_API_BASE.
   * @returns {Promise<*>}
   */
  function matrixApiFetch(path) {
    return fetch(MATRIX_API_BASE + path, {
      headers: {
        Authorization: "Bearer " + MATRIX_API_TOKEN,
        "Content-Type": "application/json",
      },
    }).then(function (response) {
      if (!response.ok)
        throw new Error(response.status + " " + response.statusText);
      return response.json();
    });
  }

  /**
   * Fetches upstream link relationships for an asset.
   * In dev mode reads from the static mock JSON (keyed by assetId).
   * In production calls GET assets/{assetId}/links?direction=up.
   * @param {string} assetId  The Squiz Matrix asset ID (raw.assetassetid).
   * @returns {Promise<Array>}  Array of link objects.
   */
  function fetchPageLinks(assetId) {
    if (isDev) {
      if (matrixMockCache) {
        return Promise.resolve(matrixMockCache[assetId] || []);
      }
      return fetch(MATRIX_MOCK_URL)
        .then(function (r) {
          return r.json();
        })
        .then(function (data) {
          matrixMockCache = data;
          return data[assetId] || [];
        })
        .catch(function () {
          return [];
        });
    }
    return matrixApiFetch("assets/" + assetId + "/links?direction=up")
      .then(function (data) {
        return Array.isArray(data) ? data : [];
      })
      .catch(function () {
        return [];
      });
  }

  /**
   * Filters a links array for "reference" link_type entries and returns
   * an array of their major_id values.
   * @param {Array} links  Array of link objects from the Matrix API.
   * @returns {string[]}   major_id values for reference links.
   */
  function getPageMajorIds(links) {
    return links
      .filter(function (l) {
        return l.link_type === "reference";
      })
      .map(function (l) {
        return l.major_id;
      });
  }

  /**
   * For each reference major_id, fetches its upstream links and returns
   * the major_id values of any "menu" links found. This resolves the
   * reference intermediary to the actual parent page.
   * @param {string[]} refMajorIds  major_id values from reference links.
   * @returns {Promise<string[]>}   Deduplicated major_id values from menu links.
   */
  function resolveMenuParents(refMajorIds) {
    return Promise.all(
      refMajorIds.map(function (id) {
        return fetchPageLinks(id).then(function (links) {
          return links
            .filter(function (l) {
              return l.link_type === "menu";
            })
            .map(function (l) {
              return l.major_id;
            });
        });
      }),
    ).then(function (arrays) {
      var seen = {};
      var result = [];
      arrays.forEach(function (ids) {
        ids.forEach(function (id) {
          if (!seen[id]) {
            seen[id] = true;
            result.push(id);
          }
        });
      });
      return result;
    });
  }

  /**
   * Resolves the full chain of upstream page links for a document asset and
   * returns a deduplicated, filtered list of {name, path} objects suitable for
   * rendering as <a> tags. Pages whose URL path contains "/news/", "/dev/", or
   * "archive" (case-insensitive) are excluded.
   *
   * Results are memoized in `pageLinksCache` for the lifetime of the page load.
   * Concurrent calls for the same assetId share the same in-flight Promise, so
   * pagination, sorting, filtering, and view switching never trigger a re-fetch.
   * The cache is reset at the start of every runSearch() call.
   *
   * Resolution chain:
   *   1. fetchPageLinks(assetId)            → upstream links
   *   2. filter link_type === "reference"   → refMajorIds
   *   3. fetchPageLinks(ref) for each ref   → childLinks; filter "hidden" ids
   *   4. matrixApiFetch("assets/{hid}")     → hidden asset details
   *   5. attributes.name === "Page Contents"→ fetch parent (major_id - 1)
   *   6. extract attributes.short_name (or name) and urls[0].path
   *
   * @param {string} assetId  raw.assetassetid for the document.
   * @returns {Promise<Array<{name: string, path: string}>>}
   */
  function resolvePageLinks(assetId) {
    if (!assetId) return Promise.resolve([]);
    if (pageLinksCache[assetId]) return pageLinksCache[assetId];

    // localStorage hit (production only — in dev the static mock JSON is
    // already cached in memory by fetchPageLinks(), so persisting it adds
    // no benefit and would clutter the developer's storage).
    if (!isDev) {
      var stored = loadPageLinksFromStorage(assetId);
      if (stored) {
        var resolvedPromise = Promise.resolve(stored);
        pageLinksCache[assetId] = resolvedPromise;
        return resolvedPromise;
      }
    }

    var promise = resolvePageLinksUncached(assetId).then(function (pageLinks) {
      if (!isDev) savePageLinksToStorage(assetId, pageLinks);
      return pageLinks;
    });
    pageLinksCache[assetId] = promise;
    return promise;
  }

  /**
   * Pre-warms the page-links cache for every result in `results` by kicking
   * off a `resolvePageLinks()` call for each unique `raw.assetassetid`. All
   * fetches run in parallel in the background; subsequent calls from
   * renderCardResults() / renderTableResults() reuse the cached Promises
   * (and most will already be resolved by the time the user paginates,
   * sorts, filters, or switches view).
   *
   * @param {Array} results  Coveo result objects (e.g. originalResults).
   */
  function prefetchPageLinks(results) {
    if (!Array.isArray(results)) return;
    results.forEach(function (r) {
      var id = (r.raw || {}).assetassetid;
      if (id && !pageLinksCache[id]) {
        // Fire and forget — the call populates the cache via resolvePageLinks().
        resolvePageLinks(id);
      }
    });
  }

  /**
   * Internal: performs the actual upstream-link resolution chain.
   * Use resolvePageLinks() instead, which adds caching.
   * @param {string} assetId
   * @returns {Promise<Array<{name: string, path: string}>>}
   */
  function resolvePageLinksUncached(assetId) {
    return fetchPageLinks(assetId).then(function (links) {
      var refIds = getPageMajorIds(links);
      if (!refIds.length) return [];
      return Promise.all(
        refIds.map(function (id) {
          return fetchPageLinks(id).then(function (childLinks) {
            var hiddenIds = childLinks
              .filter(function (l) {
                return l.link_type === "hidden";
              })
              .map(function (l) {
                return l.major_id;
              });
            var assetFetches = hiddenIds.length
              ? Promise.all(
                  hiddenIds.map(function (hid) {
                    return (
                      isDev
                        ? Promise.resolve({
                            id: hid,
                            name: "(mock asset " + hid + ")",
                          })
                        : matrixApiFetch("assets/" + hid)
                    )
                      .then(function (asset) {
                        return { major_id: hid, asset: asset };
                      })
                      .catch(function () {
                        return { major_id: hid, asset: null };
                      });
                  }),
                )
              : Promise.resolve([]);
            return assetFetches.then(function (assets) {
              var pageContentAssets = assets.filter(function (a) {
                return (
                  a.asset &&
                  a.asset.attributes &&
                  a.asset.attributes.name === "Page Contents"
                );
              });
              var parentFetches = pageContentAssets.length
                ? Promise.all(
                    pageContentAssets.map(function (a) {
                      var parentId = String(Number(a.major_id) - 1);
                      return (
                        isDev
                          ? Promise.resolve({
                              id: parentId,
                              name: "(mock asset " + parentId + ")",
                            })
                          : matrixApiFetch("assets/" + parentId)
                      )
                        .then(function (asset) {
                          return { major_id: parentId, asset: asset };
                        })
                        .catch(function () {
                          return { major_id: parentId, asset: null };
                        });
                    }),
                  )
                : Promise.resolve([]);
              return parentFetches.then(function (parents) {
                return { page_contents_parents: parents };
              });
            });
          });
        }),
      ).then(function (results) {
        var seen = {};
        var out = [];
        results.forEach(function (r) {
          (r.page_contents_parents || []).forEach(function (p) {
            if (
              p.asset &&
              p.asset.attributes &&
              p.asset.urls &&
              p.asset.urls.length
            ) {
              var name =
                p.asset.attributes.short_name || p.asset.attributes.name || "";
              var path = p.asset.urls[0].path || "";
              var lowerPath = path.toLowerCase();
              var isExcluded =
                lowerPath.indexOf("/news/") !== -1 ||
                lowerPath.indexOf("/dev/") !== -1 ||
                lowerPath.indexOf("archive") !== -1;
              if (name && path && !isExcluded && !seen[path]) {
                seen[path] = true;
                out.push({ name: name, path: path });
              }
            }
          });
        });
        return out;
      });
    });
  }

  /**
   * Builds a comma-separated HTML string of <a> links from the resolved
   * page-link list returned by resolvePageLinks().
   * When fileMeta is provided (e.g. "DOCX (612.4 KB)"), a text fragment is
   * appended to each href so the browser scrolls to and highlights the
   * matching document on the target page:
   *   https://internal.nt.gov.au/…/page#:~:text=DOCX%20(612.4%20KB)
   * @param {Array<{name: string, path: string}>} pageLinks
   * @param {string} [fileMeta]  Optional trimmed formatFileMeta() output.
   * @returns {string}  HTML; empty string when pageLinks is empty.
   */
  function renderPageLinksHtml(pageLinks, fileMeta) {
    var fragment = fileMeta ? "#:~:text=" + encodeURIComponent(fileMeta) : "";
    return pageLinks
      .map(function (p) {
        return (
          '<a href="https://' +
          $("<span>").text(p.path).html() +
          fragment +
          '">' +
          $("<span>").text(p.name).html() +
          "</a>"
        );
      })
      .join(", ");
  }

  /**
   * When running on dev/GitHub Pages, rewrites an intranet collection URL
   * (https://internal.nt.gov.au/.../collections/<slug>) to a local relative
   * path (collection/<slug>.html). Returns the URL unchanged in production.
   * @param {string} url
   * @returns {string}
   */
  function localiseCollectionUrl(url) {
    if (!isDev || !url || url === "none") return url;
    var m = url.match(/\/collections\/([^/?#]+)/);
    return m ? "collection/" + m[1] + ".html" : url;
  }

  /**
   * Builds the final href for a collection page link.
   * Localises the URL (dev only) then appends a text fragment so the browser
   * scrolls to and highlights the matching document on the collection page.
   * Fragment format: #:~:text=DOCX%20(612.4%20KB)
   * @param {string} url  raw.collectionurl from the Coveo result.
   * @param {Object} raw  result.raw — used to derive the file-meta fragment text.
   * @returns {string}
   */
  function buildCollectionUrl(url, raw) {
    var base = localiseCollectionUrl(url);
    if (!base || base === "none") return base;
    var fileMeta = formatFileMeta(raw).trim();
    return fileMeta ? base + "#:~:text=" + encodeURIComponent(fileMeta) : base;
  }

  var RESULTS_PER_PAGE_CARD = 10;
  var RESULTS_PER_PAGE_TABLE = 15;
  var MAX_FACET_VISIBLE = 7;

  // ── Module state ─────────────────────────────────────────────────────────────
  var originalResults = []; // API response order — restored when sort = relevancy
  var EXCLUDED_DOCTYPE = "Supporting document"; // hard-excluded from all result sets and facets
  var allResults = [];
  var filteredResults = [];
  var masterResults = []; // full corpus — all documents regardless of query; used to keep facet lists stable
  var currentPage = 1;
  var activeTypeFilters = new Set();
  var activeCategoryFilters = new Set();
  var activeOwnerFilter = "";
  var currentSort = "relevancy";
  var currentQuery = "";
  var initialQuery = "";
  var filterAnimTimeout = null;
  var visibleResultIds = new Set();

  // ── URL builder ──────────────────────────────────────────────────────────────
  /**
   * Builds the Coveo search endpoint URL for the given query string.
   * @param {string} query  Raw (unencoded) search term.
   * @returns {string} Full URL with ?searchterm= query parameter.
   */
  function buildCoveoUrl(query) {
    return COVEO_BASE_URL + "?searchterm=" + encodeURIComponent(query);
  }

  /**
   * Returns the value of a URL query parameter from the current page URL,
   * or null when the parameter is absent.
   * @param {string} name  Parameter name (e.g. "searchterm", "sort").
   * @returns {string|null}
   */
  function getUrlParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  // ── Date formatting ──────────────────────────────────────────────────────────
  var MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  /**
   * Formats a Coveo date string as "D\u00a0MMMM YYYY" (e.g. "5\u00a0March 2026").
   * The non-breaking space between day and month prevents line-wrapping at that point.
   * Returns the original string unchanged when it does not match the expected format,
   * and returns "" when dateStr is falsy.
   * @param {string} dateStr  Date in "YYYY-MM-DD HH:mm:ss" format (raw.resourceupdated).
   * @returns {string}
   */
  function formatDate(dateStr) {
    if (!dateStr) return "";
    // Parse "YYYY-MM-DD HH:mm:ss" and format as "D\u00a0MMMM YYYY"
    // Non-breaking space between day and month prevents them wrapping onto separate lines
    var m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      var day = parseInt(m[3], 10);
      var month = MONTHS[parseInt(m[2], 10) - 1];
      return day + "\u00a0" + month + " " + m[1];
    }
    return dateStr;
  }

  // ── File type labels ──────────────────────────────────────────────────────────
  var FILE_TYPE_LABELS = {
    pdf_file: "PDF",
    word_doc: "DOCX",
    excel: "XLSX",
    powerpoint: "PPTX",
  };

  /**
   * Builds a parenthetical file-type/size suffix for appending to a document title.
   * Uses FILE_TYPE_LABELS to map raw.resourcetype to a display label (e.g. "PDF").
   * Returns an empty string when neither raw.resourcetype nor raw.resourcefilesize
   * is present.
   * @param {Object} raw  result.raw from the Coveo API response.
   * @returns {string}  e.g. " (PDF 354.2 KB)", " (DOCX)", " (58.5 KB)", or "".
   */
  function formatFileMeta(raw) {
    var ext = FILE_TYPE_LABELS[raw.resourcetype] || "";
    var size = raw.resourcefilesize || "";
    if (ext && size) return "(" + ext + " " + size + ")";
    if (ext) return "(" + ext + ")";
    if (size) return "(" + size + ")";
    return "";
  }

  function formatFileMetaHtml(raw) {
    var metaText = formatFileMeta(raw);
    if (!metaText) return "";
    return (
      '<span class="doc-search-result__file-meta">' +
      escHtml(metaText) +
      "</span>"
    );
  }

  // ── View helpers ─────────────────────────────────────────────────────────────
  /** Returns true when the results column is in table view (data-view="table"). */
  function isTableView() {
    return $("#doc-search-results-col").attr("data-view") === "table";
  }

  /** Returns the correct results-per-page constant for the active view. */
  function resultsPerPage() {
    return isTableView() ? RESULTS_PER_PAGE_TABLE : RESULTS_PER_PAGE_CARD;
  }

  // ── Filter building ──────────────────────────────────────────────────────────
  /**
   * Rebuilds both the Type and Category facet lists.
   * Delegates to buildFacet() for each facet field.
   *
   * `results` is used only to compute per-value counts — it should be allResults
   * (the current sorted, pre-checkbox-filter set), not filteredResults.
   * The visible value list always comes from masterResults inside buildFacet(),
   * so passing an empty array is safe: all values will still be rendered with a
   * count of 0 (useful for the "no results found" state).
   *
   * Call sites:
   *   runSearch()       — after every API fetch
   *   drawer apply btn  — after applying drawer filters, to sync the sidebar
   *
   * @param {Array} results  Current sorted result set (allResults) to count facet values from.
   */
  function buildFilters(results) {
    buildFacet(
      results,
      "resourcedoctype",
      "#doc-search-type-filters",
      activeTypeFilters,
    );
    buildFacet(
      results,
      "category",
      "#doc-search-category-filters",
      activeCategoryFilters,
    );
    buildDropdownFacet(
      results,
      "resourceowner",
      "#doc-search-owner",
      activeOwnerFilter,
    );
  }

  /**
   * Populates a facet <ul> with one checkbox item per known value for `field`.
   *
   * Value list  — derived from masterResults (the full corpus), so the same
   *               set of Type / Category options is always rendered regardless
   *               of how narrow the active search query is.
   * Counts      — derived from `results` (typically allResults for the current
   *               query), reflecting how many documents in the current result
   *               set match each value.
   * Sort order  — descending by count; alphabetical tiebreak. Values with a
   *               count of 0 therefore always sink to the bottom.
   * Disabled    — checkboxes for values with a count of 0 are rendered with the
   *               `disabled` attribute. They remain visible but cannot be checked,
   *               preventing the user from selecting a filter that would yield
   *               zero results.
   * Visibility  — only the first MAX_FACET_VISIBLE items are shown initially;
   *               the rest receive the class doc-search-facet-hidden. A "Show all"
   *               button is appended when the total exceeds MAX_FACET_VISIBLE.
   *
   * Used by buildFilters() (sidebar) and buildDrawerFilters() (mobile drawer).
   *
   * Multi-value fields: when a raw field value contains comma-separated tokens
   * (e.g. raw.category = "Protocols, Governance and accountability"), splitFieldValues()
   * is applied before counting and key extraction so each token is treated as an
   * independent facet value. Single-value fields (e.g. resourcedoctype) are unaffected.
   *
   * @param {Array}  results      Current result set used solely for counting (typically allResults).
   * @param {string} field        result.raw property name (e.g. "resourcedoctype", "category").
   * @param {string} containerId  jQuery selector for the target <ul> element.
   * @param {Set}    activeSet    Currently active filter values; matching checkboxes are rendered checked.
   */

  /**
   * Splits a raw field value on "," into trimmed, non-empty tokens.
   * Fields without commas (e.g. resourcedoctype) return a single-element array,
   * so callers work identically for both single- and multi-value fields.
   * @param {string} val
   * @returns {string[]}
   */
  function splitFieldValues(val) {
    return val
      ? val
          .split(",")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean)
      : [];
  }

  function buildFacet(results, field, containerId, activeSet) {
    // Count occurrences in the CURRENT result set (may be a filtered/searched subset)
    var counts = {};
    results.forEach(function (r) {
      var val = (r.raw || {})[field];
      if (val) {
        splitFieldValues(val).forEach(function (v) {
          counts[v] = (counts[v] || 0) + 1;
        });
      }
    });

    // Derive the full key list from masterResults so every known value is always shown
    var masterKeys = {};
    masterResults.forEach(function (r) {
      var val = (r.raw || {})[field];
      if (val) {
        splitFieldValues(val).forEach(function (v) {
          masterKeys[v] = true;
        });
      }
    });
    var keys = Object.keys(masterKeys);

    // Sort descending by count in current results; alphabetical tiebreak
    keys.sort(function (a, b) {
      var ca = counts[a] || 0;
      var cb = counts[b] || 0;
      return cb !== ca ? cb - ca : a.localeCompare(b);
    });

    var $container = $(containerId);
    $container.empty();

    keys.forEach(function (key, idx) {
      var count = counts[key] || 0;
      var isHidden = idx >= MAX_FACET_VISIBLE;
      var checked = activeSet.has(key) ? " checked" : "";
      var disabled = count === 0 ? " disabled" : "";
      var disabledClass = count === 0 ? " doc-search-facet-item--disabled" : "";
      var hiddenAttr = isHidden ? ' class="doc-search-facet-hidden"' : "";
      var $item = $(
        "<li" +
          hiddenAttr +
          ">" +
          '<label class="doc-search-facet-item' +
          disabledClass +
          '">' +
          '<input type="checkbox" data-facet="' +
          field +
          '" data-value="' +
          escAttr(key) +
          '"' +
          checked +
          disabled +
          ">" +
          '<span class="doc-search-facet-item__label">' +
          escHtml(key) +
          "</span>" +
          '<span class="doc-search-facet-item__count">(' +
          count +
          ")</span>" +
          "</label>" +
          "</li>",
      );
      $container.append($item);
    });

    // "Show all" / "Show less" toggle
    if (keys.length > MAX_FACET_VISIBLE) {
      var $showAll = $(
        '<li><button type="button" class="doc-search-show-all" data-facet-container="' +
          containerId +
          '" data-total="' +
          keys.length +
          '" data-max="' +
          MAX_FACET_VISIBLE +
          '">' +
          "Show all (" +
          keys.length +
          ")" +
          "</button></li>",
      );
      $container.append($showAll);
    }
  }

  function buildDropdownFacet(results, field, containerId, activeValue) {
    var counts = {};
    results.forEach(function (r) {
      var val = (r.raw || {})[field];
      if (val) {
        splitFieldValues(val).forEach(function (v) {
          counts[v] = (counts[v] || 0) + 1;
        });
      }
    });

    var masterKeys = {};
    masterResults.forEach(function (r) {
      var val = (r.raw || {})[field];
      if (val) {
        splitFieldValues(val).forEach(function (v) {
          masterKeys[v] = true;
        });
      }
    });
    var keys = Object.keys(masterKeys);
    keys.sort(function (a, b) {
      return a.localeCompare(b);
    });

    var $container = $(containerId);
    $container.empty();
    $container.append('<option value="">All owners</option>');

    keys.forEach(function (key) {
      var count = counts[key] || 0;
      var selected = key === activeValue ? " selected" : "";
      var disabled = count === 0 && key !== activeValue ? " disabled" : "";
      var displayKey = key + " (" + count + ")";
      var $option = $(
        '<option value="' +
          escAttr(key) +
          '"' +
          selected +
          disabled +
          ">" +
          escHtml(displayKey) +
          "</option>",
      );
      $container.append($option);
    });
  }

  // ── Sort ────────────────────────────────────────────────────────────────────
  /**
   * Rebuilds allResults from originalResults according to currentSort.
   * "relevancy" restores the original API order. "date descending" / "date ascending"
   * sort on raw.resourceupdated using lexicographic comparison, which is correct for
   * the "YYYY-MM-DD HH:mm:ss" format.
   */
  function applySort() {
    if (currentSort === "relevancy") {
      allResults = originalResults.slice();
    } else if (
      currentSort === "alpha ascending" ||
      currentSort === "alpha descending"
    ) {
      allResults = originalResults.slice().sort(function (a, b) {
        var ta = (
          (a.raw || {}).resourcefriendlytitle ||
          a.title ||
          ""
        ).toLowerCase();
        var tb = (
          (b.raw || {}).resourcefriendlytitle ||
          b.title ||
          ""
        ).toLowerCase();
        return currentSort === "alpha ascending"
          ? ta.localeCompare(tb)
          : tb.localeCompare(ta);
      });
    } else {
      allResults = originalResults.slice().sort(function (a, b) {
        var da = (a.raw || {}).resourceupdated || "";
        var db = (b.raw || {}).resourceupdated || "";
        return currentSort === "date descending"
          ? db.localeCompare(da)
          : da.localeCompare(db);
      });
    }
  }

  // ── Apply filters ────────────────────────────────────────────────────────────
  /**
   * Filters allResults into filteredResults using the active facet Sets.
   * Facets are ANDed across types; values within a facet are ORed.
   * An empty Set means no filter is applied for that facet (all values pass).
   *
   * Orchestrates per-item animations via a three-way diff (leaving / entering /
   * staying) of the current and next page-1 slices:
   *   • Leaving items  – fade-out + upward drift (--leaving class)
   *   • Entering items  – fade-in + downward drift (--entering class)
   *   • Staying items   – FLIP slide to their new position (--moving class)
   *
   * A clearTimeout guard prevents stacked animations on rapid filter toggles.
   */

  /**
   * Computes the number of items that would match the current drawer filter
   * selections (without mutating module state) and updates the live count
   * element inside the drawer footer.
   */
  function updateDrawerItemCount() {
    var drawerTypeFilters = new Set();
    var drawerCategoryFilters = new Set();
    $("#doc-search-drawer [data-facet]").each(function () {
      if ($(this).is(":checked")) {
        var field = $(this).data("facet");
        var value = $(this).data("value");
        if (field === "resourcedoctype") {
          drawerTypeFilters.add(value);
        } else {
          drawerCategoryFilters.add(value);
        }
      }
    });
    var drawerOwner = $('select[name="doc-search-drawer-owner"]').val() || "";

    var count = allResults.filter(function (r) {
      var raw = r.raw || {};
      if (drawerOwner) {
        var owners = splitFieldValues(raw.resourceowner || "");
        if (owners.indexOf(drawerOwner) === -1) return false;
      }
      if (
        drawerTypeFilters.size > 0 &&
        !drawerTypeFilters.has(raw.resourcedoctype)
      ) {
        return false;
      }
      if (
        drawerCategoryFilters.size > 0 &&
        !splitFieldValues(raw.category || "").some(function (v) {
          return drawerCategoryFilters.has(v);
        })
      ) {
        return false;
      }
      return true;
    }).length;

    $("#doc-search-drawer-item-count").text(
      count === 1 ? "1 item found" : count + " items found",
    );
  }

  /**
   * Returns a stable identifier for a result object, used to track item
   * identity across filter-triggered DOM rebuilds.
   */
  function resultId(result) {
    return result.uniqueId || result.clickUri || "";
  }

  /**
   * FLIP helper: captures the current top-offset of each staying item
   * before the DOM is rebuilt, keyed by result ID.
   */
  function snapshotPositions($container, stayingIds) {
    var positions = {};
    stayingIds.forEach(function (id) {
      var el = $container.find('[data-result-id="' + id + '"]')[0];
      if (el) positions[id] = el.getBoundingClientRect().top;
    });
    return positions;
  }

  /**
   * FLIP helper: after the DOM is rebuilt, reads each staying item's new
   * top-offset, computes the delta from its snapshot, and plays a smooth
   * translateY transition from the old position to the new one.
   */
  function flipStayingItems($container, firstPositions, stayingIds, isTable) {
    var movingClass = isTable
      ? "doc-search-row--moving"
      : "doc-search-result--moving";

    stayingIds.forEach(function (id) {
      if (!(id in firstPositions)) return;
      var el = $container.find('[data-result-id="' + id + '"]')[0];
      if (!el) return;
      var lastTop = el.getBoundingClientRect().top;
      var delta = firstPositions[id] - lastTop;
      if (delta === 0) return;

      // Invert: jump to old position
      el.style.transform = "translateY(" + delta + "px)";
      el.style.transition = "none";

      // Play: animate to new position
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          el.classList.add(movingClass);
          el.style.transform = "";
          el.style.transition = "";
        });
      });
    });

    // Clean up moving class after transition
    setTimeout(function () {
      stayingIds.forEach(function (id) {
        $container
          .find('[data-result-id="' + id + '"]')
          .removeClass(movingClass);
      });
    }, 300);
  }

  function applyFilters() {
    filteredResults = allResults.filter(function (r) {
      var raw = r.raw || {};
      if (activeOwnerFilter) {
        var owners = splitFieldValues(raw.resourceowner || "");
        if (owners.indexOf(activeOwnerFilter) === -1) {
          return false;
        }
      }
      if (
        activeTypeFilters.size > 0 &&
        !activeTypeFilters.has(raw.resourcedoctype)
      ) {
        return false;
      }
      if (
        activeCategoryFilters.size > 0 &&
        !splitFieldValues(raw.category || "").some(function (v) {
          return activeCategoryFilters.has(v);
        })
      ) {
        return false;
      }
      return true;
    });

    // Toggle UI elements based on whether results exist
    toggleNoResultsState(filteredResults.length);
    updateResultsSummary();

    // Compute new page 1 slice and diff against currently visible items
    var perPage = resultsPerPage();
    var newSlice = filteredResults.slice(0, perPage);
    var newIds = new Set(newSlice.map(resultId));
    var isTable = isTableView();

    // Determine which items are leaving, entering, or staying
    var leavingIds = new Set();
    visibleResultIds.forEach(function (id) {
      if (!newIds.has(id)) leavingIds.add(id);
    });
    var enteringIds = new Set();
    newIds.forEach(function (id) {
      if (!visibleResultIds.has(id)) enteringIds.add(id);
    });
    var stayingIds = new Set();
    newIds.forEach(function (id) {
      if (visibleResultIds.has(id)) stayingIds.add(id);
    });

    clearTimeout(filterAnimTimeout);

    var $container = isTable
      ? $("#doc-search-table-body")
      : $("#doc-search-results-list");

    // If nothing is leaving, render immediately with enter + FLIP animations
    if (leavingIds.size === 0) {
      var firstPos = snapshotPositions($container, stayingIds);
      renderPage(1, enteringIds);
      flipStayingItems($container, firstPos, stayingIds, isTable);
      filterAnimTimeout = setTimeout(function () {
        $("[data-result-id]")
          .removeClass("doc-search-result--entering")
          .removeClass("doc-search-row--entering");
      }, 300);
      return;
    }

    // Snapshot positions of staying items before leave animation
    var firstPos = snapshotPositions($container, stayingIds);

    // Animate leaving items out
    leavingIds.forEach(function (id) {
      var $el = $container.find('[data-result-id="' + id + '"]');
      $el.addClass(
        isTable ? "doc-search-row--leaving" : "doc-search-result--leaving",
      );
    });

    // After leave animation, rebuild with enter + FLIP animations
    filterAnimTimeout = setTimeout(function () {
      renderPage(1, enteringIds);
      flipStayingItems($container, firstPos, stayingIds, isTable);

      filterAnimTimeout = setTimeout(function () {
        $("[data-result-id]")
          .removeClass("doc-search-result--entering")
          .removeClass("doc-search-row--entering");
      }, 300);
    }, 220);
  }

  // ── Render a page ──────────────────────────────────────────────────────────
  /**
   * Slices filteredResults to the requested page, renders card or table rows,
   * then updates the summary line and pagination bar. Also records the set of
   * visible result IDs so the next applyFilters() call can diff against it.
   * @param {number} page         1-based page number to display.
   * @param {Set}    [enteringIds] Result IDs that should receive an enter animation.
   */
  function renderPage(page, enteringIds) {
    currentPage = page;
    var perPage = resultsPerPage();
    var start = (page - 1) * perPage;
    var pageSlice = filteredResults.slice(start, start + perPage);

    if (isTableView()) {
      renderTableResults(pageSlice, enteringIds);
    } else {
      renderCardResults(pageSlice, enteringIds);
    }

    visibleResultIds = new Set(pageSlice.map(resultId));
    updateResultsSummary();
    renderPagination();
  }

  // ── Card results ─────────────────────────────────────────────────────────────
  /**
   * Renders a page slice as cloned .search-template <li> cards into
   * #doc-search-results-list. Each card receives a data-result-id attribute
   * for identity tracking. Cards whose IDs appear in enteringIds get the
   * --entering animation class.
   * @param {Array} results       Slice of filteredResults for the current page.
   * @param {Set}   [enteringIds] Result IDs that should receive an enter animation.
   */
  function renderCardResults(results, enteringIds) {
    var $list = $("#doc-search-results-list");
    var $template = $(".search-template");

    $list.empty();

    results.forEach(function (result) {
      var raw = result.raw || {};
      var id = resultId(result);
      var $item = $template
        .clone()
        .removeClass("search-template")
        .removeAttr("hidden")
        .attr("data-result-id", id);

      if (enteringIds && enteringIds.has(id)) {
        $item.addClass("doc-search-result--entering");
      }

      // Title + link
      var assetUrl = raw.asseturl || result.clickUri || "#";
      $item.find('[data-ref="search-result-link"]').attr("href", assetUrl);
      $item
        .find('[data-ref="search-result-title"]')
        .html(
          '<span class="doc-search-result__title-text">' +
            escHtml(raw.resourcefriendlytitle || result.title || "") +
            "</span>",
        );
      $item
        .find('[data-ref="search-result-file-meta-container"]')
        .html(formatFileMetaHtml(raw));

      // External link icon — hidden

      // Description
      $item
        .find('[data-ref="search-result-description"]')
        .text(raw.description || result.excerpt || "");

      // Category (hidden data attribute for filter matching)
      $item.attr("data-category", raw.category || "");

      // Collection row
      var collectionName = raw.collectionname || "";
      var collectionUrl = buildCollectionUrl(raw.collectionurl || "", raw);
      if (collectionName && collectionName !== "none" && collectionUrl) {
        $item
          .find('[data-ref="search-result-collection"]')
          .text(collectionName);
        $item
          .find('[data-ref="search-result-collection-link"]')
          .attr("href", collectionUrl);
      } else {
        $item
          .find('[data-ref="search-result-collection-row"]')
          .attr("hidden", true);
      }

      // Page row — async fetch of upstream reference links
      var assetAssetId = raw.assetassetid || "";
      if (assetAssetId) {
        (function ($card) {
          var $pageRow = $card.find('[data-ref="search-result-page-row"]');
          $pageRow.removeAttr("hidden");
          $card
            .find('[data-ref="search-result-page-ids"]')
            .text("Loading\u2026");
          resolvePageLinks(assetAssetId).then(function (pageLinks) {
            if (!pageLinks.length) {
              $pageRow.attr("hidden", true);
              return;
            }
            if (pageLinks.length > 1) {
              $card
                .find('[data-ref="search-result-page-label"]')
                .text("Sources:");
            }
            $card
              .find('[data-ref="search-result-page-ids"]')
              .html(renderPageLinksHtml(pageLinks, formatFileMeta(raw).trim()));
          });
        })($item);
      }

      // Doctype tag
      var doctype = raw.resourcedoctype || "";
      var $doctype = $item.find('[data-ref="search-result-doctype"]');
      if (doctype) {
        $doctype.text(doctype).removeAttr("hidden");
      } else {
        $doctype.attr("hidden", true);
      }

      // Last updated
      $item
        .find('[data-ref="search-result-last-updated"]')
        .text(formatDate(raw.resourceupdated));

      $list.append($item);
    });
  }

  // ── Table results ─────────────────────────────────────────────────────────────
  /**
   * Renders a page slice as <tr> rows into #doc-search-table-body.
   * Each row receives a data-result-id attribute for identity tracking.
   * Rows whose IDs appear in enteringIds get the --entering animation class.
   * @param {Array} results       Slice of filteredResults for the current page.
   * @param {Set}   [enteringIds] Result IDs that should receive an enter animation.
   */
  function renderTableResults(results, enteringIds) {
    var $tbody = $("#doc-search-table-body");
    $tbody.empty();

    results.forEach(function (result) {
      var raw = result.raw || {};
      var assetUrl = raw.asseturl || result.clickUri || "#";
      var assetAssetId = raw.assetassetid || "";
      var titleText = raw.resourcefriendlytitle || result.title || "";
      var doctype = raw.resourcedoctype || "";
      var updated = formatDate(raw.resourceupdated);

      var extIcon = "";

      var pagesCellInitial = assetAssetId ? "Loading\u2026" : "";

      var $row = $(
        "<tr>" +
          '<td class="doc-search-table__col-title">' +
          '<a class="doc-search-table__title-link" href="' +
          escAttr(assetUrl) +
          '">' +
          '<span class="doc-search-result__title-text">' +
          escHtml(titleText) +
          "</span>" +
          extIcon +
          "</a>" +
          " " +
          formatFileMetaHtml(raw) +
          "</td>" +
          '<td class="doc-search-table__col-updated doc-search-table__updated">' +
          escHtml(updated) +
          "</td>" +
          '<td class="doc-search-table__col-type">' +
          (doctype
            ? '<span class="doc-search-table__tag">' +
              escHtml(doctype) +
              "</span>"
            : "") +
          "</td>" +
          '<td class="doc-search-table__col-collection doc-search-table__col-pages">' +
          escHtml(pagesCellInitial) +
          "</td>" +
          "</tr>",
      );
      var id = resultId(result);
      $row.attr("data-result-id", id);
      $row.attr("data-category", raw.category || "");
      if (enteringIds && enteringIds.has(id)) {
        $row.addClass("doc-search-row--entering");
      }
      $tbody.append($row);

      // Async populate the Pages cell from the Squiz Matrix Management API.
      if (assetAssetId) {
        (function ($cell, fileMeta) {
          resolvePageLinks(assetAssetId).then(function (pageLinks) {
            $cell.html(renderPageLinksHtml(pageLinks, fileMeta));
          });
        })(
          $row.find(".doc-search-table__col-pages"),
          formatFileMeta(raw).trim(),
        );
      }
    });
  }

  // ── No results state ──────────────────────────────────────────────────────────
  /**
   * Toggles visibility of filter controls and sidebar based on result count.
   * When no results are found, hides: mobile filter button, results header
   * (summary + controls), sidebar, and pagination.
   * @param {number} resultCount  Total filtered result count.
   */
  function toggleNoResultsState(resultCount) {
    var noResults = resultCount === 0;
    $("#doc-search-mobile-filter-btn").toggleClass("d-none", noResults);
    $(".doc-search-results-header").toggleClass("d-none", noResults);
    $("#doc-search-sidebar").toggleClass("d-none", noResults);
    $("#doc-search-pagination").toggleClass("d-none", noResults);
  }

  // ── Results summary line ──────────────────────────────────────────────────────
  /**
   * Updates #doc-search-results-summary with "Showing X–Y of Z results" text,
   * or "No results found." when filteredResults is empty.
   */
  function updateResultsSummary() {
    var perPage = resultsPerPage();
    var total = filteredResults.length;
    var start = (currentPage - 1) * perPage + 1;
    var end = Math.min(currentPage * perPage, total);
    var $summary = $("#doc-search-results-summary");

    if (total === 0) {
      $summary.text("");
    } else {
      $summary.text(
        "Showing " +
          start +
          "–" +
          end +
          " of " +
          total +
          " result" +
          (total !== 1 ? "s" : "") +
          (initialQuery ? ' for "' + initialQuery + '"' : ""),
      );
    }
  }

  // ── Pagination ──────────────────────────────────────────────────────────────
  /**
   * Rebuilds the #doc-search-pagination nav with Prev, numbered, and Next buttons.
   * Clears the nav and returns early when there is only one page.
   */
  function renderPagination() {
    var $nav = $("#doc-search-pagination");
    var perPage = resultsPerPage();
    var total = filteredResults.length;
    var pages = Math.ceil(total / perPage);

    $nav.empty();

    if (pages <= 1) return;

    // Previous
    var $prev = $(
      '<button type="button" class="doc-search-pagination__btn doc-search-pagination__btn--prev">' +
        '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.8052 8.36231C4.6206 8.16354 4.6206 7.83654 4.8052 7.63777L10.522 1.48245C10.7066 1.28368 11.0104 1.28368 11.195 1.48245C11.3796 1.68121 11.3796 2.00822 11.195 2.20698L5.81458 8.00004L11.195 13.7931C11.3796 13.9919 11.3796 14.3189 11.195 14.5176C11.0104 14.7164 10.7066 14.7164 10.522 14.5176L4.8052 8.36231Z" fill="currentColor"/></svg>Prev</button>',
    );
    if (currentPage === 1) $prev.prop("disabled", true);
    $prev.on("click", function () {
      renderPage(currentPage - 1);
    });
    $nav.append($prev);

    // Page numbers (with ellipsis)
    var pagesToShow = buildPageRange(currentPage, pages);
    pagesToShow.forEach(function (p) {
      if (p === "…") {
        $nav.append('<span class="doc-search-pagination__ellipsis">…</span>');
        return;
      }
      var cls =
        "doc-search-pagination__btn" +
        (p === currentPage ? " doc-search-pagination__btn--active" : "");
      var $btn = $(
        '<button type="button" class="' + cls + '">' + p + "</button>",
      );
      if (p !== currentPage) {
        $btn.on(
          "click",
          (function (pg) {
            return function () {
              renderPage(pg);
            };
          })(p),
        );
      }
      $nav.append($btn);
    });

    // Next
    var $next = $(
      '<button type="button" class="doc-search-pagination__btn doc-search-pagination__btn--next">' +
        'Next<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.8052 8.36231C4.6206 8.16354 4.6206 7.83654 4.8052 7.63777L10.522 1.48245C10.7066 1.28368 11.0104 1.28368 11.195 1.48245C11.3796 1.68121 11.3796 2.00822 11.195 2.20698L5.81458 8.00004L11.195 13.7931C11.3796 13.9919 11.3796 14.3189 11.195 14.5176C11.0104 14.7164 10.7066 14.7164 10.522 14.5176L4.8052 8.36231Z" fill="currentColor"/></svg></button>',
    );
    if (currentPage === pages) $next.prop("disabled", true);
    $next.on("click", function () {
      renderPage(currentPage + 1);
    });
    $nav.append($next);
  }

  /**
   * Toggles visibility of filter controls and sidebar based on result count.
   * When no results are found, hides: mobile filter button, results header
   * (summary + controls), sidebar, and pagination.
   * @param {number} resultCount  Total filtered result count.
   */
  function toggleNoResultsState(resultCount) {
    var noResults = resultCount === 0;
    $("#doc-search-mobile-filter-btn").toggleClass("d-none", noResults);
    $(".doc-search-results-header").toggleClass("d-none", noResults);
    $("#doc-search-sidebar").toggleClass("d-none", noResults);
    $("#doc-search-pagination").toggleClass("d-none", noResults);
  }

  /**
   * Returns a mixed array of page numbers and "…" gap markers for the pagination bar.
   * Always includes page 1, the last page, and current ±1. Inserts "…" where the gap
   * is larger than one page. Returns a flat consecutive range when total ≤ 7.
   * @param {number} current  Active page (1-based).
   * @param {number} total    Total number of pages.
   * @returns {Array<number|string>}  e.g. [1, "…", 4, 5, 6, "…", 12]
   */
  function buildPageRange(current, total) {
    if (total <= 7) {
      return range(1, total);
    }
    var pages = [];
    pages.push(1);
    if (current > 3) pages.push("…");
    var lo = Math.max(2, current - 1);
    var hi = Math.min(total - 1, current + 1);
    for (var i = lo; i <= hi; i++) pages.push(i);
    if (current < total - 2) pages.push("…");
    pages.push(total);
    return pages;
  }

  /**
   * Returns an inclusive array of sequential integers from `from` to `to`.
   * @param {number} from  Start value (inclusive).
   * @param {number} to    End value (inclusive).
   * @returns {number[]}
   */
  function range(from, to) {
    var arr = [];
    for (var i = from; i <= to; i++) arr.push(i);
    return arr;
  }

  // ── User message (error / no results) ────────────────────────────────────────
  /**
   * Sets the #doc-search-user-message content. Pass an empty string or omit `msg`
   * to clear any existing message. Accepts an HTML string.
   * @param {string} [msg]  HTML to display (e.g. an error string or no-results block).
   */
  function setUserMessage(msg) {
    $("#doc-search-user-message").html(msg || "");
  }

  /**
   * Builds the structured "No results" HTML block shown when a query yields
   * zero results.  Includes a heading, the bolded query term, and a suggestion.
   * @param {string} query  The search term that returned no results.
   * @returns {string} HTML string for the no-results state.
   */
  function buildNoResultsHtml(query) {
    return (
      '<div class="doc-search-no-results" data-state="No result">' +
      '<div class="doc-search-no-results__inner">' +
      '<h2 class="doc-search-no-results__heading">No results</h2>' +
      '<p class="doc-search-no-results__detail">There were no results for <strong>' +
      escHtml(query) +
      "</strong></p>" +
      '<p class="doc-search-no-results__suggestion">Try refining your search with some different key words</p>' +
      "</div>" +
      "</div>"
    );
  }

  /**
   * Toggles visibility of filter controls and sidebar based on result count.
   * When no results are found, hides: mobile filter button, results header
   * (summary + controls), sidebar, drawer, and pagination.
   * @param {number} resultCount  Total filtered result count.
   */
  function toggleNoResultsState(resultCount) {
    var noResults = resultCount === 0;
    $("#doc-search-mobile-filter-btn").toggleClass("d-none", noResults);
    $(".doc-search-results-header").toggleClass("d-none", noResults);
    $("#doc-search-sidebar").toggleClass("d-none", noResults);
    $("#doc-search-pagination").toggleClass("d-none", noResults);
  }

  // ── HTML helpers ─────────────────────────────────────────────────────────────
  /**
   * Encodes a plain string for safe insertion as HTML text content.
   * Uses jQuery's .text()/.html() round-trip to escape &, <, >, and related chars.
   * @param {string} str
   * @returns {string} HTML-escaped string.
   */
  function escHtml(str) {
    return $("<span>")
      .text(str || "")
      .html();
  }

  /**
   * Returns an HTML string wrapping the formatFileMeta() suffix in a
   * <span class="doc-search-result__file-meta"> so it can be styled smaller.
   * Returns an empty string when there is no file type/size info.
   * @param {Object} raw  result.raw from the Coveo API response.
   * @returns {string}
   */
  function formatFileMetaHtml(raw) {
    var plain = formatFileMeta(raw);
    if (!plain) return "";
    return (
      '<span class="doc-search-result__file-meta">' + escHtml(plain) + "</span>"
    );
  }

  /**
   * Encodes a plain string for safe use inside an HTML attribute value.
   * Extends escHtml by additionally escaping `"` (&quot;) and `'` (&#39;).
   * @param {string} str
   * @returns {string} Attribute-safe escaped string.
   */
  function escAttr(str) {
    return $("<span>")
      .text(str || "")
      .html()
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ── Matrix content relocation ──────────────────────────────────────────────
  var assetContentsMoved = false;
  var assetContentsSourceObserver = null;
  var assetContentsRootObserver = null;
  var assetContentsObserverTimeoutId = null;
  var ASSET_CONTENTS_OBSERVER_TIMEOUT_MS = 30000;

  /**
   * Disconnects observers used for moving #asset-contents content and clears
   * the timeout guard.
   */
  function disconnectAssetContentsObservers() {
    if (assetContentsSourceObserver) {
      assetContentsSourceObserver.disconnect();
      assetContentsSourceObserver = null;
    }
    if (assetContentsRootObserver) {
      assetContentsRootObserver.disconnect();
      assetContentsRootObserver = null;
    }
    if (assetContentsObserverTimeoutId) {
      window.clearTimeout(assetContentsObserverTimeoutId);
      assetContentsObserverTimeoutId = null;
    }
  }

  /**
   * Moves all child nodes from #asset-contents into #custom-content.
   * Returns true only when a move was completed.
   * @returns {boolean}
   */
  function moveAssetContentsIntoCustom() {
    if (assetContentsMoved) return true;

    var target = document.getElementById("custom-content");
    var source = document.getElementById("asset-contents");

    if (!target || !source || source === target || !source.firstChild) {
      return false;
    }

    while (source.firstChild) {
      target.appendChild(source.firstChild);
    }

    assetContentsMoved = true;
    disconnectAssetContentsObservers();
    return true;
  }

  /**
   * Observes #asset-contents for late CMS injection and moves its children into
   * #custom-content when available.
   */
  function initAssetContentsRelocation() {
    if (assetContentsMoved) return;
    if (!document.getElementById("custom-content")) return;

    if (moveAssetContentsIntoCustom()) {
      return;
    }

    if (typeof MutationObserver === "undefined") {
      return;
    }

    function observeSource(source) {
      if (!source || assetContentsSourceObserver) return;

      assetContentsSourceObserver = new MutationObserver(function () {
        moveAssetContentsIntoCustom();
      });

      assetContentsSourceObserver.observe(source, {
        childList: true,
        subtree: true,
      });
    }

    var source = document.getElementById("asset-contents");
    if (source) {
      observeSource(source);
    } else if (document.body) {
      assetContentsRootObserver = new MutationObserver(function () {
        var found = document.getElementById("asset-contents");
        if (!found) return;

        if (assetContentsRootObserver) {
          assetContentsRootObserver.disconnect();
          assetContentsRootObserver = null;
        }

        observeSource(found);
        moveAssetContentsIntoCustom();
      });

      assetContentsRootObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    if (!assetContentsObserverTimeoutId) {
      assetContentsObserverTimeoutId = window.setTimeout(function () {
        disconnectAssetContentsObservers();
      }, ASSET_CONTENTS_OBSERVER_TIMEOUT_MS);
    }
  }

  // ── Core search ──────────────────────────────────────────────────────────────
  /**
   * Executes a search for the given query and renders the results.
   *
   * Fetch strategy (see ── SEARCH FLOW in the file header for full details):
   *   • Dev: always fetches MOCK_URL; masterResults seeded from the mock response.
   *   • Prod, empty query: single fetch; masterResults seeded from the response.
   *   • Prod, non-empty query, first call: two parallel fetches — one for the real
   *     query, one for buildCoveoUrl("") to populate masterResults. Only fired once
   *     per page load (when masterResults.length === 0).
   *   • Prod, non-empty query, subsequent calls: single fetch for the real query;
   *     masterResults is already populated.
   *
   * After fetching, the pipeline is:
   *   applySort() → buildFilters(allResults) → applyFilters() → renderPage(1)
   *
   * When the query returns zero results, buildFilters(allResults) is still called
   * (with an empty array) so the sidebar renders the full Type/Category list with
   * counts of 0, rather than disappearing entirely.
   *
   * Existing sort and filter state (activeTypeFilters, activeCategoryFilters,
   * currentSort) are preserved across calls. Clear those Sets before calling if
   * a clean filter slate is needed.
   *
   * @param {string} query  Raw (unencoded) search term. Pass "" to fetch all documents.
   */
  function runSearch(query) {
    currentQuery = query;

    var $spinner = $("#initialLoadingSpinner");
    var $list = $("#doc-search-results-list");
    var $tbody = $("#doc-search-table-body");
    var $pag = $("#doc-search-pagination");
    var $summary = $("#doc-search-results-summary");

    $spinner.removeClass("d-none");
    $list.empty();
    $tbody.empty();
    $pag.empty();
    $summary.empty();
    setUserMessage("");

    // Reset the page-links cache so a new query doesn't reuse stale results.
    pageLinksCache = {};

    var searchUrl = isDev ? MOCK_URL : buildCoveoUrl(query);

    // In production, when a non-empty query is used and we don't yet have the full
    // corpus cached, fetch all documents in parallel so the facet lists stay complete.
    var masterFetchNeeded =
      !isDev && query !== "" && masterResults.length === 0;
    var masterFetch = masterFetchNeeded
      ? fetch(buildCoveoUrl(""))
          .then(function (res) {
            return res.json();
          })
          .then(function (data) {
            masterResults = (data.results || []).filter(function (r) {
              return (r.raw || {}).resourcedoctype !== EXCLUDED_DOCTYPE;
            });
          })
          .catch(function () {
            /* non-critical — facets will fall back gracefully */
          })
      : Promise.resolve();

    var searchFetch = fetch(searchUrl).then(function (res) {
      if (!res.ok) throw new Error("Search request failed: " + res.status);
      return res.json();
    });

    Promise.all([searchFetch, masterFetch])
      .then(function (values) {
        var data = values[0];
        $spinner.addClass("d-none");
        originalResults = (data.results || []).filter(function (r) {
          return (r.raw || {}).resourcedoctype !== EXCLUDED_DOCTYPE;
        });

        // In dev or when query is empty the single fetch IS the full corpus
        if (masterResults.length === 0) {
          masterResults = originalResults.slice();
        }

        // Pre-warm the page-links cache in parallel for every result so card
        // and table renders never block on a fetch and pagination/sort/filter/
        // view-switching can read from cache instantly.
        prefetchPageLinks(originalResults);

        applySort();

        if (allResults.length === 0) {
          toggleNoResultsState(0);
          setUserMessage(
            query ? buildNoResultsHtml(query) : "No documents found.",
          );
          buildFilters(allResults);
          return;
        }

        buildFilters(allResults);
        applyFilters();
      })
      .catch(function (err) {
        $spinner.addClass("d-none");
        setUserMessage(
          "Search is currently unavailable. Please try again later.",
        );
        console.error("[coveo-search] Error:", err);
      });
  }

  // ── Mobile drawer ────────────────────────────────────────────────────────────

  /**
   * Populates the drawer's facet lists from the current allResults set,
   * mirroring the active sidebar filter state.
   */
  function buildDrawerFilters() {
    buildFacet(
      allResults,
      "resourcedoctype",
      "#doc-search-drawer-type-filters",
      activeTypeFilters,
    );
    buildFacet(
      allResults,
      "category",
      "#doc-search-drawer-category-filters",
      activeCategoryFilters,
    );
    buildDropdownFacet(
      allResults,
      "resourceowner",
      "#doc-search-drawer-owner",
      activeOwnerFilter,
    );
    $('select[name="doc-search-drawer-sort"]').val(currentSort);
  }

  /** Opens the mobile filter drawer. */
  function openDrawer() {
    buildDrawerFilters();
    updateDrawerItemCount();
    $("#doc-search-drawer").addClass("is-open").attr("aria-hidden", "false");
    $("#doc-search-drawer-overlay")
      .addClass("is-open")
      .attr("aria-hidden", "false");
    $("#doc-search-mobile-filter-btn").attr("aria-expanded", "true");
    // Move focus into the drawer
    $("#doc-search-drawer-close").trigger("focus");
    // Prevent body scroll
    $("body").css("overflow", "hidden");
  }

  /** Closes the mobile filter drawer. */
  function closeDrawer() {
    $("#doc-search-drawer").removeClass("is-open").attr("aria-hidden", "true");
    $("#doc-search-drawer-overlay")
      .removeClass("is-open")
      .attr("aria-hidden", "true");
    $("#doc-search-mobile-filter-btn").attr("aria-expanded", "false");
    $("body").css("overflow", "");
    $("#doc-search-mobile-filter-btn").trigger("focus");
  }

  // Open drawer
  $(document).on("click", "#doc-search-mobile-filter-btn", openDrawer);

  // Close drawer via close button or overlay tap
  $(document).on(
    "click",
    "#doc-search-drawer-close, #doc-search-drawer-overlay",
    closeDrawer,
  );

  // Close drawer on Escape key
  $(document).on("keydown", function (e) {
    if (e.key === "Escape" && $("#doc-search-drawer").hasClass("is-open")) {
      closeDrawer();
    }
  });

  // Apply filters from drawer
  $(document).on("click", "#doc-search-drawer-apply", function () {
    // Read sort
    var drawerSort =
      $('select[name="doc-search-drawer-sort"]').val() || "relevancy";
    currentSort = drawerSort;
    $('select[name="doc-search-sort"]').val(drawerSort);

    // Read owner
    var drawerOwner = $('select[name="doc-search-drawer-owner"]').val() || "";
    activeOwnerFilter = drawerOwner;
    $('select[name="doc-search-owner"]').val(drawerOwner);

    // Rebuild filter sets from drawer checkboxes
    activeTypeFilters.clear();
    activeCategoryFilters.clear();
    $("#doc-search-drawer [data-facet]").each(function () {
      if ($(this).is(":checked")) {
        var field = $(this).data("facet");
        var value = $(this).data("value");
        if (field === "resourcedoctype") {
          activeTypeFilters.add(value);
        } else {
          activeCategoryFilters.add(value);
        }
      }
    });

    applySort();
    applyFilters();
    // Rebuild sidebar filters to reflect new checkbox state
    buildFilters(allResults);
    closeDrawer();
  });

  // Clear all inside drawer (resets UI without applying)
  $(document).on("click", "#doc-search-drawer-clear", function () {
    $("#doc-search-drawer [data-facet]").prop("checked", false);
    $('select[name="doc-search-drawer-sort"]').val("relevancy");
    $('select[name="doc-search-drawer-owner"]').val("");
    updateDrawerItemCount();
  });

  // Update drawer item count when owner select changes inside drawer
  $(document).on(
    "change",
    'select[name="doc-search-drawer-owner"]',
    updateDrawerItemCount,
  );

  // Clear all on sidebar (applies immediately)
  $(document).on("click", "#doc-search-sidebar-clear", function () {
    $("#doc-search-sidebar [data-facet]").prop("checked", false);
    activeTypeFilters.clear();
    activeCategoryFilters.clear();
    activeOwnerFilter = "";
    $('select[name="doc-search-owner"]').val("");
    applyFilters();
  });

  // ── Event: checkbox filter change ────────────────────────────────────────────
  $(document).on("change", "[data-facet]", function () {
    var $cb = $(this);
    // Inside the drawer, changes are applied only via the "Apply filters" button
    if ($cb.closest("#doc-search-drawer").length) {
      updateDrawerItemCount();
      return;
    }
    var field = $cb.data("facet");
    var value = $cb.data("value");
    var set =
      field === "resourcedoctype" ? activeTypeFilters : activeCategoryFilters;

    if ($cb.is(":checked")) {
      set.add(value);
    } else {
      set.delete(value);
    }
    applyFilters();
  });

  // ── Event: "Show all" / "Show less" facet toggle ───────────────────────────
  $(document).on("click", ".doc-search-show-all", function () {
    var $btn = $(this);
    var $ul = $btn.closest("ul");
    var isExpanded = $btn.data("expanded");
    var max = $btn.data("max");
    var total = $btn.data("total");

    if (!isExpanded) {
      // Expand — show all items
      $ul
        .find(".doc-search-facet-hidden")
        .removeClass("doc-search-facet-hidden");
      $btn.text("Show less");
      $btn.data("expanded", true);
    } else {
      // Collapse — re-hide items beyond max
      $ul
        .find("li")
        .not($btn.closest("li"))
        .each(function (i) {
          if (i >= max) {
            $(this).addClass("doc-search-facet-hidden");
          }
        });
      $btn.text("Show all (" + total + ")");
      $btn.data("expanded", false);
    }
  });

  // ── Event: Sort by expand/collapse ─────────────────────────────────────────
  $(document).on("click", ".doc-search-filter-group__toggle", function () {
    var $btn = $(this);
    $btn.attr(
      "aria-expanded",
      $btn.attr("aria-expanded") === "true" ? "false" : "true",
    );
  });

  // ── Event: sort change ───────────────────────────────────────────────────────
  $(document).on("change", 'select[name="doc-search-sort"]', function () {
    currentSort = $(this).val();
    applySort();
    applyFilters();
  });

  // ── Event: owner change ───────────────────────────────────────────────────────
  $(document).on("change", 'select[name="doc-search-owner"]', function () {
    activeOwnerFilter = $(this).val();
    applyFilters();
  });

  // ── Event: view toggle ───────────────────────────────────────────────────────
  $(document).on("click", "#doc-search-view-toggle", function () {
    var $btn = $(this);
    var $col = $("#doc-search-results-col");
    var tableNow = $col.attr("data-view") === "table";
    var newView = tableNow ? "card" : "table";

    if (tableNow) {
      $col.attr("data-view", "card");
      $btn.attr("aria-pressed", "false");
    } else {
      $col.attr("data-view", "table");
      $btn.attr("aria-pressed", "true");
    }

    // Auto-save the view preference instantly
    localStorage.setItem("docSearchView", newView);

    renderPage(1);
  });

  // ── Event: View preference modal ─────────────────────────────────────────────
  $(document).on("click", "#doc-search-view-save-btn", function () {
    var currentView = $("#doc-search-results-col").attr("data-view");
    localStorage.setItem("docSearchView", currentView);
    $("#doc-search-view-modal-overlay").attr("hidden", true);
  });

  $(document).on("click", "#doc-search-view-dont-save-btn", function () {
    localStorage.removeItem("docSearchView");
    $("#doc-search-view-modal-overlay").attr("hidden", true);
  });

  // ── Reset table view on mobile ────────────────────────────────────────────────
  // If the viewport drops to mobile width while table view is active, switch back
  // to card view so the hidden toggle doesn't leave a broken table-only state.
  (function () {
    var mq = window.matchMedia("(max-width: 900px)");
    function resetTableViewOnMobile(e) {
      if (
        e.matches &&
        $("#doc-search-results-col").attr("data-view") === "table"
      ) {
        $("#doc-search-results-col").attr("data-view", "card");
        $("#doc-search-view-toggle").attr("aria-pressed", "false");
        renderPage(currentPage);
      }
    }
    mq.addEventListener("change", resetTableViewOnMobile);
  })();

  // ── Init ─────────────────────────────────────────────────────────────────────
  $(document).ready(function () {
    initAssetContentsRelocation();

    // Read initial state from URL params
    initialQuery = getUrlParam("searchterm") || "";
    var urlSort = getUrlParam("sort");

    if (urlSort) {
      currentSort = urlSort;
      $('select[name="doc-search-sort"]').val(urlSort);
    }

    // Restore view preference from localStorage
    var savedView = localStorage.getItem("docSearchView");
    if (savedView === "table" || savedView === "card") {
      // Don't restore table view on mobile viewports
      if (
        savedView === "table" &&
        window.matchMedia("(max-width: 900px)").matches
      ) {
        savedView = "card";
      }
      $("#doc-search-results-col").attr("data-view", savedView);
      $("#doc-search-view-toggle").attr(
        "aria-pressed",
        savedView === "table" ? "true" : "false",
      );
    }

    // Pre-fill search input if present
    $("#search").val(initialQuery);

    // Always load results on page load — independent of form presence
    runSearch(initialQuery);

    // Wire up the search form if it exists on this page
    var $form = $("#policy-search-form");
    if ($form.length) {
      $form.on("submit", function (e) {
        e.preventDefault();
        var query = $.trim($("#search").val());
        window.location.href =
          window.location.pathname + "?searchterm=" + encodeURIComponent(query);
      });
    }
  });
})(window.jQuery);
