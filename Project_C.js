console.log("Project_C.js loaded successfully");

/* =========================
   PROJECT C CONFIGURATION
   ========================= */

const PROJECT_C_INITIALS = ["TOG", "MOR", "MRA", "DK", "MHA", "JZA", "DB", "SA"];

const INITIAL_DISPLAY_NAMES = Object.freeze({
    TOG: "D3f4ult",
    MOR: "Osama been lackin",
    MRA: "One Question, Seven Seasons",
    DK: "Kathmandu TED Talk Nobody Asked For",
    MHA: "Biman Flight Delay Simulator",
    JZA: "Shah Rukh Khan from Temu",
    DB: "Tungtungtungsahur",
    SA: "Gragas"
});
const WEEKLY_TARGET = 90000;

const PROJECT_C_GOD_INITIALS = "TOG";
const PROJECT_C_GOD_SKIN_IMAGE = "Project_C-god-skin.jpg";

const EXTENSION_BRIDGE_TIMEOUT_MS = 20000;
const PRICE_CACHE_TTL_MS = 30 * 60 * 1000;
const PRICE_CACHE_STORAGE_KEY = "project-c:prices:v1";
const PRICE_CACHE_MAX_ENTRIES = 1500;
const PRICE_LOOKUP_CONCURRENCY = 6;
const rankedPriceCache = new Map();
const rankedPricePromiseCache = new Map();
const schedulePriceLookup = createTaskLimiter(PRICE_LOOKUP_CONCURRENCY);
let priceCacheGeneration = 0;
let priceCacheSaveTimer = null;
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


function injectProjectCGodSkinStyles() {
    if (document.getElementById("projectCGodSkinStyles")) return;

    const style = document.createElement("style");
    style.id = "projectCGodSkinStyles";

    style.textContent = `
        /* TOG / GOD ONLY */
        #resultsTable tbody tr.god-row > td:first-child {
            padding: 0 !important;
            overflow: hidden;
            position: relative;
        }

        .god-skin {
            position: relative;
            isolation: isolate;
            overflow: hidden;
            min-height: 92px;
            display: flex;
            align-items: center;
            padding: 16px 18px;
            border-radius: 10px;
            background: #07111f;
            box-shadow:
                inset 0 0 0 1px rgba(155, 205, 244, 0.28),
                inset 0 -24px 45px rgba(0,0,0,0.22);
        }

        .god-skin::before {
            content: "";
            position: absolute;
            inset: -24px -140px;
            background-image: url("${PROJECT_C_GOD_SKIN_IMAGE}");
            background-repeat: repeat-x;
            background-size: auto 150%;
            background-position: 0% 52%;
            opacity: 0.68;
            filter: saturate(1.10) contrast(1.06) brightness(0.78);
            animation: godOceanRun 22s ease-in-out infinite alternate;
            z-index: 0;
            will-change: transform;
        }

        .god-skin::after {
            content: "";
            position: absolute;
            inset: 0;
            background:
                linear-gradient(90deg,
                    rgba(3, 12, 23, 0.70) 0%,
                    rgba(4, 20, 38, 0.22) 44%,
                    rgba(3, 12, 23, 0.64) 100%),
                linear-gradient(180deg,
                    rgba(255,255,255,0.05),
                    rgba(0,0,0,0.20));
            z-index: 1;
            pointer-events: none;
        }

        .god-skin-content {
            position: relative;
            z-index: 3;
            display: flex;
            align-items: center;
            gap: 12px;
            width: 100%;
        }

        .god-skin .masked-initial {
            font-size: 1.08rem;
            font-weight: 900;
            letter-spacing: 0.10em;
            text-transform: uppercase;
            color: #f5fbff;
            text-shadow:
                0 2px 6px rgba(0,0,0,0.90),
                0 0 12px rgba(150, 210, 255, 0.55);
        }

        .god-skin .rank-badge {
            flex: 0 0 auto;
            position: relative;
            z-index: 3;
        }

        .god-tog-chip {
            margin-left: auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 48px;
            height: 27px;
            padding: 0 10px;
            border-radius: 999px;
            border: 1px solid rgba(215, 238, 255, 0.55);
            background: rgba(3, 18, 33, 0.68);
            color: #e8f6ff;
            font-size: 0.72rem;
            font-weight: 800;
            letter-spacing: 0.12em;
            box-shadow: 0 2px 10px rgba(0,0,0,0.34);
            backdrop-filter: blur(3px);
        }

        .god-wave-streak {
            position: absolute;
            z-index: 2;
            left: -45%;
            bottom: 8px;
            width: 190%;
            height: 25px;
            opacity: 0.62;
            transform: skewX(-24deg);
            background: repeating-linear-gradient(
                90deg,
                transparent 0 20px,
                rgba(205, 235, 255, 0.34) 28px 34px,
                transparent 42px 66px
            );
            animation: godWaveStreak 5.5s linear infinite;
            pointer-events: none;
        }

        #resultsTable tbody tr.god-row > td:not(:first-child) {
            background-image:
                linear-gradient(
                    90deg,
                    rgba(7,17,31,0.92),
                    rgba(10,32,55,0.78),
                    rgba(7,17,31,0.92)
                );
            border-top-color: rgba(131, 185, 224, 0.34);
            border-bottom-color: rgba(131, 185, 224, 0.34);
        }

        @keyframes godOceanRun {
            0% {
                transform: translateX(-45px);
            }
            100% {
                transform: translateX(45px);
            }
        }

        @keyframes godWaveStreak {
            0% {
                transform: translateX(-16%) skewX(-24deg);
            }
            100% {
                transform: translateX(16%) skewX(-24deg);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .god-skin::before,
            .god-wave-streak {
                animation: none;
            }
        }
    `;

    document.head.appendChild(style);
}

