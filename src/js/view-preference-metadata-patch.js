/*
 * view-preference-metadata-patch.js
 *
 * Standalone patch to persist the search view preference (grid/table)
 * into user metadata field #969752 while retaining docSearchView local cache.
 *
 * Canonical metadata values:
 * - grid (default)
 * - table
 *
 * Local storage compatibility values (existing app behavior):
 * - card  (maps to grid)
 * - table (maps to table)
 */
(function () {
  "use strict";

  var METADATA_FIELD_ID = "969752";
  var LOCAL_VIEW_KEY = "docSearchView";
  var LOCAL_USER_ID_KEY = "intra-user-id";
  var API_KEY = "6456420643";
  var SEARCH_COL_ID = "doc-search-results-col";
  var VIEW_TOGGLE_ID = "doc-search-view-toggle";
  var SAVE_BTN_ID = "doc-search-view-save-btn";
  var DONT_SAVE_BTN_ID = "doc-search-view-dont-save-btn";

  var suppressNextPersist = false;
  var lastPersistedPreference = null;

  function normalizePreference(value) {
    return String(value || "").toLowerCase() === "table" ? "table" : "grid";
  }

  function preferenceToView(preference) {
    return normalizePreference(preference) === "table" ? "table" : "card";
  }

  function viewToPreference(view) {
    return String(view || "").toLowerCase() === "table" ? "table" : "grid";
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function getUserAssetId() {
    return localStorage.getItem(LOCAL_USER_ID_KEY) || "";
  }

  function getApiInstance() {
    try {
      if (
        typeof js_api !== "undefined" &&
        js_api &&
        typeof js_api.setMetadata === "function" &&
        typeof js_api.getMetadata === "function"
      ) {
        return js_api;
      }
    } catch (e) {
      // Continue to fallback API creation.
    }

    if (window.__docSearchViewPrefApi) {
      return window.__docSearchViewPrefApi;
    }

    if (typeof window.Squiz_Matrix_API !== "function") {
      return null;
    }

    try {
      var options = [];
      options.key = API_KEY;
      window.__docSearchViewPrefApi = new window.Squiz_Matrix_API(options);
      return window.__docSearchViewPrefApi;
    } catch (err) {
      console.error("[view-pref] Failed to create Squiz API instance", err);
      return null;
    }
  }

  function getElements() {
    return {
      col: document.getElementById(SEARCH_COL_ID),
      toggleBtn: document.getElementById(VIEW_TOGGLE_ID),
      saveBtn: document.getElementById(SAVE_BTN_ID),
      dontSaveBtn: document.getElementById(DONT_SAVE_BTN_ID),
    };
  }

  function getCurrentDomPreference() {
    var els = getElements();
    if (!els.col) {
      return normalizePreference(localStorage.getItem(LOCAL_VIEW_KEY));
    }
    return viewToPreference(els.col.getAttribute("data-view"));
  }

  function setLocalView(preference) {
    localStorage.setItem(LOCAL_VIEW_KEY, preferenceToView(preference));
  }

  function syncDomToPreference(preference, options) {
    var opts = options || {};
    var els = getElements();
    var pref = normalizePreference(preference);
    var desiredView = preferenceToView(pref);

    setLocalView(pref);

    if (!els.col || !els.toggleBtn) {
      return;
    }

    if (pref === "table" && isMobileViewport()) {
      // Keep UI in card mode on mobile while preserving table preference for desktop.
      els.col.setAttribute("data-view", "card");
      els.toggleBtn.setAttribute("aria-pressed", "false");
      return;
    }

    var currentView = els.col.getAttribute("data-view") || "card";
    if (currentView === desiredView) {
      els.toggleBtn.setAttribute(
        "aria-pressed",
        desiredView === "table" ? "true" : "false",
      );
      return;
    }

    // Prefer native toggle click so existing render cycle runs.
    if (opts.useToggleClick !== false) {
      suppressNextPersist = true;
      els.toggleBtn.click();
      return;
    }

    // Fallback if click path is unavailable.
    els.col.setAttribute("data-view", desiredView);
    els.toggleBtn.setAttribute(
      "aria-pressed",
      desiredView === "table" ? "true" : "false",
    );
  }

  function parsePreferenceFromMetadataResponse(response) {
    var fieldId = METADATA_FIELD_ID;
    var aliases = [
      "user.view-preference",
      "view-preference",
      "view_preference",
      "viewPreference",
      "docSearchView",
    ];

    var visited = new WeakSet();

    function valueFromCandidate(candidate) {
      if (candidate == null) return null;
      if (typeof candidate === "string" || typeof candidate === "number") {
        var normalized = normalizePreference(candidate);
        if (String(candidate).toLowerCase() === "table") return normalized;
        if (String(candidate).toLowerCase() === "grid") return normalized;
        if (String(candidate).toLowerCase() === "card") return "grid";
      }
      return null;
    }

    function walk(node) {
      var direct;
      var i;
      var key;
      var candidate;

      if (node == null) return null;

      direct = valueFromCandidate(node);
      if (direct) return direct;

      if (typeof node !== "object") return null;
      if (visited.has(node)) return null;
      visited.add(node);

      if (Object.prototype.hasOwnProperty.call(node, fieldId)) {
        direct = valueFromCandidate(node[fieldId]);
        if (direct) return direct;
      }

      for (i = 0; i < aliases.length; i += 1) {
        key = aliases[i];
        if (Object.prototype.hasOwnProperty.call(node, key)) {
          direct = valueFromCandidate(node[key]);
          if (direct) return direct;
        }
      }

      if (Array.isArray(node)) {
        for (i = 0; i < node.length; i += 1) {
          candidate = walk(node[i]);
          if (candidate) return candidate;
        }
        return null;
      }

      if (
        Object.prototype.hasOwnProperty.call(node, "field_id") &&
        String(node.field_id) === fieldId
      ) {
        candidate =
          valueFromCandidate(node.field_val) ||
          valueFromCandidate(node.value) ||
          valueFromCandidate(node.val);
        if (candidate) return candidate;
      }

      var keys = Object.keys(node);
      for (i = 0; i < keys.length; i += 1) {
        candidate = walk(node[keys[i]]);
        if (candidate) return candidate;
      }

      return null;
    }

    return walk(response);
  }

  function persistPreference(preference, reason) {
    return new Promise(function (resolve) {
      var api = getApiInstance();
      var userAssetId = getUserAssetId();
      var pref = normalizePreference(preference);

      if (!api || !userAssetId) {
        resolve(false);
        return;
      }

      if (lastPersistedPreference === pref) {
        resolve(true);
        return;
      }

      api.setMetadata({
        asset_id: userAssetId,
        field_id: METADATA_FIELD_ID,
        field_val: pref,
        dataCallback: function (response) {
          if (response && response.error) {
            console.error("[view-pref] setMetadata failed", reason, response);
            resolve(false);
            return;
          }
          lastPersistedPreference = pref;
          resolve(true);
        },
        errorCallback: function (err) {
          console.error("[view-pref] setMetadata request error", reason, err);
          resolve(false);
        },
      });
    });
  }

  function readPreferenceFromMetadata() {
    return new Promise(function (resolve) {
      var api = getApiInstance();
      var userAssetId = getUserAssetId();

      if (!api || !userAssetId) {
        resolve(null);
        return;
      }

      api.getMetadata({
        asset_id: userAssetId,
        dataCallback: function (response) {
          if (response && response.error) {
            console.error("[view-pref] getMetadata failed", response);
            resolve(null);
            return;
          }
          resolve(parsePreferenceFromMetadataResponse(response));
        },
        errorCallback: function (err) {
          console.error("[view-pref] getMetadata request error", err);
          resolve(null);
        },
      });
    });
  }

  function persistFromCurrentDom(reason) {
    var pref = getCurrentDomPreference();
    setLocalView(pref);
    return persistPreference(pref, reason);
  }

  function wireUiListeners() {
    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target) return;

      if (target.closest("#" + VIEW_TOGGLE_ID)) {
        window.setTimeout(function () {
          if (suppressNextPersist) {
            suppressNextPersist = false;
            return;
          }
          persistFromCurrentDom("toggle-click");
        }, 0);
      }

      if (target.closest("#" + SAVE_BTN_ID)) {
        window.setTimeout(function () {
          persistFromCurrentDom("save-click");
        }, 0);
      }

      if (target.closest("#" + DONT_SAVE_BTN_ID)) {
        window.setTimeout(function () {
          // Align to default behavior when user opts out of saving.
          setLocalView("grid");
          persistPreference("grid", "dont-save-click");
        }, 0);
      }
    });
  }

  function waitForSearchViewElements(timeoutMs) {
    return new Promise(function (resolve) {
      var startedAt = Date.now();

      function check() {
        var els = getElements();
        if (els.col && els.toggleBtn) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }

        window.setTimeout(check, 100);
      }

      check();
    });
  }

  function init() {
    waitForSearchViewElements(5000).then(function (ready) {
      if (!ready) {
        return;
      }

      wireUiListeners();

      var localPref = normalizePreference(localStorage.getItem(LOCAL_VIEW_KEY));

      readPreferenceFromMetadata().then(function (remotePref) {
        var effectivePref = remotePref || localPref || "grid";

        syncDomToPreference(effectivePref, { useToggleClick: true });

        // Seed metadata if missing so default/grid is stored server-side.
        if (!remotePref) {
          persistPreference(effectivePref, "seed-default");
        }
      });
    });
  }

  // Optional helper for future integration points.
  window.syncUserViewPreference = function () {
    return persistFromCurrentDom("manual-sync");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
