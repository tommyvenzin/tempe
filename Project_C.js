console.log("Project_C.js loaded successfully");

/* =========================
   LOCAL PROXY (FAST + NO CORS)
   ========================= */

const LOCAL_PROXY = "http://localhost:8787/proxy?url=";
const CF_PROXY = "https://pepektires.tommyvenzin.workers.dev/?url=";
const PRICE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 mins
const rankedPriceCache = new Map(); // sku -> { price, cachedAt }

function isLocalHostRuntime() {
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1";
}

function getProxyCandidates() {
    // GitHub Pages / HTTPS cannot call localhost due to private network access restrictions.
    return isLocalHostRuntime() ? [LOCAL_PROXY, CF_PROXY] : [CF_PROXY, LOCAL_PROXY];
}

function proxify(url, proxyBase) {
    return proxyBase + encodeURIComponent(url);
}

async function fetchProxyText(targetUrl) {
    const proxies = getProxyCandidates();
    let lastError = null;

    for (const proxyBase of proxies) {
        try {
            const res = await fetch(proxify(targetUrl, proxyBase));
            if (!res.ok) throw new Error(`Proxy ${proxyBase} returned ${res.status}`);
            const rawText = await res.text();
            return extractHtmlFromProxyPayload(rawText);
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

function extractHtmlFromProxyPayload(text) {
    // Some proxy implementations return JSON payloads instead of raw HTML.
    const trimmed = text.trim();
    if (!trimmed.startsWith("{")) return text;

    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.contents === "string") return parsed.contents;
        if (typeof parsed.body === "string") return parsed.body;
    } catch {
        // Not JSON; keep raw text.
    }

    return text;
}

function toDateKey(rawDateText) {
    if (!rawDateText) return null;

    // Prefer compact YYYYMMDD if present.
    const compact = rawDateText.replace(/\D/g, "");
    const compactMatch = compact.match(/(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])/);
    if (compactMatch) return compactMatch[0];

    // Support common separators (DD-MM-YYYY / MM-DD-YYYY / YYYY-MM-DD).
    const m = rawDateText.match(/(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})/);
    if (!m) return null;

    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const c = parseInt(m[3], 10);

    let year;
    let month;
    let day;

    if (m[1].length === 4) {
        year = a; month = b; day = c; // YYYY-MM-DD
    } else if (m[3].length === 4) {
        year = c;
        // AU intranet is generally DD-MM-YYYY; fallback to MM-DD-YYYY if needed.
        if (a > 12) {
            day = a; month = b;
        } else if (b > 12) {
            month = a; day = b;
        } else {
            day = a; month = b;
        }
    } else {
        return null;
    }

    if (
        !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
        month < 1 || month > 12 || day < 1 || day > 31
    ) {
        return null;
    }

    return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/* =========================
   Main: Check Prices
   ========================= */

