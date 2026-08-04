"use strict";

const FITMENT_STORAGE = Object.freeze({
    draft: "fitment:v2:draft",
    jobs: "fitment:v2:jobs",
    selectedTyre: "fitment:selectedTyre",
});

const POSITION_META = Object.freeze({
    fl: { label: "Front Left", short: "FL" },
    fr: { label: "Front Right", short: "FR" },
    rl: { label: "Rear Left", short: "RL" },
    rr: { label: "Rear Right", short: "RR" },
    spare: { label: "Spare", short: "SP" },
});

const POSITION_ORDER = Object.keys(POSITION_META);
const ROAD_POSITIONS = ["fl", "fr", "rl", "rr"];
const ISSUE_OPTIONS = Object.freeze([
    ["puncture", "Puncture"],
    ["sidewall", "Sidewall"],
    ["uneven", "Uneven wear"],
    ["low-pressure", "Low pressure"],
    ["runflat", "Runflat"],
]);

let state = createDefaultState();
let activePosition = "fl";
let autosaveTimer = null;
let toastTimer = null;

function createTyreState() {
    return {
        status: "ok",
        size: "",
        product: "",
        tread: "",
        pressure: "",
        issues: [],
        notes: "",
    };
}

function createDefaultState() {
    const now = new Date().toISOString();
    return {
        version: 2,
        id: "",
        createdAt: now,
        updatedAt: now,
        stage: "outside",
        customer: {
            rego: "",
            name: "",
            phone: "",
            vehicle: "",
            odometer: "",
            request: "",
        },
        tyres: Object.fromEntries(POSITION_ORDER.map((position) => [position, createTyreState()])),
        outsideNotes: "",
        quote: {
            sku: "",
            product: "",
            priceEach: "",
            qty: 2,
            fitPositions: [],
            alignment: "none",
            alignmentPrice: 0,
            extras: 0,
            disposal: 0,
            discount: 0,
            workInstruction: "",
            notes: "",
            selectedTyreSavedAt: "",
            productLink: "",
        },
    };
}

function deepMergeDefaults(source) {
    const defaults = createDefaultState();
    const safe = source && typeof source === "object" ? source : {};

    return {
        ...defaults,
        ...safe,
        customer: { ...defaults.customer, ...(safe.customer || {}) },
        quote: { ...defaults.quote, ...(safe.quote || {}) },
        tyres: Object.fromEntries(
            POSITION_ORDER.map((position) => [
                position,
                {
                    ...defaults.tyres[position],
                    ...((safe.tyres && safe.tyres[position]) || {}),
                    issues: Array.isArray(safe.tyres?.[position]?.issues)
                        ? [...safe.tyres[position].issues]
                        : [],
                },
            ])
        ),
    };
}

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        console.error(`Could not read ${key}`, error);
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error(`Could not write ${key}`, error);
        showToast("Could not save locally");
        return false;
    }
}

function getByPath(object, path) {
    return path.split(".").reduce((value, key) => value?.[key], object);
}

function setByPath(object, path, value) {
    const keys = path.split(".");
    const finalKey = keys.pop();
    const target = keys.reduce((current, key) => {
        if (!current[key] || typeof current[key] !== "object") current[key] = {};
        return current[key];
    }, object);
    target[finalKey] = value;
}

function normalizeNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatMoney(value) {
    return new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        minimumFractionDigits: 2,
    }).format(normalizeNumber(value));
}

function formatDateTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-AU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function generateJobId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderInspectionCards() {
    const grid = document.getElementById("inspectionGrid");
    grid.innerHTML = `
        <div id="positionPicker" class="position-picker" aria-label="Tyre positions"></div>
        <div id="activeTyreEditor"></div>
    `;
    renderInspectionState();
}

function renderPositionPicker() {
    const picker = document.getElementById("positionPicker");
    if (!picker) return;

    picker.innerHTML = POSITION_ORDER.map((position) => {
        const tyre = state.tyres[position];
        const meta = POSITION_META[position];
        const detail = tyre.tread !== ""
            ? `${escapeHtml(tyre.tread)} mm`
            : (tyre.size ? escapeHtml(tyre.size) : "Not checked");

        return `
            <button
                type="button"
                class="position-picker-button ${activePosition === position ? "is-active" : ""}"
                data-edit-position="${position}"
                data-status="${escapeHtml(tyre.status)}"
            >
                <strong>${meta.short}</strong>
                <span>${escapeHtml(tyre.status)}</span>
                <small>${detail}</small>
            </button>
        `;
    }).join("");
}

