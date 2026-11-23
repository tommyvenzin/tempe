/* Tempe Orders app shell (app 1, 2026-11-24).
   Loaded synchronously in <head> of Repair_Orders.html, Order_Check.html and app/index.html.
   Outside "app mode" it only defines window.TempeApp (isApp: false) and changes nothing on the page.
   App mode = installed home-screen app (display-mode standalone / navigator.standalone) or ?app=1;
   once on, it sticks for the tab via sessionStorage 'tempe:app-mode'.
   In app mode: <html class="tempe-app">, a fixed top bar #tempe-appbar, and --tempe-appbar-h on <html>. */
(function () {
    "use strict";
    var w = window, doc = document;
    if (w.TempeApp && w.TempeApp.__shell) return; // loaded twice: keep the first

    var MODE_KEY = "tempe:app-mode";

    function ownBase() {
        var src = "";
        try {
            var cur = doc.currentScript;
            if (cur && cur.src) src = cur.src;
            if (!src) {
                var list = doc.getElementsByTagName("script");
                for (var i = list.length - 1; i >= 0; i--) {
                    if (/app-shell\.js(\?|#|$)/.test(list[i].src || "")) { src = list[i].src; break; }
                }
            }
        } catch (_) { /* old browser */ }
        try { return new URL(".", src || w.location.href).href; }
        catch (_) { return ""; }
    }

    function resolve(base, rel) {
        try { return new URL(rel, base || w.location.href).href; } catch (_) { return rel; }
    }

    function detectStandalone() {
        // Phones only: a desktop Chrome app window / "Open as window" shortcut also reports
        // display-mode standalone and must stay a normal page (the RDP board's extension bridge).
        var on = false;
        try {
            on = !!(w.matchMedia && w.matchMedia("(display-mode: standalone)").matches &&
                w.matchMedia("(pointer: coarse)").matches && !w.matchMedia("(any-pointer: fine)").matches);
        } catch (_) { /* ignore */ }
        try { if (w.navigator && w.navigator.standalone === true) on = true; } catch (_) { /* ignore */ }
        return on;
    }

    function detectAppMode(standalone) {
        var on = standalone;
        try { if (!on && w.URLSearchParams && new URLSearchParams(w.location.search).has("app")) on = true; } catch (_) { /* ignore */ }
        try {
            if (on) w.sessionStorage.setItem(MODE_KEY, "1");
            else if (w.sessionStorage.getItem(MODE_KEY) === "1") on = true;
        } catch (_) { /* storage blocked: app mode just isn't sticky */ }
        return on;
    }

    var base = ownBase();
    var standalone = detectStandalone();
    var isApp = detectAppMode(standalone);
    var home = resolve(base, "index.html");

    var api = {
        __shell: true,
        isApp: isApp,
        standalone: standalone,
        home: home,
        pairUrl: home + "#pair"
    };
    try { w.TempeApp = api; } catch (_) { /* ignore */ }

    if (!isApp) return;

    var root = doc.documentElement;
    try { root.classList.add("tempe-app"); }
    catch (_) { root.className = (root.className ? root.className + " " : "") + "tempe-app"; }

    var TABS = [
        { label: "Repair Orders", href: resolve(base, "../Repair_Orders.html") },
        { label: "Order Check", href: resolve(base, "../Order_Check.html") },
        { label: "Setup", href: home }
    ];

    function pagePath(href) {
        try {
            var p = new URL(href, w.location.href).pathname;
            return p.replace(/index\.html$/i, "").toLowerCase();
        } catch (_) { return String(href); }
    }

    function setHeight(bar) {
        try {
            var h = bar.getBoundingClientRect().height;
            if (h > 0) root.style.setProperty("--tempe-appbar-h", Math.ceil(h) + "px");
        } catch (_) { /* ignore */ }
    }

    function buildBar() {
        if (!doc.body || doc.getElementById("tempe-appbar")) return;
        var here = pagePath(w.location.href);
        var nav = doc.createElement("nav");
        nav.id = "tempe-appbar";
        nav.setAttribute("aria-label", "Tempe app");
        var inner = doc.createElement("div");
        inner.className = "tempe-appbar-tabs";
        for (var i = 0; i < TABS.length; i++) {
            var a = doc.createElement("a");
            a.className = "tempe-appbar-tab";
            a.href = TABS[i].href;
            a.textContent = TABS[i].label;
            if (pagePath(TABS[i].href) === here) a.setAttribute("aria-current", "page");
            inner.appendChild(a);
        }
        nav.appendChild(inner);
        doc.body.insertBefore(nav, doc.body.firstChild);

        setHeight(nav);
        if (typeof w.ResizeObserver === "function") {
            try { new w.ResizeObserver(function () { setHeight(nav); }).observe(nav); } catch (_) { /* ignore */ }
        }
        var update = function () { setHeight(nav); };
        try {
            w.addEventListener("resize", update);
            w.addEventListener("orientationchange", update);
            w.addEventListener("pageshow", update);
            w.addEventListener("load", update);
        } catch (_) { /* ignore */ }
    }

    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", buildBar);
    else buildBar();
})();
