/**
 * generate-collection-pages.js
 *
 * Generates two sets of static HTML files for GitHub Pages deployment:
 *
 *   index.html             — search page derived from search-section-preview.html
 *                            with all NTG-CDN asset refs replaced by local paths.
 *
 *   collection/<slug>.html — one page per collection, derived from
 *                            collection-page-preview.html + Coveo mock data.
 *
 * Run automatically as part of `npm run build`.
 *
 * Documents with raw.resourcedoctype === EXCLUDED_DOCTYPE ("Supporting document")
 * are filtered out during the collection map build step and do not appear on any
 * generated collection page. This mirrors the same exclusion applied at runtime
 * in coveo-search.js.
 */
"use strict";

var fs = require("fs");
var path = require("path");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Replaces NTG-intranet CDN asset references with local relative paths.
 * @param {string} html
 * @param {string} prefix  "./" for root (index.html), "../" for collection/* pages
 */
function rewriteVendorPaths(html, prefix) {
  var p = prefix;
  return (
    html
      // NTG Roboto font CSS
      .replace(
        'href="https://internal.nt.gov.au/cdn/fonts/roboto/roboto.css"',
        'href="' + p + 'src/vendor/css/roboto.css"',
      )
      // NTG main.css
      .replace(
        'href="https://internal.nt.gov.au/dcdd/_design/css/main.css"',
        'href="' + p + 'src/css/main.css"',
      )
      // NTG status-toolbar.css
      .replace(
        'href="https://internal.nt.gov.au/__data/assets/css_file/0010/566929/status-toolbar.css"',
        'href="' + p + 'src/css/status-toolbar.css"',
      )
      // jQuery
      .replace(
        'src="https://internal.nt.gov.au/__data/assets/js_file/0017/264320/jquery-3.4.1.min.js"',
        'src="' + p + 'src/vendor/js/jquery-3.4.1.min.js"',
      )
      // Fotorama CSS
      .replace(
        'href="https://internal.nt.gov.au/__data/assets/css_file/0009/386397/imageslider-fotorama.css"',
        'href="' + p + 'src/vendor/css/imageslider-fotorama.css"',
      )
      // Fotorama JS
      .replace(
        'src="https://internal.nt.gov.au/__data/assets/js_file/0010/386398/imageslider-fotorama.js"',
        'src="' + p + 'src/vendor/js/imageslider-fotorama.js"',
      )
      // auds.js
      .replace(
        'src="https://internal.nt.gov.au/__data/assets/js_file_folder/0020/264215/auds.js"',
        'src="' + p + 'src/vendor/js/auds.js"',
      )
      // ntg-central-update-user-profile.js
      .replace(
        'src="https://internal.nt.gov.au/_web_services/ntg-central-update-user-profile.js"',
        'src="' + p + 'src/vendor/js/ntg-central-update-user-profile.js"',
      )
      // jquery.tablesort.min.js
      .replace(
        'src="https://internal.nt.gov.au/__data/assets/js_file/0007/349657/jquery.tablesort.min.js"',
        'src="' + p + 'src/vendor/js/jquery.tablesort.min.js"',
      )
      // components.js
      .replace(
        'src="https://internal.nt.gov.au/__data/assets/js_file_folder/0016/305008/components.js"',
        'src="' + p + 'src/js/components.js"',
      )
      // global-v2.js
      .replace(
        'src="https://internal.nt.gov.au/__data/assets/js_file_folder/0009/738819/global-v2.js"',
        'src="' + p + 'src/js/global-v2.js"',
      )
      // profile-menu.js
      .replace(
        'src="https://internal.nt.gov.au/__data/assets/js_file/0004/453154/profile-menu.js"',
        'src="' + p + 'src/js/profile-menu.js"',
      )
      // status-toolbar.js
      .replace(
        'src="https://internal.nt.gov.au/__data/assets/js_file/0003/566931/status-toolbar.js"',
        'src="' + p + 'src/js/status-toolbar.js"',
      )
  );
}

// ---------------------------------------------------------------------------
// 1. Generate index.html from search-section-preview.html
// ---------------------------------------------------------------------------

var searchTemplate = fs.readFileSync("search-section-preview.html", "utf8");

var indexHtml = rewriteVendorPaths(searchTemplate, "./");

// Update page title
indexHtml = indexHtml.replace(
  "<title>Document search \u2014 Preview</title>",
  "<title>Document search \u2014 DCDD Policy Library</title>",
);

