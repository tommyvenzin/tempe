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

/* =========================
   SPEED SETTINGS (v2)
   =========================
   v2 keeps what it has already learned in this browser and only asks for what changed:
   - the last ranking appears instantly from saved data, then updates live;
   - finished days (before today) are never downloaded again;
   - website prices are kept for 12 hours and rechecked quietly in the background;
   - the table fills in as data arrives instead of waiting for everything. */

const PROJECT_C_VERSION = "2.0";
const RETAIL_HISTORY_URL = "https://my.tempetyres.com.au/retailpicking/history/";
const WHOLESALE_HISTORY_URL = "https://my.tempetyres.com.au/warehousepicking/sydney/history/";
const WEBSITE_URL = "https://www.tempetyres.com.au";

const EXTENSION_BRIDGE_TIMEOUT_MS = 25000;        // intranet pages can be slow
const EXTENSION_PING_TIMEOUT_MS = 4000;           // a missing extension shows within 4 s
const INTRANET_CONCURRENCY = 8;                   // same as v1 (4 retail + 4 wholesale)
const WEBSITE_CONCURRENCY = 6;                    // same as v1: gentle on the public site
const HISTORY_RETRIES = 2;
const PRICE_RETRIES = 1;

const PRICE_FRESH_MS = 12 * 60 * 60 * 1000;       // reuse a website price for 12 h
const PRICE_KEEP_MS = 21 * 24 * 60 * 60 * 1000;   // older prices still show instantly, then get rechecked
const NOT_LISTED_FRESH_MS = 6 * 60 * 60 * 1000;   // SKUs without a website price: recheck after 6 h
const UNKNOWN_PRICE_FRESH_MS = 20 * 60 * 1000;    // a page that could not be read: try again after 20 min
const PRICE_RECHECKS_PER_REFRESH = 40;            // quiet background rechecks, biggest sellers first
const PRICE_CACHE_MAX_ENTRIES = 5000;
const DAY_CACHE_KEEP_DAYS = 21;
const FINAL_AFTER_DAY_END_MS = 6 * 60 * 60 * 1000; // a day is only saved for good once read 6 h after it ended
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;          // ignore saved entries from a clock that ran ahead
const FAILED_RETRY_MS = 30 * 1000;                  // quiet retries after a failed intranet page: 30 s, 1, 2, 4 min
const MAX_FAILED_RETRIES = 4;

const AUTO_REFRESH_MS = 5 * 60 * 1000;            // "Live ranking": quiet refresh every 5 minutes
const FOCUS_REFRESH_AFTER_MS = 60 * 1000;         // and when the tab comes back after a minute
const RENDER_THROTTLE_MS = 150;

const PRICE_STORE_KEY = "project-c:prices:v2";
const DAY_STORE_KEY = "project-c:days:v2";
const LAST_WEEK_USED_KEY = "project-c:last-week-used:v2";
// Retail days are saved for the team below only. Changing the team list re-reads them.
const PROJECT_C_TEAM_SIGNATURE = PROJECT_C_INITIALS.join(",");

// v1 rule: a price shown on the search page is used as is. Set to true to copy F Alt Tab,
// which always uses Bridgestone's product-page price (ecomm_totalvalue). Costs one extra
// request per Bridgestone SKU the first time it is priced.
const BRIDGESTONE_USE_PRODUCT_PRICE = false;

const PROJECT_C_TEAM = new Set(PROJECT_C_INITIALS);

/* =========================
   UI HELPERS
   ========================= */

function setLoadingState(isLoading, message = "Loading weekly rankings…") {
    const loadingIndicator = document.getElementById("loadingIndicator");
    if (!loadingIndicator) return;

    const loadingText = loadingIndicator.querySelector("[data-loading-text]");
    if (loadingText && loadingText.textContent !== message) loadingText.textContent = message;

    loadingIndicator.classList.toggle("is-visible", isLoading);
    loadingIndicator.style.display = isLoading ? "flex" : "none";
}

function showEmptyState(message) {
    const resultsBody = document.querySelector("#resultsTable tbody");
    if (!resultsBody) return;

    projectCRowElements.clear();
    resultsBody.innerHTML = `
        <tr>
            <td colspan="6" class="project-empty-state">${message}</td>
        </tr>
    `;
}

function clearProjectCTable() {
    const resultsBody = document.querySelector("#resultsTable tbody");
    if (resultsBody) resultsBody.textContent = "";
    projectCRowElements.clear();
}

