/* Shared Mobile Job Card draft. Product changes and snapshots use one IndexedDB transaction. */
(function (root) {
    "use strict";
    const DB_NAME = "tempe-mobile-jobcard-v1";
    const LEGACY_KEY = "fitment:mobile-jobcard:v3";
    const CHANGE_KEY = "fitment:jobcard:changed:v1";
    const FIELDS = ["customerName", "phone", "rego", "kilometres", "vehicle", "notes"];
    // "removed": taken off the queue on the desk PC (2.4.0). A job the PC no longer knows at all is
    // marked gone on this card (operation "gone") so a new card can be started.
    const STATUSES = ["queued", "awaiting_approval", "injecting", "failed", "ready_for_review", "removed"];
    // The submission is finished with as far as this phone is concerned: a new card may start.
    function settled(sub) { return !sub || sub.status === "ready_for_review" || sub.status === "removed" || sub.status === "failed" || sub.gone === true; }
    // 2.6.9: the progress sheet's steps, in order (like the Repair Orders page's save sheet).
    const STEPS = ["sent", "queued", "working", "done"];
    // The desk PC's and RDP helper's words for a stop before anything was typed (the choices it can't do, Add new
    // not pressed, the new Repair Order gone before any field).
    const NOT_ENTERED = /^Not entered\b|can't do this job's choices now|Add new was not pressed|before any fields were entered/i;
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
    // options (2.6.2, with a 2.6.2 RDP helper): { order, printJobCard }, what was ticked with SUBMIT TO COSTAR;
    // left out for an older helper (it orders as before and doesn't print).
    function snapshot(state, id, createdUtc, options) {
        const errors = validation(state);
        if (errors.length) fail(errors[0]);
        if (options != null && (typeof options !== "object" || typeof options.order !== "boolean" || typeof options.printJobCard !== "boolean")) fail("Choose Order and Print the Job Card again.");
        const f = state.fields;
        return { schema: "tempe.mobile-jobcard.v1", submissionId: id, draftId: state.jobId, createdUtc,
            ...(options != null ? { options: { order: options.order, printJobCard: options.printJobCard } } : {}),
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
            state.submission = { payload: snapshot(state, action.submissionId, action.createdUtc, action.options), status: "awaiting_ack",
                serverVersion: 0, message: "Waiting for the PC to acknowledge this submission.", progress: "", deliveryUnknown: false };
            break;
        case "status": {
            const sub = state.submission, status = action.status;
            if (!sub || status.submissionId !== sub.payload.submissionId) fail("The PC returned a status for another submission.");
            if (!STATUSES.includes(status.status) || !Number.isInteger(status.version) || status.version < 1) fail("The PC returned an unsupported job status.");
            if (sub.status === "ready_for_review" || sub.status === "removed") return state;
            // 2.6.9: why a queued job waits (a 2.6.9 desk says) changes without a new version.
            if (status.version === sub.serverVersion && status.status === sub.status) { sub.waiting = waitingOf(status); return state; }
            if (status.version <= sub.serverVersion) return state;
            sub.status = status.status; sub.serverVersion = status.version;
            sub.message = clean(status.message).slice(0, 1000); sub.progress = clean(status.progress).slice(0, 400);
            sub.waiting = waitingOf(status);
            // 2.6.9, for the progress sheet: the RDP helper's last step count ("4/12: …", kept while it says
            // other things) and how far the order got (a stop is shown at that step).
            const count = stepCount(sub.progress) || stepCount(sub.message);
            if (count) sub.step = { n: count.n, m: count.m };
            if (status.status === "injecting" || status.status === "ready_for_review") sub.reached = "working";
            sub.deliveryUnknown = false;
            break;
        }
        case "network-error":
            if (state.submission && state.submission.payload.submissionId === action.submissionId) {
                state.submission.deliveryUnknown = true;
                state.submission.message = "Connection interrupted. The PC may already have received this order. Retry uses the same submission ID.";
            }
            break;
        case "gone":
            // The PC answered "unknown submission": the order was closed or removed there (or the
            // desk's queue was reset). Nothing more can happen to it from this phone.
            if (state.submission && state.submission.payload.submissionId === action.submissionId && state.submission.status !== "awaiting_ack") {
                state.submission.gone = true;
                state.submission.message = "The PC closed or removed this order. Start a new job card when ready.";
            }
            break;
        case "new":
            // 2.4.1: allowed once the order is ready for review, removed or gone, and also after a stop
            // (failed): the failed order stays on the desk PC for Retry / Mark done / Remove there.
            if (!settled(state.submission)) fail("Wait until this order is Ready for Review (or stopped) before starting a new job.");
            return empty(action.newJobId);
        default: fail("Unknown Job Card operation.");
        }
        state.revision++;
        return state;
    }
    function waitingOf(status) { return status.status === "queued" ? clean(status.waiting).slice(0, 400) : ""; }
    // "4/12: Create DET details" (the RDP helper's step count while it types): { n, m, rest } or null.
    function stepCount(text) {
        const m = /^(\d{1,3})\/(\d{1,3}):\s*/.exec(String(text == null ? "" : text));
        return m && +m[1] >= 1 && +m[1] <= +m[2] ? { n: +m[1], m: +m[2], rest: String(text).slice(m[0].length) } : null;
    }
    // The RDP helper's last words for an order in COSTAR: "READY FOR REVIEW · note · note CHECK BY HAND: …".
    // { text, notes, checks }: its notes one by one and what to check by hand (one text: its sentences
    // can't be told apart); any other words (Marked done by hand on the desk PC…) are the text.
    function readyParts(message) {
        const text = clean(message);
        if (!/^READY FOR REVIEW\b/i.test(text)) return { text, notes: [], checks: "" };
        const cut = text.search(/\s*CHECK BY HAND:/i), head = cut < 0 ? text : text.slice(0, cut);
        return { text: "", notes: head.split(" · ").slice(1).map(clean).filter(Boolean), checks: cut < 0 ? "" : clean(text.slice(cut).replace(/^\s*CHECK BY HAND:/i, "")) };
    }
    // 2.6.9 (Tommy, 29 Oct: "add a progress when you submit to costar just like the repair order page"): what
    // the progress sheet shows for a submission. live (from the page): sending (being sent now), offline (the
    // desk PC can't be reached: why), away (the desk is reached but the RDP helper isn't in touch).
    // steps: sent / queued / working / done, each "", "active", "done" or "failed"; texts: the words under
    // each; bar: { n, m } while COSTAR is typed into; result: how it ended (or why it isn't known);
    // ended: nothing more happens to it; retry: Retry is offered. null without a submission.
    function progressView(sub, live) {
        if (!sub) return null;
        live = live || {};
        const steps = {}, texts = {};
        for (const x of STEPS) { steps[x] = ""; texts[x] = ""; }
        const view = { title: "", steps, texts, bar: null, result: null, ended: false, retry: false };
        const failAt = name => { for (const x of STEPS) { if (x === name) { steps[x] = "failed"; return; } steps[x] = "done"; } };
        const offline = live.offline ? "Can't reach the desk PC right now: " + live.offline : "";
        const result = (kind, title, text, notes, checks) => { view.result = { kind, title, text: text || "", notes: notes || [], checks: checks || "" }; };
        if (sub.gone) {
            // Whether any of it went in can't be told from here: only "sent" is marked.
            steps.sent = "done"; view.title = "Closed on the desk PC"; view.ended = true;
            result("warn", "The desk PC doesn't have this order any more", "It was closed or removed there, or its queue was cleared. Check COSTAR, then start a new job card when ready.");
            return view;
        }
        // Being sent (SUBMIT TO COSTAR), or sent again (Retry): until the desk PC answers.
        if (live.sending && (sub.status === "awaiting_ack" || sub.status === "failed")) {
            steps.sent = "active"; view.title = sub.status === "failed" ? "Retrying" : "Sending to COSTAR";
            texts.sent = offline || (sub.status === "failed" ? "Asking the desk PC to try it again…" : "Sending it to the desk PC…");
            return view;
        }
        switch (sub.status) {
        case "awaiting_ack":
            steps.sent = "failed"; view.title = "Not confirmed"; view.retry = true;
            result("warn", "The desk PC hasn't confirmed this order", sub.deliveryUnknown ? sub.message : "It may not have arrived. Retry sends this same order again: it never goes in twice.");
            return view;
        case "awaiting_approval":
            steps.sent = "done"; steps.queued = "active"; view.title = "Waiting for approval";
            texts.queued = offline || sub.message || "Approve this job on the desk PC.";
            return view;
        case "queued":
            steps.sent = "done"; steps.queued = "active"; view.title = "Waiting for the RDP helper";
            texts.queued = offline || sub.waiting || sub.message || "";
            return view;
        case "injecting": {
            steps.sent = steps.queued = "done"; steps.working = "active"; view.title = "Typing into COSTAR";
            const said = sub.progress || sub.message || "", count = stepCount(said);
            texts.working = offline || (live.away ? "The RDP helper isn't in touch with the desk PC right now." : count ? count.rest : said);
            if (sub.step) view.bar = { n: sub.step.n, m: sub.step.m };
            return view;
        }
        case "ready_for_review": {
            for (const x of STEPS) steps[x] = "done";
            view.title = "Ready for review"; view.ended = true;
            const parts = readyParts(sub.message), handWork = parts.checks || parts.notes.some(n => /by hand|check the printer|not printed|may have|couldn't/i.test(n));
            result(handWork ? "warn" : "ok", "In COSTAR: check it there, then save it", parts.text, parts.notes, parts.checks);
            return view;
        }
        case "failed": {
            // Part of it may be in COSTAR unless the words say nothing went in: this phone may not have seen it
            // being typed (put away meanwhile, or the stop came fast).
            const partWay = sub.reached === "working" || !NOT_ENTERED.test(sub.message || "");
            failAt(partWay ? "working" : "queued"); view.ended = true; view.retry = true;
            view.title = partWay ? "Stopped part way" : "Stopped";
            result("error", partWay ? "Part of it may be in COSTAR: check it there" : "Not entered in COSTAR", sub.message || "The RDP helper stopped this order.");
            return view;
        }
        case "removed":
            failAt("queued"); view.title = "Removed"; view.ended = true;
            result("warn", "Removed on the desk PC", "It was taken off the queue there, so it won't go into COSTAR. Start a new job card when ready.");
            return view;
        default: return view;
        }
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
    // 2.6.2: tick boxes before going ahead (each ticked to start with unless said). Resolves to
    // { key: true/false } for every item, or null (Cancel).
    function choices(title, items, confirmLabel) {
        return new Promise(resolve => {
            const doc = root.document, node = doc.createElement("dialog"); node.className = "jobcard-dialog";
            const heading = doc.createElement("h2"); heading.id = "jobcard-dialog-" + uuid(); heading.textContent = title; heading.style.marginBottom = "16px"; node.appendChild(heading);
            node.setAttribute("aria-labelledby", heading.id);
            const boxes = {};
            for (const item of items) {
                const label = doc.createElement("label"); label.className = "jobcard-choice";
                label.style.cssText = "display:flex;align-items:flex-start;gap:12px;margin:0 0 14px;cursor:pointer";
                const box = doc.createElement("input"); box.type = "checkbox"; box.checked = item.checked !== false;
                box.style.cssText = "flex:none;width:24px;height:24px;min-height:0;margin:1px 0 0;padding:0;accent-color:#22d3ee";
                const text = doc.createElement("span"); text.style.cssText = "display:grid;gap:3px";
                const name = doc.createElement("strong"); name.textContent = item.label;
                const hint = doc.createElement("small"); hint.textContent = item.hint || ""; hint.style.cssText = "color:#94a3b8;font-size:.78rem;line-height:1.4";
                text.append(name, hint); label.append(box, text); node.appendChild(label); boxes[item.key] = box;
            }
            const group = doc.createElement("div"); group.className = "jobcard-dialog-actions";
            function finish(value) { node.close(); node.remove(); resolve(value); }
            const go = doc.createElement("button"); go.type = "button"; go.textContent = confirmLabel || "Confirm";
            go.addEventListener("click", () => finish(Object.fromEntries(items.map(item => [item.key, boxes[item.key].checked]))));
            const cancel = doc.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
            cancel.addEventListener("click", () => finish(null));
            group.append(go, cancel); node.appendChild(group);
            node.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
            doc.body.appendChild(node); node.showModal(); go.focus();
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
    const api = { FIELDS, STATUSES, STEPS, settled, validSku, ordered, empty, migrate, validation, snapshot, reduce, stepCount, readyParts, progressView, preview, createStore, getStore, uuid, toast, dialog, choices, addProduct };
    root.TempeJobCard = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
