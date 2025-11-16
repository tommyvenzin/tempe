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
        for (let i = 0; i < rowCount; i++) {
            const f = front[i] || {}, r = rear[i] || {};
            const row = `<tr>
                ${i === 0 ? `<td rowspan="${rowCount}">${brand}</td>` : ""}
                <td style="background:${getStockColor(f.stock)};" data-stock="${(f.stock || "").replace(/"/g, "&quot;")}">
                    ${f.pattern ? `<a href="${f.link}" target="_blank">${f.pattern}</a>` : "No data"}${f.price ? ` - $${f.price}` : ""} (${f.stock || "No stock"})</td>
                <td style="background:${getStockColor(r.stock)};" data-stock="${(r.stock || "").replace(/"/g,
