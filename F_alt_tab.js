console.log("F_alt_tab.js loaded successfully");

function handleSkuInputEnter(e) {
    if (e.key === "Enter") {
        e.preventDefault();
        checkPrices();
    }
}

// Utility Function: Get Stock Color (dark-mode Christmas friendly)
function getStockColor(stockStatus) {
    if (!stockStatus) return "transparent";
    const lower = stockStatus.toLowerCase();

    // OUT OF STOCK / ON ORDER → deep red
    if (lower.includes("out of stock") || lower.includes("on order")) {
        return "#4b1113";
    }

    // 1–4 IN STOCK → dark amber/brown
    if (lower.match(/\b[1-4]\s*in stock\b/)) {
        return "#4b2a12";
    }

    // 5–8 IN STOCK → olive-ish dark
    if (lower.match(/\b[5-8]\s*in stock\b/)) {
        return "#3b3a16";
    }

    // 8+ IN STOCK or generic "in stock" → deep green
    if (lower.includes("8+ in stock") || lower.includes("in stock")) {
        return "#123524";
    }

    return "transparent";
}

/* =========================
   TYRES TINDER (Tyrestinder.html)
   ========================= */

let savedTinderResults = {};

async function Tinder() {
    const skuInput = document.getElementById("skuInput").value.trim();
    const skuInput2 = document.getElementById("skuInput2").value.trim();
    const resultsTable = document.querySelector("#resultsTable tbody");
    resultsTable.innerHTML = "";

    const fetchTyreDetails = async (size) => {
        if (!size || size.length !== 7) return [];
        const [w, p, d] = [size.slice(0, 3), size.slice(3, 5), size.slice(5, 7)];
        const url = `https://corsproxy.io/?https://www.tempetyres.com.au/tyres?TyreWidth=${w}&TyreProfile=${p}&TyreDiameter=${d}`;

        try {
            const res = await fetch(url);
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, "text/html");
            const items = doc.querySelectorAll(".product-container");

            return Array.from(items).map((item) => ({
                brand: item.querySelector(".brand-name b")?.textContent.trim() || "No brand available",
                pattern: item.querySelector(".sub-heading-ty-3")?.textContent.trim() || "No pattern available",
                price: item.querySelector(".sale-price span")?.textContent.trim() || "No price available",
                stock: item.querySelector(".stocklevel-small .stock-label")?.textContent.trim() || "No stock info",
                sku: item.querySelector("input[name='tyresku']")?.value || "No SKU available",
                link: item.querySelector(".image-container a")
                    ? `https://tempetyres.com.au${item.querySelector(".image-container a").getAttribute("href")}`
                    : "#",
            }));
        } catch (e) {
            console.error(`Error fetching data for ${size}:`, e);
            return [];
        }
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
        const safeBrand = (brand || "").replace(/"/g, "&quot;");

        for (let i = 0; i < rowCount; i++) {
            const f = front[i] || {}, r = rear[i] || {};
            const row = `<tr data-brand="${safeBrand.toLowerCase()}">
                ${i === 0 ? `<td rowspan="${rowCount}">${brand}</td>` : ""}
                <td style="background:${getStockColor(f.stock)};" data-stock="${(f.stock || "").replace(/"/g, "&quot;")}">
                    ${f.pattern ? `<a href="${f.link}" target="_blank">${f.pattern}</a>` : "No data"}${f.price ? ` - $${f.price}` : ""} (${f.stock || "No stock"})</td>
                <td style="background:${getStockColor(r.stock)};" data-stock="${(r.stock || "").replace(/"/g, "&quot;")}">
                    ${r.pattern ? `<a href="${r.link}" target="_blank">${r.pattern}</a>` : "No data"}${r.price ? ` - $${r.price}` : ""} (${r.stock || "No stock"})</td>
                <td>${f.sku || "No SKU"}</td>
                <td>${r.sku || "No SKU"}</td>
            </tr>`;
            resultsTable.innerHTML += row;
        }
    });

    if (sorted.length === 0) {
        resultsTable.innerHTML = `<tr><td colspan="5">No matching tyres found.</td></tr>`;
    }
}


// Tyres Tinder "Available Only" – uses stock text
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
   F ALT TAB (index.html)
   ========================= */