function renderProjectCRankCell(data, index) {
    const displayName = INITIAL_DISPLAY_NAMES[data.initials] ?? "unknown";

    if (data.initials === PROJECT_C_GOD_INITIALS) {
        return `
            <td>
                <div class="god-skin">
                    <div class="god-wave-streak" aria-hidden="true"></div>
                    <div class="god-skin-content">
                        <span class="rank-badge">#${index + 1}</span>
                        <span class="masked-initial">${displayName}</span>
                        <span class="god-tog-chip">${data.initials}</span>
                    </div>
                </div>
            </td>
        `;
    }

    return `
        <td>
            <div class="rank-cell">
                <span class="rank-badge">#${index + 1}</span>
                <span class="masked-initial">${displayName}</span>
            </div>
        </td>
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

// One shared limit also covers overlapping week loads and product-page fallbacks.
function createTaskLimiter(limit) {
    const queue = [];
    let active = 0;

    function drain() {
        while (active < limit && queue.length) {
            const { task, resolve, reject } = queue.shift();
            active++;
            Promise.resolve().then(task).then(resolve, reject).finally(() => {
                active--;
                drain();
            });
        }
    }

    return (task) => new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        drain();
    });
}

// Only public product prices are stored. Sales history is fetched live every time.
function restoreProjectCPriceCache() {
    try {
        const entries = JSON.parse(sessionStorage.getItem(PRICE_CACHE_STORAGE_KEY) || "[]");
        const now = Date.now();
        if (!Array.isArray(entries)) return;
        for (const entry of entries.slice(-PRICE_CACHE_MAX_ENTRIES)) {
            if (!Array.isArray(entry) || entry.length !== 2) continue;
            const [sku, cached] = entry;
            if (typeof sku === "string" && cached &&
                Number.isFinite(cached.price) && cached.price >= 0 &&
                Number.isFinite(cached.cachedAt) && cached.cachedAt <= now &&
                now - cached.cachedAt < PRICE_CACHE_TTL_MS) {
                rankedPriceCache.set(sku, cached);
            }
        }
    } catch {
        // Private browsing, file:// restrictions and corrupt storage are nonfatal.
    }
}

function saveProjectCPriceCache() {
    window.clearTimeout(priceCacheSaveTimer);
    priceCacheSaveTimer = null;
    const now = Date.now();
    const entries = Array.from(rankedPriceCache)
        .filter(([, cached]) => now - cached.cachedAt < PRICE_CACHE_TTL_MS)
        .slice(-PRICE_CACHE_MAX_ENTRIES);
    try {
        sessionStorage.setItem(PRICE_CACHE_STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // In-memory caching still works when storage is unavailable or full.
    }
}

function scheduleProjectCPriceCacheSave() {
    if (priceCacheSaveTimer !== null) return;
    priceCacheSaveTimer = window.setTimeout(saveProjectCPriceCache, 400);
}

function refreshProjectCPrices() {
    priceCacheGeneration++;
    rankedPriceCache.clear();
    rankedPricePromiseCache.clear();
    saveProjectCPriceCache();
    void loadWeeklyRanking();
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

    const generation = priceCacheGeneration;
    const pricePromise = schedulePriceLookup(async () => {
        // Skip queued work superseded by an explicit price refresh.
        if (generation !== priceCacheGeneration) return 0;
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
            // A temporary network failure must not become a cached zero price.
            return 0;
        }

        if (generation === priceCacheGeneration) {
            rankedPriceCache.set(sku, { price, cachedAt: Date.now() });
            scheduleProjectCPriceCacheSave();
        }
        return price;
    });

    rankedPricePromiseCache.set(sku, pricePromise);

    try {
        return await pricePromise;
    } finally {
        if (rankedPricePromiseCache.get(sku) === pricePromise) {
            rankedPricePromiseCache.delete(sku);
        }
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

const PROJECT_C_LAST_WEEK_CODE = "kontol";
let projectCLastWeekUnlocked = false;
let projectCSelectedSalesWeek = "current";
let projectCWeeklyLoadId = 0;

function setProjectCSalesWeekLabel(startDate, endDate, salesWeek = "current") {
    const rangeElement = document.getElementById("rangeSummary");
    if (!rangeElement) return;

    const label = projectCLastWeekUnlocked
        ? `${salesWeek === "previous" ? "Last week" : "This week"} · `
        : "";

    rangeElement.textContent =
        `${label}${formatDisplayDate(startDate)} → ${formatDisplayDate(endDate)}`;
}

function updateProjectCWeekControls() {
    const controls = document.getElementById("projectCWeekControls");
    if (!controls) return;

    for (const button of controls.querySelectorAll("[data-sales-week]")) {
        button.setAttribute(
            "aria-pressed",
            String(button.dataset.salesWeek === projectCSelectedSalesWeek)
        );
    }
}

function revealLastWeekSales() {
    const table = document.getElementById("resultsTable");
    if (!table?.parentElement) return;

    projectCLastWeekUnlocked = true;

    if (!document.getElementById("projectCWeekControlsStyles")) {
        const style = document.createElement("style");
        style.id = "projectCWeekControlsStyles";

        style.textContent = `
            #projectCWeekControls {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 10px;
                margin: 0 0 16px;
                padding: 12px 14px;
                border: 1px solid rgba(128, 154, 181, 0.35);
                border-radius: 12px;
                color: inherit;
            }

            #projectCWeekControls button {
                cursor: pointer;
                font: inherit;
                font-weight: 600;
                color: inherit;
                background: transparent;
                border: 1px solid rgba(128, 154, 181, 0.5);
                border-radius: 8px;
                padding: 8px 12px;
            }

            #projectCWeekControls button[aria-pressed="true"] {
                background: #185eaa;
                border-color: #185eaa;
                color: #fff;
            }

            #projectCWeekControls button:focus-visible {
                outline: 2px solid #589de6;
                outline-offset: 3px;
            }

            #projectCWeekControls [data-hide-last-week] {
                margin-left: auto;
            }
        `;

        document.head.appendChild(style);
    }

    if (!document.getElementById("projectCWeekControls")) {
        const controls = document.createElement("div");
        controls.id = "projectCWeekControls";
        controls.setAttribute("role", "group");
        controls.setAttribute("aria-label", "Sales week");

        controls.innerHTML = `
            <strong>Sales week</strong>
            <button type="button" data-sales-week="current">
                This week
            </button>
            <button type="button" data-sales-week="previous">
                Last week · Fri–Thu
            </button>
            <button type="button" data-hide-last-week>
                Hide last week
            </button>
        `;

        for (const button of controls.querySelectorAll("[data-sales-week]")) {
            button.addEventListener("click", () => {
                if (button.dataset.salesWeek !== projectCSelectedSalesWeek) {
                    void loadWeeklyRanking(button.dataset.salesWeek);
                }
            });
        }

        controls.querySelector("[data-hide-last-week]").addEventListener("click", () => {
            projectCLastWeekUnlocked = false;
            controls.remove();
            void loadWeeklyRanking("current");
        });

        table.parentElement.insertBefore(controls, table);
    }

    updateProjectCWeekControls();

    if (projectCSelectedSalesWeek !== "previous") {
        void loadWeeklyRanking("previous");
    }
}

function installProjectCLastWeekShortcut() {
    let typedCode = "";

    // Detect typing anywhere on the page, including inside inputs.
    // Normal typing and browser shortcuts are not intercepted.
    window.addEventListener("keydown", (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
            typedCode = "";
            return;
        }

        if (event.repeat || event.key === "Shift") return;

        if (event.key === "Backspace") {
            typedCode = typedCode.slice(0, -1);
            return;
        }

        if (typeof event.key !== "string" || event.key.length !== 1) {
            typedCode = "";
            return;
        }

        typedCode = (typedCode + event.key.toLowerCase())
            .slice(-PROJECT_C_LAST_WEEK_CODE.length);

        if (typedCode === PROJECT_C_LAST_WEEK_CODE) {
            typedCode = "";
            revealLastWeekSales();
        }
    }, true);

    window.addEventListener("blur", () => {
        typedCode = "";
    });
}

function getPreviousSalesPeriod() {
    const { startDate: currentWeekStart } = getCurrentSalesPeriod();

    const startDate = new Date(currentWeekStart);
    const endDate = new Date(currentWeekStart);

    // Previous Friday through previous Thursday, inclusive.
    // Calendar arithmetic handles month, year and daylight-saving changes.
    startDate.setDate(startDate.getDate() - 7);
    endDate.setDate(endDate.getDate() - 1);

    return { startDate, endDate };
}

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

async function loadWeeklyRanking(salesWeek = projectCSelectedSalesWeek) {
    if (salesWeek !== "current" && salesWeek !== "previous") return;
    if (salesWeek === "previous" && !projectCLastWeekUnlocked) return;

    const resultsBody = document.querySelector("#resultsTable tbody");
    const grandTotalElement = document.getElementById("grandTotal");
    const itemTotalElement = document.getElementById("itemTotal");

    if (!resultsBody || !grandTotalElement || !itemTotalElement) return;

    const loadId = ++projectCWeeklyLoadId;
    const isActiveLoad = () => loadId === projectCWeeklyLoadId;

    projectCSelectedSalesWeek = salesWeek;
    updateProjectCWeekControls();

    const loadStartedAt = performance.now();

    const { startDate, endDate } = salesWeek === "previous"
        ? getPreviousSalesPeriod()
        : getCurrentSalesPeriod();

    const startDateKey = formatDateKey(startDate);
    const endDateKey = formatDateKey(endDate);

    setProjectCSalesWeekLabel(startDate, endDate, salesWeek);

    resultsBody.innerHTML = "";
    grandTotalElement.textContent = "$0.00";
    itemTotalElement.textContent = "0";

    setLoadingState(
        true,
        salesWeek === "previous"
            ? "Loading last week's retail and wholesale data…"
            : "Loading weekly retail and wholesale data…"
    );

    const urlMap = {
        retail: "https://my.tempetyres.com.au/retailpicking/history/",
        wholesale: "https://my.tempetyres.com.au/warehousepicking/sydney/history/"
    };

    const parser = new DOMParser();
    const salesBucket = createSalesBucket();
    const intranetConcurrency = 4;
    const validInitials = new Set(PROJECT_C_INITIALS);
    const failedHistoryRequests = [];
    const priceJobs = new Map();

    // Start each SKU as soon as a history page arrives, while other pages load.
    const prefetchPrice = (sku) => {
        if (!priceJobs.has(sku)) priceJobs.set(sku, getPriceForSku(sku, parser));
    };

    /*
     * RETAIL:
     * Fetch one exact-date page for each day in the selected period.
     */
    const loadRetailByExactDate = async () => {
        const salesDates = getSalesWeekDates(startDate, endDate);

        await mapWithConcurrency(
            salesDates,
            intranetConcurrency,
            async (date) => {
                if (!isActiveLoad()) return;
                const day = date.getDate();
                const month = date.getMonth() + 1;
                const year = date.getFullYear();

                const retailUrl =
                    `${urlMap.retail}?day=${day}&month=${month}&year=${year}&q=&searchin=ALL`;

                try {
                    const html = await fetchProxyText(retailUrl);
                    if (!isActiveLoad()) return;
                    const doc = parser.parseFromString(html, "text/html");
                    const rows = doc.querySelectorAll(".col-md-12 table tbody tr");

                    for (const row of rows) {
                        const columns = row.querySelectorAll("td");
                        if (columns.length < 7) continue;

                        const rowInitials =
                            columns[3].querySelector("a")?.textContent.trim();

                        const sku =
                            columns[1].querySelector("small")?.textContent.trim();

                        const quantity =
                            Number.parseInt(columns[5].textContent.trim(), 10);

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
                        prefetchPrice(sku);
                    }
                } catch (error) {
                    failedHistoryRequests.push(error);

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
     * This week uses the existing per-person search.
     * Last week requests each person for each exact date to reduce
     * the risk of newer records crowding out the older week.
     */
    const loadWholesaleByPerson = async () => {
        const baseUrl = urlMap.wholesale;

        const dates = salesWeek === "previous"
            ? getSalesWeekDates(startDate, endDate)
            : [null];

        const queries = dates.flatMap((date) =>
            PROJECT_C_INITIALS.map((initials) => ({ initials, date }))
        );

        await mapWithConcurrency(
            queries,
            intranetConcurrency,
            async ({ initials, date }) => {
                if (!isActiveLoad()) return;
                try {
                    const intranetUrl =
                        `${baseUrl}?day=${date ? date.getDate() : 0}` +
                        `&month=${date ? date.getMonth() + 1 : 0}` +
                        `&year=${date ? date.getFullYear() : 0}` +
                        `&q=${encodeURIComponent(initials)}&searchin=EnteredBy`;

                    const html = await fetchProxyText(intranetUrl);
                    if (!isActiveLoad()) return;
                    const doc = parser.parseFromString(html, "text/html");
                    const rows = doc.querySelectorAll(".col-md-12 table tbody tr");

                    for (const row of rows) {
                        const columns = row.querySelectorAll("td");
                        if (columns.length < 7) continue;

                        const rawDateText =
                            columns[1].querySelector("b a")?.textContent.trim();

                        const rowDateKey = toDateKey(rawDateText);

                        if (
                            !rowDateKey ||
                            rowDateKey < startDateKey ||
                            rowDateKey > endDateKey ||
                            (date && rowDateKey !== formatDateKey(date))
                        ) {
                            continue;
                        }

                        const rowInitials =
                            columns[3].querySelector("a")?.textContent.trim();

                        const sku =
                            columns[1].querySelector("small")?.textContent.trim();

                        const quantity =
                            Number.parseInt(columns[5].textContent.trim(), 10);

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
                        prefetchPrice(sku);
                    }
                } catch (error) {
                    failedHistoryRequests.push(error);
                    console.error(`Error processing wholesale for ${initials}:`, error);
                }
            }
        );
    };

    try {
        await Promise.all([
            loadRetailByExactDate(),
            loadWholesaleByPerson(),
        ]);

        // A slower request for another week must not overwrite this view.
        if (!isActiveLoad()) return;

        if (failedHistoryRequests.length > 0) {
            throw new Error(
                `${failedHistoryRequests.length} sales history request(s) failed.`
            );
        }

        const intranetFinishedAt = performance.now();

        // Price each unique SKU once across all people and both sales types.
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

        const priceEntries = await Promise.all(skuList.map(async (sku) =>
            [sku, await priceJobs.get(sku)]
        ));

        const priceBySku = new Map(priceEntries);

        if (!isActiveLoad()) return;

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
                    Math.min(
                        100,
                        Math.round((combinedTotal / WEEKLY_TARGET) * 100)
                    )
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
            showEmptyState(
                salesWeek === "previous"
                    ? "No ranking data was found for last sales week (Friday–Thursday)."
                    : "No ranking data was found for the current sales week."
            );
            return;
        }

        resultsBody.innerHTML = rowsData.map((data, index) => `
            <tr class="${data.initials === PROJECT_C_GOD_INITIALS ? "god-row" : ""}">
                ${renderProjectCRankCell(data, index)}
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

        const grandTotal = rowsData.reduce(
            (sum, data) => sum + data.combinedTotal,
            0
        );

        const itemTotal = rowsData.reduce(
            (sum, data) => sum + data.qty,
            0
        );

        grandTotalElement.textContent = `$${grandTotal.toFixed(2)}`;
        itemTotalElement.textContent = String(itemTotal);

        console.log(
            `Project C timing — intranet: ${Math.round(intranetFinishedAt - loadStartedAt)}ms, ` +
            `remaining pricing: ${Math.round(pricingFinishedAt - intranetFinishedAt)}ms, ` +
            `total: ${Math.round(performance.now() - loadStartedAt)}ms, ` +
            `unique SKUs: ${uniqueSkus.size}`
        );
    } catch (error) {
        if (!isActiveLoad()) return;

        console.error("Error loading Project C ranking:", error);
        grandTotalElement.textContent = "—";
        itemTotalElement.textContent = "—";

        showEmptyState(
            "The ranking could not be loaded. Check Tom does it all and refresh the page."
        );
    } finally {
        if (isActiveLoad()) setLoadingState(false);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    restoreProjectCPriceCache();
    injectProjectCGodSkinStyles();
    installProjectCLastWeekShortcut();
    installProjectCEffects();
    document.getElementById("projectCRefreshPrices")?.addEventListener("click", refreshProjectCPrices);
    window.addEventListener("pagehide", saveProjectCPriceCache);
    loadWeeklyRanking();
});

