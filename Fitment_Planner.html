<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="color-scheme" content="dark">
    <title>Mobile Job Card</title>
    <link rel="stylesheet" href="./allaround.css">
</head>

<body class="app-page mobile-jobcard-page">
    <nav class="navbar app-nav" aria-label="Primary navigation">
        <div class="navbar-links">
            <a href="index.html">F Alt Tab</a>
            <a href="Project_C.html">Project C</a>
            <a href="Tyrestinder.html">Tyres Tinder</a>
            <a href="Fitment_Planner.html" aria-current="page">Job Card</a>
            <a href="testrun.html">Tempe Orders</a>
        </div>

        <select class="nav-dropdown" aria-label="Navigation menu"
            onchange="if (this.value) window.location.href=this.value;">
            <option value="index.html">F Alt Tab</option>
            <option value="Project_C.html">Project C</option>
            <option value="Tyrestinder.html">Tyres Tinder</option>
            <option value="Fitment_Planner.html" selected>Job Card</option>
            <option value="testrun.html">Tempe Orders</option>
        </select>
    </nav>

    <main class="jobcard-shell">
        <header class="jobcard-header">
            <div>
                <span class="eyebrow">MOBILE JOB CARD</span>
                <h1>Customer details</h1>
                <p>Capture the job outside, then send it to COSTAR for review.</p>
            </div>

            <div class="jobcard-header-actions">
                <span id="saveStatus" class="jobcard-save-status" aria-live="polite">Saved</span>
                <button type="button" id="newJobBtn" class="jobcard-quiet-button">New job</button>
            </div>
        </header>

        <form id="jobCardForm" class="jobcard-form" autocomplete="on">
            <label class="jobcard-field">
                <span>Name</span>
                <input
                    id="customerName"
                    required maxlength="200"
                    name="customerName"
                    type="text"
                    autocomplete="name"
                    autocapitalize="words"
                    enterkeyhint="next"
                    placeholder="Customer name"
                >
            </label>

            <label class="jobcard-field">
                <span>Mobile number</span>
                <input
                    id="phone"
                    required maxlength="30"
                    name="phone"
                    type="tel"
                    inputmode="tel"
                    autocomplete="tel"
                    enterkeyhint="next"
                    placeholder="04..."
                >
            </label>

            <label class="jobcard-field">
                <span>Rego</span>
                <input
                    id="rego"
                    required maxlength="15"
                    name="rego"
                    type="text"
                    autocapitalize="characters"
                    autocomplete="off"
                    enterkeyhint="next"
                    placeholder="CXB89H"
                >
            </label>

            <label class="jobcard-field">
                <span>Kilometres</span>
                <div class="jobcard-input-suffix">
                    <input
                        id="kilometres"
                    required maxlength="7"
                        name="kilometres"
                        type="text"
                        inputmode="numeric"
                        autocomplete="off"
                        enterkeyhint="next"
                        placeholder="40631"
                    >
                    <span>KM</span>
                </div>
            </label>

            <label class="jobcard-field jobcard-field-wide">
                <span>Car make / model</span>
                <input
                    id="vehicle"
                    required maxlength="200"
                    name="vehicle"
                    type="text"
                    autocapitalize="words"
                    autocomplete="off"
                    enterkeyhint="next"
                    placeholder="Mazda MX-5"
                >
            </label>

            <label class="jobcard-field jobcard-field-wide">
                <span>Additional Notes <small>(optional)</small></span>
                <textarea
                    id="tyre"
                    name="tyre"
                    rows="2"
                    autocapitalize="characters"
                    autocomplete="off"
                    enterkeyhint="done"
                    maxlength="400"
                    placeholder="Parked in SF; spare on front passenger side…"
                ></textarea>
            </label>
            <section class="jobcard-products jobcard-field-wide" aria-labelledby="productsHeading">
                <div class="jobcard-section-heading"><h2 id="productsHeading">Products</h2><span id="productCount">0 / 3</span></div>
                <p>Choose tyres with Add Tyre in F Alt Tab. Adjust quantities here.</p>
                <div id="productLines" class="jobcard-product-lines"></div>
                <div class="jobcard-product-actions"><button type="button" id="addWheelBtn">Add Wheel</button><a href="index.html">Find tyres in F Alt Tab</a></div>
                <p id="legacyTyreNotice" class="jobcard-hint" hidden></p>
            </section>
            <section class="jobcard-services jobcard-field-wide" aria-label="Fitting and wheel alignment">
                <p class="jobcard-fitting-note">M FB · Fitting / balancing included</p>
                <label class="jobcard-check"><input id="alignmentEnabled" type="checkbox"> Wheel Alignment <small>(optional)</small></label>
                <fieldset id="alignmentOptions" hidden>
                    <legend>Choose alignment</legend>
                    <label><input type="radio" name="alignmentCode" value="WA"> Front Wheel Alignment — WA</label>
                    <label><input type="radio" name="alignmentCode" value="WAFR"> Front &amp; Rear Wheel Alignment — WAFR</label>
                </fieldset>
            </section>
        </form>

        <section class="jobcard-preview-card" aria-labelledby="previewHeading">
            <div class="jobcard-preview-heading">
                <div>
                    <span class="section-kicker">JOB CARD TEXT</span>
                    <h2 id="previewHeading">Ready for RepairOrder</h2>
                </div>
                <span id="completionStatus" class="completion-status">0 / 6</span>
            </div>

            <pre id="jobCardPreview" class="jobcard-preview"></pre>
        </section>

        <section class="jobcard-preview-card jobcard-costar-status" aria-labelledby="costarHeading">
            <h2 id="costarHeading">COSTAR status</h2>
            <p id="helperConnection">PC helper not connected</p>
            <p id="queueStatus">Open the PC helper’s QR link when it is available.</p>
            <strong id="submissionStatus" aria-live="polite">Not submitted</strong>
            <p id="injectionProgress" aria-live="polite"></p>
            <p id="jobcardError" class="jobcard-error" role="alert" hidden></p>
            <p id="snapshotNotice" class="jobcard-hint" hidden></p>
            <button type="button" id="retryBtn" hidden disabled>RETRY</button>
        </section>

        <div class="jobcard-bottom-space" aria-hidden="true"></div>
    </main>

    <div class="jobcard-action-bar">
        <button type="button" id="submitBtn" class="jobcard-primary-action" disabled>SUBMIT TO COSTAR</button>
    </div>

    <div id="jobcardToast" class="jobcard-toast" role="status" aria-live="polite"></div>

    <script src="./jobcard-shared.js" defer></script>
    <script src="./costar-client.js" defer></script>
    <script src="./Fitment_Planner.js" defer></script>
</body>
</html>
