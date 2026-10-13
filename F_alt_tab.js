console.log("F_alt_tab.js loaded successfully");

/* =========================
   Shared helpers
   ========================= */

const EXTENSION_BRIDGE_TIMEOUT_MS = 20000;
let extensionFetchRequestCounter = 0;

function fetchViaExtension(targetUrl, options = {}) {
    return new Promise((resolve, reject) => {
        const requestId =
            `general-fetch-${Date.now()}-${++extensionFetchRequestCounter}`;

        let settled = false;

        const cleanup = () => {
            window.removeEventListener("message", handleBridgeResponse);
            window.clearTimeout(timeoutId);
        };

        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback(value);
        };

        const handleBridgeResponse = (event) => {
            if (event.source !== window) return;

            const data = event.data;
            if (
                !data ||
                data.source !== "GENERAL_FETCH_BRIDGE" ||
                data.type !== "GENERAL_FETCH_RESPONSE" ||
                data.id !== requestId
            ) {
                return;
            }

            const result = data.result;

            if (!result?.ok) {
                finish(
                    reject,
                    new Error(result?.error || "Chrome Fetch Bridge request failed")
                );
                return;
            }

            if (
                typeof result.status === "number" &&
                (result.status < 200 || result.status >= 400)
            ) {
                finish(
                    reject,
                    new Error(
                        `${result.status} ${result.statusText || "HTTP error"}`
                    )
                );
                return;
            }

            finish(resolve, result);
        };

        const timeoutId = window.setTimeout(() => {
            finish(
                reject,
                new Error(
                    "Chrome Fetch Bridge did not respond. Check that the extension is enabled and 'Allow access to file URLs' is turned on."
                )
            );
        }, EXTENSION_BRIDGE_TIMEOUT_MS);

        window.addEventListener("message", handleBridgeResponse);

        window.postMessage({
            source: "LOCAL_HELPER_PAGE",
            type: "GENERAL_FETCH_REQUEST",
            id: requestId,
            url: targetUrl,
            options,
        }, "*");
    });
}

function decodeHtmlEntities(text) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(text || "");
    return textarea.value;
}

function unwrapPreResponse(text) {
    const raw = String(text || "");
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const preText = doc.querySelector("pre")?.textContent;
    return preText ? preText : raw;
}

function looksLikeCaptchaPage(html) {
    const text = String(html || "").toLowerCase();
    return (
        text.includes("verify you are human") ||
        text.includes("verification required") ||
        text.includes("g-recaptcha") ||
        text.includes("/captcha-verify") ||
        text.includes("captcha") && text.includes("recaptcha")
    );
}

function looksLikeBlockedPage(html) {
    const text = String(html || "").toLowerCase();
    return (
        looksLikeCaptchaPage(text) ||
        text.includes("access denied") ||
        text.includes("you have been blocked") ||
        text.includes("temporarily blocked") ||
        text.includes("blocked by")
    );
}

function looksLikeJinaResponse(text) {
    const raw = unwrapPreResponse(text);
    return (
        raw.includes("Markdown Content:") ||
        raw.includes("URL Source:") ||
        raw.includes("Title: Buy New") ||
        raw.includes("[**")
    );
}

function usesPcReceiver() {
    return !!window.TempeCostarClient?.isPaired();
}

// Where the phone is paired to, for error messages ("10.145.20.103:8790").
function pcReceiverHost() {
    try {
        const pairing = JSON.parse(window.localStorage.getItem("tempe:costar-pairing:v1") || "null");
        return pairing?.baseUrl ? new URL(pairing.baseUrl).host : "";
    } catch {
        return "";
    }
}

// The desk PC helper serves 12 connections at a time and closes any more
// straight away, which the browser reports as a failed connection. Such a
// request is tried once more before giving up.
async function fetchViaPcReceiver(targetUrl) {
    try {
        return await window.TempeCostarClient.fetchTyres(targetUrl);
    } catch (error) {
        if (!(error instanceof TypeError)) throw describePcError(error);
    }

    await new Promise((resolve) => window.setTimeout(resolve, 600));

    try {
        return await window.TempeCostarClient.fetchTyres(targetUrl);
    } catch (error) {
        throw describePcError(error);
    }
}

// Says why the PC helper could not be used, in words staff can act on.
function describePcError(error) {
    const host = pcReceiverHost();
    const pc = host ? `the PC helper at ${host}` : "the PC helper";

    if (error?.name === "AbortError") {
        return new Error(`${pc[0].toUpperCase()}${pc.slice(1)} did not answer within 8 seconds.`);
    }

    if (error instanceof TypeError) {
        return new Error(`Could not connect to ${pc}. Check it is receiving, this phone is on the shop Wi-Fi and the PC certificate is still trusted.`);
    }

    const message = error?.message || "request failed";
    return new Error(/PC helper/.test(message) ? message : `PC helper: ${message}`);
}

async function fetchTextWithFallback(targetUrl) {
    const viaPc = usesPcReceiver();
    console.log(viaPc ? "Fetching through paired PC receiver:" : "Fetching through Chrome extension:", targetUrl);

    const result = viaPc
        ? await fetchViaPcReceiver(targetUrl)
        : await fetchViaExtension(targetUrl, { method: "GET", cache: "no-store" });

    const text = String(result.text || "");

    if (!text.trim()) {
        throw new Error("empty-response");
    }

    const hasProducts = text.includes("product-container");

    if (!hasProducts && looksLikeBlockedPage(text)) {
        throw new Error("captcha-or-blocked-response");
    }

    return {
        text,
        proxyBase: viaPc ? "pc-receiver" : "chrome-extension",
        isJina: false,
        status: result.status,
        finalUrl: result.finalUrl || targetUrl,
    };
}

async function fetchHtmlWithFallback(targetUrl) {
    const result = await fetchTextWithFallback(targetUrl);
    return result.text;
}

function normalizeAbsoluteUrl(url) {
    if (!url || url === "#") return "#";
    if (/^https?:\/\//i.test(url)) return url.replace(/^http:\/\//i, "https://");
    return new URL(url, "https://tempetyres.com.au").href;
}

function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeJsSingle(text) {
    return String(text ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\n/g, " ")
        .replace(/\r/g, " ");
}

function extractSkuFromProductUrl(url) {
    if (!url || url === "#") return "";

    try {
        const clean = decodeURIComponent(url.split("?")[1] || url);
        const last = clean
            .split("-")
            .pop()
            ?.replace(/[^a-z0-9]/gi, "")
            .trim();

        // Tempe commonly leaves the SKU at the end of the product URL even
        // when the hidden tyresku input disappears for On Order / OOS items.
        // Requiring at least one digit avoids treating words such as
        // "runflat" as an SKU.
        if (
            last &&
            last.length >= 4 &&
            last.length <= 20 &&
            /\d/.test(last)
        ) {
            return last.toUpperCase();
        }
    } catch {}

    return "";
}

// Short confirmation for SKU and link copies. Styled by .falt-toast in
// allaround.css: centred above the home indicator on phones, and it lets
// taps through to the row underneath.
function showFAltToast(message) {
    const toast = document.createElement("div");
    toast.className = "falt-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add("is-visible");
    });

    setTimeout(() => {
        toast.classList.remove("is-visible");
        setTimeout(() => toast.remove(), 300);
    }, 800);
}

