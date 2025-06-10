console.log("Project_C.js loaded successfully");

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

    try {
        const response = await fetch(`${urlMap[type]}?day=0&month=0&year=0&q=${encodeURIComponent(initialsInput.join(","))}&searchin=EnteredBy`);
        if (!response.ok) throw new Error("Network response was not ok");
        const text = await response.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/html");
        const rows = doc.querySelectorAll(".col-md-12 table tbody tr");

        const matchedResults = [];

        for (const row of rows) {
            const columns = row.querySelectorAll("td");
            if (columns.length < 7) continue;

            const rawDateText = columns[1].querySelector(dateSelector)?.textContent.trim();
            const dateText = rawDateText?.split("-")[2]?.slice(0, 8);
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
            const url = `https://www.tempetyres.com.au/search?q=${encodeURIComponent(sku)}`;
            try {
                const res = await fetch(url);
                const html = await res.text();
                const doc = parser.parseFromString(html, "text/html");

                const priceElement = doc.querySelector(".sale-price span");
                const originalPrice = priceElement ? parseFloat(priceElement.textContent.trim()) : 0;
                const totalPrice = originalPrice * quantity;

                const descElement = doc.querySelector(".sub-heading-2");
                const description = descElement ? descElement.textContent.trim() : "No description available";

                return { sku, quantity, originalPrice, totalPrice, description, url };
            } catch (e) {
                console.error(`Error fetching SKU ${sku}:`, e);
                return { sku, quantity, originalPrice: 0, totalPrice: 0, description: "Error fetching data", url };
            }
        };

        const priceResults = await Promise.all(matchedResults.map(fetchPriceDetails));

        const chunkSize = 20;
        for (let i = 0; i < priceResults.length; i += chunkSize) {
            setTimeout(() => {
                resultsTable.innerHTML += priceResults.slice(i, i + chunkSize).map(({ sku, quantity, originalPrice, totalPrice, description, url }) => `
                    <tr>
                        <td>${sku}</td>
                        <td>${quantity}</td>
                        <td>$${originalPrice.toFixed(2)} ea</td>
                        <td>$${totalPrice.toFixed(2)}</td>
                        <td>${description}</td>
                        <td><a href="${url}" target="_blank">View</a></td>
                    </tr>
                `).join("\n");
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
        const mm = (d.getMonth() + 1).toString().padStart(2, '0');
        const dd = d.getDate().toString().padStart(2, '0');
        return `${mm}${dd}`;
    };

    startInput.value = format(start);
    endInput.value = format(today);
}