// Remove Google Analytics block (keep </head>)
indexHtml = indexHtml.replace(
  /\n    <script async="" src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[^"]*"><\/script>[\s\S]*?<\/script>\r?\n\r?\n\r?\n\r?\n\r?\n\r?\n(?=<\/head>)/,
  "\r\n\r\n",
);

fs.writeFileSync("index.html", indexHtml, "utf8");
console.log("Generated index.html");

// ---------------------------------------------------------------------------
// 2. Load mock data and build collection map
// ---------------------------------------------------------------------------

var mockData = JSON.parse(
  fs.readFileSync("src/mock/coveo-search-rest-api-query.json", "utf8"),
);

/**
 * Map<slug, { name: string, url: string, results: object[] }>
 * Keyed by the final path segment of collectionurl (the slug).
 */
var collections = new Map();

var EXCLUDED_DOCTYPE = "Supporting document";

for (var i = 0; i < mockData.results.length; i++) {
  var result = mockData.results[i];
  var raw = result.raw || {};

  // Skip supporting documents — excluded from both search results and collection pages
  if ((raw.resourcedoctype || "").trim() === EXCLUDED_DOCTYPE) continue;

  var name = (raw.collectionname || "").trim();
  var url = (raw.collectionurl || "").trim();

  if (!name || name === "none" || !url || url === "none") continue;

  var parts = url.split("/").filter(function (s) {
    return s.length > 0;
  });
  var slug = parts[parts.length - 1];
  if (!slug) continue;

  if (!collections.has(slug)) {
    collections.set(slug, { name: name, url: url, results: [] });
  }
  collections.get(slug).results.push(result);
}

// ---------------------------------------------------------------------------
// 3. Content-builder helpers
// ---------------------------------------------------------------------------

var FILE_TYPE_LABELS = {
  pdf_file: "PDF",
  word_doc: "DOCX",
  excel: "XLSX",
  powerpoint: "PPTX",
};

// Download arrow SVG (matches collection-page-preview.html icon)
var SVG_DOWNLOAD = [
  '<svg width="32" height="32" viewBox="0 0 32 32" fill="none"',
  ' xmlns="http://www.w3.org/2000/svg">',
  '<path d="M25.6667 29.3334C26.125 29.3334 26.5 28.9584 26.5 28.5001C26.5 28.0417',
  " 26.125 27.6667 25.6667 27.6667H7.33333C6.875 27.6667 6.5 28.0417 6.5 28.5001C6.5",
  " 28.9584 6.875 29.3334 7.33333 29.3334H25.6667ZM15.9115 22.422C16.2344 22.7449",
  " 16.7656 22.7449 17.0885 22.422L24.5885 14.922C24.9115 14.599 24.9115 14.0678",
  " 24.5885 13.7449C24.2656 13.422 23.7344 13.422 23.4115 13.7449L17.3333 19.823V3.50008C17.3333",
  " 3.04175 16.9583 2.66675 16.5 2.66675C16.0417 2.66675 15.6667 3.04175 15.6667",
  " 3.50008V19.823L9.58854 13.7449C9.26562 13.422 8.73438 13.422 8.41146 13.7449C8.08854",
  ' 14.0678 8.08854 14.599 8.41146 14.922L15.9115 22.422Z" fill="#208820"/>',
  "</svg>",
].join("");

function buildDocumentsHtml(results) {
  // Group results by resourcedoctype
  var byType = new Map();
  var typeOrd = [];
  for (var i = 0; i < results.length; i++) {
    var raw = results[i].raw || {};
    var doctype = (raw.resourcedoctype || "Document").trim();
    if (!byType.has(doctype)) {
      byType.set(doctype, []);
      typeOrd.push(doctype);
    }
    byType.get(doctype).push(results[i]);
  }

  var lines = [];
  for (var t = 0; t < typeOrd.length; t++) {
    var dtype = typeOrd[t];
    var items = byType.get(dtype);
    lines.push('                        <section class="policy-documents">');
    lines.push(
      '                            <h3 class="policy-documents__title">' +
        escHtml(dtype) +
        "</h3>",
    );
    for (var j = 0; j < items.length; j++) {
      var r = items[j].raw || {};
      var title = (r.resourcefriendlytitle || items[j].title || "").trim();
      var href = (r.asseturl || items[j].clickUri || "#").trim();
      var tlabel = FILE_TYPE_LABELS[r.resourcetype] || "";
      var size = (r.resourcefilesize || "").trim();
      var meta =
        tlabel && size
          ? " (" + tlabel + " " + size + ")"
          : tlabel
            ? " (" + tlabel + ")"
            : size
              ? " (" + size + ")"
              : "";
      lines.push('                            <div class="policy-document">');
      lines.push(
        '                                <a href="' + escHtml(href) + '">',
      );
      lines.push(
        '                                    <div class="policy-document__wrapper">',
      );
      lines.push(
        '                                        <div class="policy-document__icon">' +
          SVG_DOWNLOAD +
          "</div>",
      );
      lines.push(
        '                                        <div class="policy-document__details">',
      );
      lines.push(
        "                                            <h4>" +
          escHtml(title + meta) +
          "</h4>",
      );
      lines.push("                                        </div>");
      lines.push("                                    </div>");
      lines.push("                                </a>");
      lines.push("                            </div>");
    }
    lines.push("                        </section>");
  }
  return lines.join("\n");
}

function buildRelatedPoliciesHtml(currentSlug) {
  var others = [];
  collections.forEach(function (col, slug) {
    if (slug !== currentSlug) others.push([slug, col]);
  });
  if (!others.length) return "";

  var cards = others
    .map(function (pair) {
      var slug = pair[0];
      var col = pair[1];
      return [
        '                        <a href="' + escHtml(slug) + '.html">',
        '                            <div class="col-12 col-md-6 col-lg-4">',
        '                                <div class="related-policy">',
        '                                    <h3 class="related-policy__title">' +
          escHtml(col.name) +
          "</h3>",
        '                                    <p class="related-policy__description"></p>',
        "                                </div>",
        "                            </div>",
        "                        </a>",
      ].join("\n");
    })
    .join("\n");

  return [
    '            <section class="related-policies">',
    '                <div class="container ntgc-pt-48 ntgc-pb-48">',
    '                    <h2 class="related-policies__title">Related policies</h2>',
    '                    <div class="row">',
    cards,
    "                    </div>",
    "                </div>",
    "            </section>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 4. Generate collection pages
// ---------------------------------------------------------------------------

var colTemplate = fs.readFileSync("collection-page-preview.html", "utf8");
fs.mkdirSync("collection", { recursive: true });

collections.forEach(function (col, slug) {
  var html = rewriteVendorPaths(colTemplate, "../");

  // Fix dist paths (collection/ is one level down from root)
  html = html.replace(
    'href="./dist/collection-page.css"',
    'href="../dist/collection-page.css"',
  );

  // Update page title
  html = html.replace(
    /<title>[^<]*<\/title>/,
    "<title>" + escHtml(col.name) + " \u2014 DCDD Policy Library</title>",
  );

  // Replace entire content area (from <div id="content"> to footer comment)
  var contentStart = html.indexOf('<div id="content" class="ntgc-body">');
  var contentEnd = html.indexOf("<!--coveo_no_index_start_90-->");
  if (contentStart === -1 || contentEnd === -1) {
    console.error("ERROR: Could not find content markers for " + slug);
    return;
  }

  var docsHtml = buildDocumentsHtml(col.results);
  var relatedHtml = buildRelatedPoliciesHtml(slug);

  var newContent = [
    '<div id="content" class="ntgc-body">',
    "        <main>",
    '            <div class="container ntgc-pt-48 ntgc-pb-48">',
    '                <div class="row">',
    '                    <div class="col-12 col-md-8">',
    '                        <a class="back-to-search"',
    '                            href="../index.html"',
    '                            onclick="if(history.length>1){history.back();return false;}">',
    '                            <span class="fa-light fa-arrow-left"> </span> Back to search results',
    "                        </a>",
    "                        <h2>" + escHtml(col.name) + "</h2>",
    "",
    docsHtml,
    "",
    "                    </div>",
    '                    <div class="col-12 col-md-3 offset-md-1">',
    "                    </div>",
    "                </div>",
    "            </div>",
    relatedHtml,
    "        </main>",
    '        <script src="../dist/collection-page.js"></script>',
    "    </div>",
    "    ",
  ].join("\n");

  html = html.slice(0, contentStart) + newContent + html.slice(contentEnd);

  var outPath = path.join("collection", slug + ".html");
  fs.writeFileSync(outPath, html, "utf8");
  console.log("Generated " + outPath + " (" + col.results.length + " docs)");
});

console.log(
  "\nDone. " + collections.size + " collection pages + index.html written.",
);