// SKU placeholders shown when Tempe gives none: nothing to copy or tap.
const NO_COPY_SKUS = ["No SKU", "No SKU available", "SKU unavailable", "JINA-N/A"];

function copySKU(sku) {
    if (!sku || NO_COPY_SKUS.includes(sku)) return;

    navigator.clipboard.writeText(sku)
        .then(() => showFAltToast(`Copied: ${sku}`))
        .catch((err) => console.error("Copy failed", err));
}

async function selectTyreForFitment(tyre) {
    try {
        // Other existing pages may also load F_alt_tab.js without the new script tag.
        if (!window.TempeJobCard) {
            window.tempeJobCardLoad ||= new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "./jobcard-shared.js";
                script.onload = resolve;
                script.onerror = () => reject(new Error("Upload jobcard-shared.js beside this page."));
                document.head.appendChild(script);
            });
            await window.tempeJobCardLoad;
        }
        return await window.TempeJobCard.addProduct({
            type: "tyre", sku: tyre.sku,
            description: [tyre.make, tyre.model].filter(Boolean).join(" "),
        });
    } catch (error) {
        if (window.TempeJobCard) window.TempeJobCard.toast(error.message);
        else alert(error.message);
        return null;
    }
}

function handleSkuInputEnter(e) {
    if (e.key === "Enter") {
        e.preventDefault();

        // Clipboard copy is triggered directly from the physical Enter keypress.
        copyCurrentTempeSearchLinksImmediate();

        checkPrices({ copyLink: false });

        // Keep keyboard focus on the tyre-size box after Enter.
        // Tab then follows the browser's normal/native tab order.
        // On a phone checkPrices() has closed the keyboard instead, so the
        // results are not hidden behind it.
        const tyreInput = e.currentTarget;
        if (closesFAltKeyboard()) return;

        if (tyreInput && typeof tyreInput.focus === "function") {
            try {
                tyreInput.focus({ preventScroll: true });
            } catch {
                tyreInput.focus();
            }
        }
    }
}

function handleSkuInputDone(e) {
    if (e.target.value.trim()) {
        checkPrices();
    }
}

function getStockColor(stockStatus) {
    if (!stockStatus) return "transparent";
    const lower = stockStatus.toLowerCase();

    if (lower.includes("out of stock")) return "#4b1113";
    if (lower.includes("on order")) return "#1a1a1d";
    if (lower.match(/\b[1-4]\s*in stock\b/)) return "#4b2a12";
    if (lower.match(/\b[5-8]\s*in stock\b/)) return "#3b3a16";
    if (lower.includes("8+ in stock") || lower.includes("in stock")) return "#123524";

    return "transparent";
}

function isAvailableStock(stockText) {
    if (!stockText) return false;
    const lower = stockText.toLowerCase();

    if (lower.includes("out of stock")) return false;
    if (lower.includes("on order")) return false;
    if (lower.includes("no status")) return false;
    if (lower.includes("no stock")) return false;

    if (lower.includes("in stock")) return true;
    if (/\d+/.test(lower)) return true;

    return false;
}

/* =========================
   Product parsers
   ========================= */

function parseTempetyresHtmlProducts(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const items = doc.querySelectorAll(".product-container");

    return Array.from(items).map((item) => {
        const make = item.querySelector(".brand-name b")?.textContent.trim() || "No make";
        const size = item.querySelector(".sub-heading-ty-2")?.textContent.trim() || "";
        const pattern = item.querySelector(".sub-heading-ty-3")?.textContent.trim() || "";
        const model = `${size} ${pattern}`.trim() || "No model";
        const rawPrice = item.querySelector(".sale-price span")?.textContent.trim() || "0";
        const price = parseFloat(rawPrice.replace(/[^\d.]/g, "")) || 0;
        const stock = item.querySelector(".stocklevel-small .stock-label")?.textContent.trim() || "On Order";
        const linkEl = item.querySelector(".image-container a");
        const link = linkEl ? normalizeAbsoluteUrl(linkEl.getAttribute("href")) : "#";

        const hiddenSku = item.querySelector("input[name='tyresku']")?.value?.trim() || "";
        const urlSku = extractSkuFromProductUrl(link);
        const sku = hiddenSku || urlSku || "No SKU";

        return {
            make,
            brand: make,
            model,
            pattern,
            price,
            stock,
            sku,
            link,
            source: "html",
        };
    });
}

function getNearestProductLinkFromJina(lines, brandIndex) {
    for (let i = brandIndex; i >= Math.max(0, brandIndex - 5); i--) {
        const line = lines[i] || "";
        const match = line.match(/\]\((https?:\/\/[^)\s"]*tyreproducts\?[^)\s"]*)/i);
        if (match) return normalizeAbsoluteUrl(match[1]);
    }
    return "#";
}

function parseJinaMarkdownProducts(text) {
    let raw = unwrapPreResponse(text);
    raw = decodeHtmlEntities(raw);

    const content = raw.includes("Markdown Content:")
        ? raw.split("Markdown Content:").slice(1).join("Markdown Content:")
        : raw;

    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const products = [];

    for (let i = 0; i < lines.length; i++) {
        const brandMatch = lines[i].match(/^\[\*\*(.+?)\*\*\]\(/);
        if (!brandMatch) continue;

        const make = brandMatch[1].trim();
        if (!make || make.length > 40) continue;

        let j = i + 1;
        while (j < lines.length && /^(SALE|\$\d+\s*EA|SOLD|OUT)$/i.test(lines[j])) j++;

        const sizeLine = lines[j] || "";
        if (!/(LT)?\d{3}\/?\d{2}R\d{2}/i.test(sizeLine)) continue;

        const pattern = lines[j + 1] || "No pattern";

        let stock = "No stock";
        let priceText = "";

        for (let k = j + 2; k < Math.min(lines.length, j + 12); k++) {
            const line = lines[k];

            if (/^(\d+\+?\s+IN STOCK(?:\s+NOW)?|ON ORDER|OUT OF STOCK|\d+\s+IN STOCK)$/i.test(line)) {
                stock = line.replace(/\s+NOW$/i, "").trim();
                continue;
            }

            if (/^\$\s*(\d+(?:\.\d+)?|TBC)$/i.test(line)) {
                priceText = line;
                break;
            }
        }

        const price = priceText.toUpperCase().includes("TBC")
            ? 0
            : parseFloat(priceText.replace(/[^\d.]/g, "")) || 0;

        const link = getNearestProductLinkFromJina(lines, i);
        const sku = extractSkuFromProductUrl(link) || "JINA-N/A";
        const model = `${sizeLine} ${pattern}`.trim();

        products.push({
            make,
            brand: make,
            model,
            pattern,
            price,
            stock,
            sku,
            link,
            source: "jina",
        });
    }

    return products;
}

function buildTempeTyreSearchUrl(size) {
    const cleanSize = String(size || "").trim();

    if (!cleanSize || ![5, 7].includes(cleanSize.length)) {
        return "";
    }

    const width = cleanSize.slice(0, 3);
    const diameter = cleanSize.slice(-2);
    const profile = cleanSize.length === 7
        ? cleanSize.slice(3, 5)
        : "Not%20Specified";

    return `https://www.tempetyres.com.au/tyres?TyreWidth=${width}&TyreProfile=${profile}&TyreDiameter=${diameter}`;
}

function getTempeSearchUrlsFromQueries(queries) {
    return [...new Set(
        queries
            .map(buildTempeTyreSearchUrl)
            .filter(Boolean)
    )];
}

function showTempeLinkCopiedToast(count) {
    showFAltToast(count === 1
        ? "Tempe link copied"
        : `${count} Tempe links copied`);
}

function legacyCopyText(text) {
    // Remember where keyboard focus was before the temporary clipboard
    // textarea steals it.
    const previousActiveElement = document.activeElement;

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;

    try {
        copied = document.execCommand("copy");
    } catch (error) {
        console.error("Legacy clipboard copy failed", error);
    }

    textarea.remove();

    // Restore the element that had focus before copying.
    if (
        previousActiveElement &&
        typeof previousActiveElement.focus === "function"
    ) {
        try {
            previousActiveElement.focus({ preventScroll: true });
        } catch {
            previousActiveElement.focus();
        }
    }

    return copied;
}

function copyTempeSearchLinksImmediate(queries) {
    const urls = getTempeSearchUrlsFromQueries(queries);
    if (!urls.length) return false;

    const text = urls.join("\n");

    // execCommand is intentionally tried first here because it runs
    // synchronously inside the user's Enter/click gesture.
    if (legacyCopyText(text)) {
        showTempeLinkCopiedToast(urls.length);
        return true;
    }

    // Modern clipboard API as a fallback.
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => showTempeLinkCopiedToast(urls.length))
            .catch((error) => console.error("Could not copy Tempe search link", error));

        return true;
    }

    return false;
}

