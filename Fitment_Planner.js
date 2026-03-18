const selectedPositions = new Set();
const rotationPlan = [];
let pendingFrom = null;

const labelMap = {
    "front-left": "FL",
    "front-right": "FR",
    "rear-left": "RL",
    "rear-right": "RR",
    "boot": "Spare",
};

const rotationNodes = {
    "front-left": { x: 140, y: 70 },
    "front-right": { x: 360, y: 70 },
    "rear-left": { x: 140, y: 220 },
    "rear-right": { x: 360, y: 220 },
    "boot": { x: 250, y: 300 },
};

function getSpareMountedLocation() {
    const enabled = document.getElementById("spareMountedMode").checked;
    const selected = document.getElementById("spareMountedAt").value;
    return enabled && selected ? selected : null;
}

function copySKU(sku) {
    if (!sku) return;
    navigator.clipboard.writeText(sku).catch((err) => console.error("Copy failed", err));
}

function loadSelectedTyre() {
    const textEl = document.getElementById("selectedTyreText");

    try {
        const raw = localStorage.getItem("fitment:selectedTyre");
        if (!raw) return 0;

        const tyre = JSON.parse(raw);
        if (!tyre || !tyre.sku) return 0;

        const linkText = tyre.link && tyre.link !== "#"
            ? `<a href="${tyre.link}" target="_blank">${tyre.make || "Unknown"} ${tyre.model || "Tyre"}</a>`
            : `${tyre.make || "Unknown"} ${tyre.model || "Tyre"}`;

        textEl.innerHTML = `${linkText} | SKU: <button type="button" class="sku-copy-btn" id="skuCopyBtn">${tyre.sku}</button> | $${Number(tyre.price || 0).toFixed(2)}`;

        document.getElementById("skuCopyBtn")?.addEventListener("click", () => copySKU(tyre.sku));
        return Number(tyre.price || 0);
    } catch (err) {
        console.error("Failed to load selected tyre", err);
        return 0;
    }
}

function getAlignmentPrice() {
    if (!document.getElementById("alignmentEnabled").checked) return 0;
    return document.querySelector("input[name='alignmentType']:checked")?.value === "full" ? 70 : 50;
}

function drawRotationArrows() {
    const svg = document.getElementById("rotationArrows");
    svg.innerHTML = `
        <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <polygon points="0 0, 8 4, 0 8" fill="#f97316"></polygon>
            </marker>
        </defs>
    `;

    rotationPlan.forEach(({ from, to }) => {
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

    const flowText = rotationPlan.length
        ? rotationPlan.map((step) => `${labelMap[step.from]}→${labelMap[step.to]}`).join(" | ")
        : "none";
    document.getElementById("rotationFlowInline").textContent = `Rotation flow: ${flowText}`;

    const mountedSpareAt = getSpareMountedLocation();
    const spareTextEl = document.getElementById("spareMountedText");
    spareTextEl.textContent = mountedSpareAt
        ? `Spare is currently on ${labelMap[mountedSpareAt]} (labels swapped on map).`
        : "";
}

function updateTotal(baseTyrePrice) {
    const qty = Number(document.getElementById("quantityInput").value || 0);
    const tyreTotal = qty * baseTyrePrice;
    const alignment = getAlignmentPrice();
    const total = tyreTotal + alignment;

    const selectedCount = selectedPositions.size;
    const mismatch = selectedCount > 0 && selectedCount !== qty ? ` (selected spots: ${selectedCount})` : "";
    document.getElementById("totalPriceText").textContent = `Total: $${total.toFixed(2)}${mismatch}`;
}

function handlePositionTap(position, button, baseTyrePrice) {
    const rotationMode = document.getElementById("rotationMode").checked;

    if (!rotationMode) {
        if (selectedPositions.has(position)) {
            selectedPositions.delete(position);
            button.classList.remove("selected");
        } else {
            selectedPositions.add(position);
            button.classList.add("selected");
        }
        updateTotal(baseTyrePrice);
        return;
    }

    if (!pendingFrom) {
        pendingFrom = position;
        button.classList.add("rotation-source");
        return;
    }

    rotationPlan.push({ from: pendingFrom, to: position });

    document.querySelectorAll(".position-btn").forEach((btn) => btn.classList.remove("rotation-source"));
    pendingFrom = null;
    drawRotationArrows();
}

function highlightMountedSpare() {
    const mounted = getSpareMountedLocation();
    document.querySelectorAll(".position-btn").forEach((btn) => {
        if (btn.dataset.position === mounted) {
            btn.classList.add("spare-mounted");
        } else {
            btn.classList.remove("spare-mounted");
        }
    });
}

function updatePositionLabels() {
    const mounted = getSpareMountedLocation();
    const buttonLabels = {
        "front-left": "FL",
        "front-right": "FR",
        "rear-left": "RL",
        "rear-right": "RR",
        "boot": "Spare",
    };

    if (mounted) {
        buttonLabels[mounted] = "Spare";
        buttonLabels.boot = labelMap[mounted];
    }

    document.querySelectorAll(".position-btn").forEach((btn) => {
        const pos = btn.dataset.position;
        if (buttonLabels[pos]) {
            btn.textContent = buttonLabels[pos];
        }
    });
}

function initFitmentPlanner() {
    const baseTyrePrice = loadSelectedTyre();

    document.querySelectorAll(".position-btn").forEach((btn) => {
        btn.addEventListener("click", () => handlePositionTap(btn.dataset.position, btn, baseTyrePrice));
    });

    document.getElementById("quantityInput").addEventListener("input", () => updateTotal(baseTyrePrice));
    document.getElementById("alignmentEnabled").addEventListener("change", () => updateTotal(baseTyrePrice));

    document.querySelectorAll("input[name='alignmentType']").forEach((radio) => {
        radio.addEventListener("change", () => updateTotal(baseTyrePrice));
    });

    document.getElementById("rotationMode").addEventListener("change", (e) => {
        if (!e.target.checked) {
            pendingFrom = null;
            document.querySelectorAll(".position-btn").forEach((btn) => btn.classList.remove("rotation-source"));
        }
    });

    document.getElementById("clearRotationBtn").addEventListener("click", () => {
        rotationPlan.length = 0;
        pendingFrom = null;
        document.querySelectorAll(".position-btn").forEach((btn) => btn.classList.remove("rotation-source"));
        drawRotationArrows();
    });

    const spareMountedMode = document.getElementById("spareMountedMode");
    const spareMountedAt = document.getElementById("spareMountedAt");
    spareMountedMode.addEventListener("change", () => {
        spareMountedAt.disabled = !spareMountedMode.checked;
        if (!spareMountedMode.checked) {
            spareMountedAt.value = "";
        }
        updatePositionLabels();
        highlightMountedSpare();
        drawRotationArrows();
    });

    spareMountedAt.addEventListener("change", () => {
        updatePositionLabels();
        highlightMountedSpare();
        drawRotationArrows();
    });

    updatePositionLabels();
    highlightMountedSpare();
    drawRotationArrows();
    updateTotal(baseTyrePrice);
}

initFitmentPlanner();
