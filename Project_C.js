const fetchPriceDetails = async ({ sku, quantity }) => {
    const searchUrl = `https://www.tempetyres.com.au/search?q=${encodeURIComponent(sku)}`;
    try {
        const res = await fetch(searchUrl);
        const html = await res.text();
        const doc = parser.parseFromString(html, "text/html");

        let price = 0;
        let needProductPage = false;

        // Try to get price from search page
        const priceText = doc.querySelector(".sale-price span")?.textContent.trim();
        if (priceText && !priceText.toLowerCase().includes("call") && !isNaN(parseFloat(priceText))) {
            price = parseFloat(priceText);
        } else {
            needProductPage = true;
        }

        let description = "";
        let productUrl = searchUrl;

        if (needProductPage) {
            // Get product link
            const productLinkElement = doc.querySelector(".product-container .image-container a");
            if (productLinkElement) {
                productUrl = `https://www.tempetyres.com.au${productLinkElement.getAttribute("href")}`;
                const productRes = await fetch(productUrl);
                const productHtml = await productRes.text();

                // Extract price from dataLayer
                const priceMatch = productHtml.match(/'ecomm_totalvalue':\s*'(\d+)'/);
                if (priceMatch) {
                    price = parseFloat(priceMatch[1]);
                }

                // Extract description
                const productDoc = parser.parseFromString(productHtml, "text/html");
                const tySize = productDoc.querySelector(".sub-heading-ty-2")?.textContent.trim() || "";
                const tyPattern = productDoc.querySelector(".sub-heading-ty-3")?.textContent.trim() || "";
                description = `${tySize} ${tyPattern}`.trim();

                if (!description) {
                    const whSize = productDoc.querySelector(".sub-heading-wh-2")?.textContent.trim() || "";
                    const whFinish = productDoc.querySelector(".sub-heading-wh-3")?.textContent.trim() || "";
                    description = `${whSize} ${whFinish}`.trim() || "No description available";
                }
            } else {
                description = "No product link found";
            }
        } else {
            // Description from search page if no product page needed
            const tySize = doc.querySelector(".sub-heading-ty-2")?.textContent.trim() || "";
            const tyPattern = doc.querySelector(".sub-heading-ty-3")?.textContent.trim() || "";
            description = `${tySize} ${tyPattern}`.trim();

            if (!description) {
                const whSize = doc.querySelector(".sub-heading-wh-2")?.textContent.trim() || "";
                const whFinish = doc.querySelector(".sub-heading-wh-3")?.textContent.trim() || "";
                description = `${whSize} ${whFinish}`.trim() || "No description available";
            }
        }

        const totalPrice = price * quantity;
        return { sku, quantity, originalPrice: price, totalPrice, description, url: productUrl };
    } catch (e) {
        console.error(`Error fetching SKU ${sku}:`, e);
        return { sku, quantity, originalPrice: 0, totalPrice: 0, description: "Error fetching data", url: searchUrl };
    }
};
