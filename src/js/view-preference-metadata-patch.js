/*
 * view-preference-metadata-patch.js
 *
 * Standalone patch to persist the search view preference (grid/table)
 * into user metadata field #969752 while retaining docSearchView local cache.
 *
 * Canonical metadata values:
 * - table (default)
 * - grid
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
  var METADATA_READ_TIMEOUT_MS = 1500;

  var lastPersistedPreference = null;
  var listenersWired = false;

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
    var bodyUserId = document.body
      ? document.body.getAttribute("data-user")
      : "";
    return localStorage.getItem(LOCAL_USER_ID_KEY) || bodyUserId || "";
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
      var settled = false;
      var timeoutId;
      var retryId;

      function finish(preference) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        window.clearTimeout(retryId);
        resolve(preference);
      }

      timeoutId = window.setTimeout(function () {
        finish(null);
      }, METADATA_READ_TIMEOUT_MS);

      function startReadWhenReady() {
        api = getApiInstance();
        userAssetId = getUserAssetId();

        if (!api || !userAssetId) {
          retryId = window.setTimeout(startReadWhenReady, 50);
          return;
        }

        api.getMetadata({
          asset_id: userAssetId,
          dataCallback: function (response) {
            if (response && response.error) {
              console.error("[view-pref] getMetadata failed", response);
              finish(null);
              return;
            }
            finish(parsePreferenceFromMetadataResponse(response));
          },
          errorCallback: function (err) {
            console.error("[view-pref] getMetadata request error", err);
            finish(null);
          },
        });
      }

      startReadWhenReady();
    });
  }

  function persistFromCurrentDom(reason) {
    var pref = getCurrentDomPreference();
    setLocalView(pref);
    return persistPreference(pref, reason);
  }

  function wireUiListeners() {
    if (listenersWired) return;
    listenersWired = true;

    document.addEventListener("click", function (event) {
      var target = event.target;
      if (!target) return;

      if (target.closest("#" + VIEW_TOGGLE_ID)) {
        window.setTimeout(function () {
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
          setLocalView("table");
          persistPreference("table", "dont-save-click");
        }, 0);
      }
    });
  }

  function getLocalPreference() {
    var value = localStorage.getItem(LOCAL_VIEW_KEY);
    return value === "table" || value === "card"
      ? viewToPreference(value)
      : null;
  }

  function resolveInitialPreference() {
    var localPref = getLocalPreference();

    return readPreferenceFromMetadata().then(function (remotePref) {
      var effectivePref = remotePref || localPref || "table";

      if (remotePref) {
        lastPersistedPreference = remotePref;
      } else {
        persistPreference(effectivePref, "seed-default");
      }

      setLocalView(effectivePref);
      return preferenceToView(effectivePref);
    });
  }

  // Optional helper for future integration points.
  window.syncUserViewPreference = function () {
    return persistFromCurrentDom("manual-sync");
  };

  wireUiListeners();
  window.docSearchViewPreferenceReady = resolveInitialPreference();

})();