function renderActiveTyreEditor() {
    const host = document.getElementById("activeTyreEditor");
    if (!host) return;

    const position = activePosition;
    const tyre = state.tyres[position];
    const meta = POSITION_META[position];
    const currentIndex = POSITION_ORDER.indexOf(position);

    host.innerHTML = `
        <article class="tyre-editor" data-status="${escapeHtml(tyre.status)}">
            <div class="tyre-editor-head">
                <div class="position-title">
                    <span class="position-code">${meta.short}</span>
                    <div>
                        <strong>${meta.label}</strong>
                        <small>${currentIndex + 1} of ${POSITION_ORDER.length}</small>
                    </div>
                </div>
                <div class="editor-nav">
                    <button type="button" class="quiet-button" data-position-step="-1" ${currentIndex === 0 ? "disabled" : ""}>← Previous</button>
                    <button type="button" class="quiet-button" data-position-step="1" ${currentIndex === POSITION_ORDER.length - 1 ? "disabled" : ""}>Next →</button>
                </div>
            </div>

            <div class="status-switch" aria-label="${meta.label} status">
                <button type="button" data-position-status="${position}" data-status="ok" class="${tyre.status === "ok" ? "is-active" : ""}">OK</button>
                <button type="button" data-position-status="${position}" data-status="monitor" class="${tyre.status === "monitor" ? "is-active" : ""}">Monitor</button>
                <button type="button" data-position-status="${position}" data-status="replace" class="${tyre.status === "replace" ? "is-active" : ""}">Replace</button>
            </div>

            <div class="tyre-input-grid">
                <label class="field">
                    <span>Size</span>
                    <input data-bind="tyres.${position}.size" type="text" autocapitalize="characters" placeholder="225/40R18" value="${escapeHtml(tyre.size)}">
                </label>
                <label class="field field-wide">
                    <span>Brand / pattern</span>
                    <input data-bind="tyres.${position}.product" type="text" placeholder="Michelin PS5" value="${escapeHtml(tyre.product)}">
                </label>
                <label class="field">
                    <span>Tread mm</span>
                    <input data-bind="tyres.${position}.tread" type="number" inputmode="decimal" min="0" max="20" step="0.1" placeholder="0.0" value="${escapeHtml(tyre.tread)}">
                </label>
                <label class="field">
                    <span>PSI</span>
                    <input data-bind="tyres.${position}.pressure" type="number" inputmode="decimal" min="0" max="100" step="0.5" placeholder="0" value="${escapeHtml(tyre.pressure)}">
                </label>
            </div>

            <div class="issue-row" aria-label="${meta.label} issues">
                ${ISSUE_OPTIONS.map(([value, label]) => `
                    <button type="button" data-position-issue="${position}" data-issue="${value}" class="${tyre.issues.includes(value) ? "is-active" : ""}">${label}</button>
                `).join("")}
            </div>

            <label class="field tyre-note-field">
                <span>Position note</span>
                <input data-bind="tyres.${position}.notes" type="text" placeholder="Optional" value="${escapeHtml(tyre.notes)}">
            </label>
        </article>
    `;
}

function stepPosition(direction) {
    const index = POSITION_ORDER.indexOf(activePosition);
    const nextIndex = Math.max(0, Math.min(POSITION_ORDER.length - 1, index + direction));
    activePosition = POSITION_ORDER[nextIndex];
    renderInspectionState();
    document.getElementById("activeTyreEditor")?.scrollIntoView({ block: "nearest", behavior: "auto" });
}

function hydrateFormFromState() {
    renderInspectionState();

    document.querySelectorAll("[data-bind]").forEach((element) => {
        const value = getByPath(state, element.dataset.bind);
        element.value = value ?? "";
    });
    renderFitPositions();
    renderAlignment();
    renderSelectedTyreBanner();
    updateQuoteTotal();
    setStage(state.stage || "outside", { save: false, focus: false });
}

function renderInspectionState() {
    renderPositionPicker();
    renderActiveTyreEditor();
}

function renderFitPositions() {
    document.querySelectorAll("[data-fit-position]").forEach((button) => {
        button.classList.toggle("is-active", state.quote.fitPositions.includes(button.dataset.fitPosition));
    });
}