async function checkPrices() {
    const skuInput = document.getElementById("skuInput").value.trim().split("\n");
    const resultsTable = document.querySelector("#resultsTable tbody");
    resultsTable.innerHTML = "";

    const rows = await Promise.all(skuInput.map(async (line) => {
        const query = line.trim();
        if (!query) return "";

        if (![5, 7].includes(query.length)) {
            return `<tr><td colspan="4">Invalid input: ${query}</td></tr>`;
        }

        const [w, d] = [query.slice(0, 3), query.slice(-2)];
        const p = query.length === 7 ? query.slice(3, 5) : "Not%20Specified";
        const url = `https://corsproxy.io/?https://www.tempetyres.com.au/tyres?TyreWidth=${w}&TyreProfile=${p}&TyreDiameter=${d}`;

        try {
            const res = await fetch(url);
            const text = await res.text();
            const doc = new DOMParser().parseFromString(text, "text/html");
            const items = doc.querySelectorAll(".product-container");

            return Array.from(items).map((item) => {
                const make = item.querySelector(".brand-name b")?.textContent.trim() || "No make";
                const size = item.querySelector(".sub-heading-ty-2")?.textContent.trim() || "";
                const pattern = item.querySelector(".sub-heading-ty-3")?.textContent.trim() || "";
                const model = `${size} ${pattern}`.trim();
                const price = parseFloat(item.querySelector(".sale-price span")?.textContent.trim()) || 0;
                const stock = item.querySelector(".stocklevel-small .stock-label")?.textContent.trim() || "On Order";
                const sku = item.querySelector("input[name='tyresku']")?.value || "No SKU";
                const link = item.querySelector(".image-container a")
                    ? `https://tempetyres.com.au${item.querySelector(".image-container a").getAttribute("href")}`
                    : "#";

                // Stock shown after model AND stored in data-stock for filtering
                return `<tr 
                    style="background:${getStockColor(stock)};"
                    data-stock="${stock.replace(/"/g, '&quot;')}"
                >
                    <td>${make}</td>
                    <td>${model} <span style="opacity:0.8; font-size:0.9em;">(${stock})</span></td>
                    <td>$${price.toFixed(2)}</td>
                    <td>${sku}</td>
                    <td><a href="${link}" target="_blank">View</a></td>
                </tr>`;
            }).join("\n");
        } catch (err) {
            return `<tr><td colspan="4">Error retrieving: ${query}</td></tr>`;
        }
    }));

    resultsTable.innerHTML = rows.flat().join("\n");
    sortTableByPrice();
}

function sortTableByPrice() {
    const tbody = document.querySelector("#resultsTable tbody");
    const rows = Array.from(tbody.querySelectorAll("tr"));
    rows.sort((a, b) => {
        const aPrice = parseFloat(a.cells[2].textContent.replace("$", "")) || 0;
        const bPrice = parseFloat(b.cells[2].textContent.replace("$", "")) || 0;
        return aPrice - bPrice;
    });
    tbody.innerHTML = "";
    rows.forEach((r) => tbody.appendChild(r));
}

/* =========================
   FILTERS / SEARCH
   ========================= */

// Helper: determine if a stock string counts as "available"
function isAvailableStock(stockText) {
    if (!stockText) return false;
    const lower = stockText.toLowerCase();

    // NOT AVAILABLE
    if (lower.includes("out of stock")) return false;
    if (lower.includes("on order")) return false;
    if (lower.includes("no status")) return false;
    if (lower.includes("no stock")) return false;

    // AVAILABLE
    if (lower.includes("in stock")) return true;
    if (/\d+/.test(lower)) return true; // has a number like "3 in stock" or "8+ in stock"

    return false;
}

// F Alt Tab "Available Only" — uses real stock text
function removeOutOfStock() {
    const rows = document.querySelectorAll("#resultsTable tbody tr");
    rows.forEach((row) => {
        const stock = row.dataset.stock || "";
        row.style.display = isAvailableStock(stock) ? "" : "none";
    });
}

// Shared text filter (used by both index.html and Tyrestinder.html)
function filterTable() {
    const keyword = document.getElementById("searchBar").value.toLowerCase().trim();
    const rows = document.querySelectorAll("#resultsTable tbody tr");

    rows.forEach((row) => {
        // If search box is empty, show everything
        if (!keyword) {
            row.style.display = "";
            return;
        }

        const brand = (row.dataset.brand || "").toLowerCase();
        const matchInCells = [...row.cells].some((c) =>
            c.textContent.toLowerCase().includes(keyword)
        );

        // Row matches if:
        // - Any cell contains the keyword (F Alt Tab behaviour)
        // - OR its data-brand matches (fixes Tyres Tinder + rowspan issue)
        const match = matchInCells || brand.includes(keyword);
        row.style.display = match ? "" : "none";
    });
}



