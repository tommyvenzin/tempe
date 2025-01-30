/*
async function Tinder() {
    const skuInput = document.getElementById("skuInput").value.trim().split("\n");
    const skuInput2 = document.getElementById("skuInput2").value.trim().split("\n");
    const resultsTable = document.getElementById("resultsTable").querySelector("tbody");

    resultsTable.innerHTML = "";

    const fetchTyrePatterns = async (sku) => {
        let tyreWidth, tyreProfile, tyreDiameter;
        if (sku.length === 7) {
            tyreWidth = sku.slice(0, 3);
            tyreProfile = sku.slice(3, 5);
            tyreDiameter = sku.slice(5, 7);
        } else if (sku.length === 5) {
            tyreWidth = sku.slice(0, 3);
            tyreProfile = "Not%20Specified";
            tyreDiameter = sku.slice(3, 5);
        } else {
            return [];
        }

        const corsProxy = "https://api.allorigins.win/raw?url=";
        const url = `${corsProxy}https://www.tempetyres.com.au/tyres?TyreWidth=${tyreWidth}&TyreProfile=${tyreProfile}&TyreDiameter=${tyreDiameter}`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Network response was not ok (${response.statusText})`);
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "text/html");
            const resultItems = doc.querySelectorAll(".col-md-9 .col-lg-4.col-md-4.col-sm-4.col-xs-12");

            return Array.from(resultItems).map(item => {
                const pattern = item.querySelector("table.table tbody tr:nth-of-type(4) td:nth-of-type(2)")?.textContent.trim() || null;
                const link = item.querySelector(".image-container a") ? `https://tempetyres.com.au${item.querySelector(".image-container a").getAttribute("href")}` : "#";
                const sku = item.querySelector("input[name='tyresku']")?.getAttribute("value") || "No SKU available";
                const stock = item.querySelector(".stocklevel-small")?.textContent.trim() || "No stock info";
                console.log(`Scanned Pattern: ${pattern}, SKU: ${sku}, Link: ${link}, Stock: ${stock}`);
                return { pattern, link, sku, stock };
            });
        } catch (error) {
            console.error(`Error fetching data for SKU ${sku}:`, error);
            return [];
        }
    };

    // Fetch data for both inputs
    const [data1, data2] = await Promise.all([
        Promise.all(skuInput.map(fetchTyrePatterns)),
        Promise.all(skuInput2.map(fetchTyrePatterns))
    ]);

    // Flatten arrays
    const flatData1 = data1.flat();
    const flatData2 = data2.flat();

    console.log("Input 1 Patterns:", flatData1);
    console.log("Input 2 Patterns:", flatData2);

    // Compare patterns and remove duplicates
    const uniqueMatches = [];
    const matchingPatterns = flatData1.filter(item1 => {
        const match = flatData2.find(item2 => item1.pattern === item2.pattern);
        if (match && !uniqueMatches.some(unique => unique.pattern === item1.pattern)) {
            uniqueMatches.push({
                pattern: item1.pattern,
                frontSKU: item1.sku,
                rearSKU: match.sku,
                frontLink: item1.link,
                rearLink: match.link,
                frontStock: item1.stock,
                rearStock: match.stock
            });
            return true;
        }
        return false;
    });

    // Display unique matches
    uniqueMatches.forEach(item => {
        const row = `<tr>
                        <td>${item.pattern}</td>
                        <td>${item.frontSKU}</td>
                        <td>${item.rearSKU}</td>
                        <td><a href="${item.frontLink}" target="_blank">Front Link</a></td>
                        <td><a href="${item.rearLink}" target="_blank">Rear Link</a></td>
                        <td>${item.frontStock}</td>
                        <td>${item.rearStock}</td>
                    </tr>`;
        resultsTable.innerHTML += row;
    });

    if (uniqueMatches.length === 0) {
        resultsTable.innerHTML += `<tr><td colspan="7">No matching patterns found in the specified class.</td></tr>`;
    }

    console.log("Displayed unique matching tire patterns with Front and Rear SKUs, Links, and Stock information.");
}
*/



