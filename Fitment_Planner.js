"use strict";

let jobCore;
let jobStore;
let initPromise;
const pcClient = window.TempeCostarClient;
const FIELD_MAP = { customerName: "customerName", phone: "phone", rego: "rego", kilometres: "kilometres", vehicle: "vehicle", tyre: "notes" };
let currentJob = null;
let pendingFields = {};
let fieldVersions = {};
let editQueue = Promise.resolve();
let polling = false;
let sending = false;
let helperReady = false;
// 2.6.2: the RDP helper does the Order and Print the Job Card choices (a 2.6.2 helper says so).
let jobOptions = false;
let storageHealthy = true;
let lastProductView = "";
let statusMessage = "";
// 2.6.9: why the desk PC can't be reached right now (the progress sheet says so), and whether the RDP
// helper is in touch with it (health).
let connectionProblem = "";
let workerAway = false;
const $ = id => document.getElementById(id);

function storageProblem(error) {
    storageHealthy = false;
    $("saveStatus").textContent = "Not saved";
    $("saveStatus").dataset.state = "error";
    statusMessage = error.message;
    if (jobCore?.toast) jobCore.toast(error.message);
    renderStatus();
}
function mutate(action) {
    // Keep field edits in their input order. Each transaction reads current products,
    // so a field save cannot overwrite a tyre added in another tab.
    const operation = editQueue.then(() => jobStore.mutate(action));
    editQueue = operation.catch(() => {});
    return operation;
}
function saveField(input) {
    if (!currentJob) return;
    const key = FIELD_MAP[input.id], value = input.value;
    const version = fieldVersions[key] = (fieldVersions[key] || 0) + 1;
    pendingFields[key] = value;
    $("saveStatus").textContent = "Saving…";
    $("saveStatus").dataset.state = "saving";
    renderPreview();
    mutate({ type: "patch", jobId: currentJob.jobId, fields: { [key]: value } }).then(state => {
        if (fieldVersions[key] === version) delete pendingFields[key];
        storageHealthy = true;
        applyState(state);
    }).catch(storageProblem);
}
function visibleState() {
    return currentJob ? { ...currentJob, fields: { ...currentJob.fields, ...pendingFields } } : null;
}
function applyState(state) {
    if (currentJob && state.jobId === currentJob.jobId && state.revision < currentJob.revision) return;
    if (!currentJob || state.jobId !== currentJob.jobId) pendingFields = {};
    currentJob = state;
    const display = visibleState();
    for (const [id, key] of Object.entries(FIELD_MAP)) if ($(id).value !== display.fields[key]) $(id).value = display.fields[key];
    $("alignmentEnabled").checked = state.alignmentEnabled;
    $("alignmentOptions").hidden = !state.alignmentEnabled;
    document.querySelectorAll('input[name="alignmentCode"]').forEach(input => { input.checked = input.value === state.alignment; });
    $("legacyTyreNotice").hidden = !state.legacyTyreText;
    $("legacyTyreNotice").textContent = state.legacyTyreText ? "Previous tyre description: " + state.legacyTyreText + ". Select its SKU through Add Tyre." : "";
    $("saveStatus").textContent = Object.keys(pendingFields).length ? "Saving…" : "Saved";
    $("saveStatus").dataset.state = Object.keys(pendingFields).length ? "saving" : "saved";
    renderProducts(); renderPreview(); renderStatus();
}
async function refreshDraft() {
    try { await editQueue; applyState(await jobStore.read()); }
    catch (error) { storageProblem(error); }
}
function renderProducts() {
    const signature = JSON.stringify(currentJob.products);
    if (signature === lastProductView) return;
    lastProductView = signature;
    const wrap = $("productLines"); wrap.replaceChildren();
    for (let i = 0; i < 3; i++) {
        const p = currentJob.products[i];
        const row = document.createElement("div"); row.className = "jobcard-product-row";
        const label = document.createElement("label"); label.className = "jobcard-product-sku";
        const caption = document.createElement("span"); caption.textContent = p ? `${i + 1}. ${p.type === "wheel" ? "Wheel" : "Tyre"}` : `${i + 1}. Empty product slot`;
        const input = document.createElement("input"); input.type = "text"; input.readOnly = true; input.value = p?.sku || ""; input.placeholder = "No product selected";
        label.append(caption, input);
        const qtyLabel = document.createElement("label"); const qtyCaption = document.createElement("span"); qtyCaption.textContent = "Qty";
        const qty = document.createElement("input"); qty.type = "number"; qty.inputMode = "numeric"; qty.min = "1"; qty.max = "100"; qty.step = "1";
        qty.value = p ? String(p.quantity) : ""; qty.disabled = !p; qty.setAttribute("aria-label", `Quantity for ${p?.sku || "empty slot " + (i + 1)}`);
        qty.addEventListener("change", async () => {
            try { applyState(await mutate({ type: "quantity", jobId: currentJob.jobId, productId: p.id, quantity: Number(qty.value) })); }
            catch (error) { qty.value = String(p.quantity); jobCore.toast(error.message); }
        });
        qtyLabel.append(qtyCaption, qty);
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "jobcard-remove";
        remove.textContent = "Remove"; remove.disabled = !p; remove.setAttribute("aria-label", `Remove ${p?.sku || "empty slot " + (i + 1)}`);
        remove.addEventListener("click", async () => {
            try { applyState(await mutate({ type: "remove", jobId: currentJob.jobId, productId: p.id })); }
            catch (error) { jobCore.toast(error.message); }
        });
        row.append(label, qtyLabel, remove); wrap.appendChild(row);
    }
    $("productCount").textContent = currentJob.products.length + " / 3";
}
function renderPreview() {
    const state = visibleState(); if (!state) return;
    $("jobCardPreview").textContent = jobCore.preview(state);
    const f = state.fields;
    const done = [f.customerName, f.phone, f.rego, f.kilometres, f.vehicle].filter(v => v.trim()).length + (state.products.length ? 1 : 0);
    $("completionStatus").textContent = done + " / 6";
    $("completionStatus").dataset.complete = String(jobCore.validation(state).length === 0);
}
function renderStatus() {
    if (!$("submitBtn")) return;
    const sub = currentJob?.submission;
    const names = { awaiting_ack: "Waiting for PC confirmation", queued: "Queued", awaiting_approval: "Waiting for approval on PC", injecting: "Filling COSTAR", failed: "Stopped — Retry on this phone, or New job", ready_for_review: "READY FOR REVIEW", removed: "Removed on the desk PC" };
    $("submissionStatus").textContent = !sub ? "Not submitted" : sub.gone ? "Closed on the PC — start a new job" : names[sub.status] || sub.status;
    // 2.6.9: a queued order says why it waits (a 2.6.9 desk PC tells).
    $("injectionProgress").textContent = sub?.status === "queued" ? sub.waiting || sub.message || "" : sub?.progress || sub?.message || "";
    $("jobcardError").textContent = statusMessage;
    $("jobcardError").hidden = !statusMessage;
    $("snapshotNotice").hidden = !sub;
    const chosen = sub?.payload?.options;
    $("snapshotNotice").textContent = sub ? "The submitted order is fixed. Further edits and added products stay on this card; they will not change the order sent to COSTAR." +
        (chosen ? " Chosen: " + (chosen.order ? "order (SHOP, CustWaiting, today)" : "no order") + ", " + (chosen.printJobCard ? "print the Job Card." : "no Job Card print.") : "") : "";
    $("submitBtn").disabled = !currentJob || !storageHealthy || !helperReady || !!sub || sending;
    $("submitBtn").textContent = sub ? "ORDER SUBMITTED" : "SUBMIT TO COSTAR";
    $("retryBtn").hidden = !sub || sub.gone || !(sub.status === "failed" || sub.status === "awaiting_ack");
    $("retryBtn").disabled = !helperReady || sending;
    // New job: once the order is ready for review, removed, gone from the PC, or stopped (failed).
    $("newJobBtn").disabled = !currentJob || !storageHealthy || sending || !jobCore.settled(sub);
    const progress = $("progressBtn");
    if (progress) progress.hidden = !sub || sheetOpen() || typeof jobCore?.progressView !== "function";
    // The sheet only shows how it goes: nothing in it may get in the way of the card or the order.
    try { renderSheet(); } catch (error) { console.error(error); }
}
// ---------- 2.6.9: the progress sheet (Tommy, 29 Oct: "add a progress when you submit to costar just like
// the repair order page") ----------
// Opened by SUBMIT TO COSTAR, Retry and Show progress; closing it changes nothing: the order goes on, and
// the COSTAR status card keeps saying how it stands.
const STEP_IDS = { sent: "submitStepSent", queued: "submitStepQueued", working: "submitStepWorking", done: "submitStepDone" };
function sheetOpen() { const sheet = $("submitSheet"); return !!(sheet && sheet.open); }
// Never in the way of sending: whatever goes wrong here, the order goes on (and the card says how it stands).
function openSheet() {
    try {
        const sheet = $("submitSheet");
        if (!sheet || !currentJob?.submission || typeof jobCore.progressView !== "function") return;
        if (!sheet.open && typeof sheet.showModal === "function") sheet.showModal();
    } catch (error) { console.error(error); }
    renderStatus();
}
function closeSheet() {
    try {
        const sheet = $("submitSheet");
        if (sheet && sheet.open && typeof sheet.close === "function") sheet.close();
    } catch (error) { console.error(error); }
    renderStatus();
}
function sheetTime(iso) {
    const at = new Date(iso);
    return isNaN(at.getTime()) ? "" : at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function renderSheet() {
    if (!sheetOpen() || typeof jobCore.progressView !== "function") return;
    const sub = currentJob?.submission;
    const view = jobCore.progressView(sub, { sending, offline: connectionProblem, away: workerAway });
    if (!view) { closeSheet(); return; }
    $("submitSheetTitle").textContent = view.title;
    const payload = sub.payload || {};
    $("submitSheetFor").textContent = [payload.vehicle?.registration ? "Rego " + payload.vehicle.registration : "", payload.customer?.name || ""].filter(Boolean).join(" · ");
    for (const name of jobCore.STEPS) { const li = $(STEP_IDS[name]); if (li) li.dataset.mode = view.steps[name]; }
    const at = sheetTime(payload.createdUtc);
    $("submitSentText").textContent = view.texts.sent || (at ? "at " + at : "");
    $("submitWaiting").textContent = view.texts.queued;
    $("submitProgress").textContent = (view.bar ? "Step " + view.bar.n + " of " + view.bar.m + (view.texts.working ? " · " : "") : "") + view.texts.working;
    const bar = $("submitBar");
    bar.hidden = !(view.bar && view.steps.working === "active");
    if (view.bar) { $("submitBarFill").style.width = Math.round(100 * view.bar.n / view.bar.m) + "%"; bar.setAttribute("aria-valuenow", String(view.bar.n)); bar.setAttribute("aria-valuemax", String(view.bar.m)); }
    const box = $("submitResult");
    box.hidden = !view.result;
    // Made again only when it changes (it is read out by screen readers, and its words can be selected).
    const said = JSON.stringify(view.result);
    if (view.result && box.dataset.said !== said) {
        box.dataset.said = said;
        const r = view.result, parts = [];
        box.dataset.kind = r.kind;
        const title = document.createElement("strong"); title.textContent = r.title; parts.push(title);
        if (r.text) { const p = document.createElement("p"); p.textContent = r.text; parts.push(p); }
        if (r.notes.length) { const ul = document.createElement("ul"); for (const n of r.notes) { const li = document.createElement("li"); li.textContent = n; ul.append(li); } parts.push(ul); }
        if (r.checks) { const p = document.createElement("p"); p.className = "jobcard-check-hand"; p.textContent = "Check by hand: " + r.checks; parts.push(p); }
        box.replaceChildren(...parts);
    }
    $("submitSheetHint").hidden = view.ended || view.retry;
    const actions = [];
    if (view.retry) actions.push({ label: "Close", run: closeSheet }, { label: "Retry", primary: true, disabled: !helperReady || sending, run: retrySubmission });
    else if (view.ended) actions.push({ label: "New job", run: () => { closeSheet(); newJob(); } }, { label: "Done", primary: true, run: closeSheet });
    else actions.push({ label: "Close", run: closeSheet });
    const signature = JSON.stringify(actions.map(a => [a.label, !!a.disabled]));
    const group = $("submitActions");
    if (group.dataset.actions === signature) return;
    group.dataset.actions = signature;
    group.replaceChildren(...actions.map(a => {
        const button = document.createElement("button"); button.type = "button"; button.className = a.primary ? "is-primary" : "is-quiet";
        button.textContent = a.label; button.disabled = !!a.disabled; button.addEventListener("click", a.run);
        return button;
    }));
}
async function poll() {
    if (polling) return;
    polling = true;
    try {
        await refreshDraft();
        if (!pcClient?.isPaired()) {
            helperReady = false;
            $("helperConnection").textContent = "PC helper not connected";
            $("queueStatus").textContent = "Open the PC helper’s QR link when it is available.";
            if (window.TempeCostarPairingError) statusMessage = window.TempeCostarPairingError;
            return;
        }
        const health = await pcClient.health();
        connectionProblem = "";
        workerAway = health.workerConnected !== true;
        helperReady = health.receiving === true && health.workerConnected === true;
        jobOptions = helperReady && health.jobOptions === true;
        // 2.4.0 receivers also say whether the RDP helper is taking jobs right now (workerAccepting);
        // older ones only say whether it is connected.
        const accepting = health.workerAccepting;
        $("helperConnection").textContent = !helperReady ? "PC receiver connected · RDP helper unavailable or stopped"
            : accepting === false ? "PC helper connected · RDP helper in touch, mobile entry off (your card will wait in the queue)"
            : "PC helper connected · RDP helper online";
        $("queueStatus").textContent = Number.isInteger(health.pendingCount) && health.pendingCount >= 0 ? `${health.pendingCount} pending order${health.pendingCount === 1 ? "" : "s"}` : "Queue status unavailable";
        statusMessage = "";
        const sub = currentJob?.submission;
        if (sub && sub.status !== "ready_for_review") {
            const status = await pcClient.getJob(sub.payload.submissionId);
            if (status) applyState(await mutate({ type: "status", jobId: currentJob.jobId, status }));
            else if (sub.status !== "awaiting_ack" && !sub.gone) applyState(await mutate({ type: "gone", jobId: currentJob.jobId, submissionId: sub.payload.submissionId }));
        }
    } catch (error) {
        helperReady = false;
        connectionProblem = error.message;
        $("helperConnection").textContent = "PC helper offline";
        statusMessage = "Draft kept on this phone. " + error.message;
    } finally { polling = false; renderStatus(); }
}
async function sendSnapshot(sub, retry) {
    try {
        const status = retry && sub.status === "failed" ? await pcClient.retry(sub.payload.submissionId) : await pcClient.submit(sub.payload);
        if (!status) throw new Error("The PC did not acknowledge this submission.");
        applyState(await mutate({ type: "status", jobId: currentJob.jobId, status }));
        statusMessage = "";
    } catch (error) {
        try { applyState(await mutate({ type: "network-error", jobId: currentJob.jobId, submissionId: sub.payload.submissionId })); }
        catch (saveError) { storageProblem(saveError); }
        statusMessage = error.message + " Retry will use the same submission.";
        jobCore.toast(statusMessage);
    }
}
async function submit() {
    if (sending || !helperReady || !storageHealthy) return;
    sending = true; renderStatus();
    try {
        await refreshDraft();
        if (currentJob.submission) return;
        const errors = jobCore.validation(currentJob);
        if (errors.length) { statusMessage = errors.join(" "); jobCore.toast(errors[0]); return; }
        const revision = currentJob.revision;
        // 2.6.2 (Tommy, 27 Oct): with a 2.6.2 RDP helper, the two choices before going ahead, both ticked to
        // start with. An older helper orders as before and doesn't print: the plain question.
        let options = null;
        if (jobOptions) {
            options = await jobCore.choices("Submit this order to COSTAR?", [
                { key: "order", label: "Order", hint: "Ship Via SHOP, CustWaiting ticked, Repair Date today." },
                { key: "printJobCard", label: "Print the Job Card", hint: "COSTAR prints it once the order is in (on its Job Card printer)." }
            ], "Submit to COSTAR");
            if (!options) return;
        } else {
            const confirmed = await jobCore.dialog("Submit this order to COSTAR?", [{ label: "Confirm", value: true }, { label: "Cancel", value: null }]);
            if (!confirmed) return;
        }
        const health = await pcClient.health();
        if (!health.receiving || !health.workerConnected) throw new Error("The PC helper is unavailable. Your card has not been submitted.");
        // The choices go only to a helper that does them (it may have changed while they were ticked).
        if (options && health.jobOptions !== true) throw new Error("The RDP helper changed version meanwhile. Nothing was sent: tap SUBMIT TO COSTAR again.");
        const state = await mutate({ type: "submit", jobId: currentJob.jobId, revision, submissionId: "MJC-" + jobCore.uuid(), createdUtc: new Date().toISOString(), ...(options ? { options } : {}) });
        applyState(state);
        // 2.6.9: from here the progress sheet follows it (sent, waiting, typing, ready).
        openSheet();
        await sendSnapshot(state.submission, false);
    } catch (error) { statusMessage = error.message; jobCore.toast(error.message); }
    finally { sending = false; renderStatus(); }
}
async function retrySubmission() {
    if (sending || !helperReady || !currentJob?.submission) return;
    sending = true; openSheet(); renderStatus();
    try { await refreshDraft(); await sendSnapshot(currentJob.submission, true); }
    finally { sending = false; renderStatus(); }
}
async function newJob() {
    if ($("newJobBtn").disabled) return;
    try {
        await refreshDraft();
        const oldId = currentJob.jobId;
        const sub = currentJob.submission;
        const question = sub && sub.status === "failed" && !sub.gone
            ? "This order stopped on the PC. It stays there for Retry, Mark done or Remove. Clear this card and start a new one?"
            : "Clear this job card and start a new one?";
        const confirmed = await jobCore.dialog(question, [{ label: "Confirm", value: true }, { label: "Cancel", value: null }]);
        if (!confirmed) return;
        const state = await mutate({ type: "new", jobId: oldId, newJobId: jobCore.uuid() });
        // Old one-tyre handoffs must never repopulate the next customer's card.
        try { localStorage.removeItem("fitment:selectedTyre"); localStorage.removeItem("fitment:mobile-jobcard:v3"); } catch (_) { /* The canonical new draft has already been saved. */ }
        pendingFields = {}; statusMessage = ""; lastProductView = "";
        applyState(state); $("customerName").focus(); jobCore.toast("New job ready");
    } catch (error) { jobCore.toast(error.message); }
}
async function addWheel() {
    try {
        const value = await jobCore.dialog("Add wheel", [{ label: "Add Wheel", value: "input" }, { label: "Cancel", value: null }], "COSTAR wheel SKU");
        if (value === null) return;
        const state = await jobCore.addProduct({ type: "wheel", sku: value, description: "" });
        if (state) applyState(state);
    } catch (error) { jobCore.toast(error.message); }
}
function saveAlignment() {
    const selected = document.querySelector('input[name="alignmentCode"]:checked');
    mutate({ type: "alignment", jobId: currentJob.jobId, enabled: $("alignmentEnabled").checked, code: selected?.value || "" }).then(applyState).catch(storageProblem);
}
async function copyQuickField(key) {
    const state = visibleState(); if (!state) return;
    const f = state.fields;
    const values = { q: f.customerName.toUpperCase(), w: f.phone, e: (state.products.find(p => p.type === "tyre") || state.products[0])?.sku || "", a: f.vehicle.toUpperCase(), s: f.rego.toUpperCase(), d: f.kilometres };
    if (!(key in values)) return;
    if (!values[key]) { jobCore.toast("No value to copy"); return; }
    try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(values[key]);
        else { const box = document.createElement("textarea"); box.value = values[key]; document.body.appendChild(box); box.select(); document.execCommand("copy"); box.remove(); }
        jobCore.toast(key.toUpperCase() + " copied");
    } catch (_) { jobCore.toast("Copy failed"); }
}
function setDraftControlsEnabled(enabled) {
    for (const id of [...Object.keys(FIELD_MAP), "addWheelBtn", "alignmentEnabled"]) $(id).disabled = !enabled;
    document.querySelectorAll('input[name="alignmentCode"]').forEach(input => { input.disabled = !enabled; });
}
function initJobCard() {
    // Also works if this script is loaded after DOMContentLoaded. Repeated calls
    // share one startup, so they cannot register duplicate autosave/submit handlers.
    if (!initPromise) initPromise = startJobCard();
    return initPromise;
}
async function startJobCard() {
    try {
        setDraftControlsEnabled(false);
        jobCore = window.TempeJobCard;
        if (!jobCore || typeof jobCore.getStore !== "function") {
            throw new Error("jobcard-shared.js did not load. Upload it beside Fitment_Planner.html, then reload.");
        }
        jobStore = jobCore.getStore();
        // Read the existing shared draft before enabling editing. A failed read must
        // never create an empty replacement for products already saved by F Alt Tab.
        applyState(await jobStore.read());
        for (const id of Object.keys(FIELD_MAP)) {
            $(id).addEventListener("input", event => {
                if (id === "rego") { const start = event.target.selectionStart; event.target.value = event.target.value.toUpperCase(); if (start !== null) event.target.setSelectionRange(start, start); }
                if (id === "kilometres") event.target.value = event.target.value.replace(/[^\d]/g, "");
                saveField(event.target);
            });
            $(id).addEventListener("keydown", event => {
                if (event.key !== "Enter" || event.target.tagName === "TEXTAREA") return;
                event.preventDefault(); const ids = Object.keys(FIELD_MAP), next = ids[ids.indexOf(id) + 1];
                if (next) $(next).focus(); else event.target.blur();
            });
        }
        $("jobCardForm").addEventListener("submit", event => event.preventDefault());
        $("addWheelBtn").addEventListener("click", addWheel);
        $("alignmentEnabled").addEventListener("change", saveAlignment);
        document.querySelectorAll('input[name="alignmentCode"]').forEach(input => input.addEventListener("change", saveAlignment));
        $("submitBtn").addEventListener("click", submit); $("retryBtn").addEventListener("click", retrySubmission);
        $("newJobBtn").addEventListener("click", newJob);
        if ($("progressBtn")) $("progressBtn").addEventListener("click", openSheet);
        // Closed with Close, Done, the back gesture or Esc: only the sheet goes.
        if ($("submitSheet")) $("submitSheet").addEventListener("close", renderStatus);
        jobStore.subscribe(refreshDraft);
        window.addEventListener("focus", poll); window.addEventListener("online", poll);
        window.addEventListener("offline", () => { helperReady = false; $("helperConnection").textContent = "Offline — draft kept on this phone"; renderStatus(); });
        document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
        document.addEventListener("keydown", event => {
            if (event.ctrlKey || event.altKey || event.metaKey || event.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable || document.querySelector("dialog[open]")) return;
            const key = event.key.toLowerCase(); if ("qweasd".includes(key) && key.length === 1) { event.preventDefault(); copyQuickField(key); }
        });
        setDraftControlsEnabled(true);
        if (window.TempeJobCardStartup) window.TempeJobCardStartup.ready();
        // 2.6.9: every 1.5 s while the progress sheet follows an order on its way, else every 3 s as before.
        let ticks = 0;
        await poll(); window.setInterval(() => { ticks++; if (!document.hidden && (ticks % 2 === 0 || (sheetOpen() && !jobCore.settled(currentJob?.submission)))) poll(); }, 1500);
    } catch (error) {
        setDraftControlsEnabled(false);
        storageProblem(error);
        if (window.TempeJobCardStartup) window.TempeJobCardStartup.fail(error.message);
    }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initJobCard, { once: true });
else initJobCard();
