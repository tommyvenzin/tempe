"use strict";

const jobCore = window.TempeJobCard;
const jobStore = jobCore.getStore();
const pcClient = window.TempeCostarClient;
const FIELD_MAP = { customerName: "customerName", phone: "phone", rego: "rego", kilometres: "kilometres", vehicle: "vehicle", tyre: "notes" };
let currentJob = null;
let pendingFields = {};
let fieldVersions = {};
let editQueue = Promise.resolve();
let polling = false;
let sending = false;
let helperReady = false;
let storageHealthy = true;
let lastProductView = "";
let statusMessage = "";
const $ = id => document.getElementById(id);

function storageProblem(error) {
    storageHealthy = false;
    $("saveStatus").textContent = "Not saved";
    $("saveStatus").dataset.state = "error";
    statusMessage = error.message;
    jobCore.toast(error.message);
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
    const names = { awaiting_ack: "Waiting for PC confirmation", queued: "Queued", awaiting_approval: "Waiting for approval on PC", injecting: "Filling COSTAR", failed: "Stopped — Retry available", ready_for_review: "READY FOR REVIEW" };
    $("submissionStatus").textContent = sub ? names[sub.status] || sub.status : "Not submitted";
    $("injectionProgress").textContent = sub?.progress || sub?.message || "";
    $("jobcardError").textContent = statusMessage;
    $("jobcardError").hidden = !statusMessage;
    $("snapshotNotice").hidden = !sub;
    $("snapshotNotice").textContent = sub ? "The submitted order is fixed. Further edits and added products stay on this card; they will not change the order sent to COSTAR." : "";
    $("submitBtn").disabled = !currentJob || !storageHealthy || !helperReady || !!sub || sending;
    $("submitBtn").textContent = sub ? "ORDER SUBMITTED" : "SUBMIT TO COSTAR";
    $("retryBtn").hidden = !sub || !(sub.status === "failed" || sub.status === "awaiting_ack");
    $("retryBtn").disabled = !helperReady || sending;
    $("newJobBtn").disabled = sending || !!(sub && sub.status !== "ready_for_review");
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
        helperReady = health.receiving === true && health.workerConnected === true;
        $("helperConnection").textContent = helperReady ? "PC helper connected · RDP worker online" : "PC receiver connected · RDP worker unavailable or stopped";
        $("queueStatus").textContent = Number.isInteger(health.pendingCount) && health.pendingCount >= 0 ? `${health.pendingCount} pending order${health.pendingCount === 1 ? "" : "s"}` : "Queue status unavailable";
        statusMessage = "";
        const sub = currentJob?.submission;
        if (sub && sub.status !== "ready_for_review") {
            const status = await pcClient.getJob(sub.payload.submissionId);
            if (status) applyState(await mutate({ type: "status", jobId: currentJob.jobId, status }));
            else if (sub.status !== "awaiting_ack") statusMessage = "The PC no longer reports this submission. Check the helper before retrying.";
        }
    } catch (error) {
        helperReady = false;
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
        const confirmed = await jobCore.dialog("Submit this order to COSTAR?", [{ label: "Confirm", value: true }, { label: "Cancel", value: null }]);
        if (!confirmed) return;
        const health = await pcClient.health();
        if (!health.receiving || !health.workerConnected) throw new Error("The PC helper is unavailable. Your card has not been submitted.");
        const state = await mutate({ type: "submit", jobId: currentJob.jobId, revision, submissionId: "MJC-" + jobCore.uuid(), createdUtc: new Date().toISOString() });
        applyState(state);
        await sendSnapshot(state.submission, false);
    } catch (error) { statusMessage = error.message; jobCore.toast(error.message); }
    finally { sending = false; renderStatus(); }
}
async function retrySubmission() {
    if (sending || !helperReady || !currentJob?.submission) return;
    sending = true; renderStatus();
    try { await refreshDraft(); await sendSnapshot(currentJob.submission, true); }
    finally { sending = false; renderStatus(); }
}
async function newJob() {
    if ($("newJobBtn").disabled) return;
    try {
        await refreshDraft();
        const oldId = currentJob.jobId;
        const confirmed = await jobCore.dialog("Clear this job card and start a new one?", [{ label: "Confirm", value: true }, { label: "Cancel", value: null }]);
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
async function initJobCard() {
    await refreshDraft();
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
    jobStore.subscribe(refreshDraft);
    window.addEventListener("focus", poll); window.addEventListener("online", poll);
    window.addEventListener("offline", () => { helperReady = false; $("helperConnection").textContent = "Offline — draft kept on this phone"; renderStatus(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
    document.addEventListener("keydown", event => {
        if (event.ctrlKey || event.altKey || event.metaKey || event.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable || document.querySelector("dialog[open]")) return;
        const key = event.key.toLowerCase(); if ("qweasd".includes(key) && key.length === 1) { event.preventDefault(); copyQuickField(key); }
    });
    await poll(); window.setInterval(() => { if (!document.hidden) poll(); }, 3000);
}
document.addEventListener("DOMContentLoaded", initJobCard);