async function Tinder() {
    const skuInput = document.getElementById("skuInput").value.trim();
    const skuInput2 = document.getElementById("skuInput2").value.trim();
    const resultsTable = document.getElementById("resultsTable").querySelector("tbody");

    resultsTable.innerHTML = ""; // Clear previous results

    const fetchTyreDetails = async (size) => {
        if (!size || size.length !== 7) return []; // Validate input length

        const tyreWidth = size.slice(0, 3);
        const tyreProfile = size.slice(3, 5);
        const tyreDiameter = size.slice(5, 7);

        const corsProxy = "https://api.allorigins.win/raw?url=";
        const url = `${corsProxy}https://www.tempetyres.com.au/tyres?TyreWidth=${tyreWidth}&TyreProfile=${tyreProfile}&TyreDiameter=${tyreDiameter}`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Network response was not ok (${response.statusText})`);
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "text/html");

            const resultItems = doc.querySelectorAll(".col-md-9 .col-lg-4.col-md-4.col-sm-4.col-xs-12");

            return Array.from(resultItems).map((item) => ({
                brand: item.querySelector("span.text-uppercase")?.textContent.trim() || "No brand available",
                pattern: item.querySelector(".sub-heading-2")?.textContent.trim() || "No pattern available",
                price: item.querySelector(".txtprice-small span")?.textContent.trim() || "No price available",
                stock: item.querySelector(".stocklevel-small")?.textContent.trim() || "No stock info",
                sku: item.querySelector("input[name='tyresku']")?.getAttribute("value") || "No SKU available",
                link: item.querySelector(".image-container a")
                    ? `https://tempetyres.com.au${item.querySelector(".image-container a").getAttribute("href")}`
                    : "#",
            }));
        } catch (error) {
            console.error(`Error fetching data for size ${size}:`, error);
            return [];
        }
    };

    // Fetch details for both front and rear sizes
    const [frontData, rearData] = await Promise.all([
        fetchTyreDetails(skuInput),
        fetchTyreDetails(skuInput2),
    ]);

    // Group data by Brand Name
    const groupedResults = {};
    [...frontData, ...rearData].forEach((item) => {
        if (!groupedResults[item.brand]) {
            groupedResults[item.brand] = { front: [], rear: [] };
        }
        const isFront = frontData.includes(item);
        if (isFront) groupedResults[item.brand].front.push(item);
        else groupedResults[item.brand].rear.push(item);
    });

    // Sort grouped results by Brand Name
    const sortedBrands = Object.keys(groupedResults).sort();

    // Sort front and rear models by pattern name within each brand
    sortedBrands.forEach((brand) => {
        groupedResults[brand].front.sort((a, b) => (a.pattern || "").localeCompare(b.pattern || ""));
        groupedResults[brand].rear.sort((a, b) => (a.pattern || "").localeCompare(b.pattern || ""));
    });

    // Display grouped results in the table
    sortedBrands.forEach((brand) => {
        const brandData = groupedResults[brand];
        const rows = Math.max(brandData.front.length, brandData.rear.length);

        for (let i = 0; i < rows; i++) {
            const frontItem = brandData.front[i] || {};
            const rearItem = brandData.rear[i] || {};

            // Determine stock status for coloring
            const frontStockStatus = frontItem.stock ? frontItem.stock.toLowerCase() : "";
            const rearStockStatus = rearItem.stock ? rearItem.stock.toLowerCase() : "";

            // Light green for In Stock, Light red for Out of Stock or On Order
            const frontColor = frontStockStatus.includes("out of stock") || frontStockStatus.includes("on order") ? "#f7d4d4" : (frontStockStatus.includes("in stock") ? "#d4f7d4" : "transparent");
            const rearColor = rearStockStatus.includes("out of stock") || rearStockStatus.includes("on order") ? "#f7d4d4" : (rearStockStatus.includes("in stock") ? "#d4f7d4" : "transparent");

            const row = `<tr>
                            ${i === 0 ? `<td rowspan="${rows}">${brand}</td>` : ""}
                            <td style="background-color:${frontColor};">
                                ${frontItem.pattern ? `<a href="${frontItem.link}" target="_blank">${frontItem.pattern}</a>` : "No data"}
                                ${frontItem.price ? ` - $${frontItem.price}` : ""}
                                (${frontItem.stock || "No stock info"})
                            </td>
                            <td style="background-color:${rearColor};">
                                ${rearItem.pattern ? `<a href="${rearItem.link}" target="_blank">${rearItem.pattern}</a>` : "No data"}
                                ${rearItem.price ? ` - $${rearItem.price}` : ""}
                                (${rearItem.stock || "No stock info"})
                            </td>
                            <td>${frontItem.sku || "No SKU available"}</td>
                            <td>${rearItem.sku || "No SKU available"}</td>
                        </tr>`;
            resultsTable.innerHTML += row;
        }
    });

    // Show a message if no data is found
    if (sortedBrands.length === 0) {
        resultsTable.innerHTML = `<tr><td colspan="5">No matching tires found for the given sizes.</td></tr>`;
    }
}


