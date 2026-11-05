// Shared engine for "book" entries: a scrapbook spread across the pages of a
// book that turns like a real one, via turn.js (vendored under ./vendor/
// along with the jQuery it needs, and only loaded once a book is actually
// opened). Lives in its own file rather than app.js because three different
// pages use it — the editor and the live /view/<id> preview (both app.js)
// and every static GitHub Pages entry page (scripts/static-site/static.js,
// which has none of app.js's globals) — so nothing here touches `state`,
// el(), or either file's item-card builders; those are passed in.
//
// Data model: a book entry keeps the exact same flat `items` array every
// other entry has — each item just also carries `page` (an index into
// entry.pages), and its x/y are percentages of that page's fixed
// BOOK_PAGE_W x BOOK_PAGE_H logical size rather than of the canvas. Pages
// are always rendered at that logical size and scaled as a whole to fit the
// screen, so an item sits in exactly the same spot on a laptop and a phone.
// entry.pages holds each page's background ({bg, bgImage}) and its length is
// the page count — always even, so the back cover closes on the left like a
// real book. The first and last two pages are the hard covers and their
// insides.
//
// An item hanging past its page's edge is either cut off at the edge (the
// default — see bookItemClipPath) or, with item.overflow === "out", left
// sticking out. A sticking-out item shows whole while its page is open;
// while that page is anywhere else in the closed stack, a static copy is
// drawn *behind* the book (the "tabs" layer) wherever that page physically
// lies, so the book's own pages hide everything except the part past the
// edge — a bookmark poking out of a real book. Clicking it opens its page.

const BOOK_PAGE_W = 440;
const BOOK_PAGE_H = 600;
const BOOK_DEFAULT_PAGE_COUNT = 8; // 2 covers + 2 insides + 4 blank pages
const BOOK_MIN_PAGE_COUNT = 6; // ...and never fewer than 2 blank pages
// How far an item's center may sit past its page's edges, as a % of the
// page — enough to stick well out like a bookmark, not enough to lose it.
const BOOK_ITEM_MIN = -45;
const BOOK_ITEM_MAX = 145;
const BOOK_MAX_SCALE = 1.3;
const BOOK_TAB_ROOM = 28; // px kept free on each side of the book (see computeLayout)

// Resolved against this script's own URL, so it's right both in the live app
// (/book.js -> /vendor/) and on a static entry page (../../book.js ->
// ../../vendor/) without either caller having to say where it lives.
const BOOK_VENDOR_BASE = new URL("vendor/", document.currentScript.src).href;

/** @param {number} [count] @returns {object[]} A fresh, all-blank entry.pages array. */
function bookNewPages(count = BOOK_DEFAULT_PAGE_COUNT) {
  return Array.from({ length: count }, () => ({}));
}

/** @param {number} index @param {number} count @returns {boolean} Covers and their insides are stiff board. */
function bookIsHardPage(index, count) {
  return index <= 1 || index >= count - 2;
}

/**
 * @param {number} index
 * @param {number} count
 * @returns {string} Class names for a page element of that kind: "hard" (the
 *   stiff-board pages, which turn.js turns rigidly) plus "book-endpaper"
 *   for the papered insides of the covers.
 */
function bookPageClasses(index, count) {
  if (index === 1 || index === count - 2) return " hard book-endpaper";
  return bookIsHardPage(index, count) ? " hard" : "";
}

/**
 * @param {object} item
 * @param {number} count - The book's page count.
 * @returns {number} The item's page index, clamped into range (a missing or
 *   hand-edited `page` lands on the cover rather than nowhere).
 */
function bookPageOf(item, count) {
  const page = Math.round(Number(item.page) || 0);
  return Math.min(count - 1, Math.max(0, page));
}

/** @param {number} index @param {number} count @returns {string} e.g. "Front cover", "p. 3". */
function bookPageName(index, count) {
  if (index === 0) return "Front cover";
  if (index === 1) return "Inside cover";
  if (index === count - 2) return "Inside back cover";
  if (index === count - 1) return "Back cover";
  return `p. ${index - 1}`;
}

/**
 * Apply one entry.pages[] record's background to a page element — same
 * color-or-image rules as the editor's applyCanvasBackground.
 * @param {HTMLElement} pageEl
 * @param {{bg?: string, bgImage?: string}|undefined} page
 */
function bookApplyPageBackground(pageEl, page) {
  const bg = page && page.bg;
  const bgImage = page && page.bgImage;
  pageEl.style.backgroundColor = bg || "";
  pageEl.style.backgroundImage = bgImage ? `url("${bgImage}")` : bg ? "none" : "";
  pageEl.style.backgroundSize = bgImage ? "cover" : "";
  pageEl.style.backgroundPosition = bgImage ? "center" : "";
  pageEl.classList.toggle("custom-bg", !!(bg || bgImage));
}

/**
 * The clip-path that cuts an item off at its page's edges. It's set on the
 * item's wrap, so it's expressed in the wrap's own (unrotated) coordinates:
 * the page rectangle's four corners, rotated back by the item's rotation
 * around its center. Every point is an offset from the wrap's 50%/50%
 * center, so it stays right however tall the item's content turns out to
 * be (a photo still loading, a note being typed into) — nothing has to be
 * measured, and nothing has to be recomputed when its size changes.
 * @param {object} item
 * @returns {string}
 */