async function checkPrices(type = "retail") {
    const initialsSelect = document.getElementById("skuInput");
    const initialsInput = Array.from(initialsSelect.selectedOptions).map(opt => opt.value);

    const startDateInput = document.getElementById("startDateInput").value.trim();
    const endDateInput = document.getElementById("endDateInput").value.trim();
    const resultsTable = document.getElementById("resultsTable").querySelector("tbody");
    const grandTotalElement = document.getElementById("grandTotal");
    const itemTotalElement = document.getElementById("itemTotal");
    const loadingIndicator = document.getElementById("loadingIndicator");

    resultsTable.innerHTML = "";
    let grandTotal = 0;
    let itemTotal = 0;

    const year = new Date().getFullYear();
    const formatDate = (date) => `${year}${date.replace(/\D/g, "")}`;
    const startDate = formatDate(startDateInput);
    const endDate = formatDate(endDateInput);

    if (initialsInput.length === 0) {
        alert("Please select at least one initial.");
        return;
    }

    if (!startDate || !endDate || startDate.length !== 8 || endDate.length !== 8) {
        alert("Please enter a valid start date and end date in MM-DD format.");
        return;
    }

    if (loadingIndicator) loadingIndicator.style.display = "block";

    const urlMap = {
        retail: "https://my.tempetyres.com.au/retailpicking/history/",
        wholesale: "https://my.tempetyres.com.au/warehousepicking/sydney/history/"
    };

    const dateSelector = type === "retail" ? "strong" : "b a";
    const parser = new DOMParser();

    try {
        // ✅ INTRANET fetch via local proxy
        const intranetUrl =
            `${urlMap[type]}?day=0&month=0&year=0&q=${encodeURIComponent(initialsInput.join(","))}&searchin=EnteredBy`;

        const text = await fetchProxyText(intranetUrl);

        const doc = parser.parseFromString(text, "text/html");
        const rows = doc.querySelectorAll(".col-md-12 table tbody tr");

        const matchedResults = [];

        for (const row of rows) {
            const columns = row.querySelectorAll("td");
            if (columns.length < 7) continue;

            const rawDateText = columns[1].querySelector(dateSelector)?.textContent.trim();
            const dateText = toDateKey(rawDateText);
            if (!dateText || dateText < startDate || dateText > endDate) continue;

            const initialsElement = columns[3].querySelector("a");
            const skuElement = columns[1].querySelector("small");
            const quantityElement = columns[5];
            if (!initialsElement || !skuElement || !quantityElement) continue;

            const initials = initialsElement.textContent.trim();
            const sku = skuElement.textContent.trim();
            const quantity = parseInt(quantityElement.textContent.trim(), 10);
            if (!initials || !initialsInput.includes(initials)) continue;

            matchedResults.push({ sku, quantity });
        }

        const fetchPriceDetails = async ({ sku, quantity }) => {
            const searchUrl = `https://www.tempetyres.com.au/search?q=${encodeURIComponent(sku)}`;
            let price = 0;
            let description = "";
            let productUrl = searchUrl;

            try {
                // ✅ tempetyres search fetch via local proxy
                const html = await fetchProxyText(searchUrl);
                const doc = parser.parseFromString(html, "text/html");

                // Try search page price
                let priceText = doc.querySelector(".sale-price span")?.textContent.trim();
                if (!priceText) {
                    const whPriceText = doc.querySelector(".wh-price")?.textContent;
                    const match = whPriceText && whPriceText.match(/\$([\d.]+)/);
                    if (match) priceText = match[1];
                }

                if (
                    priceText &&
                    !priceText.toLowerCase().includes("call") &&
                    !isNaN(parseFloat(priceText))
                ) {
                    price = parseFloat(priceText);

                    // Description from search page
                    if (doc.querySelector(".sub-heading-ty-2")) {
                        const tySize = doc.querySelector(".sub-heading-ty-2")?.textContent.trim() || "";
                        const tyPattern = doc.querySelector(".sub-heading-ty-3")?.textContent.trim() || "";
                        description = `${tySize} ${tyPattern}`.trim();
                    } else if (doc.querySelector(".sub-heading-wh-2")) {
                        const whSize = doc.querySelector(".sub-heading-wh-2")?.textContent.trim() || "";
                        const whFinish = doc.querySelector(".sub-heading-wh-3")?.textContent.trim() || "";
                        description = `${whSize} ${whFinish}`.trim();
                    }
                } else {
                    // Follow product page
                    const productLinkElement = doc.querySelector(".product-container .image-container a");
                    if (productLinkElement) {
                        productUrl = `https://www.tempetyres.com.au${productLinkElement.getAttribute("href")}`;

                        // ✅ tempetyres product fetch via local proxy
                        const productHtml = await fetchProxyText(productUrl);
                        const productDoc = parser.parseFromString(productHtml, "text/html");

                        // Wheels
                        const price2 = productDoc.querySelector("#price2")?.textContent.trim();
                        if (price2 && !isNaN(parseFloat(price2.replace("$", "")))) {
                            price = parseFloat(price2.replace("$", ""));
                        }

                        // Tyres fallback from embedded value
                        if (price === 0) {
                            const match = productHtml.match(/'ecomm_totalvalue':\s*'(\d+)'/);
                            if (match) price = parseFloat(match[1]);
                        }

                        if (productDoc.querySelector(".sub-heading-ty-2")) {
                            const tySize = productDoc.querySelector(".sub-heading-ty-2")?.textContent.trim() || "";
                            const tyPattern = productDoc.querySelector(".sub-heading-ty-3")?.textContent.trim() || "";
                            description = `${tySize} ${tyPattern}`.trim();
                        } else if (productDoc.querySelector(".sub-heading-wh-2")) {
                            const whSize = productDoc.querySelector(".sub-heading-wh-2")?.textContent.trim() || "";
                            const whFinish = productDoc.querySelector(".sub-heading-wh-3")?.textContent.trim() || "";
                            description = `${whSize} ${whFinish}`.trim();
                        } else {
                            description = "No description available";
                        }
                    } else {
                        description = "No product link found";
                    }
                }

                const totalPrice = price * quantity;
                return {
                    sku,
                    quantity,
                    originalPrice: price,
                    totalPrice,
                    description,
                    url: productUrl,
                };
            } catch (e) {
                console.error(`Error fetching SKU ${sku}:`, e);
                return {
                    sku,
                    quantity,
                    originalPrice: 0,
                    totalPrice: 0,
                    description: "Error fetching data",
                    url: searchUrl,
                };
            }
        };

        const priceResults = await Promise.all(matchedResults.map(fetchPriceDetails));

        const chunkSize = 20;
        for (let i = 0; i < priceResults.length; i += chunkSize) {
            setTimeout(() => {
                resultsTable.innerHTML += priceResults
                    .slice(i, i + chunkSize)
                    .map(({ sku, quantity, originalPrice, totalPrice, description, url }) => `
                        <tr>
                            <td>${sku}</td>
                            <td>${quantity}</td>
                            <td>$${originalPrice.toFixed(2)} ea</td>
                            <td>$${totalPrice.toFixed(2)}</td>
                            <td>${description}</td>
                            <td><a href="${url}" target="_blank">View</a></td>
                        </tr>
                    `)
                    .join("\n");
            }, i * 100);
        }

        grandTotal = priceResults.reduce((acc, item) => acc + item.totalPrice, 0);
        itemTotal = priceResults.reduce((acc, item) => acc + item.quantity, 0);

        grandTotalElement.textContent = `$${grandTotal.toFixed(2)}`;
        itemTotalElement.textContent = `${itemTotal}`;
    } catch (e) {
        console.error("Error:", e);
        alert("Error retrieving data. Please try again later.");
    }

    if (loadingIndicator) loadingIndicator.style.display = "none";
}

