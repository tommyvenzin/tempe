/* Phone-to-receiver API client. The receiver/RDP worker is connected in the next stage. */
(function (root) {
    "use strict";
    const KEY = "tempe:costar-pairing:v1";
    function pairing(value) {
        if (!value || typeof value !== "object") return null;
        const url = new URL(String(value.baseUrl));
        const host = url.hostname;
        const octets = host.split(".");
        const ipv4 = octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
        const privateIpv4 = ipv4 && (Number(octets[0]) === 10 || (Number(octets[0]) === 192 && Number(octets[1]) === 168) ||
            (Number(octets[0]) === 172 && Number(octets[1]) >= 16 && Number(octets[1]) <= 31));
        const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".local") ||
            privateIpv4;
        if (url.protocol !== "https:" || !local || url.username || url.password || url.search || url.hash || !/^[A-Za-z0-9_-]{32,160}$/.test(String(value.token)))
            throw new Error("Use the local HTTPS pairing address supplied by your PC helper.");
        return { baseUrl: url.origin, token: value.token };
    }
    function createClient(env = root) {
        let config = null;
        try { config = pairing(JSON.parse(env.localStorage.getItem(KEY) || "null")); } catch (_) { /* No usable saved pairing. */ }
        const params = new URLSearchParams(env.location.hash.slice(1));
        if (params.has("pc") || params.has("key")) {
            try {
                config = pairing({ baseUrl: params.get("pc"), token: params.get("key") });
                env.localStorage.setItem(KEY, JSON.stringify(config));
            } finally {
                // A pairing key is never sent as a URL query or retained in history.
                env.history.replaceState(null, "", env.location.pathname + env.location.search);
            }
        }
        async function request(path, method = "GET", body) {
            if (!config) throw new Error("PC helper not connected. Open the link from its QR code when the helper is available.");
            const controller = new AbortController();
            const timer = env.setTimeout(() => controller.abort(), 8000);
            try {
                let response;
                try {
                    response = await env.fetch(config.baseUrl + "/api/mobile/v1" + path, {
                        method, signal: controller.signal, mode: "cors", credentials: "omit", cache: "no-store", redirect: "error",
                        headers: { Authorization: "Bearer " + config.token, ...(body ? { "Content-Type": "application/json" } : {}) },
                        ...(body ? { body: JSON.stringify(body) } : {})
                    });
                } catch (error) {
                    // Browsers only say "Load failed"; name the PC. Still a TypeError, so callers can tell it was the connection.
                    if (error && error.name === "AbortError") throw new Error("The PC helper did not answer within 8 seconds.");
                    if (error instanceof TypeError) throw new TypeError("Could not reach the PC helper at " + new URL(config.baseUrl).host + ".");
                    throw error;
                }
                if (response.status === 404 && path.startsWith("/jobs/")) return null;
                if (response.status === 401) throw new Error("Pair this phone with the PC helper again.");
                if (!response.ok) {
                    // The helper says why it refused (e.g. a website it is not paired with, or Tempe failing).
                    const detail = await response.json().then(body => typeof body?.error === "string" ? " " + body.error : "", () => "");
                    throw new Error(`PC helper returned HTTP ${response.status}.${detail}`);
                }
                const value = await response.json();
                if (!value || typeof value !== "object") throw new Error("The PC returned an invalid response.");
                return value;
            } finally { env.clearTimeout(timer); }
        }
        return {
            isPaired: () => !!config,
            async health() {
                const value = await request("/health");
                if (value.service !== "tempe-mobile-jobcard" || value.apiVersion !== 1) throw new Error("This address is not the matching Job Card receiver.");
                return value;
            },
            getJob: id => request("/jobs/" + encodeURIComponent(id)),
            submit: payload => request("/jobs", "POST", payload),
            retry: id => request("/jobs/" + encodeURIComponent(id) + "/retry", "POST", { submissionId: id }),
            async fetchTyres(target) {
                const url = new URL(target);
                if (url.protocol !== "https:" || !["tempetyres.com.au", "www.tempetyres.com.au"].includes(url.hostname) ||
                    !["/tyres", "/tyreproducts", "/search"].includes(url.pathname) || url.username || url.password || (url.port && url.port !== "443"))
                    throw new Error("The tyre receiver accepts Tempe product searches only.");
                const result = await request("/tyres?url=" + encodeURIComponent(url.href));
                if (result.ok !== true || typeof result.text !== "string" || result.status < 200 || result.status >= 400) throw new Error("The PC could not retrieve this Tempe product page.");
                return result;
            }
        };
    }
    root.TempeCostarConnection = { createClient, pairing };
    if (typeof module !== "undefined" && module.exports) module.exports = root.TempeCostarConnection;
    if (root.document) {
        try { root.TempeCostarClient = createClient(); }
        catch (error) { root.TempeCostarPairingError = error.message; }
    }
})(typeof window !== "undefined" ? window : globalThis);
