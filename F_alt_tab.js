console.log("F_alt_tab.js loaded successfully");

/* =========================
   Shared helpers
   ========================= */

const LOCAL_PROXY = "http://localhost:8787/proxy?url=";
const CF_PROXY = "https://pepektires.tommyvenzin.workers.dev/?url=";
const JINA_PROXY = "https://r.jina.ai/http://";
const JINA_PROXY_WWW = "https://r.jina.ai/http://www.";

function getProxyCandidates() {
    return [LOCAL_PROXY];
}

function buildProxyUrl(targetUrl, proxyBase) {
    if (proxyBase.includes("?url=")) {
        return proxyBase + encodeURIComponent(targetUrl);
    }

    const sanitized = targetUrl
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "");

    return proxyBase + sanitized;
}

function extractHtmlFromProxyPayload(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed.startsWith("{")) return text;

    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.contents === "string") return parsed.contents;
        if (typeof parsed.body === "string") return parsed.body;
        if (typeof parsed.html === "string") return parsed.html;
    } catch {}

    return text;
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
    let lastError = null;

for (const proxyBase of getProxyCandidates()) {
    try {
        console.log("Trying proxy:", proxyBase);

        const proxyUrl = buildProxyUrl(targetUrl, proxyBase);
            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

            let text = await res.text();
            text = extractHtmlFromProxyPayload(text);

            if (!text || !text.trim()) {
                throw new Error("empty-response");
            }

            const hasProducts = text.includes("product-container");

            if (!hasProducts && looksLikeBlockedPage(text)) {
                throw new Error("captcha-or-blocked-response");
            }

            return {
                text,
                proxyBase,
                isJina: proxyBase.includes("r.jina.ai") || looksLikeJinaResponse(text),
            };
        } catch (err) {
            lastError = err;
            console.warn(`Proxy failed: ${proxyBase}`, err);
        }
    }

    throw lastError || new Error("All proxy endpoints failed.");
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
        const last = clean.split("-").pop()?.replace(/[^a-z0-9]/gi, "").trim();
        if (last && last.length >= 4 && last.length <= 20) return last.toUpperCase();
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

function selectTyreForFitment(tyre) {
    try {
        localStorage.setItem("fitment:selectedTyre", JSON.stringify({
            ...tyre,
            savedAt: new Date().toISOString(),
        }));
        window.location.href = "Fitment_Planner.html";
    } catch (err) {
        console.error("Could not save tyre for fitment planning", err);
        alert("Could not open Fitment Planner. Please try again.");
    }
}

function handleSkuInputEnter(e) {
    if (e.key === "Enter") {
        e.preventDefault();
        checkPrices();
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
        const sku = item.querySelector("input[name='tyresku']")?.value || "No SKU";
        const linkEl = item.querySelector(".image-container a");
        const link = linkEl ? normalizeAbsoluteUrl(linkEl.getAttribute("href")) : "#";

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

async function fetchTyreProductsBySize(size) {
    if (!size || ![5, 7].includes(size.length)) {
        return {
            products: [],
            manualUrl: "",
            error: "Invalid size",
        };
    }

    const w = size.slice(0, 3);
    const d = size.slice(-2);
    const p = size.length === 7 ? size.slice(3, 5) : "Not%20Specified";
    const targetUrl = `https://www.tempetyres.com.au/tyres?TyreWidth=${w}&TyreProfile=${p}&TyreDiameter=${d}`;

    try {
        const result = await fetchTextWithFallback(targetUrl);
        const products = result.isJina
            ? parseJinaMarkdownProducts(result.text)
            : parseTempetyresHtmlProducts(result.text);

        const finalProducts = products.length ? products : parseJinaMarkdownProducts(result.text);

        return {
            products: finalProducts,
            manualUrl: targetUrl,
            error: finalProducts.length ? "" : "No products parsed",
        };
    } catch (err) {
        console.error(`Failed to fetch tyre size ${size}:`, err);
        return {
            products: [],
            manualUrl: targetUrl,
            error: err.message || "Failed to fetch",
        };
    }
}

function renderManualFallbackRow(query, manualUrl, message = "Could not load results automatically") {
    return `<tr>
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
    const stock = item.stock || "No stock";
    const sku = item.sku || "No SKU";
    const link = item.link || "#";

    const safeStockAttr = escapeHtml(stock);
    const safeSku = escapeJsSingle(sku);
    const safeMake = escapeJsSingle(make);
    const safeModel = escapeJsSingle(model);
    const safeLink = escapeJsSingle(link);

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

        <td>$${price.toFixed(2)}</td>

        <td onclick="copySKU('${safeSku}')" style="cursor:pointer; color:#60a5fa;">
            ${skuDisplay}
        </td>

        <td>
            <button
                type="button"
                onclick="selectTyreForFitment({ sku: '${safeSku}', make: '${safeMake}', model: '${safeModel}', price: ${price.toFixed(2)}, stock: '${escapeJsSingle(stock)}', link: '${safeLink}' });"
            >
                Add to Fitment Planner
            </button>
        </td>
    </tr>`;
}

/* =========================
   TYRES TINDER
   ========================= */

let savedTinderResults = {};

async function Tinder() {
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

    const grouped = {};
    savedTinderResults = {};

    [...front, ...rear].forEach((item) => {
        grouped[item.brand] = grouped[item.brand] || { front: [], rear: [] };
        (front.includes(item) ? grouped[item.brand].front : grouped[item.brand].rear).push(item);

        savedTinderResults[item.brand] = savedTinderResults[item.brand] || { front: [], rear: [] };
        (front.includes(item) ? savedTinderResults[item.brand].front : savedTinderResults[item.brand].rear).push(item);
    });

    renderTinderResults(grouped);
}

function renderTinderResults(data) {
    const resultsTable = document.querySelector("#resultsTable tbody");
    resultsTable.innerHTML = "";

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
            resultsTable.innerHTML += row;
        }
    });

    if (sorted.length === 0) {
        resultsTable.innerHTML = `<tr><td colspan="5">No matching tyres found.</td></tr>`;
    }
}

