"use strict";

const JOBCARD_STORAGE_KEY = "fitment:mobile-jobcard:v3";
const SELECTED_TYRE_STORAGE_KEY = "fitment:selectedTyre";

const FIELD_IDS = Object.freeze([
    "customerName",
    "phone",
    "rego",
    "kilometres",
    "vehicle",
    "tyre",
]);

let selectedTyre = null;
let currentTyreSku = "";
let saveTimer = null;
let toastTimer = null;

function getFields() {
    return Object.fromEntries(
        FIELD_IDS.map((id) => [id, document.getElementById(id)])
    );
}

function readJson(key, fallback = null) {
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
        showToast("Could not save on this phone");
        return false;
    }
}

function collectJob() {
    const fields = getFields();

    return {
        customerName: fields.customerName.value.trim(),
        phone: fields.phone.value.trim(),
        rego: fields.rego.value.trim().toUpperCase(),
        kilometres: fields.kilometres.value.replace(/[^\d]/g, ""),
        vehicle: fields.vehicle.value.trim(),
        tyre: fields.tyre.value.trim(),
        tyreSku: currentTyreSku.trim().toUpperCase(),
        updatedAt: new Date().toISOString(),
    };
}

function populateJob(job) {
    const fields = getFields();
    const safeJob = job && typeof job === "object" ? job : {};

    for (const id of FIELD_IDS) {
        fields[id].value = safeJob[id] ?? "";
    }

    fields.rego.value = fields.rego.value.toUpperCase();
    fields.kilometres.value = fields.kilometres.value.replace(/[^\d]/g, "");
    currentTyreSku = String(safeJob.tyreSku || "").trim().toUpperCase();

    updateEverything();
}

function formatKilometres(value) {
    const digits = String(value || "").replace(/[^\d]/g, "");
    if (!digits) return "";

    const parsed = Number.parseInt(digits, 10);
    return Number.isFinite(parsed) ? parsed.toLocaleString("en-AU") : digits;
}

function valueOrBlank(value) {
    return String(value || "").trim() || "________________";
}

function uppercaseCopyValue(value) {
    return String(value || "").trim().toUpperCase();
}

function getQuickCopyBindings(job = collectJob()) {
    return {
        q: {
            value: uppercaseCopyValue(job.customerName),
            label: "Name",
            message: "Name copied",
        },
        w: {
            value: String(job.phone || "").trim(),
            label: "Mobile",
            message: "Mobile copied",
        },
        e: {
            value: uppercaseCopyValue(job.tyreSku),
            label: "SKU",
            message: "SKU copied",
        },
        a: {
            value: uppercaseCopyValue(job.vehicle),
            label: "Make / Model",
            message: "Make / model copied",
        },
        s: {
            value: uppercaseCopyValue(job.rego),
            label: "Rego",
            message: "Rego copied",
        },
        d: {
            value: String(job.kilometres || "").replace(/[^\d]/g, ""),
            label: "Odo",
            message: "Odometer copied",
        },
    };
}

function isTypingTarget(target) {
    if (!target) return false;

    const tagName = target.tagName?.toLowerCase();
    return (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target.isContentEditable
    );
}

function refreshQuickCopyButtons() {
    const bindings = getQuickCopyBindings();

    document.querySelectorAll("[data-copy-key]").forEach((button) => {
        const key = String(button.dataset.copyKey || "").toLowerCase();
        const binding = bindings[key];
        const isEmpty = !binding?.value;

        button.classList.toggle("is-empty", isEmpty);
        button.setAttribute(
            "aria-label",
            isEmpty
                ? `${binding?.label || key.toUpperCase()} has no value`
                : `Copy ${binding.label} with ${key.toUpperCase()}`
        );
    });
}

async function copyQuickField(key) {
    const normalizedKey = String(key || "").toLowerCase();
    const binding = getQuickCopyBindings()[normalizedKey];

    if (!binding) return false;

    if (!binding.value) {
        showToast(`No ${binding.label.toLowerCase()} to copy`);
        return true;
    }

    try {
        await copyText(binding.value);
        showToast(`${binding.message} · ${normalizedKey.toUpperCase()}`);
    } catch (error) {
        console.error(`${binding.label} copy failed`, error);
        showToast("Copy failed");
    }

    return true;
}

function buildJobCardText(job = collectJob()) {
    const kilometres = formatKilometres(job.kilometres);

    return [
        `CUSTOMER: ${valueOrBlank(job.customerName).toUpperCase()}`,
        `MOBILE: ${valueOrBlank(job.phone)}`,
        "",
        `TYRE: ${valueOrBlank(job.tyre).toUpperCase()}`,
        `MAKE/MODEL: ${valueOrBlank(job.vehicle).toUpperCase()}`,
        `REGO NO: ${valueOrBlank(job.rego).toUpperCase()}`,
        `ODOMETER: ${kilometres ? `${kilometres} KMS` : "________________ KMS"}`,
    ].join("\n");
}

function updatePreview() {
    const job = collectJob();
    document.getElementById("jobCardPreview").textContent = buildJobCardText(job);

    const completed = FIELD_IDS.reduce(
        (count, id) => count + (String(job[id] || "").trim() ? 1 : 0),
        0
    );

    const completion = document.getElementById("completionStatus");
    completion.textContent = `${completed} / ${FIELD_IDS.length}`;
    completion.dataset.complete = String(completed === FIELD_IDS.length);
}

