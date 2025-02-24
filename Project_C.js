// Completely Remade Project_C - Fixing MM-DD Input Conversion with Debugging
console.log("Project_C.js loaded successfully");

async function checkPrices() {
    const initialsInput = document.getElementById("skuInput").value.trim().split("\n");
    const startDateInput = document.getElementById("startDateInput").value.trim();
    const endDateInput = document.getElementById("endDateInput").value.trim();
    const resultsTable = document.getElementById("resultsTable").querySelector("tbody");
    const grandTotalElement = document.getElementById("grandTotal");
    const itemTotalElement = document.getElementById("itemTotal");
    const loadingIndicator = document.getElementById("loadingIndicator");

    resultsTable.innerHTML = ""; // Clear previous results
    let grandTotal = 0;
    let itemTotal = 0;

    const formatDate = (date) => `2025${date.replace(/\D/g, "")}`;
    const startDate = formatDate(startDateInput);
    const endDate = formatDate(endDateInput);


    console.log("Initials entered:", initialsInput);
    console.log("Generated Start Date (YYYYMMDD):", startDate);
    console.log("Generated End Date (YYYYMMDD):", endDate);

    if (initialsInput.length === 0 || !initialsInput[0].trim()) {
        alert("Please enter at least one initial.");
        return;
    }

    if (!startDate || !endDate || startDate.length !== 8 || endDate.length !== 8) {
        alert("Please enter both a valid start date and an end date in MM-DD format.");
        return;
    }

    if (loadingIndicator) {
        loadingIndicator.style.display = "block";
    }

    try {
        console.log("Fetching data from retail picking history...");
        const response = await fetch(`https://my.tempetyres.com.au/retailpicking/history/?day=0&month=0&year=0&q=${encodeURIComponent(initialsInput.join(','))}&searchin=EnteredBy`);

        if (!response.ok) throw new Error("Network response was not ok");

        const text = await response.text();
        console.log("Fetched HTML data successfully.");

        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/html");

        const rows = doc.querySelectorAll(".col-md-12 table tbody tr");
        console.log("Number of rows found:", rows.length);

        let matchedResults = [];

        for (const row of rows) {
            const columns = row.querySelectorAll("td");
            if (columns.length < 7) {
                console.warn("Skipping row due to insufficient columns:", row);
                continue;
            }

            // Extract the date from column 2 under <strong> and trim it to YYYYMMDD
            const rawDateText = columns[1].querySelector("strong")?.textContent.trim();
            if (!rawDateText) {
                console.warn("Skipping row due to missing date in column 2:", row);
                continue;
            }
            const dateText = rawDateText.split("-")[2]?.slice(0, 8); // Extract YYYYMMDD from 'RT-1-YYYYMMDD-HHMMSS-XXXX'

            console.log("Extracted date:", dateText);

            // Check if the row's date falls within the specified range
            if (dateText < startDate || dateText > endDate) {
                console.log("Skipping row outside date range:", rawDateText);
                continue;
            }

            console.log("Row passed date filter:", rawDateText);

            const initialsElement = columns[3].querySelector("a"); // Updated to column 3
            const skuElement = columns[1].querySelector("small");
            const quantityElement = columns[5];

            if (!initialsElement || !skuElement || !quantityElement) {
                console.warn("Skipping row due to missing elements:", row);
                continue;
            }

            const initials = initialsElement.textContent.trim();
            const sku = skuElement.textContent.trim();
            const quantity = parseInt(quantityElement.textContent.trim(), 10); // Corrected parseInt usage

            if (!initials || !initialsInput.includes(initials)) {
                console.log("Skipping non-matching Initials:", initials);
                continue;
            }

            const url = `https://www.tempetyres.com.au/search?q=${encodeURIComponent(sku)}`;
            let originalPrice = 0;
            let totalPrice = 0;
            let description = "No description available";

            const fetchPriceDetails = async (sku, quantity) => {
            const url = `https://www.tempetyres.com.au/search?q=${encodeURIComponent(sku)}`;
                
            try {
                const priceResponse = await fetch(url);
                if (!priceResponse.ok) throw new Error(`Network response was not ok (${priceResponse.statusText})`);
        
                const priceText = await priceResponse.text();
                const priceDoc = parser.parseFromString(priceText, "text/html");
        
                const priceElement = priceDoc.querySelector(".txtprice-small span");
                const originalPrice = priceElement ? parseFloat(priceElement.textContent.trim()) : 0;
                const totalPrice = originalPrice * quantity;
        
                const descriptionElement = priceDoc.querySelector(".sub-heading-2");
                const description = descriptionElement ? descriptionElement.textContent.trim() : "No description available";
        
                return { sku, quantity, originalPrice, totalPrice, description, url };
            } catch (error) {
                console.error(`Error fetching data for SKU ${sku}:`, error);
                return { sku, quantity, originalPrice: 0, totalPrice: 0, description: "Error fetching data", url };
            }
        };

            // Execute all price fetches in parallel
            const priceFetchPromises = matchedResults.map(({ sku, quantity }) => fetchPriceDetails(sku, quantity));
            const priceResults = await Promise.all(priceFetchPromises);
            
            resultsTable.innerHTML = ""; // Clear previous results
            
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

            
            // Update grand total
            grandTotal = priceResults.reduce((acc, item) => acc + item.totalPrice, 0);
            grandTotalElement.textContent = `$${grandTotal.toFixed(2)}`;

            grandTotal += totalPrice;
            itemTotal += quantity; // Fixed quantity accumulation

            matchedResults.push(`<tr>
                <td>${sku}</td>
                <td>${quantity}</td>
                <td>$${originalPrice.toFixed(2)} ea</td>
                <td>$${totalPrice.toFixed(2)}</td>
                <td>${description}</td>
                <td><a href="${url}" target="_blank">View</a></td>
            </tr>`);
        }

        console.log("Final matched results count:", matchedResults.length);
        resultsTable.innerHTML = matchedResults.join("\n");
        grandTotalElement.textContent = `$${grandTotal.toFixed(2)}`;
        itemTotalElement.textContent = `${itemTotal}`; // Fixed display for item total
    } catch (error) {
        console.error("Error fetching data:", error);
        alert("Error retrieving data from the website. Please try again later.");
    }

    if (loadingIndicator) {
        loadingIndicator.style.display = "none";
    }
}