function bookItemClipPath(item) {
  const cx = (item.x / 100) * BOOK_PAGE_W;
  const cy = (item.y / 100) * BOOK_PAGE_H;
  const rad = ((item.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    [0, 0],
    [BOOK_PAGE_W, 0],
    [BOOK_PAGE_W, BOOK_PAGE_H],
    [0, BOOK_PAGE_H],
  ];
  const points = corners.map(([px, py]) => {
    const dx = px - cx;
    const dy = py - cy;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    return `calc(50% + ${lx.toFixed(1)}px) calc(50% + ${ly.toFixed(1)}px)`;
  });
  return `polygon(${points.join(", ")})`;
}

/**
 * @param {object} item
 * @param {HTMLElement} wrap - The item's rendered `.sb-item`, laid out (its
 *   offsetWidth/offsetHeight are read).
 * @returns {boolean} Whether any corner of the item pokes past its page.
 */
function bookItemOverflowsPage(item, wrap) {
  const w = wrap.offsetWidth;
  const h = wrap.offsetHeight;
  if (!w || !h) return false;
  const cx = (item.x / 100) * BOOK_PAGE_W;
  const cy = (item.y / 100) * BOOK_PAGE_H;
  const rad = ((item.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].some(([lx, ly]) => {
    const px = cx + lx * cos - ly * sin;
    const py = cy + lx * sin + ly * cos;
    return px < -0.5 || px > BOOK_PAGE_W + 0.5 || py < -0.5 || py > BOOK_PAGE_H + 0.5;
  });
}

/**
 * Build a static, non-interactive item for a book page — the book version
 * of renderReadOnlyCanvas's per-item loop (same washi/card structure), used
 * for the published book's pages, its bookmark tabs, and the image export.
 * @param {object} item
 * @param {(item: object) => HTMLElement} cardBuilder
 * @param {{mirrored?: boolean, clip?: boolean, flipContent?: boolean}} [opts] -
 *   `mirrored` places it as seen on a page lying face-down (see
 *   renderTabs); `clip: false` skips the cut-at-the-edge clip-path even for
 *   an item that has one; `flipContent` draws it mirror-imaged (for a layer
 *   that's about to be mirrored again — see the turning-page flight).
 * @returns {HTMLElement}
 */
function bookBuildStaticWrap(item, cardBuilder, { mirrored = false, clip = true, flipContent = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "sb-item readonly-item";
  wrap.dataset.id = item.id;
  wrap.style.left = `${mirrored ? 100 - item.x : item.x}%`;
  wrap.style.top = `${item.y}%`;
  wrap.style.width = `${item.w}px`;
  wrap.style.zIndex = item.z;
  wrap.style.transform = `translate(-50%, -50%) rotate(${mirrored ? -item.rot : item.rot}deg)${flipContent ? " scaleX(-1)" : ""}`;
  if (clip && item.overflow !== "out") wrap.style.clipPath = bookItemClipPath(item);

  if (item.type !== "text" && item.type !== "tape" && !(item.type === "photo" && item.tape === false)) {
    const washi = document.createElement("div");
    washi.className = "washi";
    washi.style.background = item.color;
    wrap.appendChild(washi);
  }
  wrap.appendChild(cardBuilder(item));

  // turn.js starts a page curl on any mousedown/touchstart near a page
  // corner (and cancels its default, which would eat the click) — a music
  // player's buttons sitting near a corner have to keep working.
  if (item.type === "youtube") {
    for (const type of ["mousedown", "touchstart"]) wrap.addEventListener(type, (e) => e.stopPropagation());
  }
  return wrap;
}

// ---------- turning-page geometry ----------
// A soft page turn in turn.js is a paper fold: the dragged corner C has moved
// to point P, the fold line is the perpendicular bisector of C and P, and the
// flap is everything past that line reflected across it. These work it out
// in a page's own coordinates, for the flight layer (see startFlight).

const BOOK_FAR = 5000; // "infinitely" far, for half-plane polygons

/**
 * @param {string} corner - turn.js's "tl" | "tr" | "bl" | "br".
 * @param {{x: number, y: number}} point - Where that corner has been dragged to.
 * @returns {{n: {x: number, y: number}, m: {x: number, y: number}}|null} The
 *   fold line as a unit normal `n` (pointing away from the corner) through
 *   midpoint `m`, or null while nothing's folded yet.
 */
function bookFoldLine(corner, point) {
  const c = { x: corner.includes("r") ? BOOK_PAGE_W : 0, y: corner.includes("b") ? BOOK_PAGE_H : 0 };
  const dx = point.x - c.x;
  const dy = point.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return null;
  return { n: { x: dx / len, y: dy / len }, m: { x: (c.x + point.x) / 2, y: (c.y + point.y) / 2 } };
}

/** @param {object} fold - From bookFoldLine. @param {{x: number, y: number}} v @returns {number} <0 on the corner's (folding) side. */
function bookFoldSide(fold, v) {
  return (v.x - fold.m.x) * fold.n.x + (v.y - fold.m.y) * fold.n.y;
}

/** @param {object} fold @param {{x: number, y: number}} v @returns {{x: number, y: number}} v reflected across the fold line. */
function bookReflect(fold, v) {
  const d = 2 * bookFoldSide(fold, v);
  return { x: v.x - d * fold.n.x, y: v.y - d * fold.n.y };
}

/**
 * @param {object} fold
 * @param {number} side - +1 for the side staying flat, -1 for the folding side.
 * @returns {{x: number, y: number}[]} That half-plane, as a huge quad.
 */
function bookHalfPlane(fold, side) {
  const { n, m } = fold;
  const d = { x: -n.y, y: n.x };
  const a = { x: m.x + d.x * BOOK_FAR, y: m.y + d.y * BOOK_FAR };
  const b = { x: m.x - d.x * BOOK_FAR, y: m.y - d.y * BOOK_FAR };
  return [a, b, { x: b.x + side * n.x * BOOK_FAR, y: b.y + side * n.y * BOOK_FAR }, { x: a.x + side * n.x * BOOK_FAR, y: a.y + side * n.y * BOOK_FAR }];
}

/**
 * @param {object} fold
 * @returns {{x: number, y: number}[]} The flap: the part of the page past
 *   the fold line, reflected over onto the flat side (empty if none).
 */
function bookFlapPolygon(fold) {
  const rect = [
    { x: 0, y: 0 },
    { x: BOOK_PAGE_W, y: 0 },
    { x: BOOK_PAGE_W, y: BOOK_PAGE_H },
    { x: 0, y: BOOK_PAGE_H },
  ];
  const out = [];
  rect.forEach((a, i) => {
    const b = rect[(i + 1) % rect.length];
    const sa = bookFoldSide(fold, a);
    const sb = bookFoldSide(fold, b);
    if (sa <= 0) out.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  });
  return out.map((v) => bookReflect(fold, v));
}

/**
 * @param {{x: number, y: number}[][]} rings - First ring is the outline;
 *   any later ones are holes cut out of it (even-odd fill).
 * @returns {string} A CSS clip-path polygon().
 */
function bookPolygonCss(rings) {
  const pts = [];
  for (const ring of rings) {
    if (!ring.length) continue;
    for (const v of [...ring, ring[0]]) pts.push(`${v.x.toFixed(1)}px ${v.y.toFixed(1)}px`);
  }
  return `polygon(evenodd, ${pts.join(", ")})`;
}

// Everything around a page but not the page itself — where an item's back
// (or one on the page underneath) can show past the paper's edge.
const BOOK_OUTSIDE_PAGE_CLIP = bookPolygonCss([
  [
    { x: -BOOK_FAR, y: -BOOK_FAR },
    { x: BOOK_FAR, y: -BOOK_FAR },
    { x: BOOK_FAR, y: BOOK_FAR },
    { x: -BOOK_FAR, y: BOOK_FAR },
  ],
  [
    { x: 0, y: 0 },
    { x: 0, y: BOOK_PAGE_H },
    { x: BOOK_PAGE_W, y: BOOK_PAGE_H },
    { x: BOOK_PAGE_W, y: 0 },
  ],
]);

// ---------- turning-page shading ----------
// Mid-turn, turn.js shades the page being revealed underneath the turning
// one — a flat translucent black under a stiff cover, a moving gradient band
// (the curl's shadow) under a soft page — fading to nothing as the page
// lands. That shading stops at the paper's edge, so these read how dark it
// is at a given spot on the page, for book.js to darken the sticking-out
// part of an item there by the same amount (see shadeRevealed).

/** @param {string} rgba - "rgba(0, 0, 0, 0.3)" or its comma list. @returns {number} Its alpha. */
function bookCssAlpha(rgba) {
  const parts = String(rgba).replace(/^rgba?\(|\)$/g, "").split(",");
  return parts.length > 3 ? Number(parts[3]) || 0 : 0;
}

/**
 * How dark turn.js's gradient is at one spot — it writes either the old
 * `-webkit-gradient(linear, x1% y1%, x2% y2%, color-stop(...))` form or a
 * standard `linear-gradient(<angle>rad, <color> <pos>%, ...)`, depending on
 * the browser.
 * @param {string} css - The shade element's background-image.
 * @param {number} fx - Spot, as a fraction of the element's width...
 * @param {number} fy - ...and height.
 * @param {number} w - Element size, px.
 * @param {number} h
 * @returns {number} The black overlay's alpha there.
 */
function bookGradientAlphaAt(css, fx, fy, w, h) {
  if (!css || css === "none" || !w || !h) return 0;
  const stops = [];
  let t;
  const webkit = /-webkit-gradient\(\s*linear\s*,\s*([-\d.e]+)%\s+([-\d.e]+)%\s*,\s*([-\d.e]+)%\s+([-\d.e]+)%/.exec(css);
  if (webkit) {
    for (const m of css.matchAll(/color-stop\(\s*([-\d.e]+)\s*,\s*(rgba?\([^)]*\))\s*\)/g)) stops.push([Number(m[1]), bookCssAlpha(m[2])]);
    const [x1, y1, x2, y2] = webkit.slice(1).map(Number);
    const ax = (x1 / 100) * w;
    const ay = (y1 / 100) * h;
    const dx = ((x2 - x1) / 100) * w;
    const dy = ((y2 - y1) / 100) * h;
    const len2 = dx * dx + dy * dy;
    if (!len2) return 0;
    t = ((fx * w - ax) * dx + (fy * h - ay) * dy) / len2;
  } else {
    const lin = /linear-gradient\(\s*([-\d.e]+)rad\s*,(.*)\)\s*$/.exec(css);
    if (!lin) return 0;
    for (const m of lin[2].matchAll(/(rgba?\([^)]*\))\s+([-\d.e]+)%/g)) stops.push([Number(m[2]) / 100, bookCssAlpha(m[1])]);
    const angle = Number(lin[1]);
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const len = Math.abs(w * sin) + Math.abs(h * cos);
    if (!len) return 0;
    t = ((fx * w - w / 2) * sin - (fy * h - h / 2) * cos) / len + 0.5;
  }
  if (!stops.length) return 0;
  stops.sort((a, b) => a[0] - b[0]);
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, a1] = stops[i];
    const [p0, a0] = stops[i - 1];
    if (t <= p1) return p1 === p0 ? a1 : a0 + ((a1 - a0) * (t - p0)) / (p1 - p0);
  }
  return stops[stops.length - 1][1];
}

