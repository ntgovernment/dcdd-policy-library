import mockSources from "../mock/sources.json";

/**
 * coveo-search.js — Policy Library: Coveo REST API integration
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
 * The Type and Topic filter sidebars always show the complete list of values
 * from the full document corpus (masterResults), regardless of the active search
 * query. Only the count numbers beside each value change. Values with a count of
 * zero are shown as disabled so users understand they exist but yield no results.
 *
 * ── API ENDPOINT ─────────────────────────────────────────────────────────────
 * Production:  supplied by #policy-library-config[data-coveo-base-url], which
 *   the Policy Library Matrix format populates from the selected Coveo REST API
 *   asset. The endpoint returns the Coveo JSON response directly. Only one
 *   param is accepted:
 *     ?policyterm=<encoded query>   — omit or empty → returns all documents
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
 * If a result contains raw.sourcepage + raw.sourceurl, that Source link is
 * rendered immediately before async page-link fetch completes. Resolved Matrix
 * links are then merged with immediate links (immediate first, deduped).
 * Fetches are non-blocking — rows may show immediate Source links or a
 * "Loading…" placeholder depending on available fields.
 *
 * Sorting is performed client-side after the full result set is received:
 *   applySort() is called after every fetch and after every sort radio button change.
 *   "relevancy"         — preserves the original API response order (originalResults)
 *   "date descending"   — sorts allResults by raw.approveddate descending
 *   "alpha ascending"   — sorts allResults by raw.resourcefriendlytitle A–Z (localeCompare)
 *   "alpha descending"  — sorts allResults by raw.resourcefriendlytitle Z–A (localeCompare)
 *   raw.approveddate format is "DD MM YYYY"; dates are parsed before comparison
 *   so chronological ordering remains correct.
 *
 * ── COVEO RESULT FIELDS USED ─────────────────────────────────────────────────
 * result.title                        — fallback title
 * result.clickUri                     — fallback URL
 * result.excerpt                      — fallback description
 * result.raw.resourcefriendlytitle    — display title
 * result.raw.asseturl                 — primary document URL
 * result.raw.description              — card description (falls back to result.excerpt)
 * result.raw.resourcedoctype          — "Type" facet value and tag label
 * result.raw.topic                    — "Topic" facet value(s). Coveo may return multi-values as comma-separated
 *                                       strings (e.g. "Finance and travel, Purchases and assets").
 *                                       splitTopicValues() supports comma and semicolon delimiters and applies
 *                                       a capitalization rule for comma splits: split only when the next non-space
 *                                       character is uppercase (e.g. preserves "Conduct, integrity and risk").
 *                                       The raw string is
 *                                       stored as the data-topic attribute on rendered card <li> and table <tr>
 *                                       elements; filtering matches any token against activeTopicFilters.
 * result.raw.collectionname           — human-readable collection name; used as display text in card and table views
 * result.raw.collectionassetid        — Squiz asset ID for the collection (not used in rendering)
 * result.raw.collectionurl            — direct collection URL; used as href in both card and table view
 * result.raw.approveddate            — last-updated date (DD MM YYYY)
 * result.raw.resourcetype             — file type key (e.g. "pdf_file", "word_doc"); mapped to uppercase label
 * result.raw.resourcefilesize         — human-readable file size (e.g. "354.2 KB")
 * result.raw.assetassetid              — Squiz Matrix asset ID; used to fetch upstream
 *                                        page links from the Matrix Management API
 * result.raw.sourcepage               — optional immediate Source link label
 * result.raw.sourceurl                — optional immediate Source link URL
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
 *   input[name="doc-search-sort"] desktop sort radios; values: "relevancy" | "date descending" | "alpha ascending" | "alpha descending"
 *   #doc-search-view-toggle       button; aria-pressed="true" = card descriptions shown
 *   #doc-search-type-filters      <ul> receives Type facet checkboxes
 *   #doc-search-topic-filters     <ul> receives Topic facet checkboxes
 *   #doc-search-user-message      receives error / no-results HTML (see buildNoResultsHtml())
 *   .search-template[hidden]      card template element, cloned per result
 *
 * Card template data-ref slots (inside .search-template):
 *   [data-ref="search-result-link"]            <a> href = asseturl
 *   [data-ref="search-result-title"]           document title with formatFileMeta() suffix
 *                                                e.g. "My Document PDF (354.2 KB)"
 *   [data-ref="search-result-extlink"]         external-link icon — permanently hidden (display:none in CSS; JS does not remove hidden attr)
 *   [data-ref="search-result-description"]     description / excerpt text
 *   [data-ref="search-result-page-row"]         entire row hidden when no Source links remain;
 *                                               contains a 16×16 document icon SVG
 *                                               (.doc-search-result__page-icon) and a text span.
 *                                               Can be populated immediately from
 *                                               raw.sourcepage/raw.sourceurl, then merged
 *                                               with asynchronously resolved page links.
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
 *   .doc-search-table__col-collection  pages — comma-separated <a> Source links
 *                                        (immediate sourcepage/sourceurl when present,
 *                                        merged with resolved parent intranet page links)
 *                                        pages, resolved asynchronously from the Squiz Matrix
 *                                        Management API (same chain as the card view's page row).
 *                                        Initially shows immediate source links when present,
 *                                        otherwise "Loading\u2026" when raw.assetassetid is
 *                                        present; populated empty when no links remain. Pages
 *                                        whose URL path contains "/news/", "/dev/", or
 *                                        "archive" are excluded.
 *
 * Facet items (built by buildFacet into #doc-search-type-filters / #doc-search-topic-filters):
 *   input[data-facet][data-value]       checkbox; data-facet = raw field name, data-value = raw value
 *   .doc-search-facet-item              <label> wrapper
 *   .doc-search-facet-item__label       human-readable value text
 *   .doc-search-facet-item__count       occurrence count "(n)"
 *   .doc-search-facet-hidden            items beyond MAX_FACET_VISIBLE; removed on "Show all" click
 *   .doc-search-show-all                "Show all (n)" toggle button; data-facet-container = containerId
 *
 * ── URL PARAMETERS READ ON INIT ──────────────────────────────────────────────
 *   ?policyterm=<string>  pre-fills #search and immediately runs a search
 *   ?sort=<string>        pre-selects sort; must match a select option value:
 *                           "relevancy" | "date descending" | "alpha ascending" | "alpha descending"
 *
 * ── KEY CONSTANTS ────────────────────────────────────────────────────────────
 *   RESULTS_PER_PAGE_DEFAULT 10      — default results shown per page
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
 *                                   value list for all facets so that Type and Topic options
 *                                   do not disappear when a search query narrows the result set.
 *   originalResults       Array   — raw API response order for the current query;
 *                                   restored as allResults when sort = "relevancy"
 *   allResults            Array   — current display order (sorted copy of originalResults)
 *   filteredResults       Array   — subset of allResults after checkbox filters applied
 *   currentPage           Number  — active pagination page (1-based)
 *   activeTypeFilters     Set     — checked "Type" facet values (raw.resourcedoctype)
 *   activeTopicFilters    Set     — checked "Topic" facet values; each entry is a single trimmed token
 *                                   derived from splitTopicValues() for raw.topic
 *   currentSort           String  — "relevancy" | "date descending" | "alpha ascending" | "alpha descending"
 *   currentQuery          String  — last query string passed to runSearch()
 *   matrixMockCache       Object  — cached contents of matrix-asset-links.json (dev mode only;
 *                                   populated on first fetchPageLinks() call, null until then)
 *
 * ── SEARCH FLOW ──────────────────────────────────────────────────────────────
 * On form submit: the handler redirects to
 *   window.location.pathname + "?policyterm=" + encodeURIComponent(query)
 * This triggers a fresh page load, which then reads ?policyterm= on init.
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
 *                      Guarantees that every Type/Topic is always rendered.
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

  function shouldBypassSharedSources() {
    return /\/_(?:nocache|recache)(?:\/|$|\?|#)/i.test(window.location.href);
  }

  function shouldLogRecachePageLinks() {
    return /\/_recache(?:\/|$|\?|#)/i.test(window.location.href);
  }

  var configElement = document.getElementById("policy-library-config");
  var COVEO_BASE_URL = configElement
    ? (configElement.getAttribute("data-coveo-base-url") || "").trim()
    : "";
  var policyLibraryOptions = new Set(
    ((configElement && configElement.getAttribute("data-options")) || "")
      .split(";")
      .map(function (option) {
        return option.trim().toLowerCase();
      })
      .filter(Boolean),
  );
  var collectionViewEnabled = policyLibraryOptions.has("show collection");

  function isAzListingEnabled() {
    var options = (
      (document.getElementById("policy-library-config") || {}).getAttribute?.(
        "data-options",
      ) || ""
    )
      .split(";")
      .map(function (option) {
        return option.trim().toLowerCase();
      });
    return options.indexOf("show a-z listing") !== -1;
  }
  var MOCK_URL = "./src/mock/coveo-search-rest-api-query.json";

  // ── Squiz Matrix Management API (page-link lookups) ──────────────────────────
  var MATRIX_API_BASE = "https://internal.nt.gov.au/__management_api/v1/";
  var MATRIX_API_TOKEN = "eeaa62869ea5c7e751446454327cf135";
  var MATRIX_MOCK_URL = "./src/mock/matrix-asset-links.json";
  var matrixMockCache = null;

  var SOURCES_PRIMARY_URL =
    "https://internal.nt.gov.au/__data/assets/text_file/0011/979085/sources.json";
  var SOURCES_FALLBACK_URL =
    "https://internal.nt.gov.au/__data/assets/file/0010/979093/sources-fallback.json";
  var SOURCES_UPDATER_URL =
    "https://internal.nt.gov.au/dcdd/policy-library/configuration/listings/source-updater.js";
  var SOURCES_JSAPI_KEY = "1603940920";
  var SOURCES_ASSET_ID = "979085";
  var sharedSourcesPromise = null;
  var recachedSources = {};
  var recacheResolutionFailures = {};
  var recachePublished = false;

  // Per-page-load cache of resolved page-link Promises, keyed by assetId.
  // Both card and table renders call resolvePageLinks(assetId), which returns
  // the cached Promise on subsequent calls — so pagination, sorting, filtering,
  // and switching between card/table view never re-fetch the same data.
  // Cleared at the start of every runSearch() to avoid stale data across queries.
  var pageLinksCache = {};

  function validateSourcesMap(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Sources data must be an object");
    }

    Object.keys(data).forEach(function (assetId) {
      if (!/^\d+$/.test(assetId) || !Array.isArray(data[assetId])) {
        throw new Error("Invalid sources entry for asset " + assetId);
      }
      data[assetId].forEach(function (source) {
        if (
          !source ||
          typeof source !== "object" ||
          typeof source.name !== "string" ||
          typeof source.path !== "string"
        ) {
          throw new Error("Invalid source link for asset " + assetId);
        }
      });
    });

    return data;
  }

  function fetchSourcesMap(url, sourceName) {
    return fetch(url, { cache: "no-store" }).then(function (response) {
      if (!response.ok) {
        throw new Error(sourceName + " request failed: " + response.status);
      }
      return response.json().then(function (data) {
        return { data: validateSourcesMap(data), source: sourceName };
      });
    });
  }

  function loadSharedSources() {
    if (sharedSourcesPromise) return sharedSourcesPromise;

    if (isDev) {
      sharedSourcesPromise = Promise.resolve({
        data: validateSourcesMap(mockSources),
        source: "mock",
      });
      return sharedSourcesPromise;
    }

    sharedSourcesPromise = fetchSourcesMap(SOURCES_PRIMARY_URL, "primary")
      .catch(function (primaryError) {
        console.warn("[DCDD] Primary sources unavailable", primaryError);
        return fetchSourcesMap(SOURCES_FALLBACK_URL, "fallback");
      })
      .catch(function (fallbackError) {
        console.warn(
          "[DCDD] Squiz sources unavailable; using bundled mock data",
          fallbackError,
        );
        return {
          data: validateSourcesMap(mockSources),
          source: "mock",
        };
      });

    return sharedSourcesPromise;
  }

  function sortSourcesMap(sources) {
    var sorted = {};
    Object.keys(sources)
      .sort(function (a, b) {
        return Number(a) - Number(b);
      })
      .forEach(function (assetId) {
        sorted[assetId] = sources[assetId];
      });
    return sorted;
  }

  function parseJsApiResponse(response, operation) {
    return response.text().then(function (responseText) {
      var result = null;
      try {
        result = responseText ? JSON.parse(responseText) : {};
      } catch (e) {
        /* Include the raw response in the error below. */
      }

      if (!response.ok || !result || result.success === false || result.error) {
        var detail = result
          ? result.error || JSON.stringify(result)
          : responseText.slice(0, 500);
        throw new Error(
          operation + " failed (HTTP " + response.status + "): " + detail,
        );
      }
      return result;
    });
  }

  function getSourcesNonce() {
    var tokenElement = document.getElementById("token");
    if (tokenElement && tokenElement.value.trim()) {
      return Promise.resolve(tokenElement.value.trim());
    }

    return fetch(SOURCES_UPDATER_URL + "?SQ_ACTION=getToken", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Nonce request failed: " + response.status);
        }
        return response.text();
      })
      .then(function (nonceToken) {
        var trimmedToken = nonceToken.trim();
        if (!trimmedToken) {
          throw new Error("Nonce request returned an empty token");
        }
        return trimmedToken;
      });
  }

  function callSourcesJsApi(operation, params, nonceToken) {
    var body = params || {};
    body.type = operation;
    body.nonce_token = nonceToken;

    return fetch(SOURCES_UPDATER_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-SquizMatrix-JSAPI-Key": SOURCES_JSAPI_KEY,
      },
      body: JSON.stringify(body),
    }).then(function (response) {
      return parseJsApiResponse(response, operation);
    });
  }

  function publishSources(sources) {
    var nonceToken = "";
    var lockAcquired = false;
    var writeError = null;

    return getSourcesNonce()
      .then(function (token) {
        nonceToken = token;
        return callSourcesJsApi(
          "acquireLock",
          {
            id: SOURCES_ASSET_ID,
            screen: "attributes",
            dependants_only: 0,
            force_acquire: 1,
          },
          nonceToken,
        );
      })
      .then(function () {
        lockAcquired = true;
        return callSourcesJsApi(
          "setContentOfEditableFileAsset",
          {
            id: SOURCES_ASSET_ID,
            content: JSON.stringify(sortSourcesMap(sources)),
          },
          nonceToken,
        );
      })
      .catch(function (error) {
        writeError = error;
      })
      .then(function () {
        if (!lockAcquired) {
          throw writeError;
        }
        return callSourcesJsApi(
          "releaseLock",
          { id: SOURCES_ASSET_ID, screen: "attributes" },
          nonceToken,
        ).then(function () {
          if (writeError) throw writeError;
        });
      });
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
  function fetchPageLinks(assetId, rootAssetId, stage) {
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
      .catch(function (error) {
        if (rootAssetId && shouldLogRecachePageLinks()) {
          recacheResolutionFailures[rootAssetId] = {
            stage: stage || "links",
            relatedAssetId: assetId,
            error: error.message,
          };
        }
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
    var useLiveSources = shouldBypassSharedSources() && !isDev;

    var promise = useLiveSources
      ? resolvePageLinksUncached(assetId).then(function (pageLinks) {
          if (shouldLogRecachePageLinks()) {
            if (!recacheResolutionFailures[assetId]) {
              recachedSources[assetId] = pageLinks;
            }
          }
          return pageLinks;
        })
      : loadSharedSources().then(function (sourcesState) {
          return Object.prototype.hasOwnProperty.call(
            sourcesState.data,
            assetId,
          )
            ? sourcesState.data[assetId]
            : [];
        });

    if (shouldLogRecachePageLinks()) {
      promise.then(function (pageLinks) {
        console.log("[DCDD] /_recache page-links first-pass", {
          assetId: assetId,
          pageLinks: pageLinks,
        });
      });
    }
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
    if (!Array.isArray(results)) return Promise.resolve([]);
    var promises = [];
    var seen = {};
    results.forEach(function (r) {
      var id = (r.raw || {}).assetassetid;
      if (id && !seen[id]) {
        seen[id] = true;
        promises.push(resolvePageLinks(id));
      }
    });
    return Promise.all(promises);
  }

  function publishRecachedSources(prefetchPromise) {
    if (!shouldLogRecachePageLinks() || isDev || recachePublished) return;
    recachePublished = true;

    Promise.all([loadSharedSources(), prefetchPromise])
      .then(function (values) {
        var sourcesState = values[0];
        if (sourcesState.source === "mock") {
          throw new Error(
            "Shared Squiz sources are unavailable; mock data will not be published",
          );
        }

        var mergedSources = {};
        Object.keys(sourcesState.data).forEach(function (assetId) {
          mergedSources[assetId] = sourcesState.data[assetId];
        });
        Object.keys(recachedSources).forEach(function (assetId) {
          mergedSources[assetId] = recachedSources[assetId];
        });
        var failedAssetIds = Object.keys(recacheResolutionFailures);
        if (failedAssetIds.length) {
          console.warn(
            "[DCDD] Retaining existing sources for failed recache assets",
            recacheResolutionFailures,
          );
        }
        return publishSources(mergedSources);
      })
      .then(function () {
        console.log("[DCDD] Shared sources updated", {
          updatedAssets: Object.keys(recachedSources).length,
          retainedAssets: Object.keys(recacheResolutionFailures).length,
        });
      })
      .catch(function (error) {
        console.error("[DCDD] Shared sources update failed", error);
      });
  }

  /**
   * Internal: performs the actual upstream-link resolution chain.
   * Use resolvePageLinks() instead, which adds caching.
   * @param {string} assetId
   * @returns {Promise<Array<{name: string, path: string}>>}
   */
  function resolvePageLinksUncached(assetId) {
    return fetchPageLinks(assetId, assetId, "document links").then(
      function (links) {
        var refIds = getPageMajorIds(links);
        if (!refIds.length) return [];
        return Promise.all(
          refIds.map(function (id) {
            return fetchPageLinks(id, assetId, "reference links").then(
              function (childLinks) {
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
                          .catch(function (error) {
                            if (shouldLogRecachePageLinks()) {
                              recacheResolutionFailures[assetId] = {
                                stage: "hidden asset",
                                relatedAssetId: hid,
                                error: error.message,
                              };
                            }
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
                            .catch(function (error) {
                              if (shouldLogRecachePageLinks()) {
                                recacheResolutionFailures[assetId] = {
                                  stage: "parent asset",
                                  relatedAssetId: parentId,
                                  error: error.message,
                                };
                              }
                              return { major_id: parentId, asset: null };
                            });
                        }),
                      )
                    : Promise.resolve([]);
                  return parentFetches.then(function (parents) {
                    return { page_contents_parents: parents };
                  });
                });
              },
            );
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
                  p.asset.attributes.short_name ||
                  p.asset.attributes.name ||
                  "";
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
      },
    );
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
        var rawPath = (p.path || "").trim();
        var href = /^https?:\/\//i.test(rawPath)
          ? rawPath
          : "https://" + rawPath;
        return (
          '<a href="' +
          $("<span>").text(href).html() +
          fragment +
          '">' +
          $("<span>").text(p.name).html() +
          "</a>"
        );
      })
      .join(", ");
  }

  /**
   * Returns an immediate Source link entry from Coveo fields when both
   * sourcepage and sourceurl are present.
   * @param {Object} raw
   * @returns {Array<{name: string, path: string}>}
   */
  function getImmediateSourceLinks(raw) {
    var sourceName = ((raw && raw.sourcepage) || "").trim();
    var sourceUrl = ((raw && raw.sourceurl) || "").trim();
    if (!sourceName || !sourceUrl) return [];
    return [{ name: sourceName, path: sourceUrl }];
  }

  /**
   * Merges immediate and fetched Source links, removing duplicates by path
   * (case-insensitive) while preserving order.
   * @param {Array<{name: string, path: string}>} immediateLinks
   * @param {Array<{name: string, path: string}>} fetchedLinks
   * @returns {Array<{name: string, path: string}>}
   */
  function mergeSourceLinks(immediateLinks, fetchedLinks) {
    var out = [];
    var seen = {};

    function pushUnique(link) {
      var name = ((link && link.name) || "").trim();
      var path = ((link && link.path) || "").trim();
      if (!name || !path) return;
      var key = path.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push({ name: name, path: path });
    }

    (immediateLinks || []).forEach(pushUnique);
    (fetchedLinks || []).forEach(pushUnique);
    return out;
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

  var RESULTS_PER_PAGE_DEFAULT = 10;
  var ITEMS_PER_PAGE_VALUES = {
    10: true,
    20: true,
    all: true,
  };
  var MAX_FACET_VISIBLE = 7;

  var SEARCH_ANALYTICS_EVENTS = {
    search: "policy_search",
    zeroResults: "policy_search_zero_results",
  };

  // ── Module state ─────────────────────────────────────────────────────────────
  var originalResults = []; // API response order — restored when sort = relevancy
  var EXCLUDED_DOCTYPE = "Supporting document"; // hard-excluded from all result sets and facets
  var allResults = [];
  var filteredResults = [];
  var masterResults = []; // full corpus — all documents regardless of query; used to keep facet lists stable
  var currentPage = 1;
  var activeTypeFilters = new Set();
  var activeTopicFilters = new Set();
  var activeOwnerFilter = "";
  var currentSort = "relevancy";
  var currentQuery = "";
  var initialQuery = "";
  var filterAnimTimeout = null;
  var filterToastHideTimeout = null;
  var filterToastCleanupTimeout = null;
  var visibleResultIds = new Set();
  var trackedSearchEvents = {};
  var currentItemsPerPage = "10";
  var collectionResults = [];
  var activeContentMode = "document";
  var activeCollectionLetter = "all";

  var FILTER_TOAST_DURATION_MS = 2200;
  var FILTER_TOAST_TRANSITION_MS = 180;
  var FILTER_TOAST_VIEWPORT_MARGIN_PX = 24;

  var SORT_VALUES = {
    relevancy: true,
    "date descending": true,
    "alpha ascending": true,
    "alpha descending": true,
  };

  // ── URL builder ──────────────────────────────────────────────────────────────
  /**
   * Builds the Coveo search endpoint URL for the given query string.
   * @param {string} query  Raw (unencoded) search term.
   * @returns {string} Full URL with a policyterm query parameter.
   */
  function buildCoveoUrl(query) {
    if (!COVEO_BASE_URL) {
      throw new Error(
        "Policy Library Coveo endpoint is not configured. " +
          "Set the Coveo Search REST API metadata field for this page.",
      );
    }

    var url;
    try {
      url = new URL(COVEO_BASE_URL, window.location.origin);
    } catch (error) {
      throw new Error(
        "Policy Library Coveo endpoint is invalid: " + COVEO_BASE_URL,
      );
    }
    url.searchParams.set("policyterm", query);
    return url.toString();
  }

  function trackAnalyticsEvent(eventName, params) {
    if (typeof window.gtag !== "function") {
      return;
    }

    window.gtag("event", eventName, params || {});
  }

  function trackSearchAnalytics(query, resultCount) {
    var trimmedQuery = $.trim(query || "");
    if (!trimmedQuery) {
      return;
    }

    var searchKey = SEARCH_ANALYTICS_EVENTS.search + "::" + trimmedQuery;
    if (!trackedSearchEvents[searchKey]) {
      trackedSearchEvents[searchKey] = true;
      trackAnalyticsEvent(SEARCH_ANALYTICS_EVENTS.search, {
        search_term: trimmedQuery,
        results_count: resultCount,
        search_source: "onsite",
      });
    }

    if (resultCount !== 0) {
      return;
    }

    var zeroKey = SEARCH_ANALYTICS_EVENTS.zeroResults + "::" + trimmedQuery;
    if (trackedSearchEvents[zeroKey]) {
      return;
    }

    trackedSearchEvents[zeroKey] = true;
    trackAnalyticsEvent(SEARCH_ANALYTICS_EVENTS.zeroResults, {
      search_term: trimmedQuery,
      results_count: 0,
      search_source: "onsite",
    });
  }

  /**
   * Returns the value of a URL query parameter from the current page URL,
   * or null when the parameter is absent.
   * @param {string} name  Parameter name (e.g. "policyterm", "sort").
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
   * Parses raw.approveddate values in "DD MM YYYY" format.
   * Returns null when input is missing/invalid.
   * @param {string} dateStr
   * @returns {{day:number,monthIndex:number,year:number,date:Date}|null}
   */
  function parseApprovedDate(dateStr) {
    if (!dateStr) return null;
    var m = String(dateStr)
      .trim()
      .match(/^(\d{1,2})\s+(\d{1,2})\s+(\d{4})$/);
    if (!m) return null;

    var day = parseInt(m[1], 10);
    var month = parseInt(m[2], 10);
    var year = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    var dt = new Date(year, month - 1, day);
    if (
      dt.getFullYear() !== year ||
      dt.getMonth() !== month - 1 ||
      dt.getDate() !== day
    ) {
      return null;
    }

    return {
      day: day,
      monthIndex: month - 1,
      year: year,
      date: dt,
    };
  }

  /**
   * Parses raw.resourceupdated values in "YYYY-MM-DD HH:mm:ss" format.
   * Returns null when input is missing/invalid.
   * @param {string} dateStr
   * @returns {{day:number,monthIndex:number,year:number,date:Date}|null}
   */
  function parseResourceUpdatedDate(dateStr) {
    if (!dateStr) return null;
    var m = String(dateStr)
      .trim()
      .match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+\d{1,2}:\d{1,2}:\d{1,2})?$/);
    if (!m) return null;

    var year = parseInt(m[1], 10);
    var month = parseInt(m[2], 10);
    var day = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    var dt = new Date(year, month - 1, day);
    if (
      dt.getFullYear() !== year ||
      dt.getMonth() !== month - 1 ||
      dt.getDate() !== day
    ) {
      return null;
    }

    return {
      day: day,
      monthIndex: month - 1,
      year: year,
      date: dt,
    };
  }

  function getBestDateParts(raw) {
    var parsedApproved = parseApprovedDate((raw || {}).approveddate);
    if (parsedApproved) return parsedApproved;
    return parseResourceUpdatedDate((raw || {}).resourceupdated);
  }

  /**
   * Formats raw.approveddate as "D\u00a0MMMM YYYY" (e.g. "5\u00a0March 2026").
   * Returns "" for missing or invalid inputs.
   * @param {string} dateStr Date in "DD MM YYYY" format (raw.approveddate).
   * @returns {string}
   */
  function formatDate(dateStr) {
    var parsed = parseApprovedDate(dateStr);
    if (!parsed) return "";
    return parsed.day + " " + MONTHS[parsed.monthIndex] + " " + parsed.year;
  }

  function formatDateFromRaw(raw) {
    var parsed = getBestDateParts(raw);
    if (!parsed) return "";
    return parsed.day + " " + MONTHS[parsed.monthIndex] + " " + parsed.year;
  }

  // ── File type labels ──────────────────────────────────────────────────────────
  var FILE_TYPE_LABELS = {
    pdf_file: "PDF",
    word_doc: "DOCX",
    excel: "XLSX",
    powerpoint: "PPTX",
  };

  /**
   * Builds file-type/size metadata for appending to a document title.
   * Uses FILE_TYPE_LABELS to map raw.resourcetype to a display label (e.g. "PDF").
   * Returns an empty string when neither raw.resourcetype nor raw.resourcefilesize
   * is present.
   * @param {Object} raw  result.raw from the Coveo API response.
   * @returns {string}  e.g. "PDF (354.2 KB)", "DOCX", "(58.5 KB)", or "".
   */
  function formatFileMeta(raw) {
    var ext = FILE_TYPE_LABELS[raw.resourcetype] || "";
    var size = raw.resourcefilesize || "";
    if (ext && size) return ext + " (" + size + ")";
    if (ext) return ext;
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

  /** Keeps the Show description toggle aligned with the current results view. */
  function syncViewToggleState() {
    $("#doc-search-view-toggle").attr(
      "aria-pressed",
      isTableView() ? "false" : "true",
    );
  }

  /** Returns the correct results-per-page constant for the active view. */
  function resultsPerPage() {
    if (currentItemsPerPage === "20") {
      return 20;
    }
    if (currentItemsPerPage === "all") {
      return Math.max(getActiveResults().length, 1);
    }
    return RESULTS_PER_PAGE_DEFAULT;
  }

  function normalizeItemsPerPage(value) {
    var normalized = String(value || "").toLowerCase();
    return ITEMS_PER_PAGE_VALUES[normalized] ? normalized : "10";
  }

  function setItemsPerPageSelection(value) {
    currentItemsPerPage = normalizeItemsPerPage(value);
    $("#doc-search-items-per-page").val(currentItemsPerPage);
  }

  function isAllItemsMode() {
    return currentItemsPerPage === "all";
  }

  function getVisibleCollections() {
    return activeCollectionLetter === "all"
      ? collectionResults
      : collectionResults.filter(function (collection) {
          return collection.name.charAt(0).toUpperCase() === activeCollectionLetter;
        });
  }

  function getVisibleDocuments() {
    return activeCollectionLetter === "all"
      ? filteredResults
      : filteredResults.filter(function (result) {
          var raw = result.raw || {};
          var title = String(raw.resourcefriendlytitle || result.title || "");
          return title.charAt(0).toUpperCase() === activeCollectionLetter;
        });
  }

  function getActiveResults() {
    return activeContentMode === "collection"
      ? getVisibleCollections()
      : getVisibleDocuments();
  }

  function buildCollections(results) {
    var collectionsById = {};
    (results || []).forEach(function (result) {
      var raw = result.raw || {};
      var id = String(raw.collectionassetid || "").trim();
      var name = String(raw.collectionname || "").trim();
      var url = String(raw.collectionurl || "").trim();
      var key = id && id !== "none" ? id : url;
      var dateParts = getBestDateParts(raw);

      if (!key || !name || name === "none" || !url || url === "none") return;
      if (!collectionsById[key]) {
        collectionsById[key] = {
          id: key,
          name: name,
          url: url,
          latestDate: dateParts ? dateParts.date : null,
        };
      } else if (
        dateParts &&
        (!collectionsById[key].latestDate ||
          dateParts.date.getTime() > collectionsById[key].latestDate.getTime())
      ) {
        collectionsById[key].latestDate = dateParts.date;
      }
    });

    return Object.keys(collectionsById)
      .map(function (key) {
        return collectionsById[key];
      })
      .sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
  }

  function sortCollections() {
    collectionResults.sort(function (a, b) {
      if (currentSort === "alpha descending") {
        return b.name.localeCompare(a.name);
      }
      if (currentSort === "alpha ascending" || currentSort === "relevancy") {
        return a.name.localeCompare(b.name);
      }
      if (!a.latestDate && !b.latestDate) return a.name.localeCompare(b.name);
      if (!a.latestDate) return 1;
      if (!b.latestDate) return -1;
      return b.latestDate.getTime() - a.latestDate.getTime();
    });
  }

  function updateContentModeControls() {
    var isCollectionMode = activeContentMode === "collection";
    $("#doc-search-results-col").attr("data-content-mode", activeContentMode);
    var $modeControls = $("#doc-search-mode-controls");
    $modeControls
      .toggleClass("doc-search-mode-controls--disabled", !collectionViewEnabled)
      [collectionViewEnabled ? "removeAttr" : "attr"]("hidden", "hidden");
    $("#doc-search-mode-controls [data-search-mode]").each(function () {
      var isActive = $(this).data("search-mode") === activeContentMode;
      $(this).toggleClass("is-active", isActive).attr("aria-pressed", isActive);
    });
    $("#doc-search-letter-filter")[
      isAzListingEnabled() ? "removeAttr" : "attr"
    ]("hidden", "hidden");
    $("#doc-search-results-list, .doc-search-table-wrap").toggle(!isCollectionMode);
    $("#doc-search-collection-list")[
      isCollectionMode ? "removeAttr" : "attr"
    ]("hidden", "hidden");
    if (isCollectionMode) {
      $(".doc-search-results-header, #doc-search-pagination-row, #doc-search-pagination")
        .removeClass("d-none");
    }
    $(".doc-search-results-controls").toggle(!isCollectionMode);
  }

  function renderCollectionLetterFilter() {
    if (!isAzListingEnabled()) return;
    window.setTimeout(function () {
      $("#doc-search-letter-filter").removeAttr("hidden");
    }, 0);
    var $buttons = $(".doc-search-letter-filter__buttons").empty();
    var letters = ["all"].concat("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
    var results =
      activeContentMode === "collection" ? collectionResults : filteredResults;

    letters.forEach(function (letter) {
      var count =
        letter === "all"
          ? results.length
          : results.filter(function (result) {
              var title =
                activeContentMode === "collection"
                  ? result.name
                  : (result.raw || {}).resourcefriendlytitle || result.title || "";
              return title.charAt(0).toUpperCase() === letter;
            }).length;
      var isActive = activeCollectionLetter === letter;
      var label = letter === "all" ? "All" : letter;
      var $button = $(
        '<button type="button" class="doc-search-letter-filter__button">' +
          label +
          "</button>",
      )
        .attr("data-collection-letter", letter)
        .attr("aria-pressed", isActive)
        .toggleClass("is-active", isActive)
        .prop("disabled", count === 0);
      $buttons.append($button);
    });

    $(".doc-search-letter-filter__status").text(
      activeCollectionLetter === "all"
        ? ""
        : "Filtering by letter " + activeCollectionLetter + ".",
    );
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function clearFilterToastTimers() {
    if (filterToastHideTimeout) {
      window.clearTimeout(filterToastHideTimeout);
      filterToastHideTimeout = null;
    }
    if (filterToastCleanupTimeout) {
      window.clearTimeout(filterToastCleanupTimeout);
      filterToastCleanupTimeout = null;
    }
  }

  function positionFilterToast() {
    var $toast = $("#doc-search-filter-toast");
    if (!$toast.length) return;

    var toastEl = $toast[0];
    var sidebarEl = document.getElementById("doc-search-sidebar");
    var footerEl = document.querySelector(".ntgc-footer");
    var viewportMargin = FILTER_TOAST_VIEWPORT_MARGIN_PX;
    var left = viewportMargin;

    if (sidebarEl) {
      var sidebarRect = sidebarEl.getBoundingClientRect();
      var maxLeft = Math.max(
        viewportMargin,
        window.innerWidth - toastEl.offsetWidth - viewportMargin,
      );
      left = Math.min(Math.max(sidebarRect.left, viewportMargin), maxLeft);
    }

    $toast.css({ left: left + "px", right: "auto", top: "auto", bottom: viewportMargin + "px" });

    if (!footerEl) {
      return;
    }

    var footerRect = footerEl.getBoundingClientRect();
    if (footerRect.top >= window.innerHeight) {
      return;
    }

    var top = Math.max(viewportMargin, footerRect.top - toastEl.offsetHeight - viewportMargin);
    $toast.css({ top: top + "px", bottom: "auto" });
  }

  function hideFilterToast() {
    var $toast = $("#doc-search-filter-toast");
    clearFilterToastTimers();
    if (!$toast.length) return;

    $toast.removeClass("is-visible");
    filterToastCleanupTimeout = window.setTimeout(function () {
      $toast.css({ left: "", right: "", top: "", bottom: "" });
      $toast.attr("hidden", true).text("");
      filterToastCleanupTimeout = null;
    }, FILTER_TOAST_TRANSITION_MS);
  }

  function getFilterToastMessage(resultCount) {
    if (resultCount === 0) {
      return "No results match your filters";
    }
    if (resultCount === 1) {
      return "1 result matches your filters";
    }
    return resultCount + " results match your filters";
  }

  function showFilterToast(resultCount) {
    var $toast = $("#doc-search-filter-toast");
    if (isMobileViewport() || !$toast.length) {
      hideFilterToast();
      return;
    }

    clearFilterToastTimers();
    $toast.text(getFilterToastMessage(resultCount)).attr("hidden", false);
    positionFilterToast();

    requestAnimationFrame(function () {
      $toast.addClass("is-visible");
    });

    filterToastHideTimeout = window.setTimeout(function () {
      hideFilterToast();
    }, FILTER_TOAST_DURATION_MS);
  }

  $(window).on("scroll resize", function () {
    var $toast = $("#doc-search-filter-toast");
    if ($toast.length && !$toast.is("[hidden]")) {
      positionFilterToast();
    }
  });

  // ── Filter building ──────────────────────────────────────────────────────────
  /**
   * Rebuilds both the Type and Topic facet lists.
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
      "topic",
      "#doc-search-topic-filters",
      activeTopicFilters,
    );
    buildDropdownFacet(
      results,
      "resourceowner",
      "#doc-search-owner",
      activeOwnerFilter,
    );
    syncSortControls();
  }

  function syncSortControls() {
    $('input[name="doc-search-sort"]').prop("checked", false);
    $('input[name="doc-search-sort"][value="' + currentSort + '"]').prop(
      "checked",
      true,
    );
    $('input[name="doc-search-drawer-sort"]').prop("checked", false);
    $('input[name="doc-search-drawer-sort"][value="' + currentSort + '"]').prop(
      "checked",
      true,
    );
  }

  /**
   * Populates a facet <ul> with one checkbox item per known value for `field`.
   *
   * Value list  — derived from masterResults (the full corpus), so the same
   *               set of Type / Topic options is always rendered regardless
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
   * Multi-value fields: topic values may arrive comma-delimited or
   * semicolon-delimited (e.g. "Fraud and corruption, Finance and travel" or
   * "Fraud and corruption; Finance and travel"). splitTopicValues() applies
   * a capitalization rule for comma separation: split only when the next token
   * starts with an uppercase letter. Labels like "Conduct, integrity and risk"
   * remain intact.
   *
   * @param {Array}  results      Current result set used solely for counting (typically allResults).
   * @param {string} field        result.raw property name (e.g. "resourcedoctype", "topic").
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

  /**
   * Splits topic values into trimmed, non-empty tokens.
   * Supports semicolon and comma delimiters for multi-value records.
   * For comma-delimited values, it only splits at commas where the next
   * non-space character is uppercase, so labels such as
   * "Conduct, integrity and risk" remain a single topic.
   * @param {string} val
   * @returns {string[]}
   */
  function splitTopicValues(val) {
    if (!val) return [];

    var raw = String(val).trim();
    if (!raw) return [];

    // Backward/forward compatibility: accept semicolon-delimited values directly.
    if (raw.indexOf(";") !== -1) {
      return raw
        .split(";")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
    }

    var parts = [];
    var current = "";

    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (ch !== ",") {
        current += ch;
        continue;
      }

      var j = i + 1;
      while (j < raw.length && raw.charAt(j) === " ") {
        j++;
      }

      var next = j < raw.length ? raw.charAt(j) : "";
      var startsNewTopic = /[A-Z]/.test(next);

      if (startsNewTopic) {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = "";
      } else {
        current += ch;
      }
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }

  function buildFacet(results, field, containerId, activeSet) {
    // Count occurrences in the CURRENT result set (may be a filtered/searched subset)
    var counts = {};
    results.forEach(function (r) {
      var val = (r.raw || {})[field];
      if (val) {
        var facetValues =
          field === "topic" ? splitTopicValues(val) : splitFieldValues(val);
        facetValues.forEach(function (v) {
          counts[v] = (counts[v] || 0) + 1;
        });
      }
    });

    // Derive the full key list from masterResults so every known value is always shown
    var masterKeys = {};
    masterResults.forEach(function (r) {
      var val = (r.raw || {})[field];
      if (val) {
        var masterValues =
          field === "topic" ? splitTopicValues(val) : splitFieldValues(val);
        masterValues.forEach(function (v) {
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
   * parse raw.approveddate ("DD MM YYYY") before comparing.
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
        var pa = getBestDateParts(a.raw || {});
        var pb = getBestDateParts(b.raw || {});
        if (!pa && !pb) return 0;
        if (!pa) return 1;
        if (!pb) return -1;
        return currentSort === "date descending"
          ? pb.date.getTime() - pa.date.getTime()
          : pa.date.getTime() - pb.date.getTime();
      });
    }
    sortCollections();
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
   * selections (without mutating module state) and updates the drawer's
   * primary action label.
   */
  function updateDrawerItemCount() {
    var drawerTypeFilters = new Set();
    var drawerTopicFilters = new Set();
    $("#doc-search-drawer [data-facet]").each(function () {
      if ($(this).is(":checked")) {
        var field = $(this).data("facet");
        var value = $(this).data("value");
        if (field === "resourcedoctype") {
          drawerTypeFilters.add(value);
        } else {
          drawerTopicFilters.add(value);
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
        drawerTopicFilters.size > 0 &&
        !splitTopicValues(raw.topic || "").some(function (v) {
          return drawerTopicFilters.has(v);
        })
      ) {
        return false;
      }
      return true;
    }).length;

    $("#doc-search-drawer-apply").text(
      count === 1 ? "Show 1 result" : "Show " + count + " results",
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

  function applyFilters(options) {
    options = options || {};

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
        activeTopicFilters.size > 0 &&
        !splitTopicValues(raw.topic || "").some(function (v) {
          return activeTopicFilters.has(v);
        })
      ) {
        return false;
      }
      return true;
    });

    if (activeContentMode === "collection") {
      updateContentModeControls();
      renderCollectionLetterFilter();
      renderPage(1);
      return;
    }

    renderCollectionLetterFilter();

    // Toggle UI elements based on whether results exist
    var activeDocumentResults = getVisibleDocuments();
    toggleNoResultsState(activeDocumentResults.length);
    setUserMessage(
      activeDocumentResults.length === 0 ? buildNoResultsHtml(currentQuery) : "",
    );
    syncViewToggleState();
    updateResultsSummary();
    if (options.showToast) {
      showFilterToast(activeDocumentResults.length);
    }

    // Compute new page 1 slice and diff against currently visible items
    var perPage = resultsPerPage();
    var newSlice = activeDocumentResults.slice(0, perPage);
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
    var perPage = resultsPerPage();
    var activeResults = getActiveResults();
    var totalPages = Math.max(1, Math.ceil(activeResults.length / perPage));
    var targetPage = Math.min(Math.max(page, 1), totalPages);

    currentPage = targetPage;
    var start = (targetPage - 1) * perPage;
    var pageSlice = activeResults.slice(start, start + perPage);

    if (activeContentMode === "collection") {
      renderCollectionResults(pageSlice);
      visibleResultIds = new Set();
      updateResultsSummary();
      renderPagination();
      return;
    }

    if (isTableView()) {
      renderTableResults(pageSlice, enteringIds);
    } else {
      renderCardResults(pageSlice, enteringIds);
    }

    visibleResultIds = new Set(pageSlice.map(resultId));
    updateResultsSummary();
    renderPagination();
  }

  function renderCollectionResults(collections) {
    var $list = $("#doc-search-collection-list").empty();
    collections.forEach(function (collection) {
      $list.append(
        '<li class="doc-search-collection-result">' +
          '<svg class="doc-search-collection-result__icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2.5h6.5A2.5 2.5 0 0 1 21 10v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z"/></svg>' +
          '<a class="doc-search-collection-result__link" href="' +
          escAttr(localiseCollectionUrl(collection.url)) +
          '">' +
          escHtml(collection.name) +
          "</a></li>",
      );
    });
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
      var fileMeta = formatFileMeta(raw).trim();
      var immediateSourceLinks = getImmediateSourceLinks(raw);
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

      // Topic (hidden data attribute for filter matching)
      $item.attr("data-topic", raw.topic || "");

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
      if (assetAssetId || immediateSourceLinks.length) {
        (function ($card) {
          var $pageRow = $card.find('[data-ref="search-result-page-row"]');
          var $pageIds = $card.find('[data-ref="search-result-page-ids"]');
          $pageRow.removeAttr("hidden");

          if (immediateSourceLinks.length) {
            $pageIds.html(renderPageLinksHtml(immediateSourceLinks, fileMeta));
            $card
              .find('[data-ref="search-result-page-label"]')
              .text(immediateSourceLinks.length > 1 ? "Sources:" : "Source:");
          } else {
            $pageIds.text("Loading\u2026");
          }

          if (!assetAssetId) {
            return;
          }

          resolvePageLinks(assetAssetId).then(function (pageLinks) {
            var mergedLinks = mergeSourceLinks(immediateSourceLinks, pageLinks);
            if (!mergedLinks.length) {
              $pageRow.attr("hidden", true);
              return;
            }
            $pageIds.html(renderPageLinksHtml(mergedLinks, fileMeta));
            $card
              .find('[data-ref="search-result-page-label"]')
              .text(mergedLinks.length > 1 ? "Sources:" : "Source:");
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
      var updated = formatDateFromRaw(raw);
      var $updatedWrap = $item.find(".doc-search-result__updated");
      if (updated) {
        $item.find('[data-ref="search-result-last-updated"]').text(updated);
        $updatedWrap.show();
      } else {
        $updatedWrap.hide();
      }

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
      var updated = formatDateFromRaw(raw);
      var fileMeta = formatFileMeta(raw).trim();
      var immediateSourceLinks = getImmediateSourceLinks(raw);

      var extIcon = "";
      var pagesCellInitialHtml = "";
      if (immediateSourceLinks.length) {
        pagesCellInitialHtml = renderPageLinksHtml(
          immediateSourceLinks,
          fileMeta,
        );
      } else if (assetAssetId) {
        pagesCellInitialHtml = escHtml("Loading\u2026");
      }

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
          pagesCellInitialHtml +
          "</td>" +
          "</tr>",
      );
      var id = resultId(result);
      $row.attr("data-result-id", id);
      $row.attr("data-topic", raw.topic || "");
      if (enteringIds && enteringIds.has(id)) {
        $row.addClass("doc-search-row--entering");
      }
      $tbody.append($row);

      // Async populate the Pages cell from the Squiz Matrix Management API.
      if (assetAssetId) {
        (function ($cell, fileMeta) {
          resolvePageLinks(assetAssetId).then(function (pageLinks) {
            var mergedLinks = mergeSourceLinks(immediateSourceLinks, pageLinks);
            $cell.html(renderPageLinksHtml(mergedLinks, fileMeta));
          });
        })($row.find(".doc-search-table__col-pages"), fileMeta);
      }
    });
  }

  // ── Results summary line ──────────────────────────────────────────────────────
  /**
   * Updates #doc-search-results-summary with "Showing X–Y of Z results" text,
   * or "No results found." when filteredResults is empty.
   */
  function updateResultsSummary() {
    var perPage = resultsPerPage();
    var total = getActiveResults().length;
    var start = (currentPage - 1) * perPage + 1;
    var end = Math.min(currentPage * perPage, total);
    var $summary = $("#doc-search-results-summary");

    if (total === 0) {
      $summary.html("");
    } else {
      var querySuffix = activeContentMode === "document" && initialQuery
        ? ' for "<strong>' + escHtml(initialQuery) + '</strong>"'
        : "";

      $summary.html(
        "Showing " +
          start +
          "–" +
          end +
          " of " +
          total +
          " " +
          (activeContentMode === "collection" ? "collection" : "result") +
          (total !== 1 ? "s" : "") +
          querySuffix,
      );
    }
  }

  // ── Pagination ──────────────────────────────────────────────────────────────
  /**
   * Rebuilds the #doc-search-pagination nav with Prev, numbered, and Next buttons.
   * Single-page result sets keep a muted disabled shell visible so pagination
   * layout remains stable.
   */
  function renderPagination() {
    var $nav = $("#doc-search-pagination");
    var perPage = resultsPerPage();
    var total = getActiveResults().length;
    var pages = Math.ceil(total / perPage);
    var effectivePages = Math.max(pages, 1);
    var disablePagination = isAllItemsMode() || effectivePages <= 1;

    $nav.empty();
    $nav.toggleClass("is-disabled", disablePagination);

    // Previous
    var $prev = $(
      '<button type="button" class="doc-search-pagination__btn doc-search-pagination__btn--prev">' +
        '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.8052 8.36231C4.6206 8.16354 4.6206 7.83654 4.8052 7.63777L10.522 1.48245C10.7066 1.28368 11.0104 1.28368 11.195 1.48245C11.3796 1.68121 11.3796 2.00822 11.195 2.20698L5.81458 8.00004L11.195 13.7931C11.3796 13.9919 11.3796 14.3189 11.195 14.5176C11.0104 14.7164 10.7066 14.7164 10.522 14.5176L4.8052 8.36231Z" fill="currentColor"/></svg>Prev</button>',
    );
    if (currentPage === 1 || disablePagination) $prev.prop("disabled", true);
    $prev.on("click", function () {
      if (disablePagination) return;
      renderPage(currentPage - 1);
    });
    $nav.append($prev);

    // Page numbers (with ellipsis)
    var pagesToShow = disablePagination
      ? [1]
      : buildPageRange(currentPage, effectivePages);
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
              if (disablePagination) return;
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
    if (currentPage === effectivePages || disablePagination) {
      $next.prop("disabled", true);
    }
    $next.on("click", function () {
      if (disablePagination) return;
      renderPage(currentPage + 1);
    });
    $nav.append($next);
  }

  /**
   * Toggles visibility of filter controls and sidebar based on result count.
   * When no results are found, hides: mobile filter button, results header
   * (summary + controls), table wrapper, sidebar, and pagination.
   * @param {number} resultCount  Total filtered result count.
   */
  function toggleNoResultsState(resultCount) {
    var noResults = resultCount === 0;
    $("#doc-search-mobile-filter-btn").toggleClass("d-none", noResults);
    $(".doc-search-results-header").toggleClass("d-none", noResults);
    $(".doc-search-table-wrap").toggleClass("d-none", noResults);
    $("#doc-search-sidebar").toggleClass("d-none", noResults);
    $("#doc-search-pagination-row").toggleClass("d-none", noResults);
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
   * Toggles result-specific controls based on result count while keeping the
   * desktop filter sidebar available to refine a zero-result selection.
   * @param {number} resultCount  Total filtered result count.
   */
  function toggleNoResultsState(resultCount) {
    var noResults = resultCount === 0;
    $("#doc-search-mobile-filter-btn").toggleClass("d-none", noResults);
    $(".doc-search-results-header").toggleClass("d-none", noResults);
    $(".doc-search-table-wrap").toggleClass("d-none", noResults);
    $("#doc-search-pagination").toggleClass("d-none", noResults);
    $("#doc-search-pagination-row").toggleClass("d-none", noResults);
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

  /**
   * Shows the search clear control only when the input has non-whitespace text.
   * @param {jQuery} $input
   */
  function updateSearchClearButtonVisibility($input) {
    var $clearBtn = $(".ntgc-search-section__clear-btn");
    if (!$clearBtn.length || !$input || !$input.length) return;

    var hasQuery = $.trim($input.val() || "") !== "";
    $clearBtn.prop("hidden", !hasQuery);
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

  // ── Feedback relocation ───────────────────────────────────────────────────
  var feedbackObserver = null;
  var feedbackObserverTimeoutId = null;
  var feedbackMediaQuery = window.matchMedia("(max-width: 900px)");

  function disconnectFeedbackObserver() {
    if (feedbackObserver) {
      feedbackObserver.disconnect();
      feedbackObserver = null;
    }
    if (feedbackObserverTimeoutId) {
      window.clearTimeout(feedbackObserverTimeoutId);
      feedbackObserverTimeoutId = null;
    }
  }

  /**
   * Moves the existing Matrix feedback section to its responsive destination.
   * @returns {boolean} Whether the feedback section and destination were found.
   */
  function moveFeedbackSection() {
    var feedback = document.getElementById("feedback");
    var target = document.getElementById(
      feedbackMediaQuery.matches
        ? "doc-search-results-col"
        : "doc-search-sidebar",
    );

    if (!feedback || !target || feedback === target) return false;

    if (feedback.parentNode !== target) {
      target.appendChild(feedback);
    }

    disconnectFeedbackObserver();
    return true;
  }

  /**
   * Handles feedback supplied after page load by Squiz Matrix.
   */
  function initFeedbackRelocation() {
    feedbackMediaQuery.addEventListener("change", moveFeedbackSection);

    if (moveFeedbackSection() || typeof MutationObserver === "undefined") {
      return;
    }

    feedbackObserver = new MutationObserver(function () {
      moveFeedbackSection();
    });
    feedbackObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    feedbackObserverTimeoutId = window.setTimeout(function () {
      disconnectFeedbackObserver();
    }, ASSET_CONTENTS_OBSERVER_TIMEOUT_MS);
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
   * (with an empty array) so the sidebar renders the full Type/Topic list with
   * counts of 0, rather than disappearing entirely.
   *
   * Existing sort and filter state (activeTypeFilters, activeTopicFilters,
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
    hideFilterToast();
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
        trackSearchAnalytics(query, originalResults.length);

        // In dev or when query is empty the single fetch IS the full corpus
        if (masterResults.length === 0) {
          masterResults = originalResults.slice();
        }
        collectionResults = buildCollections(masterResults);
        updateContentModeControls();
        renderCollectionLetterFilter();

        // Pre-warm the page-links cache in parallel for every result so card
        // and table renders never block on a fetch and pagination/sort/filter/
        // view-switching can read from cache instantly.
        var pageLinksPrefetch = prefetchPageLinks(originalResults);
        publishRecachedSources(pageLinksPrefetch);

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

  $(document).on("click", "[data-search-mode]", function () {
    var mode = $(this).data("search-mode");
    if (mode === "collection" && !collectionViewEnabled) return;
    activeContentMode = mode;
    activeCollectionLetter = "all";
    currentPage = 1;
    sortCollections();
    updateContentModeControls();
    renderCollectionLetterFilter();
    renderPage(1);
  });

  $(document).on("click", "[data-collection-letter]", function () {
    if ($(this).prop("disabled")) return;
    activeCollectionLetter = $(this).data("collection-letter");
    currentPage = 1;
    renderCollectionLetterFilter();
    renderPage(1);
  });

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
      "topic",
      "#doc-search-drawer-topic-filters",
      activeTopicFilters,
    );
    buildDropdownFacet(
      allResults,
      "resourceowner",
      "#doc-search-drawer-owner",
      activeOwnerFilter,
    );
    syncSortControls();
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

  // Apply filters from drawer via the "Show N results" button
  $(document).on("click", "#doc-search-drawer-apply", function () {
    // Read sort
    var drawerSort =
      $('input[name="doc-search-drawer-sort"]:checked').val() || "relevancy";
    currentSort = drawerSort;
    syncSortControls();

    // Read owner
    var drawerOwner = $('select[name="doc-search-drawer-owner"]').val() || "";
    activeOwnerFilter = drawerOwner;
    $('select[name="doc-search-owner"]').val(drawerOwner);

    // Rebuild filter sets from drawer checkboxes
    activeTypeFilters.clear();
    activeTopicFilters.clear();
    $("#doc-search-drawer [data-facet]").each(function () {
      if ($(this).is(":checked")) {
        var field = $(this).data("facet");
        var value = $(this).data("value");
        if (field === "resourcedoctype") {
          activeTypeFilters.add(value);
        } else {
          activeTopicFilters.add(value);
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
    $('input[name="doc-search-drawer-sort"]').prop("checked", false);
    $('input[name="doc-search-drawer-sort"][value="relevancy"]').prop(
      "checked",
      true,
    );
    $('select[name="doc-search-drawer-owner"]').val("");
    updateDrawerItemCount();
  });

  // Update drawer action count when owner select changes inside drawer
  $(document).on(
    "change",
    'select[name="doc-search-drawer-owner"]',
    updateDrawerItemCount,
  );

  // Clear all on sidebar (applies immediately)
  $(document).on("click", "#doc-search-sidebar-clear", function () {
    $("#doc-search-sidebar [data-facet]").prop("checked", false);
    activeTypeFilters.clear();
    activeTopicFilters.clear();
    activeOwnerFilter = "";
    $('select[name="doc-search-owner"]').val("");
    applyFilters({ showToast: true });
  });

  // ── Event: checkbox filter change ────────────────────────────────────────────
  $(document).on("change", "[data-facet]", function () {
    var $cb = $(this);
    // Inside the drawer, changes are applied only via the "Show N results" button
    if ($cb.closest("#doc-search-drawer").length) {
      updateDrawerItemCount();
      return;
    }
    var field = $cb.data("facet");
    var value = $cb.data("value");
    var set =
      field === "resourcedoctype" ? activeTypeFilters : activeTopicFilters;

    if ($cb.is(":checked")) {
      set.add(value);
    } else {
      set.delete(value);
    }
    applyFilters({ showToast: true });
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
  $(document).on("change", 'input[name="doc-search-sort"]', function () {
    currentSort = $(this).val();
    applySort();
    applyFilters();
  });

  // ── Event: owner change ───────────────────────────────────────────────────────
  $(document).on("change", 'select[name="doc-search-owner"]', function () {
    activeOwnerFilter = $(this).val();
    applyFilters({ showToast: true });
  });

  // ── Event: items-per-page change ────────────────────────────────────────────
  $(document).on("change", "#doc-search-items-per-page", function () {
    setItemsPerPageSelection($(this).val());
    currentPage = 1;
    renderPage(1);

    if (typeof window.syncUserItemsPreference === "function") {
      window.syncUserItemsPreference(currentItemsPerPage);
    }
  });

  // ── Event: view toggle ───────────────────────────────────────────────────────
  $(document).on("click", "#doc-search-view-toggle", function () {
    var $btn = $(this);
    var $col = $("#doc-search-results-col");
    var toggleOn = $btn.attr("aria-pressed") !== "true";
    var newView = toggleOn ? "card" : "table";

    $col.attr("data-view", newView);
    $btn.attr("aria-pressed", toggleOn ? "true" : "false");

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
  // to card view so the hidden description toggle cannot leave a table-only state.
  (function () {
    var mq = window.matchMedia("(max-width: 900px)");
    function resetTableViewOnMobile(e) {
      var savedView = localStorage.getItem("docSearchView");
      var desktopView =
        savedView === "table" || savedView === "card" ? savedView : "table";
      var nextView = e.matches ? "card" : desktopView;

      if (e.matches) {
        hideFilterToast();
      }

      if ($("#doc-search-results-col").attr("data-view") === nextView) return;

      $("#doc-search-results-col").attr("data-view", nextView);
      syncViewToggleState();
      renderPage(currentPage);
    }
    mq.addEventListener("change", resetTableViewOnMobile);
  })();

  // ── Init ─────────────────────────────────────────────────────────────────────
  $(document).ready(function () {
    initAssetContentsRelocation();
    initFeedbackRelocation();
    $("#initialLoadingSpinner").removeClass("d-none");

    // Read initial state from URL params
    initialQuery = getUrlParam("policyterm") || "";
    var urlSort = getUrlParam("sort");

    if (urlSort && SORT_VALUES[urlSort]) {
      currentSort = urlSort;
    }
    syncSortControls();

    // Pre-fill search input if present
    $("#search").val(initialQuery);
    updateSearchClearButtonVisibility($("#search"));

    function getFallbackView() {
      var savedView = localStorage.getItem("docSearchView");
      return savedView === "table" || savedView === "card"
        ? savedView
        : "table";
    }

    function getFallbackItemsPerPage() {
      return normalizeItemsPerPage(
        localStorage.getItem("docSearchItemsPerPage") || "10",
      );
    }

    var preferenceReady = window.docSearchViewPreferenceReady;
    if (!preferenceReady || typeof preferenceReady.then !== "function") {
      preferenceReady = Promise.resolve({
        view: getFallbackView(),
        itemsPerPage: getFallbackItemsPerPage(),
      });
    }

    preferenceReady
      .catch(function () {
        return {
          view: getFallbackView(),
          itemsPerPage: getFallbackItemsPerPage(),
        };
      })
      .then(function (preferenceState) {
        var preferredView =
          preferenceState && typeof preferenceState === "object"
            ? preferenceState.view
            : preferenceState;
        var preferredItems =
          preferenceState && typeof preferenceState === "object"
            ? preferenceState.itemsPerPage
            : getFallbackItemsPerPage();
        var initialView =
          preferredView === "card" || preferredView === "table"
            ? preferredView
            : getFallbackView();

        // Mobile remains card-only without replacing the saved desktop preference.
        if (window.matchMedia("(max-width: 900px)").matches) {
          initialView = "card";
        }

        setItemsPerPageSelection(preferredItems);
        $("#doc-search-results-col").attr("data-view", initialView);
        syncViewToggleState();

        // Always load results on page load — independent of form presence.
        runSearch(initialQuery);
      });

    // Wire up the search form if it exists on this page
    var $form = $("#policy-search-form");
    if ($form.length) {
      $form.on("input change", "#search", function () {
        updateSearchClearButtonVisibility($(this));
      });

      $form.on("click", ".ntgc-search-section__clear-btn", function (e) {
        e.preventDefault();
        var $searchInput = $form.find("#search");
        $searchInput.val("");
        updateSearchClearButtonVisibility($searchInput);
        $searchInput.trigger("focus");
      });

      $form.on("submit", function (e) {
        e.preventDefault();
        var query = $.trim($("#search").val());
        window.location.href =
          window.location.pathname + "?policyterm=" + encodeURIComponent(query);
      });
    }
  });
})(window.jQuery);