async function checkPrices() {
    const skuInput = document.getElementById("skuInput").value.trim().split("\n");
    const resultsTable = document.getElementById("resultsTable").querySelector("tbody");

    resultsTable.innerHTML = ""; // Clear previous results

    const fetchPromises = skuInput.map(async (query) => {
        const trimmedQuery = query.trim();

        if (!trimmedQuery) return;

        // Ensure input has enough characters for each part
        if (trimmedQuery.length !== 5 && trimmedQuery.length !== 7) {
            resultsTable.innerHTML += `<tr><td colspan="6">Invalid input format for ${trimmedQuery}</td></tr>`;
            return;
        }

        let tyreWidth, tyreProfile, tyreDiameter;

        if (trimmedQuery.length === 7) {
            tyreWidth = trimmedQuery.slice(0, 3);
            tyreProfile = trimmedQuery.slice(3, 5);
            tyreDiameter = trimmedQuery.slice(5, 7);
        } else if (trimmedQuery.length === 5) {
            tyreWidth = trimmedQuery.slice(0, 3);
            tyreProfile = "Not%20Specified";
            tyreDiameter = trimmedQuery.slice(3, 5);
        }

        const corsProxy = "https://api.allorigins.win/raw?url=";
        const url = `${corsProxy}https://www.tempetyres.com.au/tyres?TyreWidth=${tyreWidth}&TyreProfile=${tyreProfile}&TyreDiameter=${tyreDiameter}`;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Network response was not ok (${response.statusText})`);

            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, "text/html");

            const resultItems = doc.querySelectorAll(".col-md-9 .col-lg-4.col-md-4.col-sm-4.col-xs-12");

            resultItems.forEach((item) => {
                const make = item.querySelector("b")?.textContent.trim() || "No make available";
                const model = item.querySelector(".sub-heading-2")?.textContent.trim() || "No model available";
                const price = parseFloat(item.querySelector(".txtprice-small span")?.textContent.trim()) || 0;
                const status = item.querySelector(".stocklevel-small")?.textContent.trim() || "No status available";
                const sku = item.querySelector("input[name='tyresku']")?.getAttribute("value") || "No SKU available";
                const link = item.querySelector(".image-container a") ? `https://tempetyres.com.au${item.querySelector(".image-container a").getAttribute("href")}` : "#";

                const row = `<tr>
                                <td>${make}</td>
                                <td>${model}</td>
                                <td>$${price.toFixed(2)}</td>
                                <td>${status}</td>
                                <td>${sku}</td>
                                <td><a href="${link}" target="_blank">View</a></td>
                            </tr>`;
                resultsTable.innerHTML += row;
            });
        } catch (error) {
            resultsTable.innerHTML += `<tr><td colspan="6">Error retrieving data for ${trimmedQuery}</td></tr>`;
        }
    });

    await Promise.all(fetchPromises);

    // Automatically sort by price
    sortTableByPrice();
}



// Function to sort the table by make (alphabetically)
function sortTableByMake() {
    const table = document.getElementById("resultsTable");
    const rows = Array.from(table.querySelectorAll("tbody tr"));

    rows.sort((a, b) => {
        const makeA = a.cells[0].textContent.trim().toLowerCase();
        const makeB = b.cells[0].textContent.trim().toLowerCase();
        return makeA.localeCompare(makeB);
    });

    // Clear the table body and append sorted rows
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = "";
    rows.forEach(row => tbody.appendChild(row));
    console.log("Table sorted by Make.");
}