function setSaveStatus(text, state = "saved") {
    const status = document.getElementById("saveStatus");
    status.textContent = text;
    status.dataset.state = state;
}

function saveDraft() {
    const job = collectJob();

    if (writeJson(JOBCARD_STORAGE_KEY, job)) {
        setSaveStatus("Saved", "saved");
    }
}

function scheduleSave() {
    setSaveStatus("Saving…", "saving");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDraft, 180);
}

function updateEverything() {
    updatePreview();
    refreshQuickCopyButtons();
    scheduleSave();
}

function normalizeLiveField(event) {
    const input = event.target;

    if (input.id === "rego") {
        const start = input.selectionStart;
        input.value = input.value.toUpperCase();
        if (typeof start === "number") input.setSelectionRange(start, start);
    }

    if (input.id === "kilometres") {
        input.value = input.value.replace(/[^\d]/g, "");
    }
}

function moveToNextField(event) {
    if (event.key !== "Enter" || event.target.tagName === "TEXTAREA") return;

    event.preventDefault();
    const currentIndex = FIELD_IDS.indexOf(event.target.id);
    const nextId = FIELD_IDS[currentIndex + 1];

    if (nextId) {
        document.getElementById(nextId).focus();
    } else {
        event.target.blur();
    }
}

function getSelectedTyreDescription(tyreData) {
    if (!tyreData || typeof tyreData !== "object") return "";

    return [
        tyreData.make,
        tyreData.model,
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function loadSelectedTyre() {
    selectedTyre = readJson(SELECTED_TYRE_STORAGE_KEY, null);

    const description = getSelectedTyreDescription(selectedTyre);
    const strip = document.getElementById("selectedTyreStrip");

    if (!description) {
        strip.hidden = true;
        return;
    }

    document.getElementById("selectedTyreText").textContent = description;

    const selectedSku = uppercaseCopyValue(selectedTyre?.sku);
    const skuElement = document.getElementById("selectedTyreSku");
    skuElement.textContent = selectedSku ? `SKU: ${selectedSku}` : "SKU unavailable";

    strip.hidden = false;

    const tyreField = document.getElementById("tyre");
    if (!tyreField.value.trim()) {
        tyreField.value = description;
        currentTyreSku = selectedSku;
        updateEverything();
    }
}

function useSelectedTyre() {
    const description = getSelectedTyreDescription(selectedTyre);
    if (!description) return;

    const tyreField = document.getElementById("tyre");
    tyreField.value = description;
    currentTyreSku = uppercaseCopyValue(selectedTyre?.sku);
    tyreField.focus();
    tyreField.setSelectionRange(tyreField.value.length, tyreField.value.length);
    updateEverything();
    showToast("Selected tyre added");
}

async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
}

async function copyJobCard() {
    try {
        await copyText(buildJobCardText());
        showToast("Job card copied");
    } catch (error) {
        console.error("Copy failed", error);
        showToast("Copy failed");
    }
}

async function shareJobCard() {
    const text = buildJobCardText();

    if (navigator.share) {
        try {
            await navigator.share({
                title: "Customer tyre job",
                text,
            });
            return;
        } catch (error) {
            if (error?.name === "AbortError") return;
            console.error("Share failed", error);
        }
    }

    await copyJobCard();
}

function newJob() {
    const hasData = FIELD_IDS.some(
        (id) => document.getElementById(id).value.trim()
    );

    if (
        hasData &&
        !window.confirm("Clear this job card and start a new one?")
    ) {
        return;
    }

    localStorage.removeItem(JOBCARD_STORAGE_KEY);
    currentTyreSku = "";

    for (const id of FIELD_IDS) {
        document.getElementById(id).value = "";
    }

    setSaveStatus("New job", "saved");
    loadSelectedTyre();
    updatePreview();
    document.getElementById("customerName").focus();
    showToast("New job ready");
}

function showToast(message) {
    const toast = document.getElementById("jobcardToast");
    toast.textContent = message;
    toast.classList.add("is-visible");

    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(
        () => toast.classList.remove("is-visible"),
        1500
    );
}

function initJobCard() {
    const savedJob = readJson(JOBCARD_STORAGE_KEY, null);

    if (savedJob) {
        populateJob(savedJob);
        setSaveStatus("Draft restored", "saved");
    } else {
        updatePreview();
    }

    loadSelectedTyre();

    for (const id of FIELD_IDS) {
        const input = document.getElementById(id);

        input.addEventListener("input", (event) => {
            normalizeLiveField(event);
            updateEverything();
        });

        input.addEventListener("keydown", moveToNextField);
    }

    document.querySelectorAll("[data-copy-key]").forEach((button) => {
        button.addEventListener("click", () => {
            copyQuickField(button.dataset.copyKey);
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.repeat) return;
        if (isTypingTarget(event.target)) return;

        const key = String(event.key || "").toLowerCase();
        if (!getQuickCopyBindings()[key]) return;

        event.preventDefault();
        copyQuickField(key);
    });

    document.getElementById("useSelectedTyreBtn")
        .addEventListener("click", useSelectedTyre);

    document.getElementById("copyBtn")
        .addEventListener("click", copyJobCard);

    document.getElementById("shareBtn")
        .addEventListener("click", shareJobCard);

    document.getElementById("newJobBtn")
        .addEventListener("click", newJob);

    refreshQuickCopyButtons();
    window.addEventListener("pagehide", saveDraft);
}

document.addEventListener("DOMContentLoaded", initJobCard);
