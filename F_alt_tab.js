console.log("F_alt_tab.js loaded successfully");

// Utility Function: Get Stock Color
function getStockColor(stockStatus) {
    if (!stockStatus) return "transparent";
    const lower = stockStatus.toLowerCase();
    if (lower.includes("out of stock") || lower.includes("on order")) return "#f7d4d4";
    if (lower.match(/\b[1-4]\s*in stock\b/)) return "#ffd699";
    if (lower.match(/\b[5-8]\s*in stock\b/)) return "#fff5b1";
    if (lower.includes("8+ in stock") || lower.includes("in stock")) return "#d4f7d4";
    return "transparent";
}

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
                <td style="background:${getStockColor(f.stock)};">
                    ${f.pattern ? `<a href="${f.link}" target="_blank">${f.pattern}</a>` : "No data"}${f.price ? ` - $${f.price}` : ""} (${f.stock || "No stock"})</td>
                <td style="background:${getStockColor(r.stock)};">
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

function removeOutOfStockTinder() {
    const filtered = {};

    for (const [brand, sets] of Object.entries(savedTinderResults)) {
        const goodFront = sets.front.filter(f => getStockColor(f.stock) !== "#f7d4d4");
        const goodRear = sets.rear.filter(r => getStockColor(r.stock) !== "#f7d4d4");

        if (goodFront.length && goodRear.length) {
            filtered[brand] = { front: goodFront, rear: goodRear };
        }
    }

    renderTinderResults(filtered);
}

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
                const stock = item.querySelector(".stocklevel-small .stock-label")?.textContent.trim() || "No status";
                const sku = item.querySelector("input[name='tyresku']")?.value || "No SKU";
                const link = item.querySelector(".image-container a")
                    ? `https://tempetyres.com.au${item.querySelector(".image-container a").getAttribute("href")}`
                    : "#";

                return `<tr style="background:${getStockColor(stock)};">
                    <td>${make}</td><td>${model}</td>
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

function sortTableByMake() {
    const tbody = document.querySelector("#resultsTable tbody");
    const rows = Array.from(tbody.querySelectorAll("tr"));
    rows.sort((a, b) => a.cells[0].textContent.localeCompare(b.cells[0].textContent));
    tbody.innerHTML = "";
    rows.forEach((r) => tbody.appendChild(r));
}

function sortTableByPrice() {
    const tbody = document.querySelector("#resultsTable tbody");
    const rows = Array.from(tbody.querySelectorAll("tr"));
    rows.sort((a, b) => parseFloat(a.cells[2].textContent.replace("$", "")) - parseFloat(b.cells[2].textContent.replace("$", "")));
    tbody.innerHTML = "";
    rows.forEach((r) => tbody.appendChild(r));
}

function filterRunflat() {
    const rows = document.querySelectorAll("#resultsTable tbody tr");
    rows.forEach((row) => {
        const text = row.cells[1].textContent.toLowerCase();
        row.style.display = text.includes("runflat") ? "" : "none";
    });
}

function removeOutOfStock() {
    const rows = document.querySelectorAll("#resultsTable tbody tr");
    rows.forEach((row) => {
        const bg = row.style.backgroundColor;
        const red = ["#f7d4d4", "rgb(247, 212, 212)", "transparent"];
        row.style.display = red.includes(bg) ? "none" : "";
    });
}

function filterTable() {
    const keyword = document.getElementById("searchBar").value.toLowerCase();
    const rows = document.querySelectorAll("#resultsTable tbody tr");
    rows.forEach((row) => {
        const match = [...row.cells].some((c) => c.textContent.toLowerCase().includes(keyword));
        row.style.display = match ? "" : "none";
    });
    if (!keyword) rows.forEach((r) => (r.style.display = ""));
}

function filterTinderTable() {
    const keyword = document.getElementById("searchBar").value.toLowerCase();
    const rows = document.querySelectorAll("#resultsTable tbody tr");
    rows.forEach((row) => {
        const rowText = row.textContent.toLowerCase();
        row.style.display = rowText.includes(keyword) ? "" : "none";
    });
}

function handleSkuInputEnter(e) {
    if (e.key === "Enter") {
        e.preventDefault();
        if (typeof checkPrices === "function") {
            checkPrices();
        }
    }
}