function wholesalePrices() {
    checkPrices("wholesale");
}

function autoFillSalesPeriod() {
    const startInput = document.getElementById("startDateInput");
    const endInput = document.getElementById("endDateInput");

    const today = new Date();
    const day = today.getDay();
    let start = new Date(today);

    if (day !== 5) {
        const diff = (day + 7 - 5) % 7 || 7;
        start.setDate(today.getDate() - diff);
    }

    const format = (d) => {
        const mm = (d.getMonth() + 1).toString().padStart(2, "0");
        const dd = d.getDate().toString().padStart(2, "0");
        return `${mm}${dd}`;
    };

    startInput.value = format(start);
    endInput.value = format(today);
}

/* =========================
   Grade / progress helper
   ========================= */

function getGradeInfo(total) {
    if (total >= 90000) return { label: "Sit down", className: "grade-sitdown" };  // 90k++
    if (total >= 70000) return { label: "Level 2", className: "grade-level2" };    // 70k–89,999
    if (total >= 60000) return { label: "Level 1", className: "grade-level1" };    // 60k–69,999
    return { label: "Keep going", className: "grade-keepgoing" };                  // below 60k
}

/* =========================
   All Initials Ranked
   ========================= */

async function allInitialsRanked() {
    const initialsSelect = document.getElementById("skuInput");
    const allInitials = Array.from(initialsSelect.options).map(opt => opt.value);

    let startDateInput = document.getElementById("startDateInput").value.trim();
    let endDateInput = document.getElementById("endDateInput").value.trim();

    const resultsTable = document.getElementById("resultsTable").querySelector("tbody");
    const headerRow = document.querySelector("#resultsTable thead tr");
    const grandTotalElement = document.getElementById("grandTotal");
    const itemTotalElement = document.getElementById("itemTotal");
    const loadingIndicator = document.getElementById("loadingIndicator");

    // If no date range entered, auto-fill this week
    if (!startDateInput || !endDateInput) {
        autoFillSalesPeriod();
        startDateInput = document.getElementById("startDateInput").value.trim();
        endDateInput = document.getElementById("endDateInput").value.trim();
    }

    resultsTable.innerHTML = "";
    headerRow.innerHTML = `
        <th>Initials</th>
        <th>Retail Total (AUD)</th>
        <th>Wholesale Total (AUD)</th>
        <th>Combined Total (AUD)</th>
        <th>Total Quantity</th>
        <th>Progress / Grade</th>
    `;

    grandTotalElement.textContent = "";
    itemTotalElement.textContent = "";

    const year = new Date().getFullYear();
    const formatDate = (date) => `${year}${date.replace(/\D/g, "")}`;
    const startDate = formatDate(startDateInput);
    const endDate = formatDate(endDateInput);

    if (!startDate || !endDate || startDate.length !== 8 || endDate.length !== 8) {
        alert("Please enter a valid start date and end date in MM-DD format.");
        return;
    }

    if (loadingIndicator) loadingIndicator.style.display = "block";

    const urlMap = {
        retail: "https://my.tempetyres.com.au/retailpicking/history/",
        wholesale: "https://my.tempetyres.com.au/warehousepicking/sydney/history/"
    };

    const parser = new DOMParser();

    const totals = {};      // initials -> { retailTotal, wholesaleTotal, qty }

    const getPriceForSku = async (sku) => {
        const now = Date.now();
        const cached = rankedPriceCache.get(sku);
        if (cached && now - cached.cachedAt < PRICE_CACHE_TTL_MS) {
            return cached.price;
        }

        const searchUrl = `https://www.tempetyres.com.au/search?q=${encodeURIComponent(sku)}`;
        let price = 0;

        try {
            const html = await fetchProxyText(searchUrl);
            const doc = parser.parseFromString(html, "text/html");

            let priceText = doc.querySelector(".sale-price span")?.textContent.trim();
            if (!priceText) {
                const whPriceText = doc.querySelector(".wh-price")?.textContent;
                const match = whPriceText && whPriceText.match(/\$([\d.]+)/);
                if (match) priceText = match[1];
            }

            if (priceText && !priceText.toLowerCase().includes("call") && !isNaN(parseFloat(priceText))) {
                price = parseFloat(priceText);
            } else {
                const productLinkElement = doc.querySelector(".product-container .image-container a");
                if (productLinkElement) {
                    const productUrl = `https://www.tempetyres.com.au${productLinkElement.getAttribute("href")}`;
                    const productHtml = await fetchProxyText(productUrl);
                    const productDoc = parser.parseFromString(productHtml, "text/html");

                    const price2 = productDoc.querySelector("#price2")?.textContent.trim();
                    if (price2 && !isNaN(parseFloat(price2.replace("$", "")))) {
                        price = parseFloat(price2.replace("$", ""));
                    }

                    if (price === 0) {
                        const match = productHtml.match(/'ecomm_totalvalue':\s*'(\d+)'/);
                        if (match) price = parseFloat(match[1]);
                    }
                }
            }
        } catch (e) {
            console.error(`Error fetching price for SKU ${sku}:`, e);
        }

        rankedPriceCache.set(sku, { price, cachedAt: now });
        return price;
    };

    let grandTotal = 0;
    let itemTotal = 0;

    const rankedConcurrency = 4;

    // Process each initial with bounded concurrency.
    const processType = async (type) => {
        const baseUrl = urlMap[type];
        const dateSelector = type === "retail" ? "strong" : "b a";

        await mapWithConcurrency(allInitials, rankedConcurrency, async (initials) => {
            try {
                const intranetUrl =
                    `${baseUrl}?day=0&month=0&year=0&q=${encodeURIComponent(initials)}&searchin=EnteredBy`;

                const text = await fetchProxyText(intranetUrl);
                const doc = parser.parseFromString(text, "text/html");
                const rows = doc.querySelectorAll(".col-md-12 table tbody tr");
                const lineItems = [];

                for (const row of rows) {
                    const columns = row.querySelectorAll("td");
                    if (columns.length < 7) continue;

                    const rawDateText = columns[1].querySelector(dateSelector)?.textContent.trim();
                    const dateText = toDateKey(rawDateText);
                    if (!dateText || dateText < startDate || dateText > endDate) continue;

                    const initialsElement = columns[3].querySelector("a");
                    const skuElement = columns[1].querySelector("small");
                    const quantityElement = columns[5];
                    if (!initialsElement || !skuElement || !quantityElement) continue;

                    const rowInitials = initialsElement.textContent.trim();
                    const sku = skuElement.textContent.trim();
                    const quantity = parseInt(quantityElement.textContent.trim(), 10);

                    if (!rowInitials || rowInitials !== initials || !sku || !Number.isFinite(quantity)) continue;
                    lineItems.push({ sku, quantity });
                }

                if (lineItems.length === 0) return;

                // Resolve all SKU prices for this initial concurrently (bounded).
                const pricedLines = await mapWithConcurrency(lineItems, rankedConcurrency, async ({ sku, quantity }) => {
                    const price = await getPriceForSku(sku);
                    return { quantity, lineTotal: price * quantity };
                });

                const totalForInitial = pricedLines.reduce((acc, row) => acc + row.lineTotal, 0);
                const qtyForInitial = pricedLines.reduce((acc, row) => acc + row.quantity, 0);

                if (!totals[initials]) {
                    totals[initials] = { retailTotal: 0, wholesaleTotal: 0, qty: 0 };
                }

                if (type === "retail") totals[initials].retailTotal += totalForInitial;
                else totals[initials].wholesaleTotal += totalForInitial;
                totals[initials].qty += qtyForInitial;
                grandTotal += totalForInitial;
                itemTotal += qtyForInitial;
            } catch (e) {
                console.error(`Error processing ${type} for ${initials}:`, e);
            }
        });
    };

    try {
        await processType("retail");
        await processType("wholesale");

        const target = 90000;

        const rowsData = Object.entries(totals).map(([initials, data]) => {
            const combined = data.retailTotal + data.wholesaleTotal;
            const gradeInfo = getGradeInfo(combined);
            const percent = Math.max(0, Math.min(100, Math.round((combined / target) * 100)));

            return {
                initials,
                retailTotal: data.retailTotal,
                wholesaleTotal: data.wholesaleTotal,
                combinedTotal: combined,
                qty: data.qty,
                gradeLabel: gradeInfo.label,
                gradeClass: gradeInfo.className,
                percent
            };
        });

        rowsData.sort((a, b) => b.combinedTotal - a.combinedTotal);

        resultsTable.innerHTML = rowsData.map((d) => `
            <tr>
                <td>${d.initials}</td>
                <td>$${d.retailTotal.toFixed(2)}</td>
                <td>$${d.wholesaleTotal.toFixed(2)}</td>
                <td>$${d.combinedTotal.toFixed(2)}</td>
                <td>${d.qty}</td>
                <td>
                    <div class="progress-wrapper">
                        <div class="progress-label">${d.gradeLabel} – $${d.combinedTotal.toFixed(0)} / ${target.toLocaleString()}</div>
                        <div class="progress-bar">
                            <div class="progress-fill ${d.gradeClass}" style="width: ${d.percent}%;"></div>
                        </div>
                    </div>
                </td>
            </tr>
        `).join("\n");

        grandTotalElement.textContent = `$${grandTotal.toFixed(2)}`;
        itemTotalElement.textContent = `${itemTotal}`;
    } catch (e) {
        console.error("Error in allInitialsRanked:", e);
        alert("Error retrieving ranked data. Please try again later.");
    }

    if (loadingIndicator) loadingIndicator.style.display = "none";
}