/**
 * @param {object} f - The turning page's turn.js flip data.
 * @param {object} item - An item on the page being revealed underneath it.
 * @returns {number} How dark turn.js is shading that page right now (black
 *   overlay alpha), where the item meets the page's edge.
 */
function bookTurnShadeAt(f, item) {
  if (f.effect === "hard") {
    // One flat shade, over whichever side the cover isn't — only this page
    // while it sits at the page's own spot (left: 0).
    const shade = f.ashadow && f.ashadow[0];
    if (!shade || shade.style.display === "none" || parseFloat(shade.style.left || "0") !== 0) return 0;
    return bookCssAlpha(shade.style.backgroundColor);
  }
  const shade = f.bshadow && f.bshadow[0];
  if (!shade || !shade.isConnected || shade.style.display === "none") return 0;
  const fx = Math.min(1, Math.max(0, item.x / 100));
  const fy = Math.min(1, Math.max(0, item.y / 100));
  const opacity = shade.style.opacity === "" ? 1 : Number(shade.style.opacity);
  return bookGradientAlphaAt(shade.style.backgroundImage, fx, fy, shade.offsetWidth, shade.offsetHeight) * opacity;
}

let bookLibsPromise = null; // memoized so jQuery/turn.js are only ever fetched once

/** @param {string} name @returns {Promise<void>} */
function bookLoadScript(name) {
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = BOOK_VENDOR_BASE + name;
    tag.onload = () => resolve();
    tag.onerror = () => reject(new Error(`Couldn't load ${name}.`));
    document.head.appendChild(tag);
  });
}

/** @returns {Promise<void>} Resolves once jQuery and turn.js are both ready. */
function bookLoadLibs() {
  if (!bookLibsPromise) {
    bookLibsPromise = bookLoadScript("jquery.js")
      .then(() => bookLoadScript("turn.js"))
      .catch((err) => {
        bookLibsPromise = null; // let a later book try again
        throw err;
      });
  }
  return bookLibsPromise;
}

/**
 * Build a book into `host`: the turning pages, the bookmark-tabs layer
 * behind them, and a prev/next nav row underneath. Each page's content goes
 * in a persistent "inner" element (pageInner(i)) at the fixed logical page
 * size, scaled to fit; those survive turn.js being torn down and rebuilt
 * (window resized between one- and two-page display, page count changed),
 * so whatever a caller put in them stays put.
 *
 * At rest, turn.js's page wrappers (normally overflow: hidden, which is how
 * it draws a page fold) are opened up so sticking-out items on the open
 * pages show whole, and the pages under them are hidden so their own items
 * don't poke through (their tab copies stand in for them). Any fold or turn
 * puts all that back first, since the fold relies on the clipping.
 * @param {HTMLElement} host - Must be visible (laid out) when this runs.
 * @param {object} opts
 * @param {number} opts.pageCount
 * @param {number} [opts.startPage] - Page index to open at (default: closed, on the front cover).
 * @param {boolean} [opts.editing] - The editor's book: page-corner dragging
 *   is switched off (it would fight item dragging) — the nav buttons, arrow
 *   keys, and bookmark tabs still turn pages.
 * @param {(pageEl: HTMLElement, index: number) => void} opts.decoratePage - Sets a page's background.
 * @param {() => object[]} opts.getItems - For the bookmark tabs.
 * @param {(item: object) => HTMLElement} opts.tabCardBuilder - A static card, for the bookmark tabs.
 * @param {() => number} [opts.availableHeight] - Max height (px) the book may take.
 * @param {() => void} [opts.onSettle] - Called whenever the book comes to rest.
 */