function renderAlignment() {
    document.querySelectorAll("[data-alignment]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.alignment === state.quote.alignment);
    });
}

function renderSelectedTyreBanner() {
    const banner = document.getElementById("selectedTyreBanner");
    const hasProduct = state.quote.sku || state.quote.product;

    if (!hasProduct) {
        banner.innerHTML = "No tyre selected from F Alt Tab yet. You can still enter a product manually below.";
        banner.classList.remove("has-product");
        return;
    }

    const link = state.quote.productLink
        ? `<a href="${escapeHtml(state.quote.productLink)}" target="_blank" rel="noopener">${escapeHtml(state.quote.product || "Selected tyre")}</a>`
        : `<strong>${escapeHtml(state.quote.product || "Selected tyre")}</strong>`;

    banner.innerHTML = `${link}<span>SKU ${escapeHtml(state.quote.sku || "—")}</span><span>${formatMoney(state.quote.priceEach)} each</span>`;
    banner.classList.add("has-product");
}

function syncSelectedTyreFromSearch() {
    const selected = readJson(FITMENT_STORAGE.selectedTyre, null);
    if (!selected || !selected.sku) return;

    const savedAt = selected.savedAt || "";
    if (savedAt && savedAt === state.quote.selectedTyreSavedAt) return;

    state.quote.sku = selected.sku || "";
    state.quote.product = [selected.make, selected.model].filter(Boolean).join(" ").trim();
    state.quote.priceEach = normalizeNumber(selected.price);
    state.quote.productLink = selected.link || "";
    state.quote.selectedTyreSavedAt = savedAt;
    scheduleAutosave();
}

function collectBoundField(element) {
    const path = element.dataset.bind;
    if (!path) return;

    let value = element.value;
    if (element.matches("input[type='number']")) {
        value = value === "" ? "" : normalizeNumber(value);
    }

    setByPath(state, path, value);
    state.updatedAt = new Date().toISOString();

    if (path.startsWith("quote.")) {
        renderSelectedTyreBanner();
        updateQuoteTotal();
    }

    scheduleAutosave();
}

function scheduleAutosave() {
    const status = document.getElementById("saveStatus");
    status.textContent = "Saving…";
    status.classList.add("is-saving");

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
        state.updatedAt = new Date().toISOString();
        if (writeJson(FITMENT_STORAGE.draft, state)) {
            status.textContent = "Saved locally";
            status.classList.remove("is-saving");
        }
    }, 220);
}

function setStage(stage, options = {}) {
    const { save = true, focus = true } = options;
    if (!document.querySelector(`[data-stage="${stage}"]`)) return;

    state.stage = stage;
    document.querySelectorAll("[data-stage]").forEach((section) => {
        const active = section.dataset.stage === stage;
        section.hidden = !active;
        section.classList.toggle("is-active", active);
    });
    document.querySelectorAll("[data-stage-target]").forEach((button) => {
        if (button.classList.contains("workflow-tab")) {
            button.classList.toggle("is-active", button.dataset.stageTarget === stage);
        }
    });

    if (stage === "summary") renderSummary();
    if (save) scheduleAutosave();
    if (focus) window.scrollTo({ top: 0, behavior: "auto" });
}

function setPositionStatus(position, status) {
    state.tyres[position].status = status;
    if (status === "replace" && !state.quote.fitPositions.includes(position)) {
        state.quote.fitPositions.push(position);
    }
    if (status !== "replace") {
        state.quote.fitPositions = state.quote.fitPositions.filter((item) => item !== position);
    }
    renderInspectionState();
    renderFitPositions();
    syncQuantityToPositions();
    scheduleAutosave();
}

function togglePositionIssue(position, issue) {
    const issues = state.tyres[position].issues;
    state.tyres[position].issues = issues.includes(issue)
        ? issues.filter((item) => item !== issue)
        : [...issues, issue];
    renderInspectionState();
    scheduleAutosave();
}

function toggleFitPosition(position) {
    state.quote.fitPositions = state.quote.fitPositions.includes(position)
        ? state.quote.fitPositions.filter((item) => item !== position)
        : [...state.quote.fitPositions, position];
    syncQuantityToPositions();
    renderFitPositions();
    updateQuoteTotal();
    scheduleAutosave();
}

