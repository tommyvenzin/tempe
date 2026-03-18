const selectedPositions = new Set();
const labelMap = {
    "front-left": "Front Left",
    "front-right": "Front Right",
    "rear-left": "Rear Left",
    "rear-right": "Rear Right",
    "boot": "Boot / Spare",
};

function loadSelectedTyre() {
    const textEl = document.getElementById("selectedTyreText");
    const linkEl = document.getElementById("selectedTyreLink");

    try {
        const raw = localStorage.getItem("fitment:selectedTyre");
        if (!raw) return;

        const tyre = JSON.parse(raw);
        if (!tyre || !tyre.sku) return;

        textEl.textContent = `${tyre.make || "Unknown Make"} ${tyre.model || "Unknown Model"} | SKU: ${tyre.sku} | $${Number(tyre.price || 0).toFixed(2)} | ${tyre.stock || "No stock status"}`;

        if (tyre.link && tyre.link !== "#") {
            linkEl.href = tyre.link;
            linkEl.style.display = "inline-block";
        }
    } catch (err) {
        console.error("Failed to load selected tyre", err);
    }
}

function renderSummary() {
    const summaryEl = document.getElementById("fitmentSummary");
    const warningEl = document.getElementById("fitmentWarning");
    const qty = Number(document.getElementById("quantityInput").value || 0);
    const rotationToFront = document.getElementById("rotationFrontInput").checked;

    const locations = [...selectedPositions].map((pos) => labelMap[pos]);

    if (locations.length === 0) {
        summaryEl.textContent = "Select tyre positions to build the job summary.";
        warningEl.style.display = "none";
        return;
    }

    const locationText = locations.join(", ");
    const rotationText = rotationToFront
        ? "Rotation requested: move new tyres to the front after fitment."
        : "Rotation requested: No.";

    summaryEl.textContent = `Install ${qty} tyre(s) at: ${locationText}. ${rotationText}`;

    if (qty !== locations.length) {
        warningEl.textContent = `Quantity is ${qty}, but ${locations.length} position(s) are selected.`;
        warningEl.style.display = "block";
    } else {
        warningEl.style.display = "none";
    }
}

function bindPositionButtons() {
    document.querySelectorAll(".position-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const position = btn.dataset.position;
            if (!position) return;

            if (selectedPositions.has(position)) {
                selectedPositions.delete(position);
                btn.classList.remove("selected");
            } else {
                selectedPositions.add(position);
                btn.classList.add("selected");
            }

            renderSummary();
        });
    });
}

function initFitmentPlanner() {
    loadSelectedTyre();
    bindPositionButtons();

    document.getElementById("quantityInput").addEventListener("input", renderSummary);
    document.getElementById("rotationFrontInput").addEventListener("change", renderSummary);

    renderSummary();
}

initFitmentPlanner();