function bookCreate(host, opts) {
  const editing = !!opts.editing;
  let pageCount = opts.pageCount;
  let inners = makeInners(pageCount);
  let currentPage = opts.startPage || 0; // remembered across rebuilds
  let pageEls = [];
  let flipEl = null;
  let $flip = null;
  let display = "double";
  let scale = 1;
  let raisedPage = null;
  let settleFrame = 0;
  let resizeTimer = null;
  let destroyed = false;

  host.innerHTML = "";
  host.classList.add("book-host");
  const stage = document.createElement("div");
  stage.className = "book-stage";
  // The book's drop shadow on the "desk" — drawn under the bookmark tabs
  // (turn.js's own would fall across them, making a bookmark's tip look
  // darker than the rest of it — see syncShadow).
  const shadowEl = document.createElement("div");
  shadowEl.className = "book-shadow";
  const tabsEl = document.createElement("div");
  tabsEl.className = "book-tabs";
  stage.append(shadowEl, tabsEl);
  // Above the book: sticking-out items on a page that's mid-turn, moving
  // with it (see startFlight).
  const flightEl = document.createElement("div");
  flightEl.className = "book-flight";
  // One per leaf in motion, by its front page (see leafOf).
  const flights = new Map();
  let flightFrame = 0;

  const nav = document.createElement("div");
  nav.className = "book-nav";
  const prevBtn = document.createElement("button");
  prevBtn.className = "btn book-nav-btn";
  prevBtn.textContent = "‹";
  prevBtn.title = "Previous page (←)";
  const label = document.createElement("span");
  label.className = "book-nav-label diary-date";
  label.textContent = "Opening the book…";
  const nextBtn = document.createElement("button");
  nextBtn.className = "btn book-nav-btn";
  nextBtn.textContent = "›";
  nextBtn.title = "Next page (→)";
  const navExtras = document.createElement("span");
  navExtras.className = "book-nav-extras";
  nav.append(prevBtn, label, nextBtn, navExtras);
  host.append(stage, nav);
  prevBtn.addEventListener("click", () => prev());
  nextBtn.addEventListener("click", () => next());

  /** @param {number} n @returns {HTMLElement[]} */
  function makeInners(n) {
    return Array.from({ length: n }, () => {
      const inner = document.createElement("div");
      inner.className = "book-page-inner";
      return inner;
    });
  }

  /**
   * Two pages side by side whenever that's still a comfortable size (or no
   * smaller than one page alone would be anyway), otherwise one at a time —
   * phones, and narrow portrait windows.
   * @returns {{display: "double"|"single", scale: number}}
   */
  function computeLayout() {
    // Side room for bookmarks to stick out into — mostly matters on a phone,
    // where the page would otherwise run edge to edge and hide them.
    const availW = Math.max(160, host.clientWidth - 32 - 2 * BOOK_TAB_ROOM);
    // By default: the window's height below wherever the book starts (under
    // a toolbar, which may wrap to several rows on a phone), less room for
    // the page nav and padding.
    const hostTop = host.getBoundingClientRect().top + window.scrollY;
    const availH = Math.max(220, opts.availableHeight ? opts.availableHeight() : window.innerHeight - hostTop - 120);
    const singleScale = Math.min(BOOK_MAX_SCALE, availW / BOOK_PAGE_W, availH / BOOK_PAGE_H);
    const doubleScale = Math.min(BOOK_MAX_SCALE, availW / (2 * BOOK_PAGE_W), availH / BOOK_PAGE_H);
    const useDouble = doubleScale >= 0.6 || doubleScale >= 0.75 * singleScale;
    return { display: useDouble ? "double" : "single", scale: useDouble ? doubleScale : singleScale };
  }

  /** @returns {{bookW: number, pageH: number}} turn.js's own size for the book, in real px. */
  function applySizes() {
    const pageW = Math.floor(BOOK_PAGE_W * scale);
    const pageH = Math.floor(BOOK_PAGE_H * scale);
    scale = pageW / BOOK_PAGE_W; // exact, so drag math matches what's drawn
    const bookW = display === "double" ? pageW * 2 : pageW;
    stage.style.width = `${bookW}px`;
    stage.style.height = `${pageH}px`;
    const transform = `scale(${scale}, ${pageH / BOOK_PAGE_H})`;
    for (const inner of inners) inner.style.transform = transform;
    tabsEl.style.width = `${display === "double" ? BOOK_PAGE_W * 2 : BOOK_PAGE_W}px`;
    tabsEl.style.height = `${BOOK_PAGE_H}px`;
    tabsEl.style.transform = transform;
    flightEl.style.width = tabsEl.style.width;
    flightEl.style.height = tabsEl.style.height;
    flightEl.style.transform = transform;
    return { bookW, pageH };
  }

  /** @param {number} tp - turn.js page number (1-based). @returns {HTMLElement|null} */
  function wrapperFor(tp) {
    return flipEl ? flipEl.querySelector(`.page-wrapper[page="${tp}"]`) : null;
  }

  function teardownTurn() {
    cancelAnimationFrame(settleFrame);
    endAllFlights();
    if ($flip) {
      try {
        $flip.turn("destroy");
      } catch {
        /* turn.js can throw tearing down mid-animation — its DOM goes either way */
      }
    }
    if (flipEl) flipEl.remove();
    $flip = null;
    flipEl = null;
    pageEls = [];
  }

  /** (Re)build turn.js over fresh page elements holding the persistent inners. */
  function mount() {
    if (destroyed || !window.jQuery || !jQuery.fn.turn) return;
    teardownTurn();
    ({ display, scale } = computeLayout());
    const { bookW, pageH } = applySizes();
    flipEl = document.createElement("div");
    flipEl.className = "book-flip";
    pageEls = inners.map((inner, i) => {
      const pageEl = document.createElement("div");
      pageEl.className = "book-page" + bookPageClasses(i, pageCount);
      pageEl.appendChild(inner);
      opts.decoratePage(pageEl, i);
      flipEl.appendChild(pageEl);
      return pageEl;
    });
    stage.appendChild(flipEl);
    stage.appendChild(flightEl); // after the book, so it draws on top
    $flip = jQuery(flipEl).turn({
      width: bookW,
      height: pageH,
      display,
      page: Math.min(pageCount, currentPage + 1),
      autoCenter: true,
      gradients: true,
      acceleration: true,
      when: {
        turning: (e, tp) => {
          currentPage = tp - 1;
          unsettle();
          // autoCenter re-centers (a closed book sits in the middle, an open
          // one doesn't) right after this event — follow it with the tabs.
          requestAnimationFrame(syncShadow);
        },
        turned: (e, tp) => {
          currentPage = tp - 1;
          scheduleSettle();
        },
        start: (e, pageOpts) => onFoldStart(pageOpts),
        end: (e, pageOpts) => {
          if (pageOpts) onLeafEnded(pageOpts);
          scheduleSettle();
        },
      },
    });
    if (editing) $flip.turn("disable", true);
    scheduleSettle();
  }

  /**
   * A corner is being curled (hover or drag, viewer only): put back the
   * clipping the fold depends on for just the two page sides involved, and
   * let the page underneath show its content as it's revealed.
   * @param {{page: number, next: number}} pageOpts
   */
  function onFoldStart(pageOpts) {
    for (const pageEl of pageEls) pageEl.classList.remove("book-page-hidden");
    for (const tp of [pageOpts.page, pageOpts.next]) {
      const wrapper = wrapperFor(tp);
      if (wrapper) wrapper.classList.remove("book-open-edge", "book-raised");
    }
    startFlight(pageOpts);
  }

  /**
   * @param {number} tp - turn.js page number.
   * @returns {number} The leaf it's printed on, by that leaf's front page.
   */
  function leafOf(tp) {
    return display === "double" && tp % 2 === 0 ? tp - 1 : tp;
  }

  /**
   * One leaf has stopped moving. Flipping quickly, that's not the end of
   * it: turn.js snaps a leaf that's still turning straight to where it
   * lands as soon as the next turn starts. So its sticking-out items go
   * back to being bookmark tabs right away, on whichever side it ended up
   * — not left showing where it used to lie until the book comes to rest.
   * @param {{page: number, next: number}} pageOpts
   */
  function onLeafEnded(pageOpts) {
    endFlight(leafOf(pageOpts.page));
    renderTabs();
    updateNav();
  }

  /**
   * A full page turn is starting: let the pages it'll reveal show their
   * content. Only the turning leaf's own page edges close back up (in
   * onFoldStart) — the facing page stays open, so what sticks out of it
   * stays in view the whole time.
   */
  function unsettle() {
    cancelAnimationFrame(settleFrame);
    for (const pageEl of pageEls) pageEl.classList.remove("book-page-hidden");
    if (flipEl) flipEl.querySelectorAll(".page-wrapper.book-raised").forEach((w) => w.classList.remove("book-raised"));
  }

  /**
   * Static copies of items for the flight layer, as one stacked group.
   * @param {object[]} items
   * @param {{mirrored?: boolean, flipContent?: boolean, back?: boolean, reflected?: boolean}} how -
   *   `back` draws each item's back (see .book-item-back) instead of its
   *   front; `reflected` marks a layer that gets mirrored by the fold.
   * @returns {HTMLElement}
   */
  function flightGroup(items, how) {
    const group = document.createElement("div");
    group.className = "book-flight-group";
    for (const item of items) {
      const wrap = bookBuildStaticWrap(item, opts.tabCardBuilder, { mirrored: how.mirrored, flipContent: how.flipContent, clip: false });
      if (how.back) wrap.classList.add("book-item-back");
      if (how.reflected) wrap.classList.add("book-item-reflected");
      group.appendChild(wrap);
    }
    return group;
  }

  /**
   * One side of a turning leaf, in a page's own coordinates: `top` items
   * lying on this side, over `under` items' backs from the other side —
   * those only show past the paper's edge, since the page itself hides the
   * rest (it's turn.js's page under this layer, not drawn here).
   * @param {HTMLElement} top
   * @param {HTMLElement} under
   * @returns {HTMLElement}
   */
  function flightFace(top, under) {
    const face = document.createElement("div");
    face.className = "book-flight-face";
    under.classList.add("book-flight-under");
    under.style.clipPath = BOOK_OUTSIDE_PAGE_CLIP;
    top.classList.add("book-flight-top");
    face.append(under, top);
    return face;
  }

  /**
   * Turning-page flight: while a page is being turned (or just curled at a
   * corner), the parts of its sticking-out items past the paper's edge
   * would otherwise vanish, clipped away with the rest of turn.js's page.
   * Instead those items — on both sides of the turning leaf — are hidden in
   * place and redrawn here, above the book, following the page's own
   * motion every frame:
   *  - a stiff cover rotates rigidly: the same rotation as turn.js's, with
   *    each item's front on one side of the leaf and its back on the other;
   *  - a soft page folds: what's still flat stays put (minus whatever the
   *    flap now covers), and the flap shows, reflected across the fold
   *    line, the other side of the paper — the next page's items, and the
   *    backs of this page's.
   * Ends (and everything goes back) in settle, once the book's at rest.
   * @param {{page: number, next: number}} pageOpts - turn.js's, from "start".
   */
  function startFlight(pageOpts) {
    const leaf = leafOf(pageOpts.page);
    endFlight(leaf);
    const flipPage = $flip && $flip.data().pages[pageOpts.page];
    if (!flipPage) return;
    const f = flipPage.data().f;
    const page = pageOpts.page - 1;
    // In one-page display a page's back is blank (turn.js's stand-in page).
    const next = display === "double" ? pageOpts.next - 1 : null;
    // The page being revealed underneath: beside the flap's far side in a
    // spread (one further on, or back), or simply the next page alone.
    const underTp = display === "double" ? pageOpts.next + (pageOpts.next > pageOpts.page ? 1 : -1) : pageOpts.next;
    const under = underTp >= 1 && underTp <= pageCount ? underTp - 1 : null;
    const out = (opts.getItems() || []).filter((it) => it.overflow === "out");
    const frontItems = out.filter((it) => bookPageOf(it, pageCount) === page);
    const backItems = next === null ? [] : out.filter((it) => bookPageOf(it, pageCount) === next);
    const underItems = under === null ? [] : out.filter((it) => bookPageOf(it, pageCount) === under);

    const flight = { f, hidden: [], layers: null, under, underItems, pages: [page, next] };
    flights.set(leaf, flight);

    // The revealed page's sticking-out parts come from its bookmark tabs
    // until it lands (they get shaded to match — see shadeRevealed), not
    // from its real items, which stay cut at the page edge like the rest
    // of turn.js's shaded page.
    if (underItems.length) {
      const wrapper = wrapperFor(underTp);
      if (wrapper) wrapper.classList.remove("book-open-edge");
    }

    if (frontItems.length || backItems.length) {
      const hidden = flight.hidden;
      for (const item of [...frontItems, ...backItems]) {
        const real = inners[bookPageOf(item, pageCount)].querySelector(`.sb-item[data-id="${CSS.escape(item.id)}"]`);
        if (real) hidden.push(real);
      }
      tabsEl.querySelectorAll(".book-tab-page").forEach((box) => {
        if (Number(box.dataset.page) === page || Number(box.dataset.page) === next) hidden.push(box);
      });
      for (const el of hidden) el.style.visibility = "hidden";

      const slot = document.createElement("div");
      slot.className = "book-flight-slot";
      slot.style.left = `${display === "double" && pageOpts.page % 2 ? BOOK_PAGE_W : 0}px`;
      // This page as it lies, flat: its own items on top, the other side's
      // showing past the edge from beneath (as the bookmark tabs do).
      const flat = flightFace(flightGroup(frontItems, {}), flightGroup(backItems, { mirrored: true, back: true }));
      let other;
      if (f.effect === "hard") {
        // The leaf's far side, set up to land the right way round after a
        // half turn: the next page's items as they lie on it, over this
        // page's backs.
        other = flightFace(flightGroup(backItems, {}), flightGroup(frontItems, { mirrored: true, back: true }));
        other.classList.add("is-back");
        const leafEl = document.createElement("div");
        leafEl.className = "book-flight-leaf";
        leafEl.append(flat, other);
        slot.appendChild(leafEl);
      } else {
        // The flap, in this page's coordinates, before it's reflected over:
        // the next page's items mirror-imaged (so the reflection puts them
        // right way round), over this page's items' backs.
        other = flightFace(
          flightGroup(backItems, { mirrored: true, flipContent: true }),
          flightGroup(frontItems, { back: true, reflected: true })
        );
        slot.append(flat, other);
      }
      flightEl.appendChild(slot);
      flight.layers = { flat, other, slot };
    }
    if (!flightFrame) renderFlights();
  }

  /** Follow turn.js's current folds, once per frame, until the flights end. */
  function renderFlights() {
    for (const flight of flights.values()) {
      renderFlight(flight);
      shadeRevealed(flight);
    }
    syncShadow();
    flightFrame = flights.size ? requestAnimationFrame(renderFlights) : 0;
  }

  /** @param {object} flight - One leaf's, from startFlight. */
  function renderFlight(flight) {
    const { f, layers } = flight;
    if (layers && f.effect === "hard") {
      // Copy the leaf's rotation straight off turn.js's own page wrapper.
      const wrapper = f.wrapper && f.wrapper[0];
      const match = wrapper && /rotateY\((-?[\d.e]+)deg\)/.exec(wrapper.style.transform);
      const leaf = layers.slot.firstChild;
      leaf.style.transformOrigin = wrapper ? wrapper.style.transformOrigin : "";
      leaf.style.transform = match ? `rotateY(${match[1]}deg)` : "";
    } else if (layers) {
      const { flat, other } = layers;
      const fold = f.point ? bookFoldLine(f.point.corner, { x: f.point.x / scale, y: f.point.y / scale }) : null;
      if (!fold) {
        flat.style.clipPath = "";
        other.hidden = true;
      } else {
        // Flat side: its half of the page, minus where the flap now lies on top.
        flat.style.clipPath = bookPolygonCss([bookHalfPlane(fold, 1), bookFlapPolygon(fold)]);
        // Flap: the folding half, reflected across the fold line.
        const { n, m } = fold;
        const k = 2 * (m.x * n.x + m.y * n.y);
        other.hidden = false;
        other.style.clipPath = bookPolygonCss([bookHalfPlane(fold, -1)]);
        other.style.transform = `matrix(${1 - 2 * n.x * n.x}, ${-2 * n.x * n.y}, ${-2 * n.x * n.y}, ${1 - 2 * n.y * n.y}, ${k * n.x}, ${k * n.y})`;
      }
    }
  }

  /**
   * Darken the revealed page's bookmark tabs exactly as much as turn.js is
   * shading that page where each item meets its edge — so an item's two
   * halves match all the way through the turn, and brighten together as the
   * shading fades out, with nothing left to jump when the page lands.
   * @param {object} flight
   */
  function shadeRevealed(flight) {
    for (const item of flight.underItems) {
      const tab = tabsEl.querySelector(`.book-tab-page[data-page="${flight.under}"] .sb-item[data-id="${CSS.escape(item.id)}"]`);
      if (!tab) continue;
      const alpha = Math.min(1, Math.max(0, bookTurnShadeAt(flight.f, item)));
      tab.style.filter = alpha > 0.002 ? `brightness(${(1 - alpha).toFixed(3)})` : "";
    }
  }

  /**
   * Put a turning leaf's real items (and tabs) back, and clear its copies
   * from the flight layer.
   * @param {number} leaf
   */
  function endFlight(leaf) {
    const flight = flights.get(leaf);
    if (!flight) return;
    flights.delete(leaf);
    for (const el of flight.hidden) el.style.visibility = "";
    if (flight.layers) flight.layers.slot.remove();
    if (!flights.size) {
      cancelAnimationFrame(flightFrame);
      flightFrame = 0;
    }
  }

  function endAllFlights() {
    for (const leaf of [...flights.keys()]) endFlight(leaf);
  }

  /**
   * Keep the desk shadow (and the layers that sit beside the book) lined up
   * with turn.js: the size of its own shadow element (which spans just the
   * pages actually there — half the width while the book's closed) and
   * the margin autoCenter slides the book by.
   */
  function syncShadow() {
    if (!flipEl) return;
    const src = flipEl.querySelector(":scope > .shadow");
    shadowEl.hidden = !src;
    if (src) {
      for (const prop of ["left", "top", "width", "height"]) shadowEl.style[prop] = src.style[prop];
    }
    shadowEl.style.marginLeft = tabsEl.style.marginLeft = flightEl.style.marginLeft = flipEl.style.marginLeft;
  }

  function scheduleSettle() {
    cancelAnimationFrame(settleFrame);
    settleFrame = requestAnimationFrame(settle);
  }

  /** Once nothing's moving: open the page edges back up, and redraw tabs/nav. */
  function settle() {
    if (!$flip) return;
    if ($flip.turn("animating")) {
      settleFrame = requestAnimationFrame(settle);
      return;
    }
    const visible = new Set(view());
    pageEls.forEach((pageEl, i) => pageEl.classList.toggle("book-page-hidden", !visible.has(i)));
    flipEl.querySelectorAll(".page-wrapper").forEach((w) => w.classList.add("book-open-edge"));
    applyRaise();
    syncShadow();
    renderTabs();
    // Only now, with the real items' edges open and the tabs redrawn where
    // the page landed, can the flight's copies go without a gap.
    endAllFlights();
    updateNav();
    if (opts.onSettle) opts.onSettle();
  }

  /**
   * Lift one open page above the other — the editor does this for the
   * selected item's page, so its handles/toolbars (and the item itself,
   * mid-drag across the spine) aren't hidden under the facing page.
   */
  function applyRaise() {
    if (!flipEl) return;
    flipEl.querySelectorAll(".page-wrapper.book-raised").forEach((w) => w.classList.remove("book-raised"));
    if (raisedPage === null || $flip.turn("animating")) return;
    const wrapper = wrapperFor(raisedPage + 1);
    if (wrapper) wrapper.classList.add("book-raised");
  }

  /** @returns {number[]} Indices of the page(s) currently open. */
  function view() {
    if (!$flip) return [currentPage];
    return $flip
      .turn("view")
      .filter((tp) => tp > 0)
      .map((tp) => tp - 1);
  }

  /**
   * Where a closed page physically lies, as seen from above: which side
   * (slot 0 = left, 1 = right), whether it's lying face down (so its items
   * show mirrored — its outer edge is now on the other side), and how high
   * in the stack it is (pages nearer the open spread lie on top).
   * @param {number} page
   * @param {number[]} tpView - turn.js's view(), 1-based, 0 for "no page".
   * @returns {{slot: number, mirrored: boolean, z: number}|null} null when
   *   the page shows its own sticking-out items (see showsOwnItems), or
   *   (one-page display) is already turned out of sight.
   */
  function tabPlacement(page, tpView) {
    const tp = page + 1;
    if (showsOwnItems(tp)) return null;
    if (display === "single") return tp > tpView[0] ? { slot: 0, mirrored: false, z: pageCount - tp } : null;
    const rightTp = tpView[1] || pageCount + 1;
    const turned = leafOf(tp) < rightTp;
    return {
      slot: turned ? 0 : 1,
      mirrored: turned ? tp % 2 === 1 : tp % 2 === 0,
      z: turned ? tp : pageCount - tp,
    };
  }

  /**
   * At rest, that's just the open pages. Mid-flip it's whichever pages
   * still have their edges open and aren't hidden by turn.js — not ones
   * that just snapped into view, whose edges only open once the book
   * comes to rest.
   * @param {number} tp
   * @returns {boolean}
   */
  function showsOwnItems(tp) {
    const wrapper = wrapperFor(tp);
    return (
      !!wrapper &&
      wrapper.style.display !== "none" &&
      wrapper.classList.contains("book-open-edge") &&
      !pageEls[tp - 1].classList.contains("book-page-hidden")
    );
  }

  /** Redraw the bookmark tabs for every closed page's sticking-out items. */
  function renderTabs() {
    tabsEl.innerHTML = "";
    if (!$flip) return;
    const tpView = $flip.turn("view");
    // A turning leaf's pages are drawn by its flight instead.
    const inFlight = new Set([...flights.values()].flatMap((fl) => fl.pages));
    const byPage = new Map();
    for (const item of opts.getItems() || []) {
      if (item.overflow !== "out") continue;
      const page = bookPageOf(item, pageCount);
      if (inFlight.has(page)) continue;
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push(item);
    }
    for (const [page, items] of byPage) {
      const place = tabPlacement(page, tpView);
      if (!place) continue;
      const box = document.createElement("div");
      box.className = "book-tab-page";
      box.dataset.page = String(page);
      box.style.left = `${place.slot * BOOK_PAGE_W}px`;
      box.style.zIndex = place.z;
      for (const item of items) {
        const wrap = bookBuildStaticWrap(item, opts.tabCardBuilder, { mirrored: place.mirrored });
        // A face-down page shows the *back* of what's sticking out of it —
        // blank white photo paper, a note's plain paper, and so on (see
        // .book-item-back in styles.css) — not its front.
        if (place.mirrored) wrap.classList.add("book-item-back");
        wrap.title = `Open ${bookPageName(page, pageCount)}`;
        wrap.addEventListener("click", () => goTo(page));
        box.appendChild(wrap);
      }
      tabsEl.appendChild(box);
    }
  }

  function updateNav() {
    const v = view();
    label.textContent = v.map((i) => bookPageName(i, pageCount)).join("  ·  ");
    prevBtn.disabled = Math.min(...v) <= 0;
    nextBtn.disabled = Math.max(...v) >= pageCount - 1;
  }

  /**
   * turn.js refuses to turn at all while disabled, even programmatically —
   * so the editor's (disabled) book briefly re-enables it just to start the
   * turn. The animation itself doesn't check, so it plays out normally.
   * @param {number} tp
   */
  function turnTo(tp) {
    if (!$flip) return;
    const target = Math.min(pageCount, Math.max(1, tp));
    if (editing) $flip.turn("disable", false);
    $flip.turn("page", target);
    if (editing) $flip.turn("disable", true);
  }

  /** @param {number} index */
  function goTo(index) {
    if ($flip) turnTo(index + 1);
    else currentPage = index;
  }

  function next() {
    if ($flip) turnTo(Math.max(...$flip.turn("view")) + 1);
  }

  function prev() {
    if ($flip) turnTo(Math.min(...$flip.turn("view").filter((tp) => tp > 0)) - 1);
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {boolean} [nearest] - If the point isn't on an open page, fall
   *   back to the closest one (clamped onto it) rather than null.
   * @returns {{page: number, x: number, y: number}|null} The open page under
   *   a viewport point, and where on it (% of the page).
   */
  function pointToPage(clientX, clientY, nearest = false) {
    let best = null;
    for (const page of view()) {
      const rect = inners[page].getBoundingClientRect();
      if (!rect.width) continue;
      const x = ((clientX - rect.left) / rect.width) * 100;
      const y = ((clientY - rect.top) / rect.height) * 100;
      if (x >= 0 && x <= 100 && y >= 0 && y <= 100) return { page, x, y };
      const dist = Math.hypot(Math.max(0, Math.abs(x - 50) - 50), Math.max(0, Math.abs(y - 50) - 50));
      if (nearest && (!best || dist < best.dist)) {
        best = { page, x: Math.min(96, Math.max(4, x)), y: Math.min(96, Math.max(4, y)), dist };
      }
    }
    return best && { page: best.page, x: best.x, y: best.y };
  }

  /**
   * Where a toolbar-added item should land: the middle of whichever open page
   * is nearest the middle of the screen, with a little jitter so repeated
   * adds don't stack exactly.
   * @returns {{page: number, x: number, y: number}}
   */
  function centerPos() {
    const jitter = () => (Math.random() - 0.5) * 16;
    let best = { page: view()[0], dist: Infinity };
    for (const page of view()) {
      const rect = inners[page].getBoundingClientRect();
      const dist = Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2);
      if (dist < best.dist) best = { page, dist };
    }
    return { page: best.page, x: 50 + jitter(), y: 45 + jitter() };
  }

  /**
   * Swap in a new page count (the editor adding/removing pages) — fresh,
   * empty inners; the caller re-renders items into them right after.
   * @param {number} count
   * @param {number} openAt - Page index to show afterward.
   */
  function setPageCount(count, openAt) {
    pageCount = count;
    inners = makeInners(count);
    currentPage = Math.min(count - 1, Math.max(0, openAt));
    mount();
  }

  function relayout() {
    if (!$flip) return;
    const layout = computeLayout();
    if (layout.display !== display) {
      mount(); // turn.js can't cleanly switch one-page/two-page mid-life
      return;
    }
    scale = layout.scale;
    const { bookW, pageH } = applySizes();
    $flip.turn("size", bookW, pageH);
    scheduleSettle();
  }

  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 150);
  };

  const onKeydown = (e) => {
    if (!host.offsetParent || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else return;
    e.preventDefault();
  };

  // A quick sideways swipe anywhere on the book turns the page on touch
  // screens — turn.js's own corner-drag only reacts near the corners.
  // Editable items stop their pointerdown from bubbling (they're dragged
  // instead), so this never fires mid-drag in the editor.
  let swipe = null;
  stage.addEventListener("pointerdown", (e) => {
    swipe = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY, t: Date.now() } : null;
  });
  stage.addEventListener("pointercancel", () => (swipe = null));
  stage.addEventListener("pointerup", (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    const quick = Date.now() - swipe.t < 600;
    swipe = null;
    if (!quick || Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if ($flip && $flip.turn("animating")) return; // turn.js's own corner drag already turning it
    if (dx < 0) next();
    else prev();
  });

  window.addEventListener("resize", onResize);
  document.addEventListener("keydown", onKeydown);

  const ready = bookLoadLibs().then(
    () => mount(),
    () => {
      label.textContent = "Couldn't load the page-turning library — try reloading.";
    }
  );

  return {
    ready,
    navExtras,
    get scale() {
      return scale;
    },
    get display() {
      return display;
    },
    get pageCount() {
      return pageCount;
    },
    /** @param {number} i @returns {HTMLElement} */
    pageInner: (i) => inners[i],
    view,
    goTo,
    next,
    prev,
    pointToPage,
    centerPos,
    setPageCount,
    renderTabs,
    /** Re-apply every page's background (after one changes). */
    refreshPages() {
      pageEls.forEach((pageEl, i) => opts.decoratePage(pageEl, i));
    },
    /** @param {number|null} page */
    raisePage(page) {
      if (page === raisedPage) return;
      raisedPage = page;
      applyRaise();
    },
    destroy() {
      destroyed = true;
      teardownTurn();
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKeydown);
      host.innerHTML = "";
    },
  };
}

