(() => {
    "use strict";

    const filename = decodeURIComponent(
        location.pathname.split("/").pop() || ""
    ).toLowerCase();

    // Only expose the bridge to the user's helper pages.
    // The destination URL itself can still be ANY http:// or https:// URL.
    const allowedCaller =
        filename === "index.html" ||
        filename === "project_c.html" ||
        filename === "tyrestinder.html" ||
        filename === "fitment_planner.html" ||
        filename === "order_check.html" ||
        filename.startsWith("testrun");

    if (!allowedCaller) {
        return;
    }

    window.addEventListener("message", async (event) => {
        if (event.source !== window) return;

        const data = event.data;

        if (
            !data ||
            data.source !== "LOCAL_HELPER_PAGE" ||
            data.type !== "GENERAL_FETCH_REQUEST" ||
            !data.id
        ) {
            return;
        }

        let result;

        try {
            result = await chrome.runtime.sendMessage({
                type: "GENERAL_FETCH",
                url: data.url,
                options: data.options || {}
            });
        } catch (error) {
            result = {
                ok: false,
                error: error?.message || String(error)
            };
        }

        window.postMessage({
            source: "GENERAL_FETCH_BRIDGE",
            type: "GENERAL_FETCH_RESPONSE",
            id: data.id,
            result
        }, "*");
    });
})();
