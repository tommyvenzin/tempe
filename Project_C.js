console.log("Project_C.js loaded successfully");

/* =========================
   PROJECT C CONFIGURATION
   ========================= */

const PROJECT_C_INITIALS = ["TOG", "MOR", "MRA", "DK", "MHA", "JZA", "DB", "SA"];

const INITIAL_DISPLAY_NAMES = Object.freeze({
    TOG: "god",
    MOR: "babi",
    MRA: "monyet",
    DK: "kontol",
    MHA: "tolol",
    JZA: "maling",
    DB: "okelah",
    SA: "mabok"
});
const WEEKLY_TARGET = 90000;

const LOCAL_PROXY = "http://localhost:8787/proxy?url=";
const CF_PROXY = "https://pepektires.tommyvenzin.workers.dev/?url=";
const PRICE_CACHE_TTL_MS = 30 * 60 * 1000;
const rankedPriceCache = new Map();

/* =========================
   UI HELPERS
   ========================= */

function setLoadingState(isLoading, message = "Loading weekly rankings…") {
    const loadingIndicator = document.getElementById("loadingIndicator");
    if (!loadingIndicator) return;

    const loadingText = loadingIndicator.querySelector("[data-loading-text]");
    if (loadingText) loadingText.textContent = message;

    loadingIndicator.classList.toggle("is-visible", isLoading);
    loadingIndicator.style.display = isLoading ? "flex" : "none";
}

function setSalesPeriodLabel(startDate, endDate) {
    const rangeElement = document.getElementById("rangeSummary");
    if (!rangeElement) return;

    rangeElement.textContent = `${formatDisplayDate(startDate)} → ${formatDisplayDate(endDate)}`;
}

function showEmptyState(message) {
    const resultsBody = document.querySelector("#resultsTable tbody");
    if (!resultsBody) return;

    resultsBody.innerHTML = `
        <tr>
            <td colspan="6" class="project-empty-state">${message}</td>
        </tr>
    `;
}

/* =========================
   DATE HELPERS
   ========================= */

function getCurrentSalesPeriod() {
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);

    const startDate = new Date(endDate);
    const day = endDate.getDay();

    if (day !== 5) {
        const daysSinceFriday = (day + 7 - 5) % 7 || 7;
        startDate.setDate(endDate.getDate() - daysSinceFriday);
    }

    return { startDate, endDate };
}

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
}

function formatDisplayDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${month}-${day}`;
}

function toDateKey(rawDateText) {
    if (!rawDateText) return null;

    const compact = rawDateText.replace(/\D/g, "");
    const compactMatch = compact.match(/(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])/);
    if (compactMatch) return compactMatch[0];

    const match = rawDateText.match(/(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})/);
    if (!match) return null;

    const a = Number.parseInt(match[1], 10);
    const b = Number.parseInt(match[2], 10);
    const c = Number.parseInt(match[3], 10);

    let year;
    let month;
    let day;

    if (match[1].length === 4) {
        year = a;
        month = b;
        day = c;
    } else if (match[3].length === 4) {
        year = c;

        // The AU intranet normally uses DD-MM-YYYY.
        if (a > 12) {
            day = a;
            month = b;
        } else if (b > 12) {
            month = a;
            day = b;
        } else {
            day = a;
            month = b;
        }
    } else {
        return null;
    }

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31
    ) {
        return null;
    }

    return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/* =========================
   NETWORK HELPERS
   ========================= */

function getProxyCandidates() {
    return [LOCAL_PROXY, CF_PROXY];
}

function proxify(url, proxyBase) {
    return proxyBase + encodeURIComponent(url);
}

function extractHtmlFromProxyPayload(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{")) return text;

    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.contents === "string") return parsed.contents;
        if (typeof parsed.body === "string") return parsed.body;
    } catch {
        // The response is raw HTML rather than JSON.
    }

    return text;
}

async function fetchProxyText(targetUrl) {
    let lastError = null;

    for (const proxyBase of getProxyCandidates()) {
        try {
            const response = await fetch(proxify(targetUrl, proxyBase));
            if (!response.ok) {
                throw new Error(`Proxy ${proxyBase} returned ${response.status}`);
            }

            return extractHtmlFromProxyPayload(await response.text());
        } catch (error) {
            lastError = error;
            console.warn(`Proxy request failed via ${proxyBase}`, error);
        }
    }

    throw lastError || new Error("All proxy attempts failed.");
}

async function mapWithConcurrency(items, concurrency, worker) {
    const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
    const results = new Array(items.length);
    let index = 0;

    async function runWorker() {
        while (index < items.length) {
            const current = index++;
            results[current] = await worker(items[current], current);
        }
    }

    await Promise.all(Array.from({ length: safeConcurrency }, runWorker));
    return results;
}

/* =========================
   PRICE LOOKUP
   ========================= */

async function getPriceForSku(sku, parser) {
    const now = Date.now();
    const cached = rankedPriceCache.get(sku);

    if (cached && now - cached.cachedAt < PRICE_CACHE_TTL_MS) {
        return cached.price;
    }

    const searchUrl = `https://www.tempetyres.com.au/search?q=${encodeURIComponent(sku)}`;
    let price = 0;

    try {
        const html = await fetchProxyText(searchUrl);
        const documentFromSearch = parser.parseFromString(html, "text/html");

        let priceText = documentFromSearch.querySelector(".sale-price span")?.textContent.trim();

        if (!priceText) {
            const wholesalePriceText = documentFromSearch.querySelector(".wh-price")?.textContent;
            const wholesaleMatch = wholesalePriceText?.match(/\$([\d.]+)/);
            if (wholesaleMatch) priceText = wholesaleMatch[1];
        }

        if (
            priceText &&
            !priceText.toLowerCase().includes("call") &&
            Number.isFinite(Number.parseFloat(priceText))
        ) {
            price = Number.parseFloat(priceText);
        } else {
            const productLink = documentFromSearch.querySelector(".product-container .image-container a");

            if (productLink) {
                const productUrl = `https://www.tempetyres.com.au${productLink.getAttribute("href")}`;
                const productHtml = await fetchProxyText(productUrl);
                const productDocument = parser.parseFromString(productHtml, "text/html");

                const wheelPriceText = productDocument.querySelector("#price2")?.textContent.trim();
                const wheelPrice = Number.parseFloat(wheelPriceText?.replace("$", ""));

                if (Number.isFinite(wheelPrice)) {
                    price = wheelPrice;
                }

                if (price === 0) {
                    const tyrePriceMatch = productHtml.match(/'ecomm_totalvalue':\s*'(\d+)'/);
                    if (tyrePriceMatch) price = Number.parseFloat(tyrePriceMatch[1]);
                }
            }
        }
    } catch (error) {
        console.error(`Error fetching price for SKU ${sku}:`, error);
    }

    rankedPriceCache.set(sku, { price, cachedAt: now });
    return price;
}

/* =========================
   GRADE / PROGRESS
   ========================= */

function getGradeInfo(total) {
    if (total >= 90000) return { label: "Sit down", className: "grade-sitdown" };
    if (total >= 70000) return { label: "Level 2", className: "grade-level2" };
    if (total >= 60000) return { label: "Level 1", className: "grade-level1" };
    return { label: "Keep going", className: "grade-keepgoing" };
}

/* =========================
   AUTOMATIC WEEKLY RANKING
   ========================= */