/**
 * Render a book entry read-only (the published view): bookCreate plus every
 * item placed statically on its page.
 * @param {HTMLElement} host
 * @param {object} entry - Already decrypted, if it was protected.
 * @param {object} opts
 * @param {(item: object) => HTMLElement} opts.cardBuilder - The live read-only card.
 * @param {(item: object) => HTMLElement} opts.snapshotBuilder - A still one, for bookmark tabs.
 * @param {() => number} [opts.availableHeight]
 * @returns {object} The bookCreate handle.
 */
function bookRenderReadOnly(host, entry, { cardBuilder, snapshotBuilder, availableHeight }) {
  const pages = entry.pages && entry.pages.length ? entry.pages : bookNewPages();
  const items = entry.items || [];
  const book = bookCreate(host, {
    pageCount: pages.length,
    availableHeight,
    decoratePage: (pageEl, i) => bookApplyPageBackground(pageEl, pages[i]),
    getItems: () => items,
    tabCardBuilder: snapshotBuilder,
  });
  for (const item of items) {
    book.pageInner(bookPageOf(item, pages.length)).appendChild(bookBuildStaticWrap(item, cardBuilder));
  }
  return book;
}

/**
 * Lay every page out flat, spread by spread, into `container` — for the
 * "Save Image" export, which can't capture a page turn. Cut-at-the-edge
 * items go in an overflow: hidden layer rather than using their clip-path:
 * html2canvas doesn't support clip-path at all, so it would draw them uncut.
 * @param {HTMLElement} container
 * @param {object} entry - Already decrypted, if it was protected.
 * @param {(item: object) => HTMLElement} cardBuilder - A still card (no live players).
 */