/* =========================
   DONKEY / SECRET WINTER KING
   ========================= */

function installProjectCEffects() {
    if (document.getElementById("projectCEffects")) return;

    const effects = document.createElement("div");
    effects.id = "projectCEffects";
    effects.innerHTML = `
        <div class="project-c-winter" aria-hidden="true" hidden>
            <div class="project-c-winter-halo"></div>
            <svg class="project-c-throne" viewBox="0 0 900 1000" fill="none" focusable="false">
                <defs>
                    <linearGradient id="pcIce" x1="220" y1="90" x2="690" y2="840" gradientUnits="userSpaceOnUse">
                        <stop stop-color="#d5f4ff"/><stop offset=".27" stop-color="#528ba5"/>
                        <stop offset=".64" stop-color="#18384f"/><stop offset="1" stop-color="#080f1b"/>
                    </linearGradient>
                    <linearGradient id="pcSteel" x1="450" y1="210" x2="450" y2="850" gradientUnits="userSpaceOnUse">
                        <stop stop-color="#46778a"/><stop offset=".44" stop-color="#172e41"/>
                        <stop offset="1" stop-color="#070e19"/>
                    </linearGradient>
                    <linearGradient id="pcCloak" x1="353" y1="407" x2="607" y2="908" gradientUnits="userSpaceOnUse">
                        <stop stop-color="#14273c"/><stop offset=".55" stop-color="#050b14"/>
                        <stop offset="1" stop-color="#01040a"/>
                    </linearGradient>
                    <radialGradient id="pcMoon"><stop stop-color="#9ed8f5" stop-opacity=".22"/><stop offset="1" stop-color="#367490" stop-opacity="0"/></radialGradient>
                </defs>
                <circle cx="450" cy="380" r="360" fill="url(#pcMoon)"/>
                <!-- A crown of frozen blades behind the throne. -->
                <g fill="url(#pcIce)" stroke="#99cee5" stroke-opacity=".25">
                    <path d="M448 46 466 168 456 654 431 654 433 168Z"/>
                    <path d="m357 102 40 110 44 447-27 4-70-443Z"/>
                    <path d="m540 102 13 119-70 443-27-4 44-447Z"/>
                    <path d="m280 177 61 104 67 418-30 8-107-414Z"/>
                    <path d="m621 177 8 116-107 414-30-8 67-418Z"/>
                    <path d="m208 246 68 88 85 388-29 10-128-381Z"/>
                    <path d="m692 246 4 105-128 381-29-10 85-388Z"/>
                    <path d="m144 321 86 84 91 340-28 16-154-343Z"/>
                    <path d="m756 321 5 97-154 343-28-16 91-340Z"/>
                </g>
                <path d="m295 345 155-92 155 92 49 387H246Z" fill="url(#pcSteel)" stroke="#6ca5ba" stroke-opacity=".5"/>
                <path d="m328 378 122-76 122 76 33 322H295Z" fill="#060e1a" stroke="#79bfd5" stroke-opacity=".3"/>
                <path d="m251 654 42 13 21 126H221l-20-159 22-47 32 17Zm398 0-42 13-21 126h93l20-159-22-47-32 17Z" fill="url(#pcIce)"/>
                <path d="M233 781h434l42 54H191Z" fill="url(#pcSteel)" stroke="#507385" stroke-opacity=".4"/>
                <path d="M213 835h474l30 33H184ZM166 869h568l38 34H126ZM105 904h690l47 35H60Z" fill="#10202f" stroke="#54768e" stroke-opacity=".25"/>
                <!-- The seated king: ice crown, armour, sword, heavy cloak. -->
                <g class="project-c-king">
                    <path d="m401 409-43 18-34 52-49 334 98 70 75-43 79 43 102-70-49-334-36-52-45-18Z" fill="url(#pcCloak)" stroke="#658ba7" stroke-opacity=".2"/>
                    <path d="m362 426-45 26-16 43 88 16 22-70-24-34Zm176 0 45 26 16 43-88 16-22-70 24-34Z" fill="url(#pcIce)"/>
                    <path d="m396 431 53 28 54-28 27 68-25 83-54 39-56-39-25-83Z" fill="url(#pcSteel)" stroke="#6394b2" stroke-opacity=".45"/>
                    <path d="m404 455 45 34 47-34M383 501l66 41 68-41m-125 48 57 37 56-38" stroke="#b0d5e6" stroke-opacity=".2" stroke-width="2"/>
                    <path d="m396 579-45 65-16 143 59 17 56-164 55 164 59-17-17-143-44-65Z" fill="#0b1726" stroke="#4f7690" stroke-opacity=".5"/>
                    <path d="m388 494-30 39-75 18-8 34 105-11 37-45Zm125 0 30 39 75 18 8 34-105-11-37-45Z" fill="url(#pcSteel)" stroke="#6d95af" stroke-opacity=".4"/>
                    <path d="m282 549-33 12-7 20 32 8 13-16Zm336 0 33 12 7 20-32 8-13-16Z" fill="#72929f"/>
                    <path d="m412 366 8 52 29 24 31-24 8-52-20-28h-35Z" fill="#73929f"/>
                    <path d="m419 382 30 18 31-18-9 29-22 15-21-15Z" fill="#1d3548"/>
                    <path d="m416 358-14-66 25 21 22-48 23 48 25-21-15 66-33 14Z" fill="url(#pcIce)" stroke="#c2eafa" stroke-opacity=".55"/>
                    <path d="m412 333 37 15 37-15" stroke="#c4ecfc" stroke-opacity=".6" stroke-width="2"/>
                    <g class="project-c-king-eyes" fill="#b8f7ff">
                        <path d="m426 378 13 2-2 4-10-1Zm45 0-13 2 2 4 10-1Z"/>
                    </g>
                    <path d="m447 543-6 48 3 240 6 29 6-29 3-240-6-48Z" fill="url(#pcIce)"/>
                    <path d="M418 587h64v9h-64Z" fill="#85b9d1"/><path d="M445 549h10v37h-10Z" fill="#334f65"/>
                    <path d="m312 660-27 143 75 54-23-114m250-83 27 143-75 54 23-114" stroke="#4a6b85" stroke-opacity=".2" stroke-width="3"/>
                </g>
                <g stroke="#b3eaff" stroke-opacity=".3">
                    <path d="m286 688-40 45 16 61m367-108 36 44-11 63M337 847l-31 22 17 34m259-56 32 22-17 34M454 96v120M300 229l54 293m248-293-54 293"/>
                </g>
            </svg>
            <div class="project-c-fog project-c-fog-back"></div>
            <div class="project-c-fog project-c-fog-front"></div>
            <div class="project-c-snow"></div>
            <div class="project-c-winter-vignette"></div>
        </div>
        <aside class="project-c-donkey" aria-label="Donkey says: look ! it's a Jahash ! does it looks like your mirror? I bet it does !">
            <div class="project-c-donkey-bubble" aria-hidden="true">
                <span class="project-c-donkey-label">MIRROR CHECK</span>
                <p>Look! It’s your long-lost twin, the Jahash! Wishing you both the best.</p>
            </div>
            <svg class="project-c-donkey-art" viewBox="0 0 210 190" fill="none" aria-hidden="true" focusable="false">
                <ellipse cx="107" cy="174" rx="72" ry="7" fill="#02080f" opacity=".24"/>
                <g class="project-c-donkey-tail"><path d="M160 112q35-31 35-4" stroke="#777b8c" stroke-width="7" stroke-linecap="round"/><path d="m194 103 7 9-9 6-4-9Z" fill="#303647"/></g>
                <g class="project-c-donkey-leg project-c-donkey-leg-back"><path d="m131 128 7 34 14 2-3-43" fill="#636a7d"/><path d="m133 158 20 1 2 12h-23Z" fill="#252e42"/></g>
                <g class="project-c-donkey-leg project-c-donkey-leg-front"><path d="m88 126-7 35-14 3 3-43" fill="#777e90"/><path d="m65 159 19-2 1 14H63Z" fill="#252e42"/></g>
                <ellipse cx="118" cy="118" rx="52" ry="34" fill="#9da4b4"/>
                <path d="M88 132q30 32 64-4-26 17-64 4Z" fill="#c1c7d0"/>
                <g class="project-c-donkey-head">
                    <path d="M57 70 37 13q-5-15 9-9 25 12 28 59" fill="#929aaa" stroke="#414b60" stroke-width="3"/>
                    <path d="m55 49-8-30q14 11 17 34Z" fill="#d4a4b5"/>
                    <path d="m75 66 5-50q2-18 12-7 14 22 0 59" fill="#a4adbd" stroke="#414b60" stroke-width="3"/>
                    <path d="m84 51 4-29q7 14 2 32Z" fill="#d4a4b5"/>
                    <path d="m91 64 8-8-2 15 9-1-3 14-6 32-15-5Z" fill="#353e51"/>
                    <path d="M92 75q12 24 4 43l-16 19-32-21 1-35q15-28 43-6Z" fill="#aab3c1" stroke="#414b60" stroke-width="3"/>
                    <path d="M50 100q-17 6-17 22 2 19 25 19 26-2 25-18-2-21-33-23Z" fill="#e1d6ce" stroke="#414b60" stroke-width="3"/>
                    <ellipse cx="70" cy="92" rx="11" ry="14" fill="#f8f6f2"/>
                    <ellipse cx="67" cy="94" rx="5" ry="8" fill="#273247"/>
                    <circle cx="65" cy="91" r="2" fill="white"/>
                    <path d="m58 77 20-2" stroke="#394258" stroke-width="4" stroke-linecap="round"/>
                    <ellipse cx="45" cy="119" rx="3" ry="4" fill="#777180"/><ellipse cx="63" cy="119" rx="3" ry="4" fill="#777180"/>
                    <path d="M48 131q9 5 17-1" stroke="#5e5869" stroke-width="2.5" stroke-linecap="round"/>
                    <path d="m47 139 14 2-3 10-7-1Z" fill="#444e62"/>
                </g>
                <g class="project-c-donkey-leg project-c-donkey-leg-near"><path d="m148 137-2 27-15 2 2-37" fill="#929bae"/><path d="m129 160 20 1 1 12h-23Z" fill="#303a50"/></g>
            </svg>
        </aside>
        <div class="project-c-effects-controls">
            <span class="project-c-winter-caption" hidden>WINTER KING <span>ESC TO RETURN</span></span>
            <button type="button" class="project-c-motion-button" aria-pressed="false" aria-label="Pause animations">Pause animations</button>
        </div>
    `;
    document.body.appendChild(effects);
    document.body.dataset.projectCTheme = "donkey";

    const winter = effects.querySelector(".project-c-winter");
    const donkey = effects.querySelector(".project-c-donkey");
    const caption = effects.querySelector(".project-c-winter-caption");
    const motionButton = effects.querySelector(".project-c-motion-button");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let paused = reducedMotion.matches;
    let winterMode = false;
    let typed = "";
    let lastTypedAt = 0;

    // A fixed, small number of particles; animation runs in CSS, without a JS loop.
    const flakes = document.createDocumentFragment();
    for (let i = 0; i < 28; i++) {
        const flake = document.createElement("i");
        flake.style.cssText = `--x:${(i * 37 + 9) % 100}%;--size:${2 + i % 3}px;--duration:${10 + i % 9}s;--delay:-${(i * 7) % 19}s;--drift:${40 + i % 5 * 15}px;--alpha:${0.18 + (i % 5) * 0.12}`;
        flakes.appendChild(flake);
    }
    effects.querySelector(".project-c-snow").appendChild(flakes);

    function updateMotion() {
        const stopped = paused || document.hidden;
        document.body.classList.toggle("project-c-effects-paused", stopped);
        effects.classList.toggle("project-c-still", paused);
        motionButton.textContent = paused ? "Play animations" : "Pause animations";
        motionButton.setAttribute("aria-label", motionButton.textContent);
        motionButton.setAttribute("aria-pressed", String(paused));
    }

    function setTheme(useWinter) {
        winterMode = useWinter;
        winter.hidden = !useWinter;
        donkey.hidden = useWinter;
        caption.hidden = !useWinter;
        document.body.dataset.projectCTheme = useWinter ? "winter" : "donkey";
    }

    motionButton.addEventListener("click", () => {
        paused = !paused;
        updateMotion();
    });
    document.addEventListener("visibilitychange", () => {
        typed = "";
        updateMotion();
    });
    reducedMotion.addEventListener("change", () => {
        paused = reducedMotion.matches;
        updateMotion();
    });
    window.addEventListener("blur", () => { typed = ""; });

    window.addEventListener("keydown", (event) => {
        const editing = event.target instanceof Element &&
            event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']");
        if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || editing) {
            typed = "";
            return;
        }
        if (event.repeat || event.key === "Shift") return;
        if (event.key === "Escape") {
            typed = "";
            setTheme(false);
            return;
        }
        const now = Date.now();
        if (now - lastTypedAt > 1800) typed = "";
        lastTypedAt = now;
        if (event.key === "Backspace") {
            typed = typed.slice(0, -1);
            return;
        }
        if (typeof event.key !== "string" || event.key.length !== 1) {
            typed = "";
            return;
        }
        typed = (typed + event.key.toLowerCase()).slice(-3);
        if (typed === "tom") {
            typed = "";
            setTheme(!winterMode);
        }
    });
    updateMotion();
}