function syncQuantityToPositions() {
    if (state.quote.fitPositions.length > 0) {
        state.quote.qty = state.quote.fitPositions.length;
        const qtyInput = document.querySelector('[data-bind="quote.qty"]');
        if (qtyInput) qtyInput.value = state.quote.qty;
    }
}

function useReplacePositions() {
    state.quote.fitPositions = ROAD_POSITIONS.filter((position) => state.tyres[position].status === "replace");
    if (state.tyres.spare.status === "replace") state.quote.fitPositions.push("spare");
    syncQuantityToPositions();
    renderFitPositions();
    updateQuoteTotal();
    scheduleAutosave();
    showToast(state.quote.fitPositions.length ? "Replace positions loaded" : "No tyres marked Replace");
}

function setAlignment(type, price) {
    state.quote.alignment = type;
    state.quote.alignmentPrice = normalizeNumber(price);
    renderAlignment();
    updateQuoteTotal();
    scheduleAutosave();
}

function calculateQuote() {
    const qty = Math.max(0, normalizeNumber(state.quote.qty));
    const tyreSubtotal = qty * normalizeNumber(state.quote.priceEach);
    const alignment = normalizeNumber(state.quote.alignmentPrice);
    const extras = normalizeNumber(state.quote.extras);
    const disposal = normalizeNumber(state.quote.disposal);
    const discount = normalizeNumber(state.quote.discount);
    const total = Math.max(0, tyreSubtotal + alignment + extras + disposal - discount);

    return { qty, tyreSubtotal, alignment, extras, disposal, discount, total };
}

function updateQuoteTotal() {
    const values = calculateQuote();
    document.getElementById("quoteTotal").textContent = formatMoney(values.total);

    const parts = [
        `${values.qty} tyre${values.qty === 1 ? "" : "s"}`,
        `tyres ${formatMoney(values.tyreSubtotal)}`,
    ];
    if (values.alignment) parts.push(`alignment ${formatMoney(values.alignment)}`);
    if (values.extras) parts.push(`extras ${formatMoney(values.extras)}`);
    if (values.disposal) parts.push(`disposal ${formatMoney(values.disposal)}`);
    if (values.discount) parts.push(`discount −${formatMoney(values.discount)}`);
    document.getElementById("quoteBreakdown").textContent = parts.join(" • ");
}

function copyTyreData(from, to, fields) {
    fields.forEach((field) => {
        state.tyres[to][field] = Array.isArray(state.tyres[from][field])
            ? [...state.tyres[from][field]]
            : state.tyres[from][field];
    });
    hydrateFormFromState();
    scheduleAutosave();
    showToast(`${POSITION_META[from].short} copied to ${POSITION_META[to].short}`);
}

function copyFrontToRearSameAxle(from, to) {
    copyTyreData(from, to, ["size", "product", "tread", "pressure", "issues", "notes"]);
}

function copyFlSizeToAll() {
    const size = state.tyres.fl.size;
    const product = state.tyres.fl.product;
    ROAD_POSITIONS.forEach((position) => {
        if (position === "fl") return;
        state.tyres[position].size = size;
        if (!state.tyres[position].product) state.tyres[position].product = product;
    });
    hydrateFormFromState();
    scheduleAutosave();
    showToast("FL size copied to all road tyres");
}

function inspectionLine(position) {
    const tyre = state.tyres[position];
    const meta = POSITION_META[position];
    const details = [];
    if (tyre.size) details.push(tyre.size);
    if (tyre.product) details.push(tyre.product);
    if (tyre.tread !== "") details.push(`${tyre.tread} mm`);
    if (tyre.pressure !== "") details.push(`${tyre.pressure} PSI`);
    if (tyre.issues.length) details.push(tyre.issues.map(issueLabel).join(", "));
    if (tyre.notes) details.push(tyre.notes);
    return `${meta.short}: ${tyre.status.toUpperCase()}${details.length ? ` — ${details.join(" | ")}` : ""}`;
}

function issueLabel(value) {
    return ISSUE_OPTIONS.find(([key]) => key === value)?.[1] || value;
}

function alignmentLabel() {
    if (state.quote.alignment === "front") return "Front alignment";
    if (state.quote.alignment === "full") return "Front + rear alignment";
    return "No alignment";
}