function bookRenderSheet(container, entry, cardBuilder) {
  const pages = entry.pages && entry.pages.length ? entry.pages : bookNewPages();
  const count = pages.length;
  container.innerHTML = "";
  container.classList.add("book-sheet");

  const spreads = [[0]];
  for (let i = 1; i < count - 1; i += 2) spreads.push([i, i + 1]);
  spreads.push([count - 1]);

  const layers = [];
  for (const spread of spreads) {
    const row = document.createElement("div");
    row.className = "book-sheet-spread";
    spread.forEach((i, pos) => {
      const pageEl = document.createElement("div");
      const side = spread.length === 2 ? (pos === 0 ? " even" : " odd") : "";
      pageEl.className = "book-page book-sheet-page" + bookPageClasses(i, count) + side;
      bookApplyPageBackground(pageEl, pages[i]);
      const clipLayer = document.createElement("div");
      clipLayer.className = "book-sheet-layer book-sheet-clip";
      const outLayer = document.createElement("div");
      outLayer.className = "book-sheet-layer";
      pageEl.append(clipLayer, outLayer);
      row.appendChild(pageEl);
      layers[i] = { clip: clipLayer, out: outLayer };
    });
    container.appendChild(row);
  }

  for (const item of entry.items || []) {
    const layer = layers[bookPageOf(item, count)];
    (item.overflow === "out" ? layer.out : layer.clip).appendChild(bookBuildStaticWrap(item, cardBuilder, { clip: false }));
  }
}