function formatProjectCClock(ms) {
    return new Date(ms).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function setProjectCLiveStatus(state, text, title = "") {
    const chip = document.getElementById("projectCLiveChip") || document.querySelector(".status-chip-live");
    if (!chip) return;

    let label = chip.querySelector("[data-live-text]");
    if (!label) {
        // Older Project_C.html: replace the plain "Live ranking" text with a label span.
        for (const node of [...chip.childNodes]) {
            if (node.nodeType === Node.TEXT_NODE) node.remove();
        }
        label = document.createElement("span");
        label.setAttribute("data-live-text", "");
        chip.appendChild(label);
    }

    chip.dataset.state = state;
    if (label.textContent !== text) label.textContent = text;
    chip.title = title;
}

function injectProjectCSpeedStyles() {
    if (document.getElementById("projectCSpeedStyles")) return;

    const style = document.createElement("style");
    style.id = "projectCSpeedStyles";
    style.textContent = `
        .project-c-page .status-chip-live[data-state="updating"] .status-dot {
            background: #38bdf8;
            box-shadow: 0 0 0 5px rgba(56, 189, 248, 0.12);
            animation: projectCLivePulse 1.1s ease-in-out infinite;
        }
        .project-c-page .status-chip-live[data-state="stale"] {
            color: #fde68a;
            border-color: rgba(251, 191, 36, 0.28);
            background: rgba(120, 53, 15, 0.22);
        }
        .project-c-page .status-chip-live[data-state="stale"] .status-dot {
            background: #fbbf24;
            box-shadow: 0 0 0 5px rgba(251, 191, 36, 0.12);
        }
        .project-c-page .status-chip-live[data-state="error"] {
            color: #fecdd3;
            border-color: rgba(251, 113, 133, 0.3);
            background: rgba(136, 19, 55, 0.22);
        }
        .project-c-page .status-chip-live[data-state="error"] .status-dot {
            background: #fb7185;
            box-shadow: 0 0 0 5px rgba(251, 113, 133, 0.12);
        }
        body.project-c-effects-paused .status-chip-live .status-dot {
            animation-play-state: paused !important;
        }
        @keyframes projectCLivePulse {
            50% { opacity: 0.35; }
        }
        @media (prefers-reduced-motion: reduce) {
            .project-c-page .status-chip-live .status-dot { animation: none !important; }
        }
    `;
    document.head.appendChild(style);
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

function getSalesPeriod(salesWeek) {
    return salesWeek === "previous" ? getPreviousSalesPeriod() : getCurrentSalesPeriod();
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

function getTodayKey() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return formatDateKey(today);
}

function dateFromKey(dateKey) {
    return new Date(Number(dateKey.slice(0, 4)), Number(dateKey.slice(4, 6)) - 1, Number(dateKey.slice(6, 8)));
}

function addDaysToKey(dateKey, days) {
    const date = dateFromKey(dateKey);
    date.setDate(date.getDate() + days);
    return formatDateKey(date);
}

function makeDateKey(year, month, day) {
    if (
        !Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
        year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31
    ) {
        return null;
    }
    return `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

function toDateKey(rawDateText) {
    if (!rawDateText) return null;
    const text = String(rawDateText);

    // 1. Written dates with a 4-digit year. The AU intranet normally uses DD-MM-YYYY.
    //    A time after the date (for example 02-10-2026 10:15) no longer gets mixed into it.
    for (const match of text.matchAll(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/g)) {
        const a = Number.parseInt(match[1], 10);
        const b = Number.parseInt(match[2], 10);
        const c = Number.parseInt(match[3], 10);
        let key = null;

        if (match[1].length === 4) {
            key = makeDateKey(a, b, c);
        } else if (match[3].length === 4) {
            if (a > 12) key = makeDateKey(c, b, a);
            else if (b > 12) key = makeDateKey(c, a, b);
            else key = makeDateKey(c, b, a);
        }

        if (key) return key;
    }

    // 2. Record numbers such as WS-30-20261002-101500-7 carry the date as one 8-digit block.
    for (const block of text.match(/\d+/g) || []) {
        if (block.length !== 8) continue;
        const key = makeDateKey(Number(block.slice(0, 4)), Number(block.slice(4, 6)), Number(block.slice(6, 8)));
        if (key) return key;
    }

    // 3. Same digits-only scan as v1.
    const compactMatch = text.replace(/\D/g, "").match(/(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])/);
    return compactMatch ? compactMatch[0] : null;
}

/* =========================
   SAVED DATA (this browser only)
   =========================
   Prices: public website prices only.
   Days: per person and day, which SKUs and how many. No customer names, documents or prices. */

const projectCStorage = (() => {
    let local = null;

    try {
        local = window.localStorage;
        local.getItem("project-c:probe"); // reading is enough: a full quota must not hide saved data
    } catch {
        local = null; // Private windows and blocked storage still work, just without saving.
    }

    return {
        read(key) {
            if (!local) return null;
            try {
                return JSON.parse(local.getItem(key) || "null");
            } catch {
                return null;
            }
        },
        write(key, value) {
            if (!local) return false;
            try {
                local.setItem(key, JSON.stringify(value));
                return true;
            } catch {
                return false;
            }
        },
        remove(key) {
            try {
                local?.removeItem(key);
            } catch {
                // nonfatal
            }
        },
    };
})();

function parseStoredJson(text) {
    try {
        return JSON.parse(text || "null");
    } catch {
        return null;
    }
}

function isSkuQuantities(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.values(value).every((quantity) => Number.isFinite(quantity));
}

// Saved as [price, checkedAt, status]: 1 = listed, 0 = not listed on the website, 2 = page could not be read.
const PRICE_STATUS_CODES = { listed: 1, unlisted: 0, unknown: 2 };
const PRICE_STATUS_NAMES = ["unlisted", "listed", "unknown"];
const PRICE_FRESH_FOR = { listed: PRICE_FRESH_MS, unlisted: NOT_LISTED_FRESH_MS, unknown: UNKNOWN_PRICE_FRESH_MS };

const projectCPrices = {
    entries: new Map(), // sku -> { price, at, status }
    timer: null,

    load() {
        this.mergeSaved(projectCStorage.read(PRICE_STORE_KEY));
    },

    mergeSaved(saved) {
        if (!saved || saved.v !== 2 || !saved.p || typeof saved.p !== "object") return false;
        const now = Date.now();
        let changed = false;

        for (const [sku, value] of Object.entries(saved.p)) {
            if (!Array.isArray(value)) continue;
            const [price, at, code] = value;
            const status = PRICE_STATUS_NAMES[code];
            if (!status || !Number.isFinite(price) || price < 0 || !Number.isFinite(at)) continue;
            if (now - at > PRICE_KEEP_MS || at > now + FUTURE_TOLERANCE_MS) continue;

            const current = this.entries.get(sku);
            if (!current || at > current.at) {
                this.entries.set(sku, { price, at, status });
                changed = true;
            }
        }

        return changed;
    },

    get(sku) {
        return this.entries.get(sku);
    },

    // "fresh": use as is. "stale": use now, recheck quietly. "missing": must be looked up.
    state(sku, now = Date.now()) {
        const entry = this.entries.get(sku);
        if (!entry) return "missing";
        const age = now - entry.at;
        if (age > PRICE_KEEP_MS) return "missing";
        return age < PRICE_FRESH_FOR[entry.status] ? "fresh" : "stale";
    },

    // status: "listed" (price > 0), "unlisted" (the site shows no price) or "unknown" (page not readable).
    set(sku, price, status) {
        const current = this.entries.get(sku);
        const now = Date.now();

        if (status === "listed" && price > 0) {
            this.entries.set(sku, { price, at: now, status });
        } else if (status === "unknown") {
            // Nothing learned: keep any saved price as it is; otherwise try again in 20 minutes.
            if (current && current.status !== "unknown") return;
            this.entries.set(sku, { price: current?.price || 0, at: now, status });
        } else {
            // No price on the site any more. Sales already made keep the last known price,
            // and the SKU is checked again in 6 hours.
            this.entries.set(sku, { price: current?.price > 0 ? current.price : 0, at: now, status: "unlisted" });
        }
        this.scheduleSave();
    },

    clear() {
        this.entries.clear();
        projectCStorage.remove(PRICE_STORE_KEY);
    },

    scheduleSave() {
        if (this.timer !== null) return;
        this.timer = window.setTimeout(() => this.save(), 500);
    },

    save() {
        window.clearTimeout(this.timer);
        this.timer = null;
        this.mergeSaved(projectCStorage.read(PRICE_STORE_KEY)); // keep what other tabs learned

        const now = Date.now();
        const newestFirst = [...this.entries]
            .filter(([, entry]) => now - entry.at <= PRICE_KEEP_MS)
            .sort((a, b) => b[1].at - a[1].at)
            .slice(0, PRICE_CACHE_MAX_ENTRIES);

        // If the shared storage is full, keep the newest half rather than nothing.
        for (let keep = newestFirst.length; keep > 0; keep = Math.floor(keep / 2)) {
            const p = {};
            for (const [sku, entry] of newestFirst.slice(0, keep)) p[sku] = [entry.price, entry.at, PRICE_STATUS_CODES[entry.status]];
            if (projectCStorage.write(PRICE_STORE_KEY, { v: 2, p })) return;
        }
    },
};

// "R:YYYYMMDD"          -> { INITIALS: { SKU: qty } }   (one retail page per day, this team)
// "W:YYYYMMDD:INITIALS" -> { SKU: qty }                 (wholesale, per person per day)
const projectCDays = {
    entries: new Map(), // key -> { at, final, data }
    timer: null,

    load() {
        this.mergeSaved(projectCStorage.read(DAY_STORE_KEY));
    },

    oldestKeptKey() {
        return addDaysToKey(getTodayKey(), -DAY_CACHE_KEEP_DAYS);
    },

    mergeSaved(saved) {
        if (!saved || saved.v !== 2 || !saved.d || typeof saved.d !== "object") return false;
        const oldest = this.oldestKeptKey();
        const now = Date.now();
        const sameTeam = saved.team === PROJECT_C_TEAM_SIGNATURE;
        let changed = false;

        for (const [key, value] of Object.entries(saved.d)) {
            if (!value || !Number.isFinite(value.at) || value.at > now + FUTURE_TOLERANCE_MS) continue;
            if (!/^[RW]:\d{8}/.test(key) || key.slice(2, 10) < oldest) continue;

            const isRetail = key.startsWith("R:");
            if (isRetail && !sameTeam) continue;
            const valid = isRetail
                ? value.data && typeof value.data === "object" && Object.values(value.data).every(isSkuQuantities)
                : isSkuQuantities(value.data);
            if (!valid) continue;

            const current = this.entries.get(key);
            if (!current || value.at > current.at) {
                this.entries.set(key, { at: value.at, final: value.final === true, data: value.data });
                changed = true;
            }
        }

        return changed;
    },

    get(key) {
        return this.entries.get(key);
    },

    isFinal(key) {
        return this.entries.get(key)?.final === true;
    },

    // requestedAt: when the page was asked for. An older answer never replaces a newer one,
    // and a day is only saved for good once it was read well after it ended.
    set(key, dateKey, data, requestedAt = Date.now()) {
        const current = this.entries.get(key);
        if (current && current.at > requestedAt) return;

        const dayEnded = dateFromKey(addDaysToKey(dateKey, 1)).getTime();
        this.entries.set(key, { at: requestedAt, final: requestedAt >= dayEnded + FINAL_AFTER_DAY_END_MS, data });
        this.scheduleSave();
    },

    latestAt(dateKeys) {
        let latest = 0;
        for (const dateKey of dateKeys) {
            const retail = this.entries.get(`R:${dateKey}`);
            if (retail && retail.at > latest) latest = retail.at;
            for (const initials of PROJECT_C_INITIALS) {
                const wholesale = this.entries.get(`W:${dateKey}:${initials}`);
                if (wholesale && wholesale.at > latest) latest = wholesale.at;
            }
        }
        return latest;
    },

    clear() {
        this.entries.clear();
        projectCStorage.remove(DAY_STORE_KEY);
    },

    scheduleSave() {
        if (this.timer !== null) return;
        this.timer = window.setTimeout(() => this.save(), 500);
    },

    save() {
        window.clearTimeout(this.timer);
        this.timer = null;
        this.mergeSaved(projectCStorage.read(DAY_STORE_KEY));

        const oldest = this.oldestKeptKey();
        const d = {};
        for (const [key, entry] of this.entries) {
            if (key.slice(2, 10) < oldest) {
                this.entries.delete(key);
                continue;
            }
            d[key] = { at: entry.at, final: entry.final, data: entry.data };
        }
        projectCStorage.write(DAY_STORE_KEY, { v: 2, team: PROJECT_C_TEAM_SIGNATURE, d });
    },
};

/* =========================
   NETWORK (Tom does it all)
   ========================= */

class ProjectCError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        Object.assign(this, details);
    }
}

const projectCStats = {
    requests: {},
    firstPaintMs: null,
};

const projectCBridge = (() => {
    const waiting = new Map();
    let counter = 0;
    let listening = false;
    let alive = false;
    let silent = false; // a real request timed out and the extension never answered anything
    let pingPromise = null;

    function listen() {
        if (listening) return;
        listening = true;

        // One listener for every request (v1 added and removed one per request).
        window.addEventListener("message", (event) => {
            if (event.source !== window) return;

            const data = event.data;
            if (!data || data.source !== "GENERAL_FETCH_BRIDGE" || data.type !== "GENERAL_FETCH_RESPONSE") return;

            const entry = waiting.get(data.id);
            if (!entry) return;

            waiting.delete(data.id);
            window.clearTimeout(entry.timer);
            alive = true;
            silent = false;
            entry.resolve(data.result || { ok: false, error: "Empty answer from Tom does it all" });
        });
    }

    function send(url, options, timeoutMs = EXTENSION_BRIDGE_TIMEOUT_MS, isPing = false) {
        listen();

        const notAnswering = () => new ProjectCError(
            "timeout",
            "Tom does it all did not respond. Check that the extension is enabled for this page."
        );

        // After one silent timeout, queued requests fail at once instead of waiting 25 s each.
        if (silent && !alive && !isPing) return Promise.reject(notAnswering());

        return new Promise((resolve, reject) => {
            const id = `project-c-${Date.now()}-${++counter}`;
            const timer = window.setTimeout(() => {
                waiting.delete(id);
                if (!alive && !isPing) silent = true;
                reject(notAnswering());
            }, timeoutMs);

            waiting.set(id, { resolve, timer });

            window.postMessage({
                source: "LOCAL_HELPER_PAGE",
                type: "GENERAL_FETCH_REQUEST",
                id,
                url,
                options,
            }, "*");
        });
    }

    // background.js answers about: URLs at once ("Blocked protocol"), so this proves the
    // extension is listening without any network request.
    function ping() {
        if (alive) return Promise.resolve(true);
        if (!pingPromise) {
            pingPromise = send("about:blank", { method: "GET" }, EXTENSION_PING_TIMEOUT_MS, true)
                .then(() => true, () => alive)
                .finally(() => {
                    pingPromise = null;
                });
        }
        return pingPromise;
    }

    return {
        send,
        ping,
        get alive() {
            return alive;
        },
    };
})();

// A small priority queue per host. Lower number = sooner; ties keep their order.
function createRequestQueue(limit) {
    const waiting = [];
    let active = 0;
    let sequence = 0;

    function pump() {
        while (active < limit && waiting.length) {
            let best = 0;
            let bestPriority = waiting[0].priority();

            for (let i = 1; i < waiting.length; i++) {
                const priority = waiting[i].priority();
                if (priority < bestPriority || (priority === bestPriority && waiting[i].sequence < waiting[best].sequence)) {
                    best = i;
                    bestPriority = priority;
                }
            }

            const job = waiting.splice(best, 1)[0];
            active++;
            Promise.resolve()
                .then(job.task)
                .then(job.resolve, job.reject)
                .finally(() => {
                    active--;
                    pump();
                });
        }
    }

    return {
        run(task, priority = () => 0) {
            return new Promise((resolve, reject) => {
                waiting.push({
                    task,
                    resolve,
                    reject,
                    sequence: ++sequence,
                    priority: typeof priority === "function" ? priority : () => priority,
                });
                pump();
            });
        },
        setLimit(next) {
            limit = Math.max(1, next);
            pump();
        },
    };
}

const projectCIntranetQueue = createRequestQueue(INTRANET_CONCURRENCY);
const projectCWebsiteQueue = createRequestQueue(WEBSITE_CONCURRENCY);

function projectCWait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function projectCRequest(url, kind, { queue, priority, retries = 0, guard = null }) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await queue.run(async () => {
                if (guard) guard();
                projectCStats.requests[kind] = (projectCStats.requests[kind] || 0) + 1;

                const requestedAt = Date.now();
                const result = await projectCBridge.send(url, { method: "GET", cache: "no-store" });

                if (!result || !result.ok) {
                    throw new ProjectCError("network", result?.error || "Tom does it all request failed");
                }

                if (typeof result.status === "number" && (result.status < 200 || result.status >= 400)) {
                    throw new ProjectCError("http", `${result.status} ${result.statusText || "HTTP error"}`, { status: result.status });
                }

                const text = String(result.text || "");
                if (!text.trim()) throw new ProjectCError("empty", "Empty response");

                return { text, finalUrl: String(result.finalUrl || url), requestedAt };
            }, priority);
        } catch (error) {
            if (error.code === "cancelled") throw error;
            const transient =
                error.code === "network" ||
                error.code === "empty" ||
                error.code === "blocked" ||
                (error.code === "http" && (error.status >= 500 || error.status === 429 || error.status === 408)) ||
                (error.code === "timeout" && projectCBridge.alive);

            if (!transient || attempt >= retries) throw error;
            await projectCWait(attempt === 0 ? 600 : 1800);
        }
    }
}

/* =========================
   PAGE READERS
   ========================= */

const projectCParser = new DOMParser();

// Same table cells as v1: SKU = td[1] small, initials = td[3] a, qty = td[5], wholesale date = td[1] b a.
function readPickingRows(html) {
    const doc = projectCParser.parseFromString(html, "text/html");
    const rows = [];

    for (const row of doc.querySelectorAll(".col-md-12 table tbody tr")) {
        const columns = row.querySelectorAll("td");
        if (columns.length < 7) continue;

        rows.push({
            initials: columns[3].querySelector("a")?.textContent.trim(),
            sku: columns[1].querySelector("small")?.textContent.trim(),
            quantity: Number.parseInt(columns[5].textContent.trim(), 10),
            dateText: columns[1].querySelector("b a")?.textContent.trim(),
        });
    }

    const hasHistoryTable = !!doc.querySelector(".col-md-12 table");
    const dataRows = [...doc.querySelectorAll(".col-md-12 table tbody tr")]
        .filter((row) => row.querySelectorAll("td").length >= 2).length;
    // An empty day may come back without a table ("No records found"), so the page's own
    // heading or its search form also count as proof that this is a real history page.
    const looksLikeHistory =
        hasHistoryTable ||
        /picking\s+history/i.test(html) ||
        !!doc.querySelector("[name='searchin']");

    return { rows, hasHistoryTable, dataRows, looksLikeHistory };
}

function looksLikeLoginPage(html, finalUrl) {
    if (/\/(account\/)?(log-?in|sign-?in)\b/i.test(String(finalUrl || ""))) return true;
    return /<input[^>]+type\s*=\s*["']?password/i.test(html);
}

let projectCLoginSeenAt = 0;

function projectCLoginError() {
    return new ProjectCError(
        "login",
        "The intranet sent its login page. Log in to my.tempetyres.com.au in this Chrome, then refresh."
    );
}

function projectCCancelled() {
    return new ProjectCError("cancelled", "Replaced by a newer refresh");
}

async function fetchPickingRows(url, kind, priority, run) {
    const { text, finalUrl, requestedAt } = await projectCRequest(url, kind, {
        queue: projectCIntranetQueue,
        priority,
        retries: HISTORY_RETRIES,
        guard: () => {
            // A newer refresh replaced this one: skip work that has not started yet (as v1 did).
            if (run?.cancelled) throw projectCCancelled();
            // Once one page shows the login screen, the rest of this refresh stops asking.
            if (projectCLoginSeenAt && Date.now() - projectCLoginSeenAt < 15000) throw projectCLoginError();
        },
    });

    const { rows, hasHistoryTable, dataRows, looksLikeHistory } = readPickingRows(text);

    if (!rows.length) {
        // v1 showed "No ranking data" when the intranet had logged out. Say what is wrong instead.
        if (/\/(account\/)?(log-?in|sign-?in)\b/i.test(finalUrl) || (!hasHistoryTable && looksLikeLoginPage(text, finalUrl))) {
            projectCLoginSeenAt = Date.now();
            throw projectCLoginError();
        }
        // An empty page is only "no sales" if it really is a history page whose rows we can
        // read. A maintenance page or a changed table layout must not be saved as zero.
        if (!looksLikeHistory || dataRows > 0) {
            throw new ProjectCError("format", "The intranet sent a page Project C could not read. Showing saved data where possible.");
        }
    }

    projectCLoginSeenAt = 0;
    return { rows, requestedAt };
}

// "$1,045.00" -> 1045 (v1 read this as 1). "Call", "TBC" and blanks are not prices.
function parseMoney(text) {
    const raw = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!raw || /call|tbc|poa|enquire/i.test(raw)) return NaN;
    const match = raw.replace(/(\d),(?=\d{3}(?!\d))/g, "$1").match(/\d+(?:\.\d+)?/);
    return match ? Number.parseFloat(match[0]) : NaN;
}

function normaliseSku(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Same rule as F Alt Tab: the SKU is the last "-" part of the product link.
function skuFromProductUrl(url) {
    if (!url || url === "#") return "";
    try {
        const clean = decodeURIComponent(url.split("?")[1] || url);
        const last = clean.split("-").pop()?.replace(/[^a-z0-9]/gi, "").trim();
        if (last && last.length >= 4 && last.length <= 20 && /\d/.test(last)) return last.toUpperCase();
    } catch {
        // ignore
    }
    return "";
}

function looksBlocked(html) {
    const text = html.slice(0, 300000).toLowerCase();
    return (
        text.includes("verify you are human") ||
        text.includes("verification required") ||
        text.includes("g-recaptcha") ||
        text.includes("/captcha-verify") ||
        text.includes("you have been blocked") ||
        text.includes("temporarily blocked") ||
        text.includes("access denied")
    );
}

function readCardPrice(card) {
    const saleText = (card.querySelector(".sale-price span")?.textContent || "").trim();
    if (saleText) return parseMoney(saleText);

    const wholesaleText = (card.querySelector(".wh-price")?.textContent || "").replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
    const wholesaleMatch = wholesaleText.match(/\$\s*([\d.]+)/);
    return wholesaleMatch ? Number.parseFloat(wholesaleMatch[1]) : NaN;
}

function readCards(doc) {
    return [...doc.querySelectorAll(".product-container")].map((card) => {
        const link = card.querySelector(".image-container a")?.getAttribute("href") || "";
        return {
            sku: normaliseSku(card.querySelector("input[name='tyresku']")?.value) || normaliseSku(skuFromProductUrl(link)),
            brand: (card.querySelector(".brand-name b")?.textContent || "").trim().toLowerCase(),
            link,
            price: readCardPrice(card),
        };
    });
}

// Reads the product cards on a search page. Where it is safe, only the results area is
// parsed (the site's header, menus and scripts are most of each page); otherwise the whole page.
function readSearchResults(html) {
    if (!html.includes("product-container")) return [];

    const firstCard = html.search(/<[a-z][^<>]*\bclass\s*=\s*["'][^"']*\bproduct-container\b/i);
    if (firstCard >= 0) {
        const end = Math.min(html.length, html.lastIndexOf("product-container") + 20000);
        const cards = readCards(projectCParser.parseFromString(html.slice(firstCard, end), "text/html"));
        if (cards.length) return cards;
    }
    return readCards(projectCParser.parseFromString(html, "text/html"));
}

function readProductPagePrices(html, doc = null, isProductAddress = false) {
    // Wheels: #price2, found with a real parser so unquoted or unusual markup still works.
    let wheelPrice = NaN;
    let hasPriceElement = false;
    if (/price2/i.test(html)) {
        const page = doc || projectCParser.parseFromString(html, "text/html");
        const element = page.getElementById("price2");
        hasPriceElement = !!element;
        wheelPrice = parseMoney(element?.textContent);
    }

    // Tyres: the dataLayer block that describes the product itself (as F Alt Tab does).
    let analyticsPrice = NaN;
    let hasProductData = false;
    for (const push of html.matchAll(/dataLayer\.push\(\s*\{([\s\S]*?)\}\s*\);/gi)) {
        const block = push[1] || "";
        if (!/['"]ecomm_pagetype['"]\s*:\s*['"]product['"]/i.test(block)) continue;
        hasProductData = true;
        const value = block.match(/['"]ecomm_totalvalue['"]\s*:\s*['"]([\d,.]+)['"]/i);
        if (value) analyticsPrice = Number.parseFloat(value[1].replace(/,/g, ""));
        break;
    }
    // v1 took any ecomm_totalvalue. Only do that on a real product address, so a link that
    // ends up on the home page cannot price a SKU from the home page's analytics.
    if (!Number.isFinite(analyticsPrice) && isProductAddress) {
        const value = html.match(/['"]ecomm_totalvalue['"]\s*:\s*['"]([\d,.]+)['"]/i);
        if (value) {
            hasProductData = true;
            analyticsPrice = Number.parseFloat(value[1].replace(/,/g, ""));
        }
    }

    return { wheelPrice, analyticsPrice, isProductPage: hasPriceElement || hasProductData };
}

let projectCWebsiteSlowUntil = 0;

function slowDownWebsite() {
    projectCWebsiteSlowUntil = Date.now() + 30000;
    projectCWebsiteQueue.setLimit(2);
    window.setTimeout(() => {
        if (Date.now() >= projectCWebsiteSlowUntil) projectCWebsiteQueue.setLimit(WEBSITE_CONCURRENCY);
    }, 30500);
}

function absoluteWebsiteUrl(link) {
    if (/^https?:\/\//i.test(link)) return link.replace(/^http:\/\//i, "https://");
    return `${WEBSITE_URL}${link.startsWith("/") ? "" : "/"}${link}`;
}

function isProductUrl(url) {
    try {
        return /\/tyreproducts/i.test(new URL(url).pathname);
    } catch {
        return false;
    }
}

function priced(price) {
    return price > 0 ? { price, status: "listed" } : { price: 0, status: "unlisted" };
}

// Returns { price, status }. Pages that cannot be read throw "format"/"blocked" (saved as
// "unknown" for 20 minutes); network trouble throws and is simply tried again next refresh.
async function lookupWebsitePrice(sku, priority) {
    const searchUrl = `${WEBSITE_URL}/search?q=${encodeURIComponent(sku)}`;
    const search = await projectCRequest(searchUrl, "search", { queue: projectCWebsiteQueue, priority, retries: PRICE_RETRIES });

    // A search can open the product page straight away. Read the product itself, not related cards.
    if (isProductUrl(search.finalUrl)) {
        const doc = projectCParser.parseFromString(search.text, "text/html");
        const { wheelPrice, analyticsPrice, isProductPage } = readProductPagePrices(search.text, doc, true);
        const price = [wheelPrice, analyticsPrice, readCardPrice(doc)].find((value) => value > 0) || 0;
        if (!price && !isProductPage) throw new ProjectCError("format", `Unexpected product page for ${sku}`);
        return priced(price);
    }

    const cards = readSearchResults(search.text);

    if (!cards.length) {
        if (looksBlocked(search.text)) {
            slowDownWebsite();
            throw new ProjectCError("blocked", "The website asked for a human check. Prices will retry later.");
        }

        // No product cards: read the page like v1 did (page-level price selectors).
        const doc = projectCParser.parseFromString(search.text, "text/html");
        const { wheelPrice, analyticsPrice } = readProductPagePrices(search.text, doc);
        const price = [readCardPrice(doc), wheelPrice, analyticsPrice].find((value) => value > 0) || 0;
        if (price > 0) return priced(price);

        // A real "nothing found" page repeats the search; an outage page does not.
        if (!search.text.toUpperCase().includes(String(sku).toUpperCase())) {
            throw new ProjectCError("format", `The website search did not answer normally for ${sku}`);
        }
        return priced(0);
    }

    // The exact SKU, not just the first result (v1 priced whatever the search listed first).
    const wanted = normaliseSku(sku);
    const card = cards.find((item) => item.sku === wanted) || cards[0];
    const bridgestone = BRIDGESTONE_USE_PRODUCT_PRICE && card.brand === "bridgestone";
    const link = /^(#|javascript:)/i.test(card.link.trim()) ? "" : card.link.trim();

    if (card.price > 0 && !bridgestone) return priced(card.price);
    if (!link) return priced(card.price);

    const product = await projectCRequest(absoluteWebsiteUrl(link), "product", {
        queue: projectCWebsiteQueue,
        priority,
        retries: PRICE_RETRIES,
    });
    const { wheelPrice, analyticsPrice, isProductPage } = readProductPagePrices(product.text, null, isProductUrl(product.finalUrl));

    const candidates = bridgestone
        ? [analyticsPrice, card.price, wheelPrice]
        : [wheelPrice, analyticsPrice];
    const price = candidates.find((value) => value > 0) || 0;

    // A captcha or maintenance page instead of the product must not be saved as $0.
    if (!price && !isProductPage) {
        if (looksBlocked(product.text)) slowDownWebsite();
        throw new ProjectCError("format", `Unexpected product page for ${sku}`);
    }
    return priced(price);
}

/* =========================
   PRICE JOBS
   ========================= */

const projectCPriceJobs = new Map(); // sku -> { promise, meta }
let projectCSkuImpact = new Map();   // sku -> quantity in the week on screen (bigger = priced sooner)

// band: 2 = needed for the week on screen, 3 = background week, 4 = quiet recheck.
function requestProjectCPrice(sku, band, runId) {
    const existing = projectCPriceJobs.get(sku);
    if (existing) {
        existing.meta.band = Math.min(existing.meta.band, band);
        existing.meta.runId = Math.max(existing.meta.runId, runId);
        return existing.promise;
    }

    const meta = { band, runId };
    const priority = () => meta.band * 1e12 - meta.runId * 1e6 - Math.min(999999, projectCSkuImpact.get(sku) || 0);

    const promise = lookupWebsitePrice(sku, priority).then(
        (result) => {
            projectCPrices.set(sku, result.price, result.status);
            scheduleProjectCRender();
            return result;
        },
        (error) => {
            // An unreadable page: don't ask again on every refresh, and never save it as a price.
            if (error.code === "format" || error.code === "blocked") projectCPrices.set(sku, 0, "unknown");
            throw error;
        }
    );

    projectCPriceJobs.set(sku, { promise, meta });
    promise.then(
        () => projectCPriceJobs.delete(sku),
        () => projectCPriceJobs.delete(sku)
    );
    return promise;
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
   RANKING (built from saved data, so it can be drawn at any moment)
   ========================= */

function buildProjectCModel(salesWeek) {
    const { startDate, endDate } = getSalesPeriod(salesWeek);
    const dateKeys = getSalesWeekDates(startDate, endDate).map(formatDateKey);
    const people = new Map(PROJECT_C_INITIALS.map((initials) => [initials, { retail: new Map(), wholesale: new Map() }]));
    let loadedParts = 0;

    const addAll = (target, skus) => {
        for (const [sku, quantity] of Object.entries(skus)) {
            if (Number.isFinite(quantity)) target.set(sku, (target.get(sku) || 0) + quantity);
        }
    };

    for (const dateKey of dateKeys) {
        const retail = projectCDays.get(`R:${dateKey}`);
        if (retail) {
            loadedParts++;
            for (const [initials, skus] of Object.entries(retail.data)) {
                const person = people.get(initials);
                if (person) addAll(person.retail, skus);
            }
        }

        for (const initials of PROJECT_C_INITIALS) {
            const wholesale = projectCDays.get(`W:${dateKey}:${initials}`);
            if (!wholesale) continue;
            loadedParts++;
            addAll(people.get(initials).wholesale, wholesale.data);
        }
    }

    const now = Date.now();
    const impact = new Map();
    const unpriced = new Set();
    const priceOf = (sku) => {
        const entry = projectCPrices.get(sku);
        if (projectCPrices.state(sku, now) === "missing" || (entry.status === "unknown" && !(entry.price > 0))) {
            unpriced.add(sku);
            return projectCPrices.state(sku, now) === "missing" ? 0 : entry.price;
        }
        return entry.price;
    };

    const rows = [];
    for (const initials of PROJECT_C_INITIALS) {
        const person = people.get(initials);
        let retailTotal = 0;
        let wholesaleTotal = 0;
        let qty = 0;

        for (const [sku, quantity] of person.retail) {
            retailTotal += priceOf(sku) * quantity;
            qty += quantity;
            impact.set(sku, (impact.get(sku) || 0) + quantity);
        }

        for (const [sku, quantity] of person.wholesale) {
            wholesaleTotal += priceOf(sku) * quantity;
            qty += quantity;
            impact.set(sku, (impact.get(sku) || 0) + quantity);
        }

        if (qty === 0) continue;

        const combinedTotal = retailTotal + wholesaleTotal;
        const grade = getGradeInfo(combinedTotal);
        const percent = Math.max(0, Math.min(100, Math.round((combinedTotal / WEEKLY_TARGET) * 100)));

        rows.push({
            initials,
            retailTotal,
            wholesaleTotal,
            combinedTotal,
            qty,
            gradeLabel: grade.label,
            gradeClass: grade.className,
            percent,
        });
    }

    rows.sort((a, b) => b.combinedTotal - a.combinedTotal);

    return {
        salesWeek,
        startDate,
        endDate,
        dateKeys,
        rows,
        impact,
        unpriced,
        loadedParts,
        totalParts: dateKeys.length * (1 + PROJECT_C_INITIALS.length),
    };
}

/* =========================
   TABLE (rows are updated in place, so the god skin keeps animating)
   ========================= */

const projectCRowElements = new Map();
let projectCRenderTimer = null;
let projectCLastRenderAt = -Infinity;

function scheduleProjectCRender() {
    if (projectCRenderTimer !== null) return;
    const wait = Math.max(0, projectCLastRenderAt + RENDER_THROTTLE_MS - performance.now());
    projectCRenderTimer = window.setTimeout(() => {
        projectCRenderTimer = null;
        renderProjectC();
    }, wait);
}

function createProjectCRow(data, index) {
    const template = document.createElement("template");
    template.innerHTML = `
        <tr class="${data.initials === PROJECT_C_GOD_INITIALS ? "god-row" : ""}">
            ${renderProjectCRankCell(data, index)}
            <td data-cell="retail"></td>
            <td data-cell="wholesale"></td>
            <td data-cell="combined"></td>
            <td data-cell="qty"></td>
            <td>
                <div class="progress-wrapper">
                    <div class="progress-label"></div>
                    <div class="progress-bar">
                        <div class="progress-fill"></div>
                    </div>
                </div>
            </td>
        </tr>
    `.trim();

    const tr = template.content.firstElementChild;
    return {
        tr,
        rank: tr.querySelector(".rank-badge"),
        retail: tr.querySelector('[data-cell="retail"]'),
        wholesale: tr.querySelector('[data-cell="wholesale"]'),
        combined: tr.querySelector('[data-cell="combined"]'),
        qty: tr.querySelector('[data-cell="qty"]'),
        label: tr.querySelector(".progress-label"),
        fill: tr.querySelector(".progress-fill"),
    };
}

function setProjectCText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
}

function updateProjectCRow(row, data, index) {
    setProjectCText(row.rank, `#${index + 1}`);
    setProjectCText(row.retail, `$${data.retailTotal.toFixed(2)}`);
    setProjectCText(row.wholesale, `$${data.wholesaleTotal.toFixed(2)}`);
    setProjectCText(row.combined, `$${data.combinedTotal.toFixed(2)}`);
    setProjectCText(row.qty, String(data.qty));
    setProjectCText(
        row.label,
        `${data.gradeLabel} – $${data.combinedTotal.toFixed(0)} / ${WEEKLY_TARGET.toLocaleString()}`
    );

    const fillClass = `progress-fill ${data.gradeClass}`;
    if (row.fill.className !== fillClass) row.fill.className = fillClass;

    const width = `${data.percent}%`;
    if (row.fill.style.width !== width) row.fill.style.width = width;
}

function renderProjectC() {
    projectCLastRenderAt = performance.now();

    const resultsBody = document.querySelector("#resultsTable tbody");
    const grandTotalElement = document.getElementById("grandTotal");
    const itemTotalElement = document.getElementById("itemTotal");
    if (!resultsBody || !grandTotalElement || !itemTotalElement) return null;

    const model = buildProjectCModel(projectCSelectedSalesWeek);
    projectCSkuImpact = model.impact;

    const run = projectCView.run;
    const loading = !!run && !run.done;

    if (!model.rows.length) {
        if (loading && !run.banner) {
            // Quiet refresh or retry: keep what is on screen (including an error) until there is data.
        } else if (loading && model.loadedParts < model.totalParts) {
            if (projectCRowElements.size || resultsBody.querySelector(".project-empty-state")) clearProjectCTable();
            setProjectCText(grandTotalElement, "$0.00");
            setProjectCText(itemTotalElement, "0");
        } else if (run?.done && run.failed) {
            showEmptyState(
                run.errors.some((error) => error.code === "login")
                    ? "The intranet has logged out. Log in to my.tempetyres.com.au in this Chrome, then refresh the page."
                    : "The ranking could not be loaded. Check Tom does it all and refresh the page."
            );
            setProjectCText(grandTotalElement, "—");
            setProjectCText(itemTotalElement, "—");
        } else if (!loading || model.loadedParts === model.totalParts) {
            showEmptyState(
                model.salesWeek === "previous"
                    ? "No ranking data was found for last sales week (Friday–Thursday)."
                    : "No ranking data was found for the current sales week."
            );
            setProjectCText(grandTotalElement, "$0.00");
            setProjectCText(itemTotalElement, "0");
        }
        return model;
    }

    const wanted = new Set(model.rows.map((row) => row.initials));
    for (const [initials, row] of projectCRowElements) {
        if (!wanted.has(initials)) {
            row.tr.remove();
            projectCRowElements.delete(initials);
        }
    }

    const keep = new Set([...projectCRowElements.values()].map((row) => row.tr));
    for (const child of [...resultsBody.children]) {
        if (!keep.has(child)) child.remove();
    }

    model.rows.forEach((data, index) => {
        let row = projectCRowElements.get(data.initials);
        if (!row) {
            row = createProjectCRow(data, index);
            projectCRowElements.set(data.initials, row);
        }
        updateProjectCRow(row, data, index);
        if (resultsBody.children[index] !== row.tr) {
            resultsBody.insertBefore(row.tr, resultsBody.children[index] || null);
        }
    });

    const grandTotal = model.rows.reduce((sum, row) => sum + row.combinedTotal, 0);
    const itemTotal = model.rows.reduce((sum, row) => sum + row.qty, 0);
    setProjectCText(grandTotalElement, `$${grandTotal.toFixed(2)}`);
    setProjectCText(itemTotalElement, String(itemTotal));

    if (projectCStats.firstPaintMs === null) projectCStats.firstPaintMs = Math.round(performance.now());

    return model;
}

/* =========================
   AUTOMATIC WEEKLY RANKING
   ========================= */

const PROJECT_C_LAST_WEEK_CODE = "kontol";
let projectCLastWeekUnlocked = false;
let projectCSelectedSalesWeek = "current";

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

const projectCView = {
    run: null,           // the refresh that drives the banner and the live chip
    lastRefreshAt: 0,    // when a refresh of this week last started
    retryTimer: null,
    retryCount: 0,
    retryPending: null,
};
let projectCRunCounter = 0;
let projectCBackgroundWeek = null;

function dispatchProjectCEvent(phase, run) {
    document.dispatchEvent(new CustomEvent("projectc:refresh", {
        detail: { phase, week: run.salesWeek, id: run.id, ms: run.ms ?? null },
    }));
}

function updateProjectCStatus() {
    const run = projectCView.run;
    if (!run) return;

    const weekWord = run.salesWeek === "previous" ? "last week's" : "this week's";

    if (!run.done) {
        let text;
        if (run.extensionSilent && !projectCBridge.alive) {
            text = "Waiting for Tom does it all… check the extension is on for this page.";
        } else if (run.historyDone < run.historyTotal) {
            text = run.hadData
                ? `Updating ${weekWord} sales… ${run.historyDone}/${run.historyTotal}`
                : `Loading ${weekWord} retail and wholesale data… ${run.historyDone}/${run.historyTotal}`;
        } else if (run.priceTotal > run.priceDone) {
            text = `Pricing ${run.priceDone}/${run.priceTotal} new SKU${run.priceTotal === 1 ? "" : "s"}…`;
        } else {
            text = "Finishing…";
        }

        if (run.banner) setLoadingState(true, text);

        if (run.extensionSilent && !projectCBridge.alive) {
            setProjectCLiveStatus("stale", "Waiting for Tom does it all", "The extension has not answered yet. Check it is installed and enabled for this page.");
        } else if (run.hadData) {
            setProjectCLiveStatus("updating", `Saved ${formatProjectCClock(run.savedAt)} · updating…`, text);
        } else {
            setProjectCLiveStatus("updating", "Loading…", text);
        }
        return;
    }

    if (run.banner) setLoadingState(false);

    const requestText = `${run.intranetRequests} intranet + ${run.websiteRequests} website request${run.intranetRequests + run.websiteRequests === 1 ? "" : "s"}`;
    const login = run.errors.find((error) => error.code === "login");
    const firstError = run.errors[0]?.message || "";

    if (login) {
        setProjectCLiveStatus("error", "Log in to the intranet", login.message);
    } else if (run.failed && run.missingParts >= run.totalParts) {
        setProjectCLiveStatus("error", "Not loaded", firstError || "The ranking could not be loaded.");
    } else if (run.failed && run.missingParts > 0) {
        // Some sales are missing and there is nothing saved to fill the gap: say so plainly.
        setProjectCLiveStatus(
            "stale",
            run.retrying ? "Incomplete · retrying…" : "Incomplete",
            `${run.missingParts} of ${run.totalParts} day/person parts could not be loaded, so some sales are missing. ${firstError}`.trim()
        );
    } else if (run.errors.length || run.priceErrors) {
        const parts = [];
        if (run.errors.length) {
            parts.push(`${run.errors.length} sales update${run.errors.length === 1 ? "" : "s"} failed, saved data is shown instead`);
        }
        if (run.priceErrors) {
            parts.push(`${run.priceErrors} new SKU${run.priceErrors === 1 ? "" : "s"} could not be priced yet`);
        }
        setProjectCLiveStatus(
            "stale",
            `Partly updated ${formatProjectCClock(run.finishedAt)}`,
            `${parts.join(" · ")}. ${firstError}`.trim()
        );
    } else {
        const unpriced = run.unpricedCount
            ? ` · ${run.unpricedCount} SKU${run.unpricedCount === 1 ? "" : "s"} could not be priced yet (counted as $0)`
            : "";
        setProjectCLiveStatus(
            "live",
            `Live · ${formatProjectCClock(run.finishedAt)}`,
            `Updated ${new Date(run.finishedAt).toLocaleTimeString("en-AU")} in ${(run.ms / 1000).toFixed(1)} s · ${requestText}${unpriced}`
        );
    }
}

function scheduleProjectCRetry(salesWeek) {
    window.clearTimeout(projectCView.retryTimer);
    if (projectCView.retryCount >= MAX_FAILED_RETRIES) return false;

    const delay = FAILED_RETRY_MS * 2 ** projectCView.retryCount;
    projectCView.retryCount++;
    projectCView.retryTimer = window.setTimeout(() => {
        projectCView.retryTimer = null;
        if (projectCSelectedSalesWeek !== salesWeek) return;
        if (document.hidden) {
            projectCView.retryPending = salesWeek; // run it when the tab is shown again
            return;
        }
        if (projectCView.run && !projectCView.run.done) return;
        void refreshProjectCWeek(salesWeek, { banner: false });
    }, delay);
    return true;
}

/*
 * Brings one sales week up to date. Only what can have changed is downloaded:
 * days that had already finished are saved for good, today is re-read, and only
 * SKUs without a recent price are looked up. Everything else comes from this browser.
 */
async function refreshProjectCWeek(salesWeek, { full = false, banner = true, view = true } = {}) {
    const previousRun = projectCView.run;

    // A full refresh of this week is already running: clicking again changes nothing.
    if (view && full && previousRun && !previousRun.done && previousRun.full && previousRun.salesWeek === salesWeek) {
        return previousRun;
    }

    const run = {
        id: ++projectCRunCounter,
        salesWeek,
        full,
        banner,
        view,
        done: false,
        failed: false,
        cancelled: false,
        retrying: false,
        startedAt: performance.now(),
        historyTotal: 0,
        historyDone: 0,
        priceTotal: 0,
        priceDone: 0,
        priceErrors: 0,
        errors: [],
        priced: new Set(),
        pricePromises: [],
        requestsBefore: { ...projectCStats.requests },
        hadData: false,
        gotData: false,
        savedAt: 0,
        totalParts: 0,
        missingParts: 0,
    };

    const { startDate, endDate } = getSalesPeriod(salesWeek);
    const dateKeys = getSalesWeekDates(startDate, endDate).map(formatDateKey);
    const today = getTodayKey();

    if (view) {
        // Like v1, a newer refresh replaces an older one; its queued pages are skipped.
        if (previousRun && !previousRun.done) previousRun.cancelled = true;
        window.clearTimeout(projectCView.retryTimer);
        projectCView.retryTimer = null;
        projectCView.retryPending = null;

        const model = buildProjectCModel(salesWeek);
        run.hadData = model.rows.length > 0;
        run.savedAt = projectCDays.latestAt(dateKeys);
        projectCView.run = run;
        if (salesWeek === "current") projectCView.lastRefreshAt = Date.now();
        // Keeps the date range right when the tab stays open past midnight.
        if (salesWeek === projectCSelectedSalesWeek) setProjectCSalesWeekLabel(startDate, endDate, salesWeek);
    }

    const isViewRun = () => view && projectCView.run === run;
    const historyBand = view ? 1 : 3;
    const historyPriority = () => historyBand * 1e12 - run.id * 1e6;
    const priceBand = view ? 2 : 3;

    if (isViewRun()) {
        dispatchProjectCEvent("start", run);
        updateProjectCStatus();
        projectCBridge.ping().then((ok) => {
            if (!ok && !run.done) {
                run.extensionSilent = true;
                if (isViewRun()) updateProjectCStatus();
            }
        });
    }

    const requestPrices = (skus) => {
        if (run.cancelled) return;
        for (const sku of skus) {
            if (run.priced.has(sku)) continue;
            if (!full && projectCPrices.state(sku) !== "missing") continue;

            run.priced.add(sku);
            run.priceTotal++;
            run.pricePromises.push(
                requestProjectCPrice(sku, priceBand, run.id).then(
                    () => {
                        run.priceDone++;
                    },
                    (error) => {
                        run.priceDone++;
                        run.priceErrors++;
                        console.error(`Project C: could not price ${sku}:`, error);
                    }
                ).finally(() => {
                    if (isViewRun()) updateProjectCStatus();
                })
            );
        }
    };

    const history = [];
    const track = (promise) => {
        run.historyTotal++;
        const tracked = promise.then(
            () => {
                run.historyDone++;
                run.gotData = true;
            },
            (error) => {
                run.historyDone++;
                if (error.code === "cancelled") return;
                run.errors.push(error);
                console.error("Project C:", error);
            }
        ).finally(() => {
            scheduleProjectCRender();
            if (isViewRun()) updateProjectCStatus();
        });
        history.push(tracked);
        return tracked;
    };

    const needsDownload = (key) => full || !projectCDays.isFinal(key);

    // RETAIL: one exact-date page per day, like v1, but finished days come from saved data.
    for (const dateKey of dateKeys) {
        if (needsDownload(`R:${dateKey}`)) track(loadRetailDay(dateKey, historyPriority, requestPrices, run));
    }

    // WHOLESALE: per person.
    for (const initials of PROJECT_C_INITIALS) {
        const missingPast = dateKeys.filter((dateKey) => dateKey < today && needsDownload(`W:${dateKey}:${initials}`));
        const nothingSaved = !dateKeys.some((dateKey) => projectCDays.get(`W:${dateKey}:${initials}`));

        if (salesWeek === "current" && missingPast.length && (missingPast.length >= 2 || nothingSaved)) {
            // One search per person covers the whole week (and often last week too).
            track(loadWholesaleAllDates(initials, dateKeys, historyPriority, requestPrices, track, run, needsDownload));
        } else {
            // Usually just today (plus yesterday on the first visit of a new day): small exact-date searches.
            for (const dateKey of missingPast) track(loadWholesaleDay(initials, dateKey, historyPriority, requestPrices, run));
            if (dateKeys.includes(today)) track(loadWholesaleDay(initials, today, historyPriority, requestPrices, run));
        }
    }

    if (isViewRun()) updateProjectCStatus();

    // Follow-up requests are awaited inside the jobs that create them.
    await Promise.allSettled(history);

    // SKUs from saved days that have no usable price yet (for example after clearing prices).
    const model = buildProjectCModel(salesWeek);
    requestPrices(model.impact.keys());
    if (isViewRun()) updateProjectCStatus();

    await Promise.allSettled(run.pricePromises);

    // Quiet rechecks of older prices, biggest sellers first. Nobody waits for these.
    if (!run.cancelled) {
        const stale = [...model.impact.keys()]
            .filter((sku) => !run.priced.has(sku) && projectCPrices.state(sku) === "stale")
            .sort((a, b) => (model.impact.get(b) || 0) - (model.impact.get(a) || 0))
            .slice(0, PRICE_RECHECKS_PER_REFRESH);
        for (const sku of stale) requestProjectCPrice(sku, 4, run.id).catch(() => {});
    }

    const finalModel = buildProjectCModel(salesWeek);
    run.done = true;
    run.failed = run.errors.length > 0;
    run.totalParts = finalModel.totalParts;
    run.missingParts = finalModel.totalParts - finalModel.loadedParts;
    run.unpricedCount = finalModel.unpriced.size;
    run.finishedAt = Date.now();
    run.ms = Math.round(performance.now() - run.startedAt);

    const delta = (kind) => (projectCStats.requests[kind] || 0) - (run.requestsBefore[kind] || 0);
    run.intranetRequests = delta("retail-day") + delta("wholesale-all") + delta("wholesale-day");
    run.websiteRequests = delta("search") + delta("product");

    if (isViewRun()) {
        if (run.failed && projectCBridge.alive && !run.errors.some((error) => error.code === "login")) {
            run.retrying = scheduleProjectCRetry(salesWeek);
        } else if (!run.failed) {
            projectCView.retryCount = 0;
        }

        renderProjectC();
        updateProjectCStatus();
        dispatchProjectCEvent("done", run);
        console.log(
            `Project C ${PROJECT_C_VERSION} timing — ${salesWeek === "previous" ? "last week" : "this week"}: ` +
            `${run.hadData ? `saved data on screen at ${projectCStats.firstPaintMs ?? "?"} ms, ` : ""}` +
            `live in ${run.ms} ms, ${run.intranetRequests} intranet + ${run.websiteRequests} website requests, ` +
            `${finalModel.impact.size} SKUs (${run.priceTotal} newly priced)` +
            `${run.errors.length ? `, ${run.errors.length} failed` : ""}`
        );
    }

    // Last week was opened before in this browser: have it ready too.
    if (view && salesWeek === "current" && !run.failed && !run.cancelled) prefetchLastWeekIfUsed();

    return run;
}

function loadRetailDay(dateKey, priority, requestPrices, run) {
    const date = dateFromKey(dateKey);
    const url =
        `${RETAIL_HISTORY_URL}?day=${date.getDate()}&month=${date.getMonth() + 1}&year=${date.getFullYear()}&q=&searchin=ALL`;

    return fetchPickingRows(url, "retail-day", priority, run).then(({ rows, requestedAt }) => {
        const data = {};
        for (const row of rows) {
            if (!PROJECT_C_TEAM.has(row.initials) || !row.sku || !Number.isFinite(row.quantity)) continue;
            const person = data[row.initials] || (data[row.initials] = {});
            person[row.sku] = (person[row.sku] || 0) + row.quantity;
        }
        projectCDays.set(`R:${dateKey}`, dateKey, data, requestedAt);
        for (const skus of Object.values(data)) requestPrices(Object.keys(skus));
    });
}

function loadWholesaleDay(initials, dateKey, priority, requestPrices, run) {
    const date = dateFromKey(dateKey);
    const url =
        `${WHOLESALE_HISTORY_URL}?day=${date.getDate()}&month=${date.getMonth() + 1}&year=${date.getFullYear()}` +
        `&q=${encodeURIComponent(initials)}&searchin=EnteredBy`;

    return fetchPickingRows(url, "wholesale-day", priority, run).then(({ rows, requestedAt }) => {
        const skus = {};
        for (const row of rows) {
            if (row.initials !== initials || !row.sku || !Number.isFinite(row.quantity)) continue;
            if (toDateKey(row.dateText) !== dateKey) continue;
            skus[row.sku] = (skus[row.sku] || 0) + row.quantity;
        }
        projectCDays.set(`W:${dateKey}:${initials}`, dateKey, skus, requestedAt);
        requestPrices(Object.keys(skus));
    });
}

/*
 * The all-dates search lists the newest records first and stops after a fixed number,
 * so busy weeks can push older records off the page. If the page really is newest-first,
 * every day after its last (oldest) row is complete; that day and anything before it are
 * asked for exactly. If the order is not newest-first, the page vouches for nothing.
 */
async function loadWholesaleAllDates(initials, dateKeys, priority, requestPrices, track, run, needsDownload) {
    const url =
        `${WHOLESALE_HISTORY_URL}?day=0&month=0&year=0&q=${encodeURIComponent(initials)}&searchin=EnteredBy`;
    const { rows, requestedAt } = await fetchPickingRows(url, "wholesale-all", priority, run);

    const today = getTodayKey();
    const inWeek = new Set(dateKeys);
    const byDay = new Map();
    const datesInOrder = [];
    let previous = null;
    let ordered = true;

    for (const row of rows) {
        const dateKey = toDateKey(row.dateText);
        if (!dateKey) continue;
        datesInOrder.push(dateKey);
        if (previous && dateKey > previous) ordered = false;
        previous = dateKey;

        if (row.initials !== initials || !row.sku || !Number.isFinite(row.quantity) || dateKey > today) continue;
        const skus = byDay.get(dateKey) || {};
        skus[row.sku] = (skus[row.sku] || 0) + row.quantity;
        byDay.set(dateKey, skus);
    }

    const dated = datesInOrder.length;
    // The newest of the last three dates, so one stray old record at the very end can't
    // make the page vouch for days that were really cut off.
    const boundary = dated ? datesInOrder.slice(-3).reduce((a, b) => (a > b ? a : b)) : null;

    // Rows whose dates cannot be read must not be saved as "no sales".
    if (rows.length && !dated) {
        throw new ProjectCError("format", `Could not read the wholesale dates for ${initials}.`);
    }

    const save = (dateKey) => {
        const skus = byDay.get(dateKey) || {};
        projectCDays.set(`W:${dateKey}:${initials}`, dateKey, skus, requestedAt);
        if (inWeek.has(dateKey)) requestPrices(Object.keys(skus));
    };

    let askExactly;
    if (!rows.length) {
        // Nothing matches this person at all: this week is empty for them.
        for (const dateKey of dateKeys) if (dateKey <= today) save(dateKey);
        askExactly = [];
    } else if (!ordered) {
        askExactly = dateKeys.filter((dateKey) => dateKey <= today);
    } else {
        // Every day after the oldest row is complete (this often covers last week too).
        const keptFrom = projectCDays.oldestKeptKey();
        let dateKey = addDaysToKey(boundary, 1);
        if (dateKey < keptFrom) dateKey = keptFrom;
        for (; dateKey <= today; dateKey = addDaysToKey(dateKey, 1)) save(dateKey);
        askExactly = dateKeys.filter((key) => key <= boundary);
    }

    askExactly = askExactly.filter((dateKey) => needsDownload(`W:${dateKey}:${initials}`));
    await Promise.all(askExactly.map((dateKey) => track(loadWholesaleDay(initials, dateKey, priority, requestPrices, run))));
}

function prefetchLastWeekIfUsed() {
    const usedAt = projectCStorage.read(LAST_WEEK_USED_KEY);
    if (!Number.isFinite(usedAt) || Date.now() - usedAt > 30 * 24 * 60 * 60 * 1000) return;

    const { startDate } = getPreviousSalesPeriod();
    const weekKey = formatDateKey(startDate);
    if (projectCBackgroundWeek === weekKey) return;
    projectCBackgroundWeek = weekKey;

    void refreshProjectCWeek("previous", { banner: false, view: false });
}

async function loadWeeklyRanking(salesWeek = projectCSelectedSalesWeek, options = {}) {
    if (salesWeek !== "current" && salesWeek !== "previous") return;
    if (salesWeek === "previous" && !projectCLastWeekUnlocked) return;

    const switching = salesWeek !== projectCSelectedSalesWeek;
    projectCSelectedSalesWeek = salesWeek;
    updateProjectCWeekControls();

    const { startDate, endDate } = getSalesPeriod(salesWeek);
    setProjectCSalesWeekLabel(startDate, endDate, salesWeek);

    if (salesWeek === "previous") projectCStorage.write(LAST_WEEK_USED_KEY, Date.now());

    // Draw straight away from what this browser already knows, then bring it up to date.
    // The refresh registers itself first, so an empty first visit shows "loading", not "no data".
    if (switching) clearProjectCTable();
    const refresh = refreshProjectCWeek(salesWeek, { banner: true, ...options });
    renderProjectC();
    return refresh;
}

function refreshProjectCPrices() {
    void refreshProjectCWeek(projectCSelectedSalesWeek, { full: true, banner: true });
}

function installProjectCAutoRefresh() {
    const refreshIfDue = (minimumAgeMs) => {
        if (document.hidden) return;
        if (projectCView.run && !projectCView.run.done) return;

        // A retry that came due while the tab was hidden (this week or last week).
        if (projectCView.retryPending) {
            const week = projectCView.retryPending;
            projectCView.retryPending = null;
            if (week === projectCSelectedSalesWeek) {
                void refreshProjectCWeek(week, { banner: false });
                return;
            }
        }

        if (projectCSelectedSalesWeek !== "current") return;
        if (Date.now() - projectCView.lastRefreshAt < minimumAgeMs) return;
        void refreshProjectCWeek("current", { banner: false });
    };

    window.setInterval(() => refreshIfDue(AUTO_REFRESH_MS), 20000);
    document.addEventListener("visibilitychange", () => refreshIfDue(FOCUS_REFRESH_AFTER_MS));
    window.addEventListener("focus", () => refreshIfDue(FOCUS_REFRESH_AFTER_MS));
    window.addEventListener("online", () => refreshIfDue(0));
}

function onProjectCStorage(event) {
    let changed = false;
    if (event.key === PRICE_STORE_KEY) changed = projectCPrices.mergeSaved(parseStoredJson(event.newValue));
    else if (event.key === DAY_STORE_KEY) changed = projectCDays.mergeSaved(parseStoredJson(event.newValue));
    if (changed) scheduleProjectCRender();
}

function startProjectC() {
    projectCPrices.load();
    projectCDays.load();
    injectProjectCGodSkinStyles();
    injectProjectCSpeedStyles();
    installProjectCLastWeekShortcut();
    installProjectCEffects();
    document.getElementById("projectCRefreshPrices")?.addEventListener("click", refreshProjectCPrices);
    window.addEventListener("pagehide", () => {
        projectCPrices.save();
        projectCDays.save();
    });
    window.addEventListener("storage", onProjectCStorage);
    installProjectCAutoRefresh();

    window.projectC = Object.freeze({
        version: PROJECT_C_VERSION,
        stats: projectCStats,
        refresh: (full = false) => refreshProjectCWeek(projectCSelectedSalesWeek, { full, banner: true }),
        clearSavedData() {
            projectCPrices.clear();
            projectCDays.clear();
            projectCStorage.remove(LAST_WEEK_USED_KEY);
        },
    });

    void loadWeeklyRanking();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startProjectC);
} else {
    startProjectC();
}

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