async function loadWeeklyRanking() {
    const resultsBody = document.querySelector("#resultsTable tbody");
    const grandTotalElement = document.getElementById("grandTotal");
    const itemTotalElement = document.getElementById("itemTotal");

    if (!resultsBody || !grandTotalElement || !itemTotalElement) return;

    const { startDate, endDate } = getCurrentSalesPeriod();
    const startDateKey = formatDateKey(startDate);
    const endDateKey = formatDateKey(endDate);

    setSalesPeriodLabel(startDate, endDate);
    resultsBody.innerHTML = "";
    grandTotalElement.textContent = "$0.00";
    itemTotalElement.textContent = "0";
    setLoadingState(true, "Loading all weekly retail and wholesale totals…");

    const urlMap = {
        retail: "https://my.tempetyres.com.au/retailpicking/history/",
        wholesale: "https://my.tempetyres.com.au/warehousepicking/sydney/history/"
    };

    const parser = new DOMParser();
    const totals = {};
    const concurrency = 4;

    const processType = async (type) => {
        const baseUrl = urlMap[type];
        const dateSelector = type === "retail" ? "strong" : "b a";

        await mapWithConcurrency(PROJECT_C_INITIALS, concurrency, async (initials) => {
            try {
                const intranetUrl =
                    `${baseUrl}?day=0&month=0&year=0&q=${encodeURIComponent(initials)}&searchin=EnteredBy`;

                const html = await fetchProxyText(intranetUrl);
                const intranetDocument = parser.parseFromString(html, "text/html");
                const rows = intranetDocument.querySelectorAll(".col-md-12 table tbody tr");
                const lineItems = [];

                for (const row of rows) {
                    const columns = row.querySelectorAll("td");
                    if (columns.length < 7) continue;

                    const rawDateText = columns[1].querySelector(dateSelector)?.textContent.trim();
                    const rowDateKey = toDateKey(rawDateText);

                    if (!rowDateKey || rowDateKey < startDateKey || rowDateKey > endDateKey) continue;

                    const rowInitials = columns[3].querySelector("a")?.textContent.trim();
                    const sku = columns[1].querySelector("small")?.textContent.trim();
                    const quantity = Number.parseInt(columns[5].textContent.trim(), 10);

                    if (
                        rowInitials !== initials ||
                        !sku ||
                        !Number.isFinite(quantity)
                    ) {
                        continue;
                    }

                    lineItems.push({ sku, quantity });
                }

                if (lineItems.length === 0) return;

                const pricedLines = await mapWithConcurrency(
                    lineItems,
                    concurrency,
                    async ({ sku, quantity }) => {
                        const price = await getPriceForSku(sku, parser);
                        return { quantity, lineTotal: price * quantity };
                    }
                );

                const totalForInitial = pricedLines.reduce((sum, row) => sum + row.lineTotal, 0);
                const quantityForInitial = pricedLines.reduce((sum, row) => sum + row.quantity, 0);

                if (!totals[initials]) {
                    totals[initials] = { retailTotal: 0, wholesaleTotal: 0, qty: 0 };
                }

                if (type === "retail") {
                    totals[initials].retailTotal += totalForInitial;
                } else {
                    totals[initials].wholesaleTotal += totalForInitial;
                }

                totals[initials].qty += quantityForInitial;
            } catch (error) {
                console.error(`Error processing ${type} for ${initials}:`, error);
            }
        });
    };

    try {
        await processType("retail");
        await processType("wholesale");

        const rowsData = Object.entries(totals)
            .map(([initials, data]) => {
                const combinedTotal = data.retailTotal + data.wholesaleTotal;
                const grade = getGradeInfo(combinedTotal);
                const percent = Math.max(
                    0,
                    Math.min(100, Math.round((combinedTotal / WEEKLY_TARGET) * 100))
                );

                return {
                    initials,
                    retailTotal: data.retailTotal,
                    wholesaleTotal: data.wholesaleTotal,
                    combinedTotal,
                    qty: data.qty,
                    gradeLabel: grade.label,
                    gradeClass: grade.className,
                    percent
                };
            })
            .sort((a, b) => b.combinedTotal - a.combinedTotal);

        if (rowsData.length === 0) {
            showEmptyState("No ranking data was found for the current sales week.");
            return;
        }

        resultsBody.innerHTML = rowsData.map((data, index) => `
            <tr>
                <td>
                    <div class="rank-cell">
                        <span class="rank-badge">#${index + 1}</span>
                        <span class="masked-initial">${INITIAL_DISPLAY_NAMES[data.initials] ?? "unknown"}</span>
                    </div>
                </td>
                <td>$${data.retailTotal.toFixed(2)}</td>
                <td>$${data.wholesaleTotal.toFixed(2)}</td>
                <td>$${data.combinedTotal.toFixed(2)}</td>
                <td>${data.qty}</td>
                <td>
                    <div class="progress-wrapper">
                        <div class="progress-label">
                            ${data.gradeLabel} – $${data.combinedTotal.toFixed(0)} / ${WEEKLY_TARGET.toLocaleString()}
                        </div>
                        <div class="progress-bar">
                            <div
                                class="progress-fill ${data.gradeClass}"
                                style="width: ${data.percent}%;"
                            ></div>
                        </div>
                    </div>
                </td>
            </tr>
        `).join("");

        const grandTotal = rowsData.reduce((sum, data) => sum + data.combinedTotal, 0);
        const itemTotal = rowsData.reduce((sum, data) => sum + data.qty, 0);

        grandTotalElement.textContent = `$${grandTotal.toFixed(2)}`;
        itemTotalElement.textContent = String(itemTotal);
    } catch (error) {
        console.error("Error loading Project C ranking:", error);
        showEmptyState("The ranking could not be loaded. Check the proxy and refresh the page.");
    } finally {
        setLoadingState(false);
    }
}

document.addEventListener("DOMContentLoaded", loadWeeklyRanking);
