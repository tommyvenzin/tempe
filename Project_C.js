// Completely Remade Project_C - Fixing MM-DD Input Conversion with Debugging

async function checkPrices() {
    const initialsInput = document.getElementById("skuInput").value.trim().toUpperCase().split("
");
    const startDateInput = document.getElementById("startDateInput").value.trim();
    const endDateInput = document.getElementById("endDateInput").value.trim();
    const resultsTable = document.getElementById("resultsTable").querySelector("tbody");
    const grandTotalElement = document.getElementById("grandTotal");
    const loadingIndicator = document.getElementById("loadingIndicator");

    resultsTable.innerHTML = ""; // Clear previous results
    let grandTotal = 0;

    // Convert MM-DD input into YYYYMMDD format (Assuming 2025 as the fixed year)
    const startDate = `2025${startDateInput.replace(/[^0-9]/g, "")}`;
    const endDate = `2025${endDateInput.replace(/[^0-9]/g, "")}`;

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
        const response = await fetch(`https://my.tempetyres.com.au/retailpicking/history/?day=0&month=0&year=0&q=${encodeURIComponent(initialsInput[0])}&searchin=EnteredBy`);
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
            const quantity = quantityElement.textContent.trim();

            if (!initials || !initialsInput.includes(initials)) {
                console.log("Skipping non-matching Initials:", initials);
                continue;
            }

            const url = `https://www.tempetyres.com.au/search?q=${encodeURIComponent(sku)}`;
            let originalPrice = 0;
            let totalPrice = 0;
            let description = "No description available";

            try {
                const priceResponse = await fetch(url);
                if (!priceResponse.ok) throw new Error(`Network response was not ok (${priceResponse.statusText})`);

                const priceText = await priceResponse.text();
                const priceDoc = parser.parseFromString(priceText, "text/html");

                const priceElement = priceDoc.querySelector(".txtprice-small span");
                originalPrice = priceElement ? parseFloat(priceElement.textContent.trim()) : 0;
                totalPrice = originalPrice * parseInt(quantity);

                const descriptionElement = priceDoc.querySelector(".sub-heading-2");
                description = descriptionElement ? descriptionElement.textContent.trim() : "No description available";
            } catch (error) {
                console.error(`Error fetching data for SKU ${sku}:`, error);
            }

            grandTotal += totalPrice;

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
    } catch (error) {
        console.error("Error fetching data:", error);
        alert("Error retrieving data from the website. Please try again later.");
    }

    if (loadingIndicator) {
        loadingIndicator.style.display = "none";
    }
}
