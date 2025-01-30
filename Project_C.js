 async function checkPrices() {
            const skuInput = document.getElementById("skuInput").value.trim().split("\n");
            const resultsTable = document.getElementById("resultsTable").querySelector("tbody");
            const grandTotalElement = document.getElementById("grandTotal");
            resultsTable.innerHTML = ""; // Clear previous results
            let grandTotal = 0; // Initialize grand total

            for (const line of skuInput) {
                const [quantity, sku] = line.trim().split(" ");
                
                if (!quantity || isNaN(quantity) || !sku) {
                    console.error(`Invalid entry: ${line}`);
                    continue; // Skip invalid entries
                }

                const url = `https://www.tempetyres.com.au/search?q=${encodeURIComponent(sku)}`;
                
                try {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Network response was not ok (${response.statusText})`);

                    const text = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(text, "text/html");

                    // Find the span inside the element with the class `txtprice-small` for the price
                    const priceElement = doc.querySelector(".txtprice-small span");
                    const originalPrice = priceElement ? parseFloat(priceElement.textContent.trim()) : 0;
                    const totalPrice = originalPrice * parseInt(quantity);

                    // Accumulate the total price into grand total
                    grandTotal += totalPrice;

                    // Find the <p> element with the class `sub-heading-2` for the description
                    const descriptionElement = doc.querySelector(".sub-heading-2");
                    const description = descriptionElement ? descriptionElement.textContent.trim() : "No description available";

                    const row = `<tr>
                                    <td>${sku}</td>
                                    <td>${quantity}</td>
                                    <td>$${originalPrice.toFixed(2)} ea</td>
                                    <td>$${totalPrice.toFixed(2)}</td>
                                    <td>${description}</td>
                                    <td><a href="${url}" target="_blank">View</a></td>
                                </tr>`;
                    resultsTable.innerHTML += row;
                } catch (error) {
                    console.error(`Error fetching data for SKU ${sku}:`, error);
                    const row = `<tr>
                                    <td>${sku}</td>
                                    <td>${quantity}</td>
                                    <td colspan="4">Error retrieving data</td>
                                </tr>`;
                    resultsTable.innerHTML += row;
                }
            }

            // Update the grand total in the table footer
            grandTotalElement.textContent = `$${grandTotal.toFixed(2)}`;
        }