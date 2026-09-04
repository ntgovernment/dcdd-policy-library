/**
 * search-page.js — DCDD Document Search: Vite bundle entry point
 *
 * ── BUILD ─────────────────────────────────────────────────────────────────────
 *   npm run build
 *     → dist/search-page.js   IIFE script (all search JS)
 *     → dist/search-page.css  all search CSS
 *
 * ── DEPLOYMENT ───────────────────────────────────────────────────────────────
 *   Both dist/ files are committed to git. Git File Bridge syncs them into
 *   Squiz Matrix automatically on push. Do NOT add dist/ to .gitignore.
 *   The Matrix paint layout references:
 *     <script src="...\/dist\/search-page.js"><\/script>
 *     <link rel="stylesheet" href="...\/dist\/search-page.css">
 *
 * ── BUNDLE FORMAT ────────────────────────────────────────────────────────────
 *   IIFE — runs as a plain <script> tag, no module loader required.
 *   jQuery must already be on the page before this script executes.
 *
 * ── ADDING FILES ─────────────────────────────────────────────────────────────
 *   Add an import statement below, run npm run build, then commit
 *   both src/ and dist/ changes together.
 */

// ── Search CSS ────────────────────────────────────────────────────────────────
import "./css/search-widget.css";

// ── Search JS ─────────────────────────────────────────────────────────────────
import "./js/view-preference-metadata-patch.js";
import "./js/coveo-search.js";