function buildSummary() {
    const customer = state.customer;
    const quote = calculateQuote();
    const fitPositions = state.quote.fitPositions.map((position) => POSITION_META[position]?.short || position).join(", ") || "Not selected";
    const lines = [
        "TYRE JOB",
        `Rego: ${customer.rego || "—"}`,
        `Customer: ${customer.name || "—"}${customer.phone ? ` | ${customer.phone}` : ""}`,
        `Vehicle: ${customer.vehicle || "—"}${customer.odometer !== "" ? ` | ${customer.odometer} km` : ""}`,
        `Request: ${customer.request || "—"}`,
        "",
        "INSPECTION",
        ...POSITION_ORDER.map(inspectionLine),
    ];

    if (state.outsideNotes) lines.push(`Walkaround notes: ${state.outsideNotes}`);

    lines.push(
        "",
        "QUOTE / WORK PLAN",
        `Product: ${state.quote.product || "—"}`,
        `SKU: ${state.quote.sku || "—"}`,
        `Quantity: ${quote.qty} @ ${formatMoney(state.quote.priceEach)}`,
        `Fit positions: ${fitPositions}`,
        `Alignment: ${alignmentLabel()} (${formatMoney(quote.alignment)})`,
    );

    if (quote.extras) lines.push(`Fitting / extras: ${formatMoney(quote.extras)}`);
    if (quote.disposal) lines.push(`Disposal: ${formatMoney(quote.disposal)}`);
    if (quote.discount) lines.push(`Discount: -${formatMoney(quote.discount)}`);
    if (state.quote.workInstruction) lines.push(`Work instruction: ${state.quote.workInstruction}`);
    if (state.quote.notes) lines.push(`Quote notes: ${state.quote.notes}`);

    lines.push("", `TOTAL: ${formatMoney(quote.total)}`);
    return lines.join("\n");
}

function renderSummary() {
    document.getElementById("summaryOutput").textContent = buildSummary();
    document.getElementById("summaryUpdatedAt").textContent = `Updated ${formatDateTime(state.updatedAt)}`;
}

async function copySummary() {
    const text = buildSummary();
    try {
        await navigator.clipboard.writeText(text);
        showToast("Summary copied");
    } catch {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
        showToast("Summary copied");
    }
}

function loadJobs() {
    const jobs = readJson(FITMENT_STORAGE.jobs, []);
    return Array.isArray(jobs) ? jobs : [];
}

function saveCurrentJob() {
    if (!state.id) state.id = generateJobId();
    state.updatedAt = new Date().toISOString();

    const jobs = loadJobs();
    const index = jobs.findIndex((job) => job.id === state.id);
    const snapshot = typeof structuredClone === "function"
        ? structuredClone(state)
        : JSON.parse(JSON.stringify(state));

    if (index >= 0) jobs[index] = snapshot;
    else jobs.unshift(snapshot);

    jobs.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    writeJson(FITMENT_STORAGE.jobs, jobs.slice(0, 50));
    writeJson(FITMENT_STORAGE.draft, state);
    updateSavedJobsCount();
    showToast("Job saved");
}

function updateSavedJobsCount() {
    document.getElementById("savedJobsCount").textContent = String(loadJobs().length);
}

function renderSavedJobs() {
    const list = document.getElementById("savedJobsList");
    const jobs = loadJobs();

    if (!jobs.length) {
        list.innerHTML = `<div class="empty-jobs">No saved jobs yet.</div>`;
        return;
    }

    list.innerHTML = jobs.map((job) => {
        const rego = job.customer?.rego || "No rego";
        const name = job.customer?.name || job.customer?.vehicle || "Unnamed job";
        return `
            <article class="saved-job-card">
                <button type="button" class="saved-job-open" data-open-job="${escapeHtml(job.id)}">
                    <strong>${escapeHtml(rego)}</strong>
                    <span>${escapeHtml(name)}</span>
                    <small>${escapeHtml(formatDateTime(job.updatedAt))}</small>
                </button>
                <button type="button" class="saved-job-delete" data-delete-job="${escapeHtml(job.id)}" aria-label="Delete ${escapeHtml(rego)}">Delete</button>
            </article>
        `;
    }).join("");
}

function openJob(id) {
    const job = loadJobs().find((item) => item.id === id);
    if (!job) return;
    state = deepMergeDefaults(job);
    hydrateFormFromState();
    writeJson(FITMENT_STORAGE.draft, state);
    document.getElementById("savedJobsDialog").close();
    showToast("Job opened");
}

