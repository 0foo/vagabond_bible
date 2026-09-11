/* The Vagabond Bible — client runtime.
   Works from file:// as well as http://, so the index is loaded by injecting
   a <script> tag rather than fetch(), which CORS blocks on local files. */
(function () {
  "use strict";

  var ROOT = document.documentElement.getAttribute("data-root") || "";

  /* ------------------------------------------------------------ theme */
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  var saved = store.get("vb-theme");
  if (saved === "dark" || saved === "light") {
    document.documentElement.setAttribute("data-theme", saved);
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme");
    if (!cur) {
      cur = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark" : "light";
    }
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    store.set("vb-theme", next);
  }

  /* ------------------------------------------------------------ search */
  var idx = null;          // heading index (small, eager)
  var full = null;         // full-text index (large, lazy)
  var fullState = "none";  // none | loading | ready | failed
  var modal, input, resultsEl, hintEl, sel = 0, rows = [];

  function loadScript(src, cb) {
    var s = document.createElement("script");
    s.src = src;
    s.onload = function () { cb(true); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  function ensureFull() {
    if (fullState !== "none") return;
    fullState = "loading";
    setHint("Loading full text…");
    loadScript(ROOT + "search-full.js", function (ok) {
      if (ok && window.VB_FULL) {
        full = window.VB_FULL;
        fullState = "ready";
        setHint("");
        run();
      } else {
        fullState = "failed";
        setHint("Headings only");
      }
    });
  }

  function setHint(t) { if (hintEl) hintEl.textContent = t; }

  function tokens(q) {
    return q.toLowerCase().split(/[^a-z0-9']+/).filter(function (t) { return t.length > 1; });
  }

  function scoreEntry(hay, toks, title) {
    var s = 0, i, t, pos;
    var lowTitle = title.toLowerCase();
    for (i = 0; i < toks.length; i++) {
      t = toks[i];
      pos = hay.indexOf(t);
      if (pos < 0) return 0;
      s += 1;
      if (lowTitle.indexOf(t) >= 0) s += 6;
      if (hay.indexOf(" " + t + " ") >= 0) s += 1.5;
    }
    return s;
  }

  function snippet(text, toks) {
    var low = text.toLowerCase(), at = -1, i;
    for (i = 0; i < toks.length; i++) {
      at = low.indexOf(toks[i]);
      if (at >= 0) break;
    }
    if (at < 0) at = 0;
    var start = Math.max(0, at - 70);
    var frag = text.slice(start, start + 210);
    if (start > 0) frag = "…" + frag.replace(/^\S*\s/, "");
    if (start + 210 < text.length) frag = frag.replace(/\s\S*$/, "") + "…";
    return frag;
  }

  // Wrap matches in sentinels first, escape once, then swap sentinels for real
  // tags -- so highlighting can never inject markup from the source text.
  var S0 = "\u0001", S1 = "\u0002";
  function mark(str, toks) {
    var out = str.replace(/[\u0001\u0002]/g, "");
    toks.forEach(function (t) {
      out = out.replace(new RegExp("(" + escapeRe(t) + ")", "gi"), S0 + "$1" + S1);
    });
    out = escapeHtml(out);
    return out.split(S0).join("<mark>").split(S1).join("</mark>");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function run() {
    if (!idx) return;
    var q = input.value.trim();
    var toks = tokens(q);
    rows = [];
    if (!toks.length) {
      resultsEl.innerHTML =
        '<div class="empty">Search every guide in the library — try <b>snare</b>, ' +
        "<b>hypothermia</b>, <b>grainer</b>, or <b>water purification</b>.</div>";
      return;
    }

    var hits = [];
    var i, e, sc;
    // headings and titles first — always available, instant
    for (i = 0; i < idx.e.length; i++) {
      e = idx.e[i];
      sc = scoreEntry(e[3], toks, e[2]);
      if (sc > 0) hits.push({ s: sc + 4, d: e[0], u: e[1], t: e[2], snip: e[4] || "", doc: idx.d[e[0]] });
    }
    // then full text, if the reader asked for it
    if (fullState === "ready" && full) {
      var seen = {};
      hits.forEach(function (h) { seen[h.u] = 1; });
      for (i = 0; i < full.e.length; i++) {
        e = full.e[i];
        if (seen[e[1]]) continue;
        sc = scoreEntry(e[3], toks, e[2]);
        if (sc > 0) hits.push({ s: sc, d: e[0], u: e[1], t: e[2], snip: e[3], doc: idx.d[e[0]] });
      }
    }

    hits.sort(function (a, b) { return b.s - a.s; });
    hits = hits.slice(0, 40);
    rows = hits;

    if (!hits.length) {
      var more = fullState === "ready"
        ? ""
        : '<br><button class="btn" id="gofull" style="margin-top:12px">Search full text of every page</button>';
      resultsEl.innerHTML = '<div class="empty">No headings match “' +
        escapeHtml(q) + "”." + more + "</div>";
      wireFullBtn();
      return;
    }

    resultsEl.innerHTML = hits.map(function (h, n) {
      return '<a class="res' + (n === 0 ? " sel" : "") + '" href="' + ROOT + h.u + '">' +
        '<span class="src">' + escapeHtml(h.doc) + "</span>" +
        "<b>" + mark(h.t, toks) + "</b>" +
        (h.snip ? '<span class="snip">' + mark(snippet(h.snip, toks), toks) + "</span>" : "") +
        "</a>";
    }).join("") + (fullState === "ready" || fullState === "loading" ? "" :
      '<div class="empty" style="padding:14px"><button class="btn" id="gofull">' +
      "Also search full text of every page</button></div>");
    sel = 0;
    wireFullBtn();
  }

  function wireFullBtn() {
    var b = document.getElementById("gofull");
    if (b) b.addEventListener("click", ensureFull);
  }

  function move(d) {
    var els = resultsEl.querySelectorAll(".res");
    if (!els.length) return;
    els[sel] && els[sel].classList.remove("sel");
    sel = (sel + d + els.length) % els.length;
    els[sel].classList.add("sel");
    els[sel].scrollIntoView({ block: "nearest" });
  }

  function openSearch() {
    if (!modal) return;
    modal.hidden = false;
    input.value = "";
    input.focus();
    run();
    if (!idx) {
      loadScript(ROOT + "search-index.js", function (ok) {
        if (ok && window.VB_INDEX) { idx = window.VB_INDEX; run(); }
        else { resultsEl.innerHTML = '<div class="empty">Search index unavailable.</div>'; }
      });
    }
  }
  function closeSearch() { if (modal) modal.hidden = true; }

  /* ------------------------------------------------------------ maps */
  function initLightbox() {
    var lb = document.getElementById("lightbox");
    if (!lb) return;
    var stage = lb.querySelector(".lb-stage");
    var img = lb.querySelector("img");
    var label = lb.querySelector(".lb-label");
    var cards = [].slice.call(document.querySelectorAll("[data-full]"));
    var at = 0;

    function show(i) {
      at = (i + cards.length) % cards.length;
      var c = cards[at];
      img.src = c.getAttribute("data-full");
      label.textContent = c.getAttribute("data-label") + "  ·  " + (at + 1) + " / " + cards.length;
      stage.classList.remove("zoom");
      stage.scrollTop = 0; stage.scrollLeft = 0;
      lb.hidden = false;
    }
    cards.forEach(function (c, i) {
      c.addEventListener("click", function () { show(i); });
    });
    lb.querySelector(".lb-close").addEventListener("click", function () { lb.hidden = true; });
    lb.querySelector(".lb-prev").addEventListener("click", function () { show(at - 1); });
    lb.querySelector(".lb-next").addEventListener("click", function () { show(at + 1); });
    lb.querySelector(".lb-zoom").addEventListener("click", function () {
      stage.classList.toggle("zoom");
      this.textContent = stage.classList.contains("zoom") ? "Fit" : "Zoom";
    });
    stage.addEventListener("click", function (e) { if (e.target === stage) lb.hidden = true; });
    document.addEventListener("keydown", function (e) {
      if (lb.hidden) return;
      if (e.key === "Escape") lb.hidden = true;
      if (e.key === "ArrowRight") show(at + 1);
      if (e.key === "ArrowLeft") show(at - 1);
    });

    // drag-to-pan when zoomed
    var down = false, sx, sy, sl, st;
    stage.addEventListener("mousedown", function (e) {
      if (!stage.classList.contains("zoom")) return;
      down = true; sx = e.clientX; sy = e.clientY; sl = stage.scrollLeft; st = stage.scrollTop;
      e.preventDefault();
    });
    window.addEventListener("mouseup", function () { down = false; });
    window.addEventListener("mousemove", function (e) {
      if (!down) return;
      stage.scrollLeft = sl - (e.clientX - sx);
      stage.scrollTop = st - (e.clientY - sy);
    });
  }

  /* ------------------------------------------------------------ boot */
  document.addEventListener("DOMContentLoaded", function () {
    modal = document.getElementById("search");
    if (modal) {
      input = document.getElementById("q");
      resultsEl = modal.querySelector(".results");
      hintEl = modal.querySelector(".hint");
      input.addEventListener("input", run);
      modal.addEventListener("click", function (e) { if (e.target === modal) closeSearch(); });
      modal.querySelector(".sheet").addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        else if (e.key === "Enter") {
          var els = resultsEl.querySelectorAll(".res");
          if (els[sel]) { e.preventDefault(); window.location.href = els[sel].getAttribute("href"); }
        }
      });
    }

    [].forEach.call(document.querySelectorAll("[data-search]"), function (b) {
      b.addEventListener("click", openSearch);
    });
    [].forEach.call(document.querySelectorAll("[data-theme-toggle]"), function (b) {
      b.addEventListener("click", toggleTheme);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeSearch();
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (!typing && (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key === "k"))) {
        e.preventDefault();
        openSearch();
      }
    });

    initLightbox();
  });
})();
