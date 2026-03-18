const selectedPositions = new Set();
const labelMap = {
    "front-left": "Front Left",
    "front-right": "Front Right",
    "rear-left": "Rear Left",
    "rear-right": "Rear Right",
    "boot": "Spare / Boot",
};

const rotationNodes = {
    "front-left": { x: 140, y: 70 },
    "front-right": { x: 360, y: 70 },
    "rear-left": { x: 140, y: 220 },
    "rear-right": { x: 360, y: 220 },
    "boot": { x: 250, y: 300 },
};

function copySKU(sku) {
    if (!sku) return;
    navigator.clipboard.writeText(sku)
        .then(() => {
            const toast = document.createElement("div");
            toast.textContent = `Copied: ${sku}`;
            toast.style.position = "fixed";
            toast.style.bottom = "20px";
            toast.style.right = "20px";
            toast.style.padding = "8px 12px";
            toast.style.background = "#16a34a";
            toast.style.color = "white";
            toast.style.borderRadius = "6px";
            toast.style.zIndex = "9999";
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 900);
        })
        .catch((err) => console.error("Copy failed", err));
}

function loadSelectedTyre() {
    const textEl = document.getElementById("selectedTyreText");

    try {
        const raw = localStorage.getItem("fitment:selectedTyre");
        if (!raw) return 0;

        const tyre = JSON.parse(raw);
        if (!tyre || !tyre.sku) return 0;

        const linkText = tyre.link && tyre.link !== "#"
            ? `<a href="${tyre.link}" target="_blank">${tyre.make || "Unknown Make"} ${tyre.model || "Unknown Model"}</a>`
            : `${tyre.make || "Unknown Make"} ${tyre.model || "Unknown Model"}`;

        textEl.innerHTML = `${linkText} | SKU: <button type="button" class="sku-copy-btn" id="skuCopyBtn">${tyre.sku}</button> | $${Number(tyre.price || 0).toFixed(2)} | ${tyre.stock || "No stock status"}`;

        const skuBtn = document.getElementById("skuCopyBtn");
        if (skuBtn) {
            skuBtn.addEventListener("click", () => copySKU(tyre.sku));
        }

        return Number(tyre.price || 0);
    } catch (err) {
        console.error("Failed to load selected tyre", err);
        return 0;
    }
}

function getAlignmentPrice() {
    const enabled = document.getElementById("alignmentEnabled").checked;
    if (!enabled) return 0;

    const selectedType = document.querySelector("input[name='alignmentType']:checked")?.value;
    return selectedType === "full" ? 70 : 50;
}

function getRotationPlan() {
    const plan = [];
    document.querySelectorAll(".rotation-to").forEach((select) => {
        const from = select.dataset.from;
        const to = select.value;
        if (to) plan.push({ from, to });
    });
    return plan;
}

function drawRotationArrows(plan) {
    const svg = document.getElementById("rotationArrows");
    svg.innerHTML = `
        <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <polygon points="0 0, 8 4, 0 8" fill="#f97316"></polygon>
            </marker>
        </defs>
    `;

    plan.forEach(({ from, to }) => {
        const start = rotationNodes[from];
        const end = rotationNodes[to];
        if (!start || !end || from === to) return;

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", start.x);
        line.setAttribute("y1", start.y);
        line.setAttribute("x2", end.x);
        line.setAttribute("y2", end.y);
        line.setAttribute("stroke", "#f97316");
        line.setAttribute("stroke-width", "3");
        line.setAttribute("marker-end", "url(#arrowhead)");
        svg.appendChild(line);
    });
}

function renderSummary(baseTyrePrice) {
    const summaryEl = document.getElementById("fitmentSummary");
    const warningEl = document.getElementById("fitmentWarning");
    const totalEl = document.getElementById("totalPriceText");

    const qty = Number(document.getElementById("quantityInput").value || 0);
    const locations = [...selectedPositions].map((pos) => labelMap[pos]);
    const rotationPlan = getRotationPlan();
    drawRotationArrows(rotationPlan);

    const alignmentPrice = getAlignmentPrice();
    const tyreTotal = qty * baseTyrePrice;
    const total = tyreTotal + alignmentPrice;

    totalEl.textContent = `Total: $${total.toFixed(2)} (Tyres: $${tyreTotal.toFixed(2)} + Alignment: $${alignmentPrice.toFixed(2)})`;

    if (locations.length === 0) {
        summaryEl.textContent = "Select tyre positions to build the job summary.";
        warningEl.style.display = "none";
        return;
    }

    const locationText = locations.join(", ");
    const rotationText = rotationPlan.length
        ? `Rotation flow: ${rotationPlan.map((step) => `${labelMap[step.from]} ➜ ${labelMap[step.to]}`).join(" | ")}`
        : "Rotation flow: none.";

    summaryEl.textContent = `Install ${qty} tyre(s) at: ${locationText}. ${rotationText}`;

    if (qty !== locations.length) {
        warningEl.textContent = `Quantity is ${qty}, but ${locations.length} position(s) are selected.`;
        warningEl.style.display = "block";
    } else {
        warningEl.style.display = "none";
    }
}

function bindPositionButtons(onChange) {
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

            onChange();
        });
    });
}

function buildRotationRows() {
    const builder = document.getElementById("rotationBuilder");
    const positions = Object.keys(labelMap);

    builder.innerHTML = positions.map((from) => {
        const options = ['<option value="">No move</option>']
            .concat(positions.map((to) => `<option value="${to}">${labelMap[to]}</option>`))
            .join("");

        return `
            <div class="rotation-row">
                <span class="rotation-from">${labelMap[from]}</span>
                <span class="rotation-arrow">➜</span>
                <select class="rotation-to" data-from="${from}">${options}</select>
            </div>
        `;
    }).join("");
}

function initFitmentPlanner() {
    buildRotationRows();
    const baseTyrePrice = loadSelectedTyre();

    const triggerRender = () => renderSummary(baseTyrePrice);

    bindPositionButtons(triggerRender);

    document.getElementById("quantityInput").addEventListener("input", triggerRender);

    const alignmentEnabled = document.getElementById("alignmentEnabled");
    const alignmentOptions = document.getElementById("alignmentOptions");
    alignmentEnabled.addEventListener("change", () => {
        alignmentOptions.style.display = alignmentEnabled.checked ? "grid" : "none";
        triggerRender();
    });

    document.querySelectorAll("input[name='alignmentType']").forEach((radio) => {
        radio.addEventListener("change", triggerRender);
    });

    document.querySelectorAll(".rotation-to").forEach((select) => {
        select.addEventListener("change", triggerRender);
    });

    triggerRender();
}

initFitmentPlanner();