function deleteJob(id) {
    const jobs = loadJobs().filter((item) => item.id !== id);
    writeJson(FITMENT_STORAGE.jobs, jobs);
    renderSavedJobs();
    updateSavedJobsCount();
    showToast("Job deleted");
}

function startNewJob() {
    const hasData = state.customer.rego || state.customer.name || state.customer.vehicle || state.outsideNotes;
    if (hasData && !window.confirm("Start a new job? The current draft will be replaced.")) return;

    state = createDefaultState();
    localStorage.removeItem(FITMENT_STORAGE.draft);
    syncSelectedTyreFromSearch();
    hydrateFormFromState();
    document.getElementById("rego").focus();
    scheduleAutosave();
    showToast("New job ready");
}

function showToast(message) {
    const toast = document.getElementById("fitmentToast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1500);
}

function bindEvents() {
    document.addEventListener("input", (event) => {
        if (event.target.matches("[data-bind]")) collectBoundField(event.target);
    });

    document.addEventListener("change", (event) => {
        if (event.target.matches("[data-bind]")) collectBoundField(event.target);
    });

    document.addEventListener("click", (event) => {
        const stageButton = event.target.closest("[data-stage-target]");
        if (stageButton) setStage(stageButton.dataset.stageTarget);

        const editPositionButton = event.target.closest("[data-edit-position]");
        if (editPositionButton) {
            activePosition = editPositionButton.dataset.editPosition;
            renderInspectionState();
        }

        const positionStepButton = event.target.closest("[data-position-step]");
        if (positionStepButton) stepPosition(Number(positionStepButton.dataset.positionStep));

        const statusButton = event.target.closest("[data-position-status]");
        if (statusButton) setPositionStatus(statusButton.dataset.positionStatus, statusButton.dataset.status);

        const issueButton = event.target.closest("[data-position-issue]");
        if (issueButton) togglePositionIssue(issueButton.dataset.positionIssue, issueButton.dataset.issue);

        const fitButton = event.target.closest("[data-fit-position]");
        if (fitButton) toggleFitPosition(fitButton.dataset.fitPosition);

        const alignmentButton = event.target.closest("[data-alignment]");
        if (alignmentButton) setAlignment(alignmentButton.dataset.alignment, alignmentButton.dataset.price);

        const openJobButton = event.target.closest("[data-open-job]");
        if (openJobButton) openJob(openJobButton.dataset.openJob);

        const deleteJobButton = event.target.closest("[data-delete-job]");
        if (deleteJobButton && window.confirm("Delete this saved job?")) deleteJob(deleteJobButton.dataset.deleteJob);
    });

    document.getElementById("finishOutsideBtn").addEventListener("click", () => {
        useReplacePositions();
        setStage("inside");
    });
    document.getElementById("reviewSummaryBtn").addEventListener("click", () => setStage("summary"));
    document.getElementById("useReplacePositionsBtn").addEventListener("click", useReplacePositions);
    document.getElementById("copyFrontBtn").addEventListener("click", () => copyFrontToRearSameAxle("fl", "fr"));
    document.getElementById("copyRearBtn").addEventListener("click", () => copyFrontToRearSameAxle("rl", "rr"));
    document.getElementById("copySizeAllBtn").addEventListener("click", copyFlSizeToAll);
    document.getElementById("copySummaryBtn").addEventListener("click", copySummary);
    document.getElementById("saveJobBtn").addEventListener("click", saveCurrentJob);
    document.getElementById("newJobBtn").addEventListener("click", startNewJob);

    const dialog = document.getElementById("savedJobsDialog");
    document.getElementById("savedJobsBtn").addEventListener("click", () => {
        renderSavedJobs();
        dialog.showModal();
    });
    document.getElementById("closeSavedJobsBtn").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
    });
}

function initFitmentPlanner() {
    renderInspectionCards();
    state = deepMergeDefaults(readJson(FITMENT_STORAGE.draft, createDefaultState()));
    syncSelectedTyreFromSearch();
    bindEvents();
    hydrateFormFromState();
    updateSavedJobsCount();
    scheduleAutosave();
}

document.addEventListener("DOMContentLoaded", initFitmentPlanner);
