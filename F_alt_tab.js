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

async function fetchTextWithFallback(targetUrl) {
    const viaPc = window.TempeCostarClient?.isPaired();
    console.log(viaPc ? "Fetching through paired PC receiver:" : "Fetching through Chrome extension:", targetUrl);

    const result = viaPc
        ? await window.TempeCostarClient.fetchTyres(targetUrl)
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

function copySKU(sku) {
    if (!sku || sku === "No SKU" || sku === "No SKU available" || sku === "JINA-N/A") return;

    navigator.clipboard.writeText(sku)
        .then(() => {
            const toast = document.createElement("div");
            toast.textContent = `Copied: ${sku}`;
            toast.style.position = "fixed";
            toast.style.bottom = "20px";
            toast.style.right = "20px";
            toast.style.padding = "8px 12px";
            toast.style.background = "#16a34a";
            toast.style.color = "white";
            toast.style.borderRadius = "6px";
            toast.style.fontSize = "14px";
            toast.style.opacity = "0";
            toast.style.transition = "opacity 0.3s ease";
            toast.style.zIndex = "9999";
            document.body.appendChild(toast);

            requestAnimationFrame(() => {
                toast.style.opacity = "1";
            });

            setTimeout(() => {
                toast.style.opacity = "0";
                setTimeout(() => toast.remove(), 300);
            }, 800);
        })
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
        const tyreInput = e.currentTarget;
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
    const toast = document.createElement("div");
    toast.textContent = count === 1
        ? "Tempe link copied"
        : `${count} Tempe links copied`;
    toast.style.position = "fixed";
    toast.style.bottom = "20px";
    toast.style.right = "20px";
    toast.style.padding = "8px 12px";
    toast.style.background = "#16a34a";
    toast.style.color = "white";
    toast.style.borderRadius = "6px";
    toast.style.fontSize = "14px";
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease";
    toast.style.zIndex = "9999";
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = "1";
    });

    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 800);
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
    while (fAltDetailActive < DETAIL_CONCURRENCY && fAltDetailQueue.length) {
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
function prefetchTyreSize(size) {
    if (!buildTempeTyreSearchUrl(size)) return;

    const saved = getFAltCache().listings[size];
    if (saved && Date.now() - saved.t < LISTING_FRESH_MS) return;

    searchTyreSize(size).catch(() => {});
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

function renderManualFallbackRow(query, manualUrl, message = "Could not load results automatically") {
    return `<tr data-message="error">
        <td colspan="5">
            ${escapeHtml(message)} for <strong>${escapeHtml(query)}</strong>.<br>
            Manual link: <a href="${manualUrl}" target="_blank" style="color:#93c5fd;">Open Tempe Tyres search</a>
        </td>
    </tr>`;
}

function renderFAltProductRow(item) {
    const make = item.make || item.brand || "No make";
    const model = item.model || item.pattern || "No model";
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

    return `<tr 
        style="background:${getStockColor(stock)};"
        data-stock="${safeStockAttr}"
    >
        <td>${escapeHtml(make)}</td>

        <td>
            <a href="${link}" target="_blank" style="color:#93c5fd; text-decoration:none;">
                ${escapeHtml(model)}
            </a>
            <span style="opacity:0.8; font-size:0.9em;"> (${escapeHtml(stock)})</span>
        </td>

        <td>
            ${item.bridgestoneHiddenPrice
                ? `<div style="text-decoration:line-through; opacity:0.55;">$${originalPrice.toFixed(2)}</div>
                   <div style="font-weight:700;">$${price.toFixed(2)}</div>`
                : `$${price.toFixed(2)}`}
            ${pricePending
                ? `<div style="font-size:0.75em; opacity:0.7;">checking…</div>`
                : ""}
        </td>

        ${skuPending
            ? `<td style="opacity:0.7;">looking up…</td>`
            : `<td onclick="copySKU('${safeSku}')" style="cursor:pointer; color:#60a5fa;">
            ${skuDisplay}
        </td>`}

        <td>
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
    resultsTable.innerHTML = "";

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

            const row = `<tr data-brand="${safeBrand.toLowerCase()}">
                ${i === 0 ? `<td rowspan="${rowCount}">${safeBrand}</td>` : ""}
                <td style="background:${getStockColor(f.stock)};" data-stock="${escapeHtml(f.stock || "")}">
                    ${f.pattern ? `<a href="${f.link}" target="_blank">${escapeHtml(f.pattern)}</a>` : "No data"}${f.price ? ` - $${escapeHtml(f.price)}` : ""} (${escapeHtml(f.stock || "No stock")})</td>
                <td style="background:${getStockColor(r.stock)};" data-stock="${escapeHtml(r.stock || "")}">
                    ${r.pattern ? `<a href="${r.link}" target="_blank">${escapeHtml(r.pattern)}</a>` : "No data"}${r.price ? ` - $${escapeHtml(r.price)}` : ""} (${escapeHtml(r.stock || "No stock")})</td>

                <td onclick="copySKU('${safeFrontSku}')" style="cursor:pointer; color:#60a5fa;">
                    ${escapeHtml(f.sku || "No SKU")}
                </td>

                <td onclick="copySKU('${safeRearSku}')" style="cursor:pointer; color:#60a5fa;">
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
let fAltRenderQueued = false;
let fAltRowElements = new Map();

async function checkPrices({ copyLink = true } = {}) {
    const skuInput = document.getElementById("skuInput").value.trim().split("\n");

    // Search button clicks still copy automatically.
    // Enter-key searches already copied directly inside handleSkuInputEnter().
    if (copyLink) {
        copyCurrentTempeSearchLinksImmediate();
    }

    const queries = [...new Set(skuInput.map((line) => line.trim()).filter(Boolean))];

    const search = {
        startedAt: Date.now(),
        finishedAt: 0,
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
                "Could not load results. Check the PC receiver connection or desktop Chrome Fetch Bridge"
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

function describeFAltStatus(search) {
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
    const tyres = `${count} tyre${count === 1 ? "" : "s"}`;

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
    if (!status) return;

    const text = describeFAltStatus(search);
    status.textContent = text;
    status.style.display = text ? "" : "none";
}

/* =========================
   SHARED FILTERS
   ========================= */

function removeOutOfStock() {
    // Remembered so rows that stream in afterwards are filtered too.
    fAltAvailableOnly = true;
    applyFAltRowFilters();
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
