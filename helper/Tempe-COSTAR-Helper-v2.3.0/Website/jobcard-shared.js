/* Shared Mobile Job Card draft. Product changes and snapshots use one IndexedDB transaction. */
(function (root) {
    "use strict";
    const DB_NAME = "tempe-mobile-jobcard-v1";
    const LEGACY_KEY = "fitment:mobile-jobcard:v3";
    const CHANGE_KEY = "fitment:jobcard:changed:v1";
    const FIELDS = ["customerName", "phone", "rego", "kilometres", "vehicle", "notes"];
    const STATUSES = ["queued", "awaiting_approval", "injecting", "failed", "ready_for_review"];
    const clone = value => JSON.parse(JSON.stringify(value));
    const clean = value => String(value == null ? "" : value).trim();
    const sku = value => clean(value).toUpperCase();
    function fail(message) { throw new Error(message); }
    function uuid() {
        const bytes = new Uint8Array(16);
        root.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const h = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    }
    function validSku(value) {
        return /^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(sku(value)) &&
            !/^(F|M|DET|WA|WAFR|SERVICES?|UNKNOWN|UNAVAILABLE)$/.test(sku(value));
    }
    function ordered(products) {
        return [...products.filter(p => p.type === "wheel"), ...products.filter(p => p.type === "tyre")];
    }
    function empty(id) {
        return { schema: 1, jobId: id, revision: 0, fields: Object.fromEntries(FIELDS.map(k => [k, ""])),
            products: [], alignment: "", alignmentEnabled: false, submission: null, legacyTyreText: "" };
    }
    function migrate(legacy, id) {
        const state = empty(id);
        if (!legacy || typeof legacy !== "object") return state;
        for (const k of FIELDS.filter(k => k !== "notes")) state.fields[k] = String(legacy[k] ?? "");
        if (validSku(legacy.tyreSku)) {
            state.products.push({ id: "legacy-tyre", type: "tyre", sku: sku(legacy.tyreSku), quantity: 4,
                description: clean(legacy.tyre), source: "f-alt-tab" });
        } else state.legacyTyreText = clean(legacy.tyre);
        return state;
    }
    function validation(state) {
        const f = state.fields, errors = [];
        if (!clean(f.customerName) || f.customerName.length > 200) errors.push("Enter the customer name (up to 200 characters).");
        if (!/^\+?[\d ()-]+$/.test(clean(f.phone)) || !/^\d{8,15}$/.test(f.phone.replace(/\D/g, ""))) errors.push("Enter a valid mobile number.");
        if (!/^[A-Z0-9 -]{1,15}$/i.test(clean(f.rego))) errors.push("Enter the vehicle registration.");
        if (!/^\d{1,7}$/.test(clean(f.kilometres))) errors.push("Enter the odometer as whole kilometres, including 0 if applicable.");
        if (!clean(f.vehicle) || f.vehicle.length > 200) errors.push("Enter the vehicle make/model (up to 200 characters).");
        if (f.notes.length > 400) errors.push("Keep additional notes within 400 characters.");
        if (Object.values(f).some(v => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))) errors.push("Remove unsupported control characters from the form.");
        if (state.products.length < 1 || state.products.length > 3) errors.push("Add between one and three product lines.");
        if (state.products.some(p => !validSku(p.sku) || !["wheel", "tyre"].includes(p.type) || !Number.isInteger(p.quantity) || p.quantity < 1 || p.quantity > 100)) errors.push("Check each SKU and quantity (1–100).");
        if (new Set(state.products.map(p => sku(p.sku))).size !== state.products.length) errors.push("Remove duplicate product SKUs.");
        if (state.alignmentEnabled && !["WA", "WAFR"].includes(state.alignment)) errors.push("Choose front or front and rear wheel alignment.");
        return errors;
    }
    function snapshot(state, id, createdUtc) {
        const errors = validation(state);
        if (errors.length) fail(errors[0]);
        const f = state.fields;
        return { schema: "tempe.mobile-jobcard.v1", submissionId: id, draftId: state.jobId, createdUtc,
            customer: { name: clean(f.customerName).toUpperCase(), mobile: clean(f.phone) },
            vehicle: { registration: sku(f.rego), makeModel: clean(f.vehicle).toUpperCase(), odometer: Number(f.kilometres) },
            products: ordered(state.products).map(p => ({ type: p.type, sku: p.sku, quantity: p.quantity, description: p.description })),
            fittingCode: "M FB", alignment: state.alignmentEnabled ? state.alignment : null,
            additionalNotes: clean(f.notes) };
    }
    function reduce(previous, action) {
        if (action.jobId && action.jobId !== previous.jobId) fail("A new job was started in another tab. Review the current card first.");
        const state = clone(previous);
        switch (action.type) {
        case "read": return state;
        case "patch":
            for (const key of Object.keys(action.fields || {})) if (FIELDS.includes(key)) state.fields[key] = String(action.fields[key]);
            break;
        case "alignment":
            state.alignmentEnabled = !!action.enabled;
            state.alignment = action.enabled ? (["WA", "WAFR"].includes(action.code) ? action.code : "") : "";
            break;
        case "add": {
            const item = action.product;
            if (!["wheel", "tyre"].includes(item.type) || !validSku(item.sku)) fail("This product has no valid COSTAR SKU. Select a product with a SKU.");
            if (state.products.some(p => p.sku === sku(item.sku))) fail(`${sku(item.sku)} is already on this Job Card. Change its quantity on the card.`);
            const product = { id: action.productId, type: item.type, sku: sku(item.sku), quantity: item.type === "tyre" ? 4 : 1,
                description: clean(item.description).slice(0, 400), source: item.type === "tyre" ? "f-alt-tab" : "manual-wheel" };
            if (action.replaceId) {
                const index = state.products.findIndex(p => p.id === action.replaceId);
                if (index < 0) fail("That product changed in another tab. Choose a replacement again.");
                state.products[index] = product;
            } else {
                if (state.products.length >= 3) fail("All three slots are occupied. Choose which product to replace.");
                state.products.push(product);
            }
            state.products = ordered(state.products);
            break;
        }
        case "quantity": {
            const product = state.products.find(p => p.id === action.productId);
            if (!product) fail("That product is no longer on this card.");
            if (!Number.isInteger(action.quantity) || action.quantity < 1 || action.quantity > 100) fail("Quantity must be a whole number from 1 to 100.");
            product.quantity = action.quantity;
            break;
        }
        case "remove": state.products = state.products.filter(p => p.id !== action.productId); break;
        case "submit":
            if (state.submission) fail("This job has already been submitted. Use Retry for the same submission, or New job after Ready for Review.");
            if (action.revision !== state.revision) fail("The Job Card changed while you were confirming. Review it and submit again.");
            state.submission = { payload: snapshot(state, action.submissionId, action.createdUtc), status: "awaiting_ack",
                serverVersion: 0, message: "Waiting for the PC to acknowledge this submission.", progress: "", deliveryUnknown: false };
            break;
        case "status": {
            const sub = state.submission, status = action.status;
            if (!sub || status.submissionId !== sub.payload.submissionId) fail("The PC returned a status for another submission.");
            if (!STATUSES.includes(status.status) || !Number.isInteger(status.version) || status.version < 1) fail("The PC returned an unsupported job status.");
            if (status.version <= sub.serverVersion || sub.status === "ready_for_review") return state;
            sub.status = status.status; sub.serverVersion = status.version;
            sub.message = clean(status.message).slice(0, 1000); sub.progress = clean(status.progress).slice(0, 400);
            sub.deliveryUnknown = false;
            break;
        }
        case "network-error":
            if (state.submission && state.submission.payload.submissionId === action.submissionId) {
                state.submission.deliveryUnknown = true;
                state.submission.message = "Connection interrupted. The PC may already have received this order. Retry uses the same submission ID.";
            }
            break;
        case "new":
            if (state.submission && state.submission.status !== "ready_for_review") fail("Wait until this order is Ready for Review before starting a new job.");
            return empty(action.newJobId);
        default: fail("Unknown Job Card operation.");
        }
        state.revision++;
        return state;
    }
    function preview(state) {
        const f = state.fields, show = v => clean(v).toUpperCase() || "________________";
        const products = ordered(state.products).map(p => `${p.type.toUpperCase()}: ${p.sku}  × ${p.quantity}`);
        return [`CUSTOMER: ${show(f.customerName)}`, `MOBILE: ${show(f.phone)}`, "", ...products,
            ...(products.length ? [] : ["PRODUCTS: Select tyres in F Alt Tab or add a wheel."]),
            "M FB — FITTING / BALANCING",
            ...(state.alignmentEnabled ? [state.alignment === "WA" ? "WA — FRONT WHEEL ALIGNMENT" : state.alignment === "WAFR" ? "WAFR — FRONT & REAR WHEEL ALIGNMENT" : "ALIGNMENT: Choose front or front and rear."] : []),
            "", `MAKE/MODEL: ${show(f.vehicle)}`, `REGO NO: ${show(f.rego)}`,
            `ODOMETER: ${/^\d+$/.test(f.kilometres) ? Number(f.kilometres).toLocaleString("en-AU") : "________________"} KMS`,
            ...(clean(f.notes) ? ["", `M: ${clean(f.notes)}`] : [])].join("\n");
    }
    function createStore(env = root) {
        let database;
        const listeners = new Set();
        const channel = env.BroadcastChannel ? new env.BroadcastChannel("tempe-jobcard-v1") : null;
        function notify() { listeners.forEach(fn => fn()); }
        if (channel) channel.onmessage = notify;
        if (env.addEventListener) env.addEventListener("storage", event => { if (event.key === CHANGE_KEY) notify(); });
        function announce() {
            if (channel) channel.postMessage("changed");
            try { env.localStorage.setItem(CHANGE_KEY, String(Date.now()) + Math.random()); } catch (_) { /* IndexedDB owns the saved draft. */ }
            notify();
        }
        function open() {
            if (!database) database = new Promise((resolve, reject) => {
                if (!env.indexedDB) { reject(new Error("This browser cannot save the Job Card. Enable website storage and reload.")); return; }
                const request = env.indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = () => request.result.createObjectStore("drafts");
                request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
                request.onerror = () => reject(request.error || new Error("Could not open the saved Job Card."));
                request.onblocked = () => reject(new Error("Close other Job Card tabs, then reload this page."));
            });
            return database;
        }
        async function mutate(action) {
            const db = await open();
            return new Promise((resolve, reject) => {
                const tx = db.transaction("drafts", "readwrite"), store = tx.objectStore("drafts");
                let next, problem, changed = false;
                const request = store.get("active");
                request.onsuccess = () => {
                    try {
                        let old = request.result;
                        if (!old) {
                            let legacy = null;
                            try { legacy = JSON.parse(env.localStorage.getItem(LEGACY_KEY) || "null"); } catch (_) { /* No readable legacy draft. */ }
                            old = migrate(legacy, uuid()); changed = true;
                        }
                        if (old.schema !== 1 || !Array.isArray(old.products)) fail("The saved Job Card needs checking. Its data has not been cleared.");
                        next = reduce(old, action);
                        changed = changed || action.type !== "read";
                        if (changed) store.put(next, "active");
                    } catch (error) { problem = error; tx.abort(); }
                };
                tx.oncomplete = () => { if (changed) announce(); resolve(clone(next)); };
                tx.onerror = tx.onabort = () => reject(problem || tx.error || new Error("Could not save this change on the phone."));
            });
        }
        return { read: () => mutate({ type: "read" }), mutate, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
    }
    let store;
    function getStore() { if (!store) store = createStore(); return store; }
    function toast(message) {
        let box = root.document.getElementById("jobcardToast");
        if (!box) { box = root.document.createElement("div"); box.id = "jobcardToast"; box.className = "jobcard-shared-toast"; box.setAttribute("role", "status"); root.document.body.appendChild(box); }
        box.textContent = message; box.classList.add("is-visible");
        root.clearTimeout(toast.timer); toast.timer = root.setTimeout(() => box.classList.remove("is-visible"), 4200);
    }
    function dialog(title, choices, inputLabel) {
        return new Promise(resolve => {
            const node = root.document.createElement("dialog"); node.className = "jobcard-dialog";
            const heading = root.document.createElement("h2"); heading.id = "jobcard-dialog-" + uuid(); heading.textContent = title; node.appendChild(heading);
            node.setAttribute("aria-labelledby", heading.id);
            let input;
            if (inputLabel) {
                const label = root.document.createElement("label"); label.textContent = inputLabel;
                input = root.document.createElement("input"); input.type = "text"; input.autocomplete = "off"; input.autocapitalize = "characters"; input.maxLength = 40;
                label.appendChild(input); node.appendChild(label);
            }
            const group = root.document.createElement("div"); group.className = "jobcard-dialog-actions";
            function finish(value) { node.close(); node.remove(); resolve(value); }
            for (const choice of choices) {
                const button = root.document.createElement("button"); button.type = "button"; button.textContent = choice.label;
                button.addEventListener("click", () => finish(choice.value === "input" ? input.value : choice.value)); group.appendChild(button);
            }
            node.appendChild(group); node.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
            root.document.body.appendChild(node); node.showModal(); if (input) input.focus();
        });
    }
    async function addProduct(product) {
        const db = getStore(), state = await db.read();
        if (!validSku(product.sku)) fail("This product has no valid COSTAR SKU. Choose a product with a SKU.");
        if (state.products.some(p => p.sku === sku(product.sku))) fail(`${sku(product.sku)} is already on the card. Its quantity has not changed.`);
        let replaceId;
        if (state.products.length >= 3) {
            replaceId = await dialog("All three slots are full. Replace which product?", [
                ...ordered(state.products).map(p => ({ label: `${p.type === "wheel" ? "Wheel" : "Tyre"}: ${p.sku} × ${p.quantity}`, value: p.id })),
                { label: "Cancel", value: null }
            ]);
            if (!replaceId) return null;
        }
        const result = await db.mutate({ type: "add", jobId: state.jobId, product, productId: uuid(), replaceId });
        toast(`${sku(product.sku)} ${replaceId ? "replaced" : "added"} on the Job Card · quantity ${product.type === "tyre" ? 4 : 1}`);
        return result;
    }
    const api = { FIELDS, STATUSES, validSku, ordered, empty, migrate, validation, snapshot, reduce, preview, createStore, getStore, uuid, toast, dialog, addProduct };
    root.TempeJobCard = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
