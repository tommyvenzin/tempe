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

const EXTENSION_BRIDGE_TIMEOUT_MS = 20000;
const PRICE_CACHE_TTL_MS = 30 * 60 * 1000;
const rankedPriceCache = new Map();
const rankedPricePromiseCache = new Map();
let extensionFetchRequestCounter = 0;

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
                    new Error(result?.error || "Tom does it all request failed")
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
                    "Tom does it all did not respond. Check that the extension is enabled for this page."
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

async function fetchProxyText(targetUrl) {
    const result = await fetchViaExtension(targetUrl, {
        method: "GET",
        cache: "no-store",
    });

    const text = String(result.text || "");

    if (!text.trim()) {
        throw new Error("Empty response");
    }

    return text;
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

    const pending = rankedPricePromiseCache.get(sku);
    if (pending) {
        return pending;
    }

    const pricePromise = (async () => {
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

        rankedPriceCache.set(sku, { price, cachedAt: Date.now() });
        return price;
    })();

    rankedPricePromiseCache.set(sku, pricePromise);

    try {
        return await pricePromise;
    } finally {
        rankedPricePromiseCache.delete(sku);
    }
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

function getSalesWeekDates(startDate, endDate) {
    const dates = [];
    const cursor = new Date(startDate);

    while (cursor <= endDate) {
        dates.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    return dates;
}

function createSalesBucket() {
    return Object.fromEntries(
        PROJECT_C_INITIALS.map((initials) => [
            initials,
            {
                retail: new Map(),
                wholesale: new Map(),
            },
        ])
    );
}

function addSkuQuantity(bucket, initials, type, sku, quantity) {
    if (!bucket[initials] || !sku || !Number.isFinite(quantity)) return;

    const skuMap = bucket[initials][type];
    skuMap.set(sku, (skuMap.get(sku) || 0) + quantity);
}

async function loadWeeklyRanking() {
    const resultsBody = document.querySelector("#resultsTable tbody");
    const grandTotalElement = document.getElementById("grandTotal");
    const itemTotalElement = document.getElementById("itemTotal");

    if (!resultsBody || !grandTotalElement || !itemTotalElement) return;

    const loadStartedAt = performance.now();

    const { startDate, endDate } = getCurrentSalesPeriod();
    const startDateKey = formatDateKey(startDate);
    const endDateKey = formatDateKey(endDate);

    setSalesPeriodLabel(startDate, endDate);
    resultsBody.innerHTML = "";
    grandTotalElement.textContent = "$0.00";
    itemTotalElement.textContent = "0";
    setLoadingState(true, "Loading weekly retail and wholesale data…");

    const urlMap = {
        retail: "https://my.tempetyres.com.au/retailpicking/history/",
        wholesale: "https://my.tempetyres.com.au/warehousepicking/sydney/history/"
    };

    const parser = new DOMParser();
    const salesBucket = createSalesBucket();
    const intranetConcurrency = 4;
    const priceConcurrency = 4;
    const validInitials = new Set(PROJECT_C_INITIALS);

    /*
     * RETAIL:
     * Fetch one exact-date page for each day from Friday through today.
     * The intranet does the date filtering before returning the HTML.
     */
    const loadRetailByExactDate = async () => {
        const salesDates = getSalesWeekDates(startDate, endDate);

        await mapWithConcurrency(
            salesDates,
            intranetConcurrency,
            async (date) => {
                const day = date.getDate();
                const month = date.getMonth() + 1;
                const year = date.getFullYear();

                const retailUrl =
                    `${urlMap.retail}?day=${day}&month=${month}&year=${year}&q=&searchin=ALL`;

                try {
                    const html = await fetchProxyText(retailUrl);
                    const doc = parser.parseFromString(html, "text/html");
                    const rows = doc.querySelectorAll(".col-md-12 table tbody tr");

                    for (const row of rows) {
                        const columns = row.querySelectorAll("td");
                        if (columns.length < 7) continue;

                        const rowInitials = columns[3].querySelector("a")?.textContent.trim();
                        const sku = columns[1].querySelector("small")?.textContent.trim();
                        const quantity = Number.parseInt(columns[5].textContent.trim(), 10);

                        if (
                            !validInitials.has(rowInitials) ||
                            !sku ||
                            !Number.isFinite(quantity)
                        ) {
                            continue;
                        }

                        addSkuQuantity(
                            salesBucket,
                            rowInitials,
                            "retail",
                            sku,
                            quantity
                        );
                    }
                } catch (error) {
                    console.error(
                        `Error loading retail for ${year}-${month}-${day}:`,
                        error
                    );
                }
            }
        );
    };

    /*
     * WHOLESALE:
     * Keep the safer existing per-person search because wholesale date pages
     * can contain too many records and may be truncated by the intranet.
     */
    const loadWholesaleByPerson = async () => {
        const baseUrl = urlMap.wholesale;

        await mapWithConcurrency(
            PROJECT_C_INITIALS,
            intranetConcurrency,
            async (initials) => {
                try {
                    const intranetUrl =
                        `${baseUrl}?day=0&month=0&year=0&q=${encodeURIComponent(initials)}&searchin=EnteredBy`;

                    const html = await fetchProxyText(intranetUrl);
                    const doc = parser.parseFromString(html, "text/html");
                    const rows = doc.querySelectorAll(".col-md-12 table tbody tr");

                    for (const row of rows) {
                        const columns = row.querySelectorAll("td");
                        if (columns.length < 7) continue;

                        const rawDateText = columns[1].querySelector("b a")?.textContent.trim();
                        const rowDateKey = toDateKey(rawDateText);

                        if (
                            !rowDateKey ||
                            rowDateKey < startDateKey ||
                            rowDateKey > endDateKey
                        ) {
                            continue;
                        }

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

                        addSkuQuantity(
                            salesBucket,
                            initials,
                            "wholesale",
                            sku,
                            quantity
                        );
                    }
                } catch (error) {
                    console.error(`Error processing wholesale for ${initials}:`, error);
                }
            }
        );
    };

    try {
        /*
         * Retail and wholesale now load at the same time instead of one after
         * the other.
         */
        await Promise.all([
            loadRetailByExactDate(),
            loadWholesaleByPerson(),
        ]);

        const intranetFinishedAt = performance.now();

        /*
         * Build one unique SKU list across every salesperson and both sales
         * types. A SKU is priced only once.
         */
        const uniqueSkus = new Set();

        for (const data of Object.values(salesBucket)) {
            for (const sku of data.retail.keys()) uniqueSkus.add(sku);
            for (const sku of data.wholesale.keys()) uniqueSkus.add(sku);
        }

        setLoadingState(
            true,
            `Pricing ${uniqueSkus.size} unique SKU${uniqueSkus.size === 1 ? "" : "s"}…`
        );

        const skuList = Array.from(uniqueSkus);
        const priceEntries = await mapWithConcurrency(
            skuList,
            priceConcurrency,
            async (sku) => [sku, await getPriceForSku(sku, parser)]
        );
        const priceBySku = new Map(priceEntries);

        const pricingFinishedAt = performance.now();

        const rowsData = PROJECT_C_INITIALS
            .map((initials) => {
                const data = salesBucket[initials];

                let retailTotal = 0;
                let wholesaleTotal = 0;
                let qty = 0;

                for (const [sku, quantity] of data.retail.entries()) {
                    retailTotal += (priceBySku.get(sku) || 0) * quantity;
                    qty += quantity;
                }

                for (const [sku, quantity] of data.wholesale.entries()) {
                    wholesaleTotal += (priceBySku.get(sku) || 0) * quantity;
                    qty += quantity;
                }

                if (qty === 0) return null;

                const combinedTotal = retailTotal + wholesaleTotal;
                const grade = getGradeInfo(combinedTotal);
                const percent = Math.max(
                    0,
                    Math.min(100, Math.round((combinedTotal / WEEKLY_TARGET) * 100))
                );

                return {
                    initials,
                    retailTotal,
                    wholesaleTotal,
                    combinedTotal,
                    qty,
                    gradeLabel: grade.label,
                    gradeClass: grade.className,
                    percent
                };
            })
            .filter(Boolean)
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

        console.log(
            `Project C timing — intranet: ${Math.round(intranetFinishedAt - loadStartedAt)}ms, ` +
            `pricing: ${Math.round(pricingFinishedAt - intranetFinishedAt)}ms, ` +
            `total: ${Math.round(performance.now() - loadStartedAt)}ms, ` +
            `unique SKUs: ${uniqueSkus.size}`
        );
    } catch (error) {
        console.error("Error loading Project C ranking:", error);
        showEmptyState("The ranking could not be loaded. Check Tom does it all and refresh the page.");
    } finally {
        setLoadingState(false);
    }
}

document.addEventListener("DOMContentLoaded", loadWeeklyRanking);