function removeOutOfStockTinder() {
    const filtered = {};

    for (const [brand, sets] of Object.entries(savedTinderResults)) {
        const goodFront = sets.front.filter(f => isAvailableStock(f.stock));
        const goodRear = sets.rear.filter(r => isAvailableStock(r.stock));

        if (goodFront.length && goodRear.length) {
            filtered[brand] = { front: goodFront, rear: goodRear };
        }
    }

    renderTinderResults(filtered);
}

/* =========================
   F ALT TAB
   ========================= */

async function checkPrices() {
    const skuInput = document.getElementById("skuInput").value.trim().split("\n");
    const resultsTable = document.querySelector("#resultsTable tbody");
    resultsTable.innerHTML = `<tr><td colspan="5">Searching...</td></tr>`;

    const rows = await Promise.all(skuInput.map(async (line) => {
        const query = line.trim();
        if (!query) return "";

        if (![5, 7].includes(query.length)) {
            return `<tr><td colspan="5">Invalid input: ${escapeHtml(query)}</td></tr>`;
        }

        const result = await fetchTyreProductsBySize(query);

        if (!result.products.length) {
            return renderManualFallbackRow(
                query,
                result.manualUrl,
                "Could not load results automatically after Local/Worker/Jina attempts"
            );
        }

        return result.products.map(renderFAltProductRow).join("\n");
    }));

    const rendered = rows.flat().join("\n").trim();
    resultsTable.innerHTML = rendered || `<tr><td colspan="5">No results returned.</td></tr>`;
    sortTableByPrice();
}

function sortTableByPrice() {
    const tbody = document.querySelector("#resultsTable tbody");
    const rows = Array.from(tbody.querySelectorAll("tr"));

    rows.sort((a, b) => {
        const aPrice = parseFloat((a.cells[2]?.textContent || "").replace("$", "")) || 0;
        const bPrice = parseFloat((b.cells[2]?.textContent || "").replace("$", "")) || 0;
        return aPrice - bPrice;
    });

    tbody.innerHTML = "";
    rows.forEach((r) => tbody.appendChild(r));
}

/* =========================
   SHARED FILTERS
   ========================= */

function removeOutOfStock() {
    const rows = document.querySelectorAll("#resultsTable tbody tr");

    rows.forEach((row) => {
        const stock = row.dataset.stock || "";
        row.style.display = isAvailableStock(stock) ? "" : "none";
    });
}

function filterTable() {
    const keyword = document.getElementById("searchBar").value.toLowerCase().trim();
    const rows = document.querySelectorAll("#resultsTable tbody tr");

    rows.forEach((row) => {
        if (!keyword) {
            row.style.display = "";
            return;
        }

        const brand = (row.dataset.brand || "").toLowerCase();
        const matchInCells = [...row.cells].some((c) =>
            c.textContent.toLowerCase().includes(keyword)
        );

        const match = matchInCells || brand.includes(keyword);
        row.style.display = match ? "" : "none";
    });
}