function getCurrentSizeQueries() {
    return document.getElementById("skuInput")
        .value
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter((query) => [5, 7].includes(query.length));
}

function copyCurrentTempeSearchLinksImmediate() {
    return copyTempeSearchLinksImmediate(getCurrentSizeQueries());
}

function extractProductAnalytics(html) {
    const raw = String(html || "");

    // Look specifically inside dataLayer.push({...}) objects describing a
    // product page. Tempe exposes both the real product identifier and, for
    // some products such as Bridgestone, the useful hidden price here.
    const pushes = raw.matchAll(/dataLayer\.push\(\s*\{([\s\S]*?)\}\s*\);/gi);

    for (const match of pushes) {
        const block = match[1] || "";

        if (!/['"]ecomm_pagetype['"]\s*:\s*['"]product['"]/i.test(block)) {
            continue;
        }

        const valueMatch = block.match(
            /['"]ecomm_totalvalue['"]\s*:\s*['"]([\d,.]+)['"]/i
        );

        const productIdMatch = block.match(
            /['"]ecomm_prodid['"]\s*:\s*\[\s*['"]([^'"]+)['"]\s*\]/i
        );

        const hiddenPrice = valueMatch
            ? Number.parseFloat(valueMatch[1].replace(/,/g, ""))
            : null;

        const sku = productIdMatch
            ? String(productIdMatch[1] || "").trim().toUpperCase()
            : "";

        return {
            hiddenPrice: Number.isFinite(hiddenPrice) ? hiddenPrice : null,
            sku,
        };
    }

    return {
        hiddenPrice: null,
        sku: "",
    };
}

/* =========================
   Speed layer
   Saved results show instantly and are then refreshed, identical requests
   are shared, and sizes start loading while they are still being typed.
   ========================= */

const FALT_CACHE_KEY = "tempe:falt-cache:v1";
const LISTING_FRESH_MS = 90 * 1000;              // reused as-is, no request
const LISTING_KEEP_MS = 12 * 60 * 60 * 1000;     // shown instantly, then refreshed
const DETAIL_FRESH_MS = 10 * 60 * 1000;          // Bridgestone hidden price reused as-is
const DETAIL_KEEP_MS = 30 * 24 * 60 * 60 * 1000; // a product link's SKU never changes
const MAX_SAVED_LISTINGS = 30;
const MAX_SAVED_DETAILS = 600;
const DETAIL_CONCURRENCY = 8;                    // product pages in flight across all searches
const PC_DETAIL_CONCURRENCY = 2;                 // the PC helper fetches 2 Tempe pages at a time

const MISSING_SKUS = new Set(["", "No SKU", "No SKU available", "JINA-N/A"]);

let fAltCache = null;
let fAltCacheSaveTimer = 0;
const fAltListingLoads = new Map();
const fAltDetailLoads = new Map();
const fAltDetailQueue = [];
let fAltDetailActive = 0;

function getFAltCache() {
    if (fAltCache) return fAltCache;

    fAltCache = { listings: {}, details: {} };

    try {
        const saved = JSON.parse(window.localStorage.getItem(FALT_CACHE_KEY) || "null");
        if (saved && typeof saved === "object") {
            fAltCache.listings = saved.listings || {};
            fAltCache.details = saved.details || {};
        }
    } catch {}

    return fAltCache;
}

function keepNewestEntries(entries, keepMs, max) {
    const now = Date.now();

    return Object.fromEntries(
        Object.entries(entries || {})
            .filter(([, entry]) => entry && now - entry.t < keepMs)
            .sort((a, b) => b[1].t - a[1].t)
            .slice(0, max)
    );
}

function mergeNewestEntries(stored, current) {
    const merged = { ...(stored || {}) };

    for (const [key, entry] of Object.entries(current || {})) {
        if (!(merged[key]?.t >= entry.t)) merged[key] = entry;
    }

    return merged;
}

function saveFAltCacheSoon() {
    if (fAltCacheSaveTimer) return;
    fAltCacheSaveTimer = window.setTimeout(saveFAltCacheNow, 400);
}

function saveFAltCacheNow() {
    window.clearTimeout(fAltCacheSaveTimer);
    fAltCacheSaveTimer = 0;
    if (!fAltCache) return;

    // Other open pages (Tinder, a second F Alt Tab) save here too: keep the
    // newest copy of every entry instead of overwriting theirs.
    try {
        const stored = JSON.parse(window.localStorage.getItem(FALT_CACHE_KEY) || "null");
        if (stored && typeof stored === "object") {
            fAltCache.listings = mergeNewestEntries(stored.listings, fAltCache.listings);
            fAltCache.details = mergeNewestEntries(stored.details, fAltCache.details);
        }
    } catch {}

    fAltCache.listings = keepNewestEntries(fAltCache.listings, LISTING_KEEP_MS, MAX_SAVED_LISTINGS);
    fAltCache.details = keepNewestEntries(fAltCache.details, DETAIL_KEEP_MS, MAX_SAVED_DETAILS);

    try {
        window.localStorage.setItem(FALT_CACHE_KEY, JSON.stringify(fAltCache));
    } catch {
        // Storage is shared with the other pages: if it is full, keep only
        // the newest few sizes rather than failing every save.
        try {
            fAltCache.listings = keepNewestEntries(fAltCache.listings, LISTING_KEEP_MS, 8);
            window.localStorage.setItem(FALT_CACHE_KEY, JSON.stringify(fAltCache));
        } catch {}
    }
}

function compactProduct(item) {
    const { make, model, pattern, price, stock, sku, link, source } = item;
    return { make, model, pattern, price, stock, sku, link, source };
}

function reviveProduct(item) {
    return { ...item, brand: item.make };
}

function needsSkuLookup(item) {
    return MISSING_SKUS.has(String(item?.sku || ""));
}

function isBridgestone(item) {
    return String(item?.make || item?.brand || "").trim().toLowerCase() === "bridgestone";
}

function wantsProductDetail(item) {
    return !!item?.link && item.link !== "#" && (isBridgestone(item) || needsSkuLookup(item));
}

function savedDetailIsEnough(item, detail) {
    if (!detail) return false;
    if (Date.now() - detail.t < DETAIL_FRESH_MS) return true;

    // Only Bridgestone prices go stale; a found SKU is good for as long as it is kept.
    return !isBridgestone(item) && !!detail.sku;
}

function applyProductDetail(item, detail, { final = false } = {}) {
    const updated = { ...item };

    // Recover SKU from ecomm_prodid whenever the listing page did not expose
    // one. If analytics does not contain it, keep the URL-derived SKU as the
    // next fallback.
    if (needsSkuLookup(item)) {
        updated.sku =
            detail?.sku ||
            extractSkuFromProductUrl(item.link) ||
            (final ? "SKU unavailable" : item.sku);
    }

    // For Bridgestone, always preserve the public/listing price and override
    // the working price with ecomm_totalvalue when found.
    if (isBridgestone(item) && Number.isFinite(detail?.hiddenPrice)) {
        updated.originalPrice = Number(item.price || 0);
        updated.price = detail.hiddenPrice;
        updated.bridgestoneHiddenPrice = true;
    }

    return updated;
}

function runDetailLimited(task) {
    return new Promise((resolve, reject) => {
        fAltDetailQueue.push({ task, resolve, reject });
        pumpDetailQueue();
    });
}

function pumpDetailQueue() {
    // More than the PC helper can fetch at once would only hold its
    // connections and lock out the next search.
    const limit = usesPcReceiver() ? PC_DETAIL_CONCURRENCY : DETAIL_CONCURRENCY;

    while (fAltDetailActive < limit && fAltDetailQueue.length) {
        const { task, resolve, reject } = fAltDetailQueue.shift();
        fAltDetailActive++;

        Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
                fAltDetailActive--;
                pumpDetailQueue();
            });
    }
}

function loadListing(size) {
    if (fAltListingLoads.has(size)) return fAltListingLoads.get(size);

    const load = (async () => {
        const result = await fetchTextWithFallback(buildTempeTyreSearchUrl(size));
        const htmlProducts = parseTempetyresHtmlProducts(result.text);
        const products = htmlProducts.length
            ? htmlProducts
            : parseJinaMarkdownProducts(result.text);

        if (products.length) {
            getFAltCache().listings[size] = {
                t: Date.now(),
                products: products.map(compactProduct),
            };
            saveFAltCacheSoon();
        }

        return products;
    })().finally(() => fAltListingLoads.delete(size));

    fAltListingLoads.set(size, load);
    return load;
}

function loadProductDetail(link) {
    if (fAltDetailLoads.has(link)) return fAltDetailLoads.get(link);

    const load = runDetailLimited(async () => {
        const analytics = extractProductAnalytics(await fetchHtmlWithFallback(link));
        const detail = {
            t: Date.now(),
            sku: analytics.sku,
            hiddenPrice: analytics.hiddenPrice,
        };

        getFAltCache().details[link] = detail;
        saveFAltCacheSoon();
        return detail;
    }).finally(() => fAltDetailLoads.delete(link));

    fAltDetailLoads.set(link, load);
    return load;
}

// Loads one size and reports every improvement through onUpdate: saved
// results first (if any), then the live listing, then each product page as it
// lands. Product pages for saved results are requested alongside the live
// listing instead of after it. Never rejects; resolves with the final state.
async function searchTyreSize(size, onUpdate = () => {}) {
    const manualUrl = buildTempeTyreSearchUrl(size);

    if (!manualUrl) {
        const result = {
            products: [],
            manualUrl: "",
            error: "Invalid size",
            loading: false,
            pending: 0,
            savedAt: 0,
        };
        onUpdate(result);
        return result;
    }

    const saved = getFAltCache().listings[size];
    const savedAge = saved ? Date.now() - saved.t : Infinity;

    let base = savedAge < LISTING_KEEP_MS && Array.isArray(saved.products)
        ? saved.products.map(reviveProduct)
        : [];
    let savedAt = base.length ? saved.t : 0;
    let loading = !base.length || savedAge >= LISTING_FRESH_MS;
    let error = "";
    const details = new Map();

    const snapshot = () => {
        const products = base.map((item) => {
            if (!wantsProductDetail(item)) return item;

            const state = details.get(item.link);
            const updated = applyProductDetail(item, state?.detail, { final: state?.final });
            updated.detailPending = !!state?.pending;
            return updated;
        });

        return {
            products,
            manualUrl,
            error: error || (!loading && !products.length ? "No products parsed" : ""),
            loading,
            pending: products.filter((item) => item.detailPending).length,
            savedAt,
        };
    };

    const emit = () => {
        const result = snapshot();
        onUpdate(result);
        return result;
    };

    const resolveDetails = () => Promise.all(base.filter(wantsProductDetail).map((item) => {
        if (details.has(item.link)) return details.get(item.link).done;

        const cached = getFAltCache().details[item.link];
        const usable = cached && Date.now() - cached.t < DETAIL_KEEP_MS ? cached : null;
        const state = {
            detail: usable,
            final: !!usable,
            pending: !savedDetailIsEnough(item, usable),
            done: null,
        };
        details.set(item.link, state);

        if (!state.pending) return null;

        state.done = loadProductDetail(item.link)
            .then((detail) => {
                state.detail = detail;
                state.final = true;
            })
            .catch((err) => {
                console.warn(`Could not enrich product details for ${item.sku || item.link}:`, err);
            })
            .finally(() => {
                state.pending = false;
                emit();
            });

        return state.done;
    }));

    let detailWork = resolveDetails();
    emit();

    if (loading) {
        try {
            base = await loadListing(size);
            savedAt = 0;
        } catch (err) {
            console.error(`Failed to fetch tyre size ${size}:`, err);
            error = err.message || "Failed to fetch";
        }

        loading = false;
        detailWork = resolveDetails();
        emit();
    }

    await detailWork;
    return snapshot();
}

// Starts a size in the background so pressing Enter finds it ready.
// Through the PC helper only the listing is fetched early: product pages
// for a size that is still being typed would keep the PC busy.
function prefetchTyreSize(size) {
    if (!buildTempeTyreSearchUrl(size)) return;

    const saved = getFAltCache().listings[size];
    if (saved && Date.now() - saved.t < LISTING_FRESH_MS) return;

    if (usesPcReceiver()) loadListing(size).catch(() => {});
    else searchTyreSize(size).catch(() => {});
}

const fAltPrefetchTimers = new Map();

function handleSizeTyping(event) {
    const input = event.currentTarget || event.target;
    const shortSizesAllowed = !document.body.classList.contains("tinder-page");

    window.clearTimeout(fAltPrefetchTimers.get(input));

    const sizes = String(input.value || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((size) =>
            /^\d+$/.test(size) &&
            (size.length === 7 || (size.length === 5 && shortSizesAllowed))
        );

    if (!sizes.length) return;

    // A 5-digit width+rim search is also the start of a 7-digit size, so
    // only fetch it once typing has paused.
    const delay = sizes.some((size) => size.length === 5) ? 700 : 120;

    fAltPrefetchTimers.set(input, window.setTimeout(() => {
        sizes.forEach(prefetchTyreSize);
    }, delay));
}

function wireTyreSizePrefetch() {
    ["skuInput", "skuInput2"].forEach((id) => {
        document.getElementById(id)?.addEventListener("input", handleSizeTyping);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireTyreSizePrefetch);
} else {
    wireTyreSizePrefetch();
}

window.addEventListener("pagehide", saveFAltCacheNow);

async function fetchTyreProductsBySize(size) {
    const result = await searchTyreSize(size);

    return {
        products: result.products,
        manualUrl: result.manualUrl,
        error: result.products.length ? "" : result.error,
    };
}

function renderManualFallbackRow(query, manualUrl, message = "Could not load results automatically", reason = "") {
    return `<tr data-message="error">
        <td colspan="5">
            ${escapeHtml(message)} for <strong>${escapeHtml(query)}</strong>.<br>
            ${reason ? `<span class="falt-error-reason">${escapeHtml(reason)}</span><br>` : ""}
            Manual link: <a class="falt-manual-link" href="${manualUrl}" target="_blank">Open Tempe Tyres search</a>
        </td>
    </tr>`;
}

function renderFAltProductRow(item) {
    const make = item.make || item.brand || "No make";
    const model = item.model || item.pattern || "No model";

    // The listing gives "size pattern". The size is wrapped so phones can
    // show it smaller; the cell text stays exactly the same.
    const size = item.pattern && model.endsWith(` ${item.pattern}`)
        ? model.slice(0, -item.pattern.length).trim()
        : "";
    const modelHtml = size
        ? `<span class="falt-size">${escapeHtml(size)}</span> ${escapeHtml(item.pattern)}`
        : escapeHtml(model);
    const price = Number(item.price || 0);
    const originalPrice = Number(item.originalPrice ?? price);
    const stock = item.stock || "No stock";
    const sku = item.sku || "SKU unavailable";
    const link = item.link || "#";

    const safeStockAttr = escapeHtml(stock);
    const safeSku = escapeJsSingle(sku);

    // Rows are shown before their product page has loaded; say what is
    // still on its way rather than showing a price or SKU that may change.
    const pricePending = item.detailPending && isBridgestone(item);
    const skuPending = item.detailPending && needsSkuLookup(item);

    const skuDisplay = sku === "JINA-N/A"
        ? `<span title="Jina result does not expose the exact hidden SKU">JINA-N/A</span>`
        : escapeHtml(sku);
    const hasSku = !NO_COPY_SKUS.includes(sku);

    // Classes, not inline styles, so allaround.css can turn the row into a
    // card on phones. The stock brackets are separate so cards can drop them.
    return `<tr
        class="falt-row"
        style="background:${getStockColor(stock)};"
        data-stock="${safeStockAttr}"
    >
        <td class="falt-make">${escapeHtml(make)}</td>

        <td class="falt-model">
            <a class="falt-model-link" href="${link}" target="_blank">
                ${modelHtml}
            </a>
            <span class="falt-stock"><span class="falt-paren"> (</span>${escapeHtml(stock)}<span class="falt-paren">)</span></span>
        </td>

        <td class="falt-price">
            ${item.bridgestoneHiddenPrice
                ? `<div class="falt-price-was">$${originalPrice.toFixed(2)}</div>
                   <div class="falt-price-now falt-price-hidden">$${price.toFixed(2)}</div>`
                : `<span class="falt-price-now">$${price.toFixed(2)}</span>`}
            ${pricePending
                ? `<div class="falt-pending">checking…</div>`
                : ""}
        </td>

        ${skuPending
            ? `<td class="falt-sku is-pending">looking up…</td>`
            : hasSku
                ? `<td class="falt-sku falt-sku-copy" onclick="copySKU('${safeSku}')" title="Copy SKU">
            ${skuDisplay}
        </td>`
                : `<td class="falt-sku falt-sku-none">
            ${skuDisplay}
        </td>`}

        <td class="falt-action">
            <button
                type="button"
                ${skuPending ? "disabled" : ""}
                data-jobcard-product="${escapeHtml(JSON.stringify({ sku, make, model }))}"
                onclick="selectTyreForFitment(JSON.parse(this.dataset.jobcardProduct));"
            >
                Add Tyre
            </button>
        </td>
    </tr>`;
}

/* =========================
   TYRES TINDER
   ========================= */

let savedTinderResults = {};
let activeTinderResults = {};
let tinderSearchCounter = 0;
let tinderLastSearchKey = "";

function cloneTinderResults(data) {
    return Object.fromEntries(
        Object.entries(data || {}).map(([brand, sets]) => [
            brand,
            {
                front: [...(sets.front || [])],
                rear: [...(sets.rear || [])],
            },
        ])
    );
}

function tinderItemMatches(item, keyword) {
    if (!item) return false;

    return [
        item.brand,
        item.pattern,
        item.stock,
        item.sku,
        item.price,
    ].some((value) => String(value || "").toLowerCase().includes(keyword));
}

function applyTinderTextFilter(keyword) {
    const normalizedKeyword = String(keyword || "").toLowerCase().trim();
    const baseResults = Object.keys(activeTinderResults).length
        ? activeTinderResults
        : savedTinderResults;

    if (!normalizedKeyword) {
        renderTinderResults(cloneTinderResults(baseResults));
        return;
    }

    const filtered = {};

    for (const [brand, sets] of Object.entries(baseResults)) {
        const brandMatches = brand.toLowerCase().includes(normalizedKeyword);

        const matchingFront = brandMatches
            ? [...sets.front]
            : sets.front.filter((item) => tinderItemMatches(item, normalizedKeyword));

        const matchingRear = brandMatches
            ? [...sets.rear]
            : sets.rear.filter((item) => tinderItemMatches(item, normalizedKeyword));

        if (matchingFront.length || matchingRear.length) {
            filtered[brand] = {
                front: matchingFront,
                rear: matchingRear,
            };
        }
    }

    renderTinderResults(filtered);
}

async function Tinder() {
    const searchId = ++tinderSearchCounter;
    const skuInput = document.getElementById("skuInput").value.trim();
    const skuInput2 = document.getElementById("skuInput2").value.trim();
    const resultsTable = document.querySelector("#resultsTable tbody");
    // Only sizes that are looked up (7 digits, see fetchTyreDetails).
    const sizesText = [skuInput, skuInput2].filter((size) => size.length === 7).map(escapeHtml).join(" and ");
    resultsTable.innerHTML = `<tr data-message="loading"><td colspan="5">Matching ${sizesText || "tyres"}…</td></tr>`;
    tinderLastSearchKey = `${skuInput}|${skuInput2}`;
    closeFAltKeyboard();

    const fetchTyreDetails = async (size) => {
        if (!size || size.length !== 7) return [];

        const result = await fetchTyreProductsBySize(size);
        return result.products.map((item) => ({
            brand: item.brand || item.make || "No brand available",
            pattern: item.pattern || item.model || "No pattern available",
            price: item.price ? item.price.toFixed(2) : "0.00",
            stock: item.stock || "On Order",
            sku: item.sku || "No SKU available",
            link: item.link || result.manualUrl || "#",
        }));
    };

    const [front, rear] = await Promise.all([
        fetchTyreDetails(skuInput),
        fetchTyreDetails(skuInput2),
    ]);

    // A newer search was started while this one loaded.
    if (searchId !== tinderSearchCounter) return;

    const grouped = {};
    savedTinderResults = {};

    [...front, ...rear].forEach((item) => {
        grouped[item.brand] = grouped[item.brand] || { front: [], rear: [] };
        (front.includes(item) ? grouped[item.brand].front : grouped[item.brand].rear).push(item);

        savedTinderResults[item.brand] = savedTinderResults[item.brand] || { front: [], rear: [] };
        (front.includes(item) ? savedTinderResults[item.brand].front : savedTinderResults[item.brand].rear).push(item);
    });

    activeTinderResults = cloneTinderResults(savedTinderResults);
    renderTinderResults(cloneTinderResults(activeTinderResults));
}

function renderTinderResults(data) {
    const resultsTable = document.querySelector("#resultsTable tbody");
    const rows = [];

    const sorted = Object.keys(data).sort();
    sorted.forEach((brand) => {
        const { front, rear } = data[brand];
        front.sort((a, b) => a.pattern.localeCompare(b.pattern));
        rear.sort((a, b) => a.pattern.localeCompare(b.pattern));

        const rowCount = Math.max(front.length, rear.length);
        const safeBrand = escapeHtml(brand || "");

        for (let i = 0; i < rowCount; i++) {
            const f = front[i] || {}, r = rear[i] || {};

            const safeFrontSku = escapeJsSingle(f.sku || "");
            const safeRearSku = escapeJsSingle(r.sku || "");
            const frontSkuClass = hasTinderSku(f) ? "" : " tinder-sku-none";
            const rearSkuClass = hasTinderSku(r) ? "" : " tinder-sku-none";

            // Classes are for the phone cards (allaround.css); the brand cell
            // is hidden there and every card shows data-brand instead.
            const row = `<tr class="tinder-row" data-brand="${safeBrand.toLowerCase()}">
                ${i === 0 ? `<td class="tinder-brand" rowspan="${rowCount}">${safeBrand}</td>` : ""}
                <td class="tinder-front" style="background:${getStockColor(f.stock)};" data-stock="${escapeHtml(f.stock || "")}">
                    ${f.pattern ? `<a href="${f.link}" target="_blank">${escapeHtml(f.pattern)}</a>` : "No data"}${f.price ? ` - $${escapeHtml(f.price)}` : ""} (${escapeHtml(f.stock || "No stock")})</td>
                <td class="tinder-rear" style="background:${getStockColor(r.stock)};" data-stock="${escapeHtml(r.stock || "")}">
                    ${r.pattern ? `<a href="${r.link}" target="_blank">${escapeHtml(r.pattern)}</a>` : "No data"}${r.price ? ` - $${escapeHtml(r.price)}` : ""} (${escapeHtml(r.stock || "No stock")})</td>

                <td class="tinder-sku tinder-front-sku${frontSkuClass}" onclick="copySKU('${safeFrontSku}')">
                    ${escapeHtml(f.sku || "No SKU")}
                </td>

                <td class="tinder-sku tinder-rear-sku${rearSkuClass}" onclick="copySKU('${safeRearSku}')">
                    ${escapeHtml(r.sku || "No SKU")}
                </td>
            </tr>`;
            rows.push(row);
        }
    });

    resultsTable.innerHTML = sorted.length
        ? rows.join("")
        : `<tr><td colspan="5">No matching tyres found.</td></tr>`;
}

function hasTinderSku(item) {
    return !!item.sku && !NO_COPY_SKUS.includes(item.sku);
}

function removeOutOfStockTinder() {
    const filtered = {};

    for (const [brand, sets] of Object.entries(savedTinderResults)) {
        const goodFront = sets.front.filter((item) => isAvailableStock(item.stock));
        const goodRear = sets.rear.filter((item) => isAvailableStock(item.stock));

        if (goodFront.length && goodRear.length) {
            filtered[brand] = {
                front: goodFront,
                rear: goodRear,
            };
        }
    }

    activeTinderResults = cloneTinderResults(filtered);

    const currentKeyword = document.getElementById("searchBar")?.value || "";
    applyTinderTextFilter(currentKeyword);
}

/* =========================
   F ALT TAB
   ========================= */

let fAltSearch = null;
let fAltAvailableOnly = false;
let fAltLastSearchText = "";
let fAltRenderQueued = false;
let fAltRowElements = new Map();

async function checkPrices({ copyLink = true } = {}) {
    const skuInputBox = document.getElementById("skuInput");
    const skuInput = skuInputBox.value.trim().split("\n");
    fAltLastSearchText = skuInputBox.value.trim();

    // Search button clicks still copy automatically.
    // Enter-key searches already copied directly inside handleSkuInputEnter().
    if (copyLink) {
        copyCurrentTempeSearchLinksImmediate();
    }

    const queries = [...new Set(skuInput.map((line) => line.trim()).filter(Boolean))];

    const search = {
        startedAt: Date.now(),
        finishedAt: 0,
        revealOnPhone: true,
        sections: queries.map((query) => {
            const invalid = ![5, 7].includes(query.length);

            return {
                query,
                invalid,
                products: [],
                manualUrl: buildTempeTyreSearchUrl(query),
                error: "",
                loading: !invalid,
                pending: 0,
                savedAt: 0,
            };
        }),
    };

    fAltSearch = search;
    fAltAvailableOnly = false;
    syncFAltAvailableButton();

    // Results stream into the table as they arrive: saved results first,
    // then the live listing, then each Bridgestone price / missing SKU.
    const work = Promise.all(
        search.sections
            .filter((section) => !section.invalid)
            .map((section) => searchTyreSize(section.query, (update) => {
                if (fAltSearch !== search) return;
                Object.assign(section, update);
                queueFAltRender();
            }))
    );

    // Saved results were applied synchronously above, so the first paint
    // already shows them.
    renderFAltResults();
    closeFAltKeyboard();

    await work;

    if (fAltSearch === search) {
        search.finishedAt = Date.now();
        queueFAltRender();
    }
}

function queueFAltRender() {
    if (fAltRenderQueued) return;
    fAltRenderQueued = true;

    const run = () => {
        fAltRenderQueued = false;
        renderFAltResults();
    };

    // Coalesce bursts of product-page updates into one paint.
    if (!document.hidden && window.requestAnimationFrame) {
        window.requestAnimationFrame(run);
    } else {
        window.setTimeout(run, 50);
    }
}

// The reason a size did not load, as shown under "Could not load results".
function describeFAltLoadError(error) {
    switch (error) {
        case "No products parsed":
            return "";
        case "empty-response":
            return "Tempe sent back an empty page.";
        case "captcha-or-blocked-response":
            return "Tempe asked for a captcha or blocked the request. Open the search below once, then try again.";
        default:
            return error || "";
    }
}

function renderFAltMessageRow(html) {
    return `<tr data-message="info"><td colspan="5">${html}</td></tr>`;
}

function renderFAltResults() {
    const tbody = document.querySelector("#resultsTable tbody");
    const search = fAltSearch;
    if (!tbody || !search) return;

    const rows = [];
    const products = [];

    for (const section of search.sections) {
        const query = section.query;

        if (section.invalid) {
            rows.push([`invalid|${query}`, renderFAltMessageRow(`Invalid input: ${escapeHtml(query)}`)]);
        } else if (section.products.length) {
            section.products.forEach((item) => products.push({ query, item }));
        } else if (section.loading) {
            rows.push([`loading|${query}`, renderFAltMessageRow(`Searching ${escapeHtml(query)}…`)]);
        } else {
            rows.push([`error|${query}`, renderManualFallbackRow(
                query,
                section.manualUrl,
                section.error === "No products parsed" ? "Tempe listed no tyres" : "Could not load results",
                describeFAltLoadError(section.error)
            )]);
        }
    }

    // Cheapest first by the working price (the Bridgestone hidden price once known).
    products.sort((a, b) => Number(a.item.price || 0) - Number(b.item.price || 0));

    const seen = new Map();

    products.forEach(({ query, item }) => {
        const id = `${query}|${item.link && item.link !== "#" ? item.link : `${item.make}|${item.model}`}`;
        const count = (seen.get(id) || 0) + 1;
        seen.set(id, count);
        rows.push([`${id}|${count}`, renderFAltProductRow(item)]);
    });

    if (!rows.length) {
        rows.push(["empty", renderFAltMessageRow("No results returned.")]);
    }

    reconcileFAltRows(tbody, rows);
    applyFAltRowFilters();
    updateFAltStatus(search);

    // Phones: once this search has something to show, bring the first card
    // into view. Only once, so later updates never move the page.
    if (search.revealOnPhone && (products.length || search.finishedAt)) {
        search.revealOnPhone = false;
        revealFAltResultsOnPhone();
    }

    // Saved rows stay dimmed until the live listing has replaced them.
    tbody.style.opacity = search.sections.some((section) => section.loading && section.products.length)
        ? "0.65"
        : "";
}

// Rows whose HTML is unchanged keep their element, so a row being clicked or
// hovered is not replaced while later results stream in.
function reconcileFAltRows(tbody, rows) {
    const next = new Map();
    const template = document.createElement("template");

    const elements = rows.map(([key, html]) => {
        const previous = fAltRowElements.get(key);
        let element = previous?.html === html ? previous.element : null;

        if (!element) {
            template.innerHTML = html.trim();
            element = template.content.firstElementChild;
        }

        next.set(key, { html, element });
        return element;
    });

    const keep = new Set(elements);
    Array.from(tbody.children).forEach((row) => {
        if (!keep.has(row)) row.remove();
    });

    elements.forEach((element, index) => {
        if (tbody.children[index] !== element) {
            tbody.insertBefore(element, tbody.children[index] || null);
        }
    });

    fAltRowElements = next;
}

function formatSavedAge(time) {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (!Number.isFinite(minutes) || minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    return `${Math.round(minutes / 60)} h ago`;
}

function describeFAltStatus(search, shown = null) {
    const sections = search.sections.filter((section) => !section.invalid);
    if (!sections.length) return "";

    const count = sections.reduce((sum, section) => sum + section.products.length, 0);
    const pending = sections.reduce((sum, section) => sum + (section.pending || 0), 0);
    const loading = sections.some((section) => section.loading);
    const savedAt = Math.min(
        ...sections
            .filter((section) => section.savedAt && section.products.length)
            .map((section) => section.savedAt)
    );
    // "7 of 10 tyres" while the filter or Available Only hides some.
    const tyres = shown !== null && shown !== count
        ? `${shown} of ${count} tyres`
        : `${count} tyre${count === 1 ? "" : "s"}`;

    if (loading && !count) return "Searching…";
    if (loading) return `${tyres} · saved ${formatSavedAge(savedAt)} · refreshing…`;
    if (pending) return `${tyres} · checking ${pending} more…`;

    if (sections.some((section) => section.error && section.products.length)) {
        return `${tyres} · saved ${formatSavedAge(savedAt)} · live refresh failed`;
    }

    if (search.finishedAt) {
        return `${tyres} · ${((search.finishedAt - search.startedAt) / 1000).toFixed(1)}s`;
    }

    return tyres;
}

function updateFAltStatus(search) {
    const status = document.getElementById("resultsStatus");
    if (!status || !search) return;

    const text = describeFAltStatus(search, countShownFAltProducts());
    if (status.textContent !== text) status.textContent = text;
    status.style.display = text ? "" : "none";
}

// Product rows left visible by the text filter and Available Only, or null
// while neither is on.
function countShownFAltProducts() {
    const keyword = (document.getElementById("searchBar")?.value || "").trim();
    if (!keyword && !fAltAvailableOnly) return null;

    return [...document.querySelectorAll("#resultsTable tbody tr[data-stock]")]
        .filter((row) => row.style.display !== "none")
        .length;
}

/* =========================
   SHARED FILTERS
   ========================= */

function removeOutOfStock(event) {
    // The second click of a desktop double-click would turn it straight
    // off again.
    if (event?.detail > 1 && !isFAltTouchScreen()) return;

    // A toggle: tap again to show every tyre. Remembered so rows that
    // stream in afterwards are filtered too.
    fAltAvailableOnly = !fAltAvailableOnly;
    syncFAltAvailableButton();
    applyFAltRowFilters();
    updateFAltStatus(fAltSearch);
}

function syncFAltAvailableButton() {
    document.getElementById("availableOnlyButton")
        ?.setAttribute("aria-pressed", String(fAltAvailableOnly));
}

function filterTable() {
    const searchBar = document.getElementById("searchBar");
    const keyword = searchBar?.value.toLowerCase().trim() || "";

    // Tyres Tinder uses grouped rows with rowspans. Re-rendering the matching
    // data keeps every brand cell and rowspan valid after searches like "runflat".
    if (
        document.body.classList.contains("tinder-page") &&
        Object.keys(savedTinderResults).length
    ) {
        applyTinderTextFilter(keyword);
        return;
    }

    // Standard row filtering for F Alt Tab.
    applyFAltRowFilters();
    updateFAltStatus(fAltSearch);
}

// Applies both the text filter and Available Only, so neither undoes the other.
function applyFAltRowFilters() {
    const keyword = (document.getElementById("searchBar")?.value || "").toLowerCase().trim();
    const rows = document.querySelectorAll("#resultsTable tbody tr");

    rows.forEach((row) => {
        if (row.dataset.message) {
            row.style.display = "";
            return;
        }

        const brand = (row.dataset.brand || "").toLowerCase();
        const matchesKeyword =
            !keyword ||
            brand.includes(keyword) ||
            [...row.cells].some((cell) => cell.textContent.toLowerCase().includes(keyword));
        const inStock = !fAltAvailableOnly || isAvailableStock(row.dataset.stock || "");

        row.style.display = matchesKeyword && inStock ? "" : "none";
    });
}

/* =========================
   PHONES AND TABLETS
   allaround.css shows result cards and keeps the search card at the top of
   the screen for FALT_BAR_QUERY. Keep the two in step.
   ========================= */

const FALT_BAR_QUERY = "screen and (max-width: 740px), screen and (max-height: 500px) and (pointer: coarse)";
const FALT_SIZE_INPUT_IDS = ["skuInput", "skuInput2"];

// Where the last tap landed (see keyboardClosedByTap).
let fAltLastTap = { target: null, at: 0 };

function matchesFAltMedia(query) {
    return !!window.matchMedia && window.matchMedia(query).matches;
}

function isFAltTouchScreen() {
    return matchesFAltMedia("(pointer: coarse)");
}

function usesFAltPhoneBar() {
    return matchesFAltMedia(FALT_BAR_QUERY);
}

// Phones close the keyboard after a search so it does not cover the
// results. Wider touch screens (an iPad, maybe with a keyboard case) keep
// focus in the size box, as desktop does.
function closesFAltKeyboard() {
    return isFAltTouchScreen() && usesFAltPhoneBar();
}

function closeFAltKeyboard() {
    const active = document.activeElement;
    if (closesFAltKeyboard() && FALT_SIZE_INPUT_IDS.includes(active?.id)) {
        active.blur();
    }
}

// A new search started while scrolled down the old cards: go back to the
// first card, just below the sticky search card.
function revealFAltResultsOnPhone() {
    const bar = document.querySelector(".price-checker-page .controls-card");
    const results = document.querySelector(".price-checker-page .results-card");
    if (!bar || !results || !usesFAltPhoneBar()) return;

    const top = results.getBoundingClientRect().top + window.scrollY - bar.offsetHeight - 8;
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
}

// The status chip sits in the sticky search card on phones, so it stays in
// view while the cards scroll, and beside the results heading elsewhere.
function placeFAltStatusChip() {
    const status = document.getElementById("resultsStatus");
    const bar = document.querySelector(".price-checker-page .controls-card");
    const home = document.querySelector(".price-checker-page .results-card .section-heading");
    if (!status || !bar || !home) return;

    const target = usesFAltPhoneBar() ? bar : home;
    if (status.parentElement !== target) target.appendChild(status);
}

// Shorter placeholders where the search card is narrow, so they are not cut
// off. The HTML placeholder is kept for wider screens.
function placeFAltPlaceholders() {
    const narrow = usesFAltPhoneBar();

    document.querySelectorAll("input[data-phone-placeholder]").forEach((input) => {
        input.dataset.widePlaceholder ??= input.placeholder;
        input.placeholder = narrow ? input.dataset.phonePlaceholder : input.dataset.widePlaceholder;
    });
}

// True when the size box lost focus because the user tapped a control or a
// result (Search, Add Tyre, an SKU, another field). That tap does its own
// thing, so the Done search below must not run or replace the results under
// the finger. The iPhone keyboard's Done button is not a tap on the page.
function keyboardClosedByTap(input) {
    const { target, at } = fAltLastTap;
    if (!target || input.contains(target) || Date.now() - at > 800) return false;

    // Moving between the Tinder size boxes keeps the keyboard open.
    if (FALT_SIZE_INPUT_IDS.includes(target.id)) return false;

    return !!target.closest?.("#resultsTable, button, a, input, select, textarea, label, [onclick]");
}

// iPhone number pads have no return key: Done only closes the keyboard, so
// the size box losing focus is the cue to search. Nothing happens if focus
// has come back to the box (or the whole page lost focus), or if the text
// is what was last searched (Enter, Search or an earlier Done). Every blur
// counts, not just "change", which only fires for a box edited since it was
// last focused.
function handleSkuInputBlur(event) {
    const input = event.currentTarget;
    if (!isFAltTouchScreen() || keyboardClosedByTap(input)) return;

    window.setTimeout(() => {
        if (document.activeElement === input || !document.hasFocus()) return;

        const text = input.value.trim();
        if (text && text !== fAltLastSearchText) checkPrices({ copyLink: false });
    }, 150);
}

// Tyres Tinder: the same for the two size boxes, once both sizes are filled
// in. Moving on to the other size box is not a search.
function handleTinderSizeBlur(event) {
    if (!isFAltTouchScreen() || keyboardClosedByTap(event.currentTarget)) return;

    window.setTimeout(() => {
        if (FALT_SIZE_INPUT_IDS.includes(document.activeElement?.id) || !document.hasFocus()) return;

        const front = document.getElementById("skuInput")?.value.trim() || "";
        const rear = document.getElementById("skuInput2")?.value.trim() || "";
        const key = `${front}|${rear}`;

        if (/^\d{7}\|\d{7}$/.test(key) && key !== tinderLastSearchKey) Tinder();
    }, 150);
}

// Keyboard focus moving back up the cards would stop under the sticky
// search card, out of sight: nudge the page so it shows below the card.
// (scroll-padding would do this too, but it also scrolls the page every
// time the size or filter box in the card gets focus.)
function keepFAltFocusBelowBar(event) {
    const bar = document.querySelector(".price-checker-page .controls-card");
    if (!bar || !usesFAltPhoneBar()) return;

    window.requestAnimationFrame(() => {
        const barBottom = bar.getBoundingClientRect().bottom;
        const top = event.target.getBoundingClientRect().top;
        if (top < barBottom + 8) window.scrollBy(0, top - barBottom - 8);
    });
}

// The filter applies as you type; its Done/Enter key just closes the keyboard.
function handleFilterEnter(event) {
    if (event.key === "Enter" && isFAltTouchScreen()) event.currentTarget.blur();
}

function onFAltMediaChange(query, listener) {
    const list = window.matchMedia?.(query);
    if (list?.addEventListener) list.addEventListener("change", listener);
    else list?.addListener?.(listener);
}

function wireFAltPhoneLayout() {
    document.addEventListener("pointerdown", (event) => {
        fAltLastTap = { target: event.target, at: Date.now() };
    }, true);

    // A touch that turns into a scroll was not a tap on anything.
    document.addEventListener("pointercancel", () => {
        fAltLastTap = { target: null, at: 0 };
    }, true);

    if (document.body.classList.contains("price-checker-page")) {
        document.getElementById("skuInput")?.addEventListener("blur", handleSkuInputBlur);
        document.getElementById("resultsTable")?.addEventListener("focusin", keepFAltFocusBelowBar);

        placeFAltStatusChip();
        onFAltMediaChange(FALT_BAR_QUERY, placeFAltStatusChip);
    }

    if (document.body.classList.contains("tinder-page")) {
        FALT_SIZE_INPUT_IDS.forEach((id) => {
            document.getElementById(id)?.addEventListener("blur", handleTinderSizeBlur);
        });
    }

    placeFAltPlaceholders();
    onFAltMediaChange(FALT_BAR_QUERY, placeFAltPlaceholders);

    document.getElementById("searchBar")?.addEventListener("keydown", handleFilterEnter);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireFAltPhoneLayout);
} else {
    wireFAltPhoneLayout();
}