// Function to sort the table by price (numerically)
function sortTableByPrice() {
    const table = document.getElementById("resultsTable");
    const rows = Array.from(table.querySelectorAll("tbody tr"));

    rows.sort((a, b) => {
        const priceA = parseFloat(a.cells[2].textContent.replace("$", "").trim());
        const priceB = parseFloat(b.cells[2].textContent.replace("$", "").trim());
        return priceA - priceB;
    });

    // Clear the table body and append sorted rows
    const tbody = table.querySelector("tbody");
    tbody.innerHTML = "";
    rows.forEach(row => tbody.appendChild(row));
    console.log("Table sorted by Price.");
}

function filterRunflat() {
    const table = document.getElementById("resultsTable");
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    const tbody = table.querySelector("tbody");

    // Clear the table body and only append rows that contain "runflat" in the model column
    tbody.innerHTML = "";
    rows.forEach(row => {
        const model = row.cells[1].textContent.trim().toLowerCase();
        if (model.includes("runflat")) {
            tbody.appendChild(row);
        }
    });

    console.log("Filtered table to only show rows with 'runflat' in the model.");
}

function removeOutOfStock() {
    const table = document.getElementById("resultsTable");
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    const tbody = table.querySelector("tbody");

// Filter rows to exclude those with "Out of Stock" or "On Order" status
tbody.innerHTML = "";
    rows.forEach(row => {
        const status = row.cells[3].textContent.trim().toLowerCase();
        if (status !== "out of stock" && status !== "on order") {
            tbody.appendChild(row);
        }
});

console.log("Removed rows with 'Out of Stock' or 'On Order' status.");
}

function removeOutOfStock2() {
    const table = document.getElementById("resultsTable");
    const rows = Array.from(table.querySelectorAll("tbody tr"));

    rows.forEach((row) => {
        const frontModelCell = row.cells[1]?.innerText.toLowerCase() || ""; // Front Model column
        const rearModelCell = row.cells[2]?.innerText.toLowerCase() || ""; // Rear Model column

        const frontIsOutOfStock = frontModelCell.includes("no data") || frontModelCell.includes("out of stock") || frontModelCell.includes("on order");
        const rearIsOutOfStock = rearModelCell.includes("no data") || rearModelCell.includes("out of stock") || rearModelCell.includes("on order");

        // If both are out of stock, hide the row
        if (frontIsOutOfStock && rearIsOutOfStock) {
            row.style.display = "none"; // Hide the row
        } else {
            row.style.display = ""; // Show the row if it has available data
        }
    });

    // Fix rowspans for brand name
    const brands = table.querySelectorAll("tbody td[rowspan]"); // Get all brand name cells with rowspan
    brands.forEach((brandCell) => {
        const brandRows = Array.from(brandCell.parentElement.querySelectorAll("~ tr")); // Rows under this brand
        const visibleRows = brandRows.filter((row) => row.style.display !== "none");

        if (visibleRows.length === 0) {
            // If no rows are visible, hide the brand cell as well
            brandCell.parentElement.style.display = "none";
        } else {
            // Adjust rowspan based on the number of visible rows
            brandCell.rowSpan = visibleRows.length + 1; // Include the original row
        }
    });

    console.log("Removed out-of-stock rows and updated rowspans.");
}


function filterTable() {
    const searchTerm = document.getElementById("searchBar").value.toLowerCase();
    const rows = document.querySelectorAll("#resultsTable tbody tr");

    rows.forEach(row => {
        const cells = row.querySelectorAll("td");
        const rowText = Array.from(cells).map(cell => cell.textContent.toLowerCase()).join(" ");
        row.style.display = rowText.includes(searchTerm) ? "" : "none";
    });

    // Reset filter if search term is empty
    if (!searchTerm) {
        rows.forEach(row => row.style.display = "");
    }
}

function handleSkuInputEnter(event) {
    if (event.key === "Enter") {
        event.preventDefault(); // Prevent the default behavior (e.g., adding a new line in the textarea)
        checkPrices(); // Call the function to check prices
    }
}


/*

Known Bug :
    - Some Tyres doesnt says MOE, but it says MERCC instead.
    - Tyres Tinder doesn't work on Runflat or Original tyre, sometimes it's not matching


Adjustment :
    - row 1 : brand name
    - row 2 : Model, SKU, Availability, name with link
    - row 3 : 

*/
