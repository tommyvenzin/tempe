/* Repair Orders on the phone (helper 2.6.0; 2.6.1: shown as soon as read, list from a recent copy; 2.6.2: Order and
   Print the Job Card ticked in the review, print with no change). Lists COSTAR Tempe's Work-in-Progress (read by the RDP
   helper through the desk PC), opens a Repair Order (the helper opens it in COSTAR, reads it and closes it
   again) and saves changes straight in. Changes stay a draft on this phone until "Save to COSTAR".
   A save is written down (its request ID and change) before it is sent and followed until it ends,
   wherever the phone goes meanwhile: a reload, a lost connection or going back never sends another
   one, it asks about the same one again. Sending that same change again is safe: the helper types it
   only into the Repair Order exactly as the phone read it (its fingerprint). A draft that has been sent
   remembers that fingerprint: its new lines and lines taken out are kept on a newer read only while
   COSTAR still has exactly that fingerprint (nothing of it can be in), or when the save is known to
   have typed nothing; otherwise they are left out (they may be in already) and the phone says so. */
(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const client = window.TempeCostarClient || null;
    const HEADER_KEYS = ["name", "phone", "email", "address", "address2", "suburb", "state", "postcode", "po", "comment"];
    const JOB_KEYS = ["makeModel", "rego", "odometer", "shipVia", "dateIn", "customerWaiting"];
    const CAR_KEYS = ["makeModel", "rego", "odometer"];
    const LABELS = { name: "Name", phone: "Mobile", email: "Email", address: "Address", address2: "Address line 2", suburb: "Suburb", state: "State", postcode: "Postcode",
        po: "PO#", comment: "Comment", makeModel: "Make / model", rego: "Rego", odometer: "Odometer", shipVia: "Ship Via", dateIn: "Date In", customerWaiting: "Customer Waiting" };
    // The most letters each box takes, as the helper checks them (it refuses longer).
    const LIMITS = { name: 100, phone: 20, email: 120, address: 100, address2: 100, suburb: 60, state: 3, postcode: 4, po: 30, comment: 80, makeModel: 60, rego: 15, odometer: 7, shipVia: 20 };
    const NOTE_MAX = 80, MAX_LINES = 25, MAX_ADDS = 8;
    const DRAFT_KEY = "tempe:ro-draft:v1:", SNAP_KEY = "tempe:ro-snap:v1:", PENDING_KEY = "tempe:ro-pending:v1:", LEFT_KEY = "tempe:ro-left:v1:";
    const FRESH_MS = 2 * 60 * 1000, DRAFT_MS = 24 * 3600 * 1000, PENDING_MS = 3 * 3600 * 1000;
    // sent: { sig, id } once a save of this draft was sent and nothing yet proves none of it is in COSTAR
    // (sig: the fingerprint that save was made on).
    // canPrint (2.6.2): the RDP helper prints Job Cards (a 2.6.2 helper says so).
    const state = { rows: [], list: null, filter: "all", query: "", doc: null, row: null, base: null, readAt: 0, draft: emptyDraft(), sent: null,
        token: 0, listBusy: false, readingToken: 0, closingToken: 0, sheetDoc: null, cameFromList: false, canPrint: false, reviewNext: null };

    // ---------- small helpers ----------
    const norm = v => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
    const digits = v => String(v ?? "").replace(/\D/g, "");
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    function emptyDraft() { return { header: {}, lines: {}, add: [] }; }
    function cents(text) { const t = String(text ?? "").replace(/[$,\s]/g, ""); return /^-?\d+(\.\d+)?$/.test(t) ? Math.round(Number(t) * 100) : null; }
    function num(text) { const t = String(text ?? "").replace(/,/g, "").trim(); return /^-?\d+(\.\d+)?$/.test(t) ? String(Number(t)) : norm(text); }
    const money = c => c == null ? "" : "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cleanMoney = v => String(v ?? "").replace(/[$,\s]/g, "");
    const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    function validDate(y, m, d) { const x = new Date(y, m - 1, d); return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? x : null; }
    // COSTAR's date texts: 07/10/2026, 7/10/26, 27 Oct 2026, Tue 27 Oct 2026, 2026-10-27 (a time after it is ignored).
    function parseDate(text) {
        const t = norm(text).replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*([AP]\.?M\.?)?$/, "");
        let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(t);
        if (m) { let y = Number(m[3]); if (y < 100) y += 2000; return validDate(y, Number(m[2]), Number(m[1])); }
        m = /^(?:[A-Z]{3,9},?\s+)?(\d{1,2})\s+([A-Z]{3})[A-Z]*\s+(\d{4})$/.exec(t);
        if (m && MONTHS.includes(m[2])) return validDate(Number(m[3]), MONTHS.indexOf(m[2]) + 1, Number(m[1]));
        m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
        return m ? validDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
    }
    const iso = d => d ? d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") : "";
    const shortDate = d => d ? d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "";
    const fullDate = d => d ? d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";
    const clock = t => new Date(t).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
    function ago(when) {
        const t = typeof when === "number" ? when : Date.parse(when);
        if (!t) return "";
        const s = Math.max(0, Math.round((Date.now() - t) / 1000));
        if (s < 45) return "just now";
        if (s < 90) return "a minute ago";
        if (s < 3600) return Math.round(s / 60) + " min ago";
        return "at " + clock(t);
    }
    function uuid() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
        const b = new Uint8Array(16); window.crypto.getRandomValues(b); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
        return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
    }
    function el(tag, props, ...children) {
        const node = document.createElement(tag);
        if (props) for (const [k, v] of Object.entries(props)) {
            if (v == null || v === false) continue;
            if (k === "class") node.className = v;
            else if (k === "text") node.textContent = v;
            else if (k.startsWith("data-") || k.startsWith("aria-") || k === "role" || k === "type" || k === "inputmode" || k === "maxlength" || k === "placeholder" || k === "autocapitalize" || k === "enterkeyhint") node.setAttribute(k, v === true ? "" : v);
            else node[k] = v;
        }
        for (const c of children) if (c != null) node.append(c);
        return node;
    }
    let toastTimer = 0;
    function toast(text, kind) {
        const t = $("toast"); t.textContent = text; t.dataset.kind = kind || "";
        t.classList.add("is-visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("is-visible"), 3400);
    }
    function store(kind, key, value) {
        try {
            const s = kind === "local" ? window.localStorage : window.sessionStorage;
            if (value === undefined) { const raw = s.getItem(key); return raw ? JSON.parse(raw) : null; }
            if (value === null) s.removeItem(key); else s.setItem(key, JSON.stringify(value));
        } catch (_) { /* storage full or blocked: the page still works */ }
        return null;
    }

    // ---------- the desk PC ----------
    async function ask(kind, doc, edit, fresh) {
        const body = { id: "RO-" + uuid(), kind };
        if (doc) body.doc = doc;
        if (edit) body.edit = edit;
        // 2.6.1: a list read just now (↻), not Order Check's copy from the last few minutes.
        if (fresh) body.fresh = true;
        return client.roAsk(body);
    }
    // Follows a request until it is done or failed. null: the desk PC no longer knows it; undefined:
    // the phone moved on (token) before it finished.
    async function follow(status, onUpdate, token) {
        const started = Date.now(); let errors = 0;
        while (status && status.status !== "done" && status.status !== "failed") {
            // 2.6.1: often at first (a Repair Order opens in seconds now), less after.
            const age = Date.now() - started;
            await sleep(document.hidden ? 2500 : age > 30000 ? 1500 : age > 10000 ? 900 : 400);
            if (token != null && token !== state.token) return undefined;
            let next;
            try { next = await client.roStatus(status.id); errors = 0; }
            catch (error) { if (onUpdate) onUpdate(status, error); if (++errors > 60) throw error; continue; }
            if (token != null && token !== state.token) return undefined;
            if (next === null) return null;
            status = next;
            if (onUpdate) onUpdate(status, null);
        }
        return status;
    }
    // Whether the RDP helper prints Job Cards (2.6.2): the save bar and an open review follow it.
    function setCanPrint(on) {
        if (state.canPrint === on) return;
        state.canPrint = on; updateSaveBar();
        if ($("reviewSheet").open) renderAlso();
    }
    function setHelper(kind, text) {
        $("helperLine").dataset.state = kind;
        $("helperText").textContent = text;
    }
    async function checkHealth() {
        if (!client || document.hidden) return;
        try {
            const h = await client.health();
            setCanPrint(h.roPrint === true);
            if (h.ro !== true) setHelper("off", "The desk PC needs helper 2.6.0 for Repair Orders: click the yellow update line on the desk PC.");
            else if (!h.receiving) setHelper("off", "The desk PC has stopped receiving.");
            else if (!h.roConnected) setHelper("off", "The RDP helper on the COSTAR PC isn't running (or not in touch).");
            else if (!h.roOn) setHelper("warn", "Repair Orders are switched off in the RDP helper.");
            else if (!h.roReady) setHelper("busy", h.roDetail || "COSTAR Tempe is busy.");
            else setHelper("ok", "COSTAR Tempe is ready");
        } catch (error) { setHelper("off", error.message); }
    }

    // ---------- the list ----------
    function rowMatches(row, words) {
        const hay = [row.doc, String(row.doc || "").replace(/^0+/, ""), row.name, row.comment, row.po, row.shipVia, row.by, row.status, row.total].map(norm).join(" ");
        return words.every(w => hay.includes(w));
    }
    function inFilter(row) {
        if (state.filter === "all") return true;
        const d = parseDate(row.date); if (!d) return false;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (state.filter === "today") return d.getTime() === today.getTime();
        return today.getTime() - d.getTime() <= 6 * 86400000 && d.getTime() <= today.getTime();
    }
    function docValue(doc) { const n = Number(String(doc || "").replace(/\D/g, "")); return Number.isFinite(n) ? n : 0; }
    function renderList() {
        const words = norm(state.query).split(" ").filter(Boolean);
        const rows = state.rows.filter(r => inFilter(r) && rowMatches(r, words)).sort((a, b) => docValue(b.doc) - docValue(a.doc));
        const list = $("roList"); list.replaceChildren();
        for (const r of rows.slice(0, 300)) {
            const date = parseDate(r.date);
            const tags = el("span", { class: "ro-tags" });
            if (r.shipVia) tags.append(el("span", { class: "ro-tag" + (norm(r.shipVia) === "SHOP" ? " is-shop" : ""), text: norm(r.shipVia) }));
            if (r.po) tags.append(el("span", { class: "ro-tag", text: "PO " + r.po }));
            if (r.by) tags.append(el("span", { class: "ro-tag is-muted", text: r.by }));
            if (r.status) tags.append(el("span", { class: "ro-tag is-status", text: r.status }));
            const button = el("button", { type: "button", class: "ro-row", "data-doc": r.doc, "aria-label": "Repair Order " + r.doc + ", " + (r.name || "no name") },
                el("span", { class: "ro-row-top" }, el("b", { class: "ro-doc", text: r.doc }), el("span", { class: "ro-date", text: date ? shortDate(date) : (r.date || "") }), el("span", { class: "ro-amount", text: r.total || "" })),
                el("span", { class: "ro-name", text: r.name || "No name" }),
                r.comment ? el("span", { class: "ro-comment", text: r.comment }) : null,
                tags.childElementCount ? tags : null);
            list.append(el("li", null, button));
        }
        const empty = $("listEmpty");
        if (!state.list) { empty.hidden = false; empty.textContent = state.listBusy ? "Reading COSTAR's Work-in-Progress…" : "No list yet. Tap ↻ to read COSTAR's Work-in-Progress."; }
        else if (!rows.length) { empty.hidden = false; empty.textContent = words.length || state.filter !== "all" ? "No Repair Order matches." : "COSTAR's Work-in-Progress is empty."; }
        else empty.hidden = true;
        if (rows.length > 300) list.append(el("li", { class: "ro-more", text: (rows.length - 300) + " more: search to narrow the list." }));
    }
    function renderMeta(extra, kind) {
        const meta = $("listMeta");
        if (extra) { meta.textContent = extra; meta.dataset.kind = kind || ""; return; }
        meta.dataset.kind = "";
        if (!state.list) { meta.textContent = ""; return; }
        const n = (state.list.rows || []).length;
        meta.textContent = n + " Repair Order" + (n === 1 ? "" : "s") + " · read " + ago(state.list.readUtc) + (state.list.source === "order-check" ? " (Order Check's copy)" : "") + (state.list.note ? " · " + state.list.note : "");
    }
    function applyList(view) {
        if (view && view.helper) setCanPrint(view.helper.print === true);
        state.list = view && view.list ? view.list : state.list;
        state.rows = state.list && Array.isArray(state.list.rows) ? state.list.rows : [];
        renderList(); renderMeta();
    }
    async function loadList(force) {
        if (!client) return;
        let view;
        try { view = await client.roList(); }
        catch (error) { renderMeta(/HTTP 404/.test(error.message) ? "The desk PC needs helper 2.6.0 for Repair Orders." : error.message, "error"); return; }
        applyList(view);
        const age = state.list ? Date.now() - Date.parse(state.list.readUtc) : Infinity;
        if (force || view.refresh || !(age < 60000)) refreshList(view.refresh);
    }
    async function refreshList(pending, fresh) {
        // ↻ while a read is going: a fresh read follows it (2.6.1).
        if (state.listBusy) { if (fresh) state.wantFresh = true; return; }
        state.listBusy = true; $("listBar").hidden = false; $("refreshList").classList.add("is-spinning"); renderList();
        try {
            let status = pending || await ask("list", null, null, fresh);
            const show = s => renderMeta(s.status === "queued" ? "Waiting for the RDP helper: " + (s.waiting || s.message) : "Reading COSTAR's Work-in-Progress…");
            show(status);
            status = await follow(status, s => show(s), null);
            if (status === null) renderMeta("The desk PC lost track of the read. Tap ↻ to try again.", "error");
            else if (status && status.status === "failed") { renderMeta(status.message, "error"); return; }
            applyList(await client.roList());
        } catch (error) { renderMeta(error.message, "error"); }
        finally {
            state.listBusy = false; $("listBar").hidden = true; $("refreshList").classList.remove("is-spinning"); renderList();
            if (state.wantFresh) { state.wantFresh = false; refreshList(null, true); }
        }
    }

    // ---------- one Repair Order ----------
    const here = doc => state.doc === doc && !!state.base && state.base.doc === doc;
    function showView(which) {
        $("listView").hidden = which !== "list";
        $("detailView").hidden = which !== "detail";
        $("saveBar").hidden = which !== "detail" || !state.base;
        document.body.classList.toggle("ro-has-savebar", which === "detail" && !!state.base);
    }
    function showOpen(title, text) { $("openCard").hidden = false; $("openTitle").textContent = title; $("openText").textContent = text || ""; }
    function showAlert(text, actions, kind) {
        $("detailAlert").hidden = false; $("detailAlert").dataset.kind = kind || "error";
        $("detailAlertText").textContent = text;
        const box = $("detailAlertActions"); box.replaceChildren();
        for (const a of actions || []) { const b = el("button", { type: "button", class: a.primary ? "ro-primary" : "ro-quiet", text: a.label }); b.addEventListener("click", a.run); box.append(b); }
    }
    function hideAlert() { $("detailAlert").hidden = true; }
    function headerFromRow() {
        const r = state.row, b = state.base;
        $("detailTitle").textContent = "RO " + state.doc;
        const name = b ? b.name : r ? r.name : "";
        const total = b ? money(b.totalCents) : r ? r.total : "";
        $("detailSub").textContent = [name, total].filter(Boolean).join(" · ");
    }
    async function openDetail(doc, force) {
        const token = ++state.token;
        if (state.sheetDoc && state.sheetDoc !== doc) closeSheet();
        state.doc = doc; state.row = state.rows.find(r => r.doc === doc) || null; state.base = null; state.draft = emptyDraft(); state.sent = null; state.reviewNext = null;
        $("roForm").hidden = true; $("openCard").hidden = true; hideAlert(); $("readLine").textContent = "";
        showView("detail"); headerFromRow(); window.scrollTo(0, 0);
        // A save still being followed (or never seen to end) for this Repair Order: followed again first.
        const pending = pendingOf(doc), saved = store("local", DRAFT_KEY + doc);
        const cached = store("session", SNAP_KEY + doc);
        // A copy from a moment ago is shown at once, unless a save may have changed the Repair Order since.
        const trusted = cached && cached.snapshot && cached.snapshot.doc === doc && !pending && !tracks[doc] && !(saved && saved.sent);
        if (trusted) setBase(cached.snapshot, cached.at, true);
        if (pending) { openSheet(doc); track(pending, false); }
        if (force || !trusted || Date.now() - cached.at > FRESH_MS) await readFromCostar(token);
    }
    const reading = () => state.readingToken !== 0 && state.readingToken === state.token;
    async function readFromCostar(token) {
        if (state.readingToken === token || token !== state.token) return;
        state.readingToken = token; updateSaveBar(); hideAlert();
        showOpen(state.base ? "Reading it again from COSTAR…" : "Opening in COSTAR…", "Sent to the desk PC");
        // 2.6.1: the helper sends the Repair Order as soon as it is read; it is shown then, while COSTAR
        // closes it (the read ends with that close).
        let early = null, offered = false;
        const show = s => {
            if (token !== state.token) return;
            const left = !offered && s.status === "queued" && /Repair Order is open/i.test(s.waiting || s.message || "") ? anyLeftOpen(state.doc) : null;
            if (left) {
                // The helper only says that a Repair Order is open; this phone knows which one it left open.
                offered = true;
                showAlert("A Repair Order is open in COSTAR Tempe, so the RDP helper is waiting. Your phone left RO " + left + " open there (COSTAR didn't close it). If that's the one, close it here, or at the PC:",
                    [{ label: "Close RO " + left + " in COSTAR", primary: true, run: () => { hideAlert(); closeInCostar(left); } }], "warn");
            }
            if (!early && s.status === "working" && s.snapshot && s.snapshot.doc === state.doc) {
                early = s.snapshot.sig; state.closingToken = token;
                $("openCard").hidden = true; setBase(s.snapshot, Date.now(), false); updateSaveBar();
                return;
            }
            if (early) return;
            if (s.status === "queued") showOpen("Waiting for the RDP helper…", s.waiting || s.message);
            else if (s.status === "working") showOpen("Opening in COSTAR…", s.progress || s.message);
        };
        try {
            let status = await ask("open", state.doc);
            if (token !== state.token) return;
            show(status);
            status = await follow(status, show, token);
            // Only the Repair Order this was asked for, and only while it is still the one on screen.
            if (status === undefined || token !== state.token) return;
            $("openCard").hidden = true;
            const again = [{ label: "Try again", primary: true, run: () => readFromCostar(state.token) }];
            if (status === null) { if (!early) showAlert("The desk PC lost track of this (it may have restarted).", again); }
            else if (status.status === "done" && status.snapshot) {
                // Shown already unless COSTAR's copy changed in between: the form isn't drawn again under the fingers.
                if (status.snapshot.sig !== early) setBase(status.snapshot, Date.now(), false);
                markLeft(state.doc, !!status.leftOpen); if (!status.leftOpen && offered) hideAlert();
                if (status.leftOpen) showAlert(status.message || "COSTAR didn't close it again.", [{ label: "Close it in COSTAR", primary: true, run: () => { hideAlert(); closeInCostar(state.doc); } }], "warn");
            }
            else showAlert(status.message || "COSTAR couldn't open it.", again, early ? "warn" : "error");
        } catch (error) {
            if (token !== state.token) return;
            $("openCard").hidden = true;
            if (!early) showAlert(error.message, [{ label: "Try again", primary: true, run: () => readFromCostar(state.token) }]);
        } finally {
            if (state.readingToken === token) state.readingToken = 0;
            if (state.closingToken === token) state.closingToken = 0;
            if (token === state.token) { updateSaveBar(); reviewIfAsked(); }
        }
    }
    // The Repair Order as COSTAR holds it: the form shows it, with this phone's unsaved changes on top.
    // cached: a copy from a moment ago (not proof of what COSTAR holds now).
    function setBase(snapshot, at, cached) {
        if (!snapshot || snapshot.doc !== state.doc) return;
        const doc = snapshot.doc, previous = state.base && state.base.doc === doc ? state.base : null;
        state.base = snapshot; state.readAt = at;
        if (!cached) store("session", SNAP_KEY + doc, { snapshot, at });
        let draft = null, restoredAt = 0;
        if (previous) { if (countChanges()) draft = state.draft; }
        else {
            const saved = store("local", DRAFT_KEY + doc);
            if (saved && saved.draft && Date.now() - saved.at < DRAFT_MS) { draft = saved.draft; state.sent = saved.sent || null; restoredAt = saved.at; }
            else { state.draft = emptyDraft(); state.sent = null; }
        }
        // Nothing of a sent save can be in COSTAR only while a read made just now still has the fingerprint
        // that save was made on. Otherwise its new lines and lines taken out are left out (said).
        const untouched = !state.sent || (!cached && snapshot.sig === state.sent.sig);
        const result = draft ? rebase(draft, snapshot, untouched) : null;
        if (result) state.draft = result.draft;
        // Read just now with no save of it open: what is left of the draft is only "set this to that"
        // (new lines and lines taken out kept only if nothing went in), so nothing can go in twice now.
        if (!cached && !saveOpen(doc)) state.sent = null;
        if (result || previous === null) persistDraft(restoredAt || Date.now());
        if (result && result.dropped.length) showAlert("Left out of your changes, because the Repair Order changed in COSTAR" + (result.droppedAdds ? " (what a save already put in is not sent again)" : "") + ": " + result.dropped.join("; ") + ". Check the lines and do them again if they're still needed.", [{ label: "OK", run: hideAlert }], "warn");
        else if (result && restoredAt && countChanges() > 0) toast("Your unsaved changes from " + ago(restoredAt) + " are back.");
        $("readLine").textContent = cached ? "As COSTAR showed it " + ago(at) + "." : "Read from COSTAR " + ago(at) + ".";
        headerFromRow(); renderForm(); showView("detail");
    }
    // A line's fingerprint: what the phone was shown for it (code, words, quantity, price).
    const priceOf = line => norm(line.code) === "F" ? line.list : line.net;
    const lineKey = line => [norm(line.code), norm(line.description), num(line.qty), String(cents(priceOf(line)))].join("|");
    const lineWords = line => [line.code, line.description].filter(Boolean).join(" ");
    // A draft put on a newer read. Box values stay unless they now match it (nothing to change) or the
    // box can't be changed now. A line change follows its line by what that line held (its fingerprint)
    // and, among lines that look the same, by which of them it was: only while there are still exactly as
    // many of them; never by its place alone. One that doesn't fit is left out and said (unless it is
    // already as asked). New lines and lines taken out stay only when nothing of this draft can be in
    // COSTAR yet (keep); otherwise they are left out and said.
    function rebase(draft, base, keep) {
        const d = JSON.parse(JSON.stringify(draft || emptyDraft())), dropped = [], cannot = base.cannot || {}, lines = base.lines || [];
        d.header = d.header || {}; d.lines = d.lines || {}; d.add = Array.isArray(d.add) ? d.add : [];
        for (const k of Object.keys(d.header)) {
            if (!HEADER_KEYS.includes(k) || same(k, d.header[k], base[k])) delete d.header[k];
            else if (cannot[k]) { delete d.header[k]; dropped.push(LABELS[k] + " (it can't be changed from the phone now)"); }
        }
        for (const k of JOB_KEYS) {
            if (d[k] === undefined) continue;
            const why = CAR_KEYS.includes(k) ? cannot.car : cannot[k];
            if (same(k, d[k], baseValue(base, k))) delete d[k];
            else if (why) { delete d[k]; dropped.push(LABELS[k] + " (it can't be changed from the phone now)"); }
        }
        const kept = {};
        for (const [i, c] of Object.entries(d.lines)) {
            const usable = l => l && l.kind !== "car" && l.kind !== "det" && norm(l.code) === norm(c.code);
            const what = (c.remove ? "taking out " : "the change to ") + (c.desc ? c.code + " " + c.desc : "line " + c.code);
            if (c.remove && !keep) {
                // It may be out already (a save went in part way): never sent again on a guess.
                if (lines.some(l => usable(l) && norm(l.description) === norm(c.desc))) dropped.push(what);
                continue;
            }
            let at = -1, why = "";
            if (c.key) {
                const hits = []; lines.forEach((l, j) => { if (usable(l) && lineKey(l) === c.key) hits.push(j); });
                const twins = c.twins || 1, nth = c.nth || 0;
                if (hits.length === twins && nth < hits.length) at = hits[nth];
                else why = hits.length > 1 || twins > 1 ? " (the lines that look the same changed)" : " (its line changed in COSTAR)";
            } else if (usable(lines[Number(i)])) at = Number(i);
            if (at < 0 || kept[at]) {
                const done = !c.remove && lines.some(l => usable(l) && (c.qty === undefined || num(c.qty) === num(l.qty)) && (c.price === undefined || cents(c.price) === cents(priceOf(l))) && (c.text === undefined || norm(c.text) === norm(l.description)));
                const gone = c.remove && !lines.some(l => usable(l) && norm(l.description) === norm(c.desc));
                if (!done && !gone) dropped.push(what + (why || ""));
                continue;
            }
            const line = lines[at];
            if (c.qty !== undefined && num(c.qty) === num(line.qty)) delete c.qty;
            if (c.price !== undefined && cents(c.price) === cents(priceOf(line))) delete c.price;
            if (c.text !== undefined && norm(c.text) === norm(line.description)) delete c.text;
            if (!c.remove && c.qty === undefined && c.price === undefined && c.text === undefined) continue;
            kept[at] = c;
        }
        d.lines = kept;
        let droppedAdds = false;
        if (!keep && d.add.length) { dropped.push(d.add.length === 1 ? "the new line " + addWords(d.add[0]) : "the " + d.add.length + " new lines"); d.add = []; droppedAdds = true; }
        return { draft: d, dropped, droppedAdds: droppedAdds || dropped.some(x => /^taking out /.test(x)) && !keep };
    }
    function baseValue(b, key) {
        if (key === "dateIn") { const d = parseDate(b.dateIn); return d ? iso(d) : ""; }
        return b[key] ?? "";
    }
    function same(key, a, b) {
        if (key === "phone") return digits(a) === digits(b);
        if (key === "email") return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
        if (key === "customerWaiting" || key === "dateIn") return String(a ?? "") === String(b ?? "");
        return norm(a) === norm(b);
    }
    const addWords = a => a.kind === "item" ? norm(a.code) + (a.qty ? " × " + num(a.qty) : "") : "note \"" + norm(a.text) + "\"";

    // ---------- the form ----------
    function fieldBox(key) { return document.querySelector('.ro-field[data-key="' + key + '"]'); }
    function inputOf(key) { return document.querySelector('#roForm [name="' + key + '"]'); }
    function renderForm() {
        const b = state.base, d = state.draft, cannot = b.cannot || {}, limits = b.limits || {};
        $("roForm").hidden = false;
        for (const key of HEADER_KEYS.concat(["makeModel", "rego", "odometer", "shipVia", "dateIn"])) {
            const input = inputOf(key); if (!input) continue;
            const draftValue = HEADER_KEYS.includes(key) ? d.header[key] : d[key];
            input.value = draftValue !== undefined ? draftValue : baseValue(b, key);
            const why = CAR_KEYS.includes(key) ? cannot.car : cannot[key];
            input.disabled = !!why;
            // This Repair Order's own limit (COSTAR's box), never more than the helper takes; set anew for each.
            const max = Math.min(LIMITS[key] || Infinity, limits[key] || Infinity);
            if (Number.isFinite(max)) input.maxLength = max; else input.removeAttribute("maxlength");
            setFieldNote(key, why ? "Can't change it from the phone: " + why : "");
            markField(key);
        }
        const account = b.account ? "On COSTAR account " + b.account + "." : "";
        $("accountLine").hidden = !account; $("accountLine").textContent = account;
        $("carNote").hidden = b.det && !cannot.car;
        $("carNote").textContent = cannot.car ? "Can't change the car from the phone: " + cannot.car : !b.det ? "No DET line yet: a car entered here adds DET with its notes." : "";
        $("shopButton").disabled = !!cannot.shipVia; $("todayButton").disabled = !!cannot.dateIn;
        const waiting = d.customerWaiting !== undefined ? d.customerWaiting : b.customerWaiting;
        const sw = $("waitingSwitch"); sw.setAttribute("aria-checked", waiting === "yes" ? "true" : "false"); sw.disabled = !!cannot.customerWaiting;
        setFieldNote("customerWaiting", cannot.customerWaiting ? "Can't change it from the phone: " + cannot.customerWaiting : "");
        markField("customerWaiting");
        const facts = [];
        if (b.timeIn) facts.push("Time in " + b.timeIn);
        if (b.writtenBy) facts.push("Written by " + b.writtenBy);
        $("jobFacts").textContent = facts.join(" · ");
        $("totalLine").textContent = "Total " + money(b.totalCents);
        renderLines(); updateSaveBar();
    }
    function setFieldNote(key, text) {
        const box = fieldBox(key); if (!box) return;
        let note = box.querySelector(".ro-field-note");
        if (!text) { if (note) note.remove(); return; }
        if (!note) { note = el("small", { class: "ro-field-note" }); box.append(note); }
        note.textContent = text;
    }
    const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
    // Rules as the desk and the helper check them, said at once. limit: COSTAR's own limit for the box.
    function problemOf(key, value, limit) {
        const raw = String(value ?? ""), v = raw.trim();
        if (CONTROL.test(raw)) return "No tabs or line breaks.";
        const max = Math.min(LIMITS[key] || 120, limit || Infinity);
        if (v.length > max) return max + " letters at most.";
        switch (key) {
            case "name": return v ? "" : "The name can't be empty.";
            case "phone": return /^\+?[\d ()-]+$/.test(v) && /^\d{8,15}$/.test(digits(v)) ? "" : "8 to 15 digits.";
            case "email": return !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? "" : "Not an email address.";
            case "state": return /^(|NSW|VIC|QLD|SA|WA|TAS|NT|ACT)$/.test(v.toUpperCase()) ? "" : "NSW, VIC, QLD, SA, WA, TAS, NT or ACT.";
            case "postcode": return /^(\d{4})?$/.test(v) ? "" : "4 digits.";
            case "po": return /^[A-Za-z0-9 #/._-]*$/.test(v) ? "" : "Letters, digits, spaces and # / . _ - only.";
            case "rego": return /^[A-Za-z0-9 -]*$/.test(v) ? "" : "Letters, digits, spaces and - only.";
            case "odometer": return /^\d*$/.test(v) ? "" : "Digits only.";
            case "shipVia": return /^[A-Za-z0-9 &/.-]*$/.test(v) ? "" : "Letters, digits and & / . - only.";
            case "dateIn": { if (!v) return "Pick a date."; const d = parseDate(v), today = new Date(); return d && Math.abs(d - today) < 400 * 86400000 ? "" : "A date within a year."; }
            default: return "";
        }
    }
    function noteProblem(text) {
        const raw = String(text ?? "");
        if (CONTROL.test(raw)) return "No tabs or line breaks.";
        if (!raw.trim()) return "A note can't be empty: take the line out instead.";
        return raw.trim().length > NOTE_MAX ? NOTE_MAX + " letters at most." : "";
    }
    const qtyOk = v => /^\d{1,4}(\.\d{1,2})?$/.test(String(v).trim()) && Number(v) > 0;
    const priceOk = v => /^\d{1,6}(\.\d{1,2})?$/.test(cleanMoney(v));
    const limitOf = key => state.base && state.base.limits ? state.base.limits[key] : 0;
    function markField(key) {
        const box = fieldBox(key); if (!box || !state.base) return;
        const changed = HEADER_KEYS.includes(key) ? state.draft.header[key] !== undefined : state.draft[key] !== undefined;
        const value = HEADER_KEYS.includes(key) ? state.draft.header[key] : state.draft[key];
        const problem = changed && key !== "customerWaiting" ? problemOf(key, value, limitOf(key)) : "";
        box.classList.toggle("is-changed", changed); box.classList.toggle("is-invalid", !!problem);
        let err = box.querySelector(".ro-field-error");
        if (problem) { if (!err) { err = el("small", { class: "ro-field-error" }); box.append(err); } err.textContent = problem; }
        else if (err) err.remove();
    }
    function setValue(key, value) {
        if (locked()) { renderForm(); return; }
        const b = state.base, d = state.draft, header = HEADER_KEYS.includes(key);
        if (same(key, value, baseValue(b, key))) { if (header) delete d.header[key]; else delete d[key]; }
        else if (header) d.header[key] = value; else d[key] = value;
        markField(key); changed();
    }
    function persistDraft(at) {
        if (!state.base) return;
        const doc = state.base.doc;
        // An empty draft has nothing that could go in twice, unless its save is still open.
        if (!countChanges() && !saveOpen(doc)) state.sent = null;
        store("local", DRAFT_KEY + doc, countChanges() ? { sig: state.base.sig, draft: state.draft, at: at || Date.now(), sent: state.sent } : null);
    }
    function changed() { persistDraft(); updateSaveBar(); }
    // Proof that nothing of save `id` is in COSTAR (it typed nothing, and it was the only copy of it).
    // It clears the draft's mark only when the mark is that save's: an earlier save of the draft that may
    // have gone in part way is not cleared by a later one that typed nothing.
    function clearSent(doc, id) {
        const saved = store("local", DRAFT_KEY + doc);
        if (saved && saved.sent && saved.sent.id === id) { saved.sent = null; store("local", DRAFT_KEY + doc, saved); }
        if (state.doc === doc && state.sent && state.sent.id === id) state.sent = null;
    }
    // Editing waits while a save of this Repair Order is open: what was sent is what goes in.
    const locked = () => !!state.base && saveOpen(state.base.doc);

    // ---------- lines ----------
    // A line change remembers what its line held and, among lines that look the same, which one it was.
    function lineDraft(i) {
        if (state.draft.lines[i]) return state.draft.lines[i];
        const line = state.base.lines[i], key = lineKey(line), twins = [];
        state.base.lines.forEach((l, j) => { if (l.kind === line.kind && lineKey(l) === key) twins.push(j); });
        return (state.draft.lines[i] = { code: line.code, key, desc: line.description || "", twins: twins.length, nth: Math.max(0, twins.indexOf(i)) });
    }
    function tidyLine(i) { const c = state.draft.lines[i]; if (c && !c.remove && c.qty === undefined && c.price === undefined && c.text === undefined) delete state.draft.lines[i]; }
    function renderLines() {
        const b = state.base, d = state.draft, list = $("lines"); list.replaceChildren();
        b.lines.forEach((line, i) => {
            if (line.kind === "car") return;
            const c = d.lines[i] || {}, n = line.n || i + 1, removed = !!c.remove;
            if (line.kind === "det") {
                list.append(el("li", { class: "ro-line is-det" }, el("span", { class: "ro-line-no", text: String(n) }), el("b", { class: "ro-code", text: "DET" }), el("span", { class: "ro-desc", text: "Car details: see Car above" })));
                return;
            }
            const item = line.kind === "item";
            const remove = el("button", { type: "button", class: "ro-remove", "data-index": i, "aria-label": (removed ? "Keep line " : "Take out line ") + n + " " + line.code });
            remove.append(removed ? el("span", { text: "Undo" }) : trashIcon());
            const head = el("div", { class: "ro-line-head" }, el("span", { class: "ro-line-no", text: String(n) }), el("b", { class: "ro-code", text: line.code }), remove);
            const li = el("li", { class: "ro-line" + (removed ? " is-removed" : "") + (c.qty !== undefined || c.price !== undefined || c.text !== undefined ? " is-changed" : ""), "data-index": i, "data-kind": line.kind }, head);
            if (item) {
                li.append(el("p", { class: "ro-desc", text: line.description || "" }));
                const qty = el("input", { class: "ro-qty", inputmode: "decimal", value: c.qty !== undefined ? c.qty : num(line.qty), "aria-label": "Quantity of " + line.code, disabled: removed || !line.qty });
                const price = el("input", { class: "ro-price", inputmode: "decimal", value: c.price !== undefined ? c.price : (cents(priceOf(line)) != null ? (cents(priceOf(line)) / 100).toFixed(2) : ""), "aria-label": "Price each of " + line.code, disabled: removed || !priceOf(line) });
                const minus = el("button", { type: "button", class: "ro-step", "data-step": "-1", "aria-label": "One less", text: "−", disabled: removed || !line.qty });
                const plus = el("button", { type: "button", class: "ro-step", "data-step": "1", "aria-label": "One more", text: "+", disabled: removed || !line.qty });
                li.append(el("div", { class: "ro-line-edit" },
                    el("span", { class: "ro-stepper" }, minus, qty, plus),
                    el("span", { class: "ro-times", text: "×" }),
                    el("span", { class: "ro-prefix" }, el("em", { text: "$" }), price),
                    el("span", { class: "ro-line-total", text: lineTotal(c.qty !== undefined ? c.qty : line.qty, c.price !== undefined ? c.price : priceOf(line)) })));
            } else {
                li.append(el("input", { class: "ro-note", value: c.text !== undefined ? c.text : line.description, maxlength: String(NOTE_MAX), autocapitalize: "characters", "aria-label": "Note on line " + n, disabled: removed }));
            }
            if (c.qty !== undefined && !qtyOk(c.qty) || c.price !== undefined && !priceOk(c.price) || c.text !== undefined && noteProblem(c.text)) li.classList.add("is-invalid");
            list.append(li);
        });
        const fresh = $("newLines"); fresh.replaceChildren();
        d.add.forEach((a, k) => {
            const x = el("button", { type: "button", class: "ro-remove", "data-add": k, "aria-label": "Don't add this line" }, el("span", { text: "✕" }));
            const text = a.kind === "item" ? [norm(a.code), a.qty ? "× " + num(a.qty) : "", a.price ? "at " + money(cents(a.price)) : "(COSTAR's price)"].filter(Boolean).join(" ") : "Note: " + a.text;
            fresh.append(el("li", { class: "ro-line is-new" }, el("div", { class: "ro-line-head" }, el("span", { class: "ro-line-no is-plus", text: "+" }), el("b", { class: "ro-code", text: a.kind === "item" ? norm(a.code) : "M" }), x), el("p", { class: "ro-desc", text })));
        });
    }
    function lineTotal(qty, price) { const q = Number(String(qty).replace(/,/g, "")), p = cents(price); return Number.isFinite(q) && p != null ? money(Math.round(q * p)) : ""; }
    function trashIcon() {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
        const p = document.createElementNS(svg.namespaceURI, "path"); p.setAttribute("d", "M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z"); svg.append(p);
        return svg;
    }
    function onLineInput(event) {
        if (locked()) { renderForm(); return; }
        const t = event.target, li = t.closest(".ro-line"); if (!li || li.dataset.index == null) return;
        const i = Number(li.dataset.index), line = state.base.lines[i];
        if (t.classList.contains("ro-qty")) { const c = lineDraft(i); if (num(t.value) === num(line.qty)) delete c.qty; else c.qty = t.value.trim(); }
        else if (t.classList.contains("ro-price")) { const c = lineDraft(i); if (cents(t.value) === cents(priceOf(line))) delete c.price; else c.price = cleanMoney(t.value); }
        else if (t.classList.contains("ro-note")) { const c = lineDraft(i); if (norm(t.value) === norm(line.description)) delete c.text; else c.text = t.value; }
        else return;
        tidyLine(i);
        const c = state.draft.lines[i] || {};
        li.classList.toggle("is-changed", c.qty !== undefined || c.price !== undefined || c.text !== undefined);
        li.classList.toggle("is-invalid", (c.qty !== undefined && !qtyOk(c.qty)) || (c.price !== undefined && !priceOk(c.price)) || (c.text !== undefined && !!noteProblem(c.text)));
        const total = li.querySelector(".ro-line-total");
        if (total) total.textContent = lineTotal(c.qty !== undefined ? c.qty : line.qty, c.price !== undefined ? c.price : priceOf(line));
        changed();
    }
    function onLineClick(event) {
        if (locked()) return;
        const step = event.target.closest(".ro-step"), remove = event.target.closest(".ro-remove");
        if (step) {
            const li = step.closest(".ro-line"), input = li.querySelector(".ro-qty");
            const next = Math.max(1, Math.round((Number(input.value) || 0) + Number(step.dataset.step)));
            input.value = String(next); input.dispatchEvent(new Event("input", { bubbles: true }));
            return;
        }
        if (!remove) return;
        if (remove.dataset.add != null) { state.draft.add.splice(Number(remove.dataset.add), 1); renderLines(); changed(); return; }
        const i = Number(remove.dataset.index), c = lineDraft(i);
        if (c.remove) delete c.remove; else { c.remove = true; delete c.qty; delete c.price; delete c.text; }
        tidyLine(i); renderLines(); changed();
        if (state.draft.lines[i] && state.draft.lines[i].remove) toast("Line " + (state.base.lines[i].n || i + 1) + " will be taken out when you save.");
    }

    // ---------- adding a line ----------
    let addKind = "item";
    function openAdd(kind) {
        if (!state.base || locked()) return;
        addKind = kind;
        $("addTitle").textContent = kind === "item" ? "Add an item" : "Add a note";
        $("addItemFields").hidden = kind !== "item"; $("addNoteField").hidden = kind !== "note";
        $("addCode").value = ""; $("addQty").value = ""; $("addPrice").value = ""; $("addText").value = ""; $("addError").hidden = true;
        syncAddFields();
        // The dialog puts the cursor in its autofocus box as it opens (no later jump while typing).
        $("addCode").autofocus = kind === "item"; $("addText").autofocus = kind === "note";
        $("addSheet").showModal();
    }
    function syncAddFields() {
        const note = /^M /.test(norm($("addCode").value));
        $("addQty").disabled = note; $("addPrice").disabled = note;
        $("addQty").placeholder = note ? "—" : "1"; $("addPrice").placeholder = note ? "—" : "COSTAR's";
    }
    function confirmAdd(event) {
        event.preventDefault();
        const err = $("addError"); let line;
        if (addKind === "item") {
            const code = norm($("addCode").value), qty = $("addQty").value.trim(), price = cleanMoney($("addPrice").value);
            if (!/^[A-Z0-9][A-Z0-9 ._/-]{0,19}$/.test(code) || code === "DET" || code === "M") { err.textContent = code === "DET" ? "Enter the car under Car: DET is added with it." : code === "M" ? "Use + Note for a note line." : "Type a COSTAR item code."; err.hidden = false; return; }
            const memo = /^M /.test(code);
            if (!memo && qty && !qtyOk(qty)) { err.textContent = "Quantities are 0.01 to 9999."; err.hidden = false; return; }
            if (!memo && price && !priceOk(price)) { err.textContent = "Prices are dollars and cents."; err.hidden = false; return; }
            line = { kind: "item", code, qty: memo ? "" : qty, price: memo ? "" : price };
        } else {
            const text = $("addText").value, problem = noteProblem(text);
            if (problem) { err.textContent = problem === noteProblem("") ? "Type the note." : problem; err.hidden = false; return; }
            line = { kind: "note", code: "M", text: text.trim() };
        }
        if (locked()) { $("addSheet").close(); return; }
        if (state.draft.add.length >= MAX_ADDS) { err.textContent = "Add " + MAX_ADDS + " lines at most at a time: save these first."; err.hidden = false; return; }
        if (linesAfter() + 1 > MAX_LINES) { err.textContent = "COSTAR has " + MAX_LINES + " lines and this Repair Order would use them all: take a line out first."; err.hidden = false; return; }
        state.draft.add.push(line);
        $("addSheet").close(); renderLines(); changed();
        toast(line.kind === "item" ? line.code + " will be added when you save." : "The note will be added when you save.");
    }

    // ---------- changes, review and save ----------
    function countChanges() {
        const d = state.draft; if (!d) return 0;
        return Object.keys(d.header).length + JOB_KEYS.filter(k => d[k] !== undefined).length + Object.keys(d.lines).length + d.add.length;
    }
    // The filled lines after the change (COSTAR has 25), as the helper counts them.
    function linesAfter() {
        const b = state.base, d = state.draft; if (!b) return 0;
        const removed = Object.values(d.lines).filter(c => c.remove).length;
        const det = !b.det && CAR_KEYS.some(k => d[k] !== undefined) ? 4 : 0;
        return (b.lines || []).length - removed + d.add.length + det;
    }
    // What stops a save, in words for the bar ("" when nothing).
    function invalid() {
        const d = state.draft;
        for (const [k, v] of Object.entries(d.header)) if (problemOf(k, v, limitOf(k))) return "Check " + LABELS[k];
        for (const k of JOB_KEYS) if (d[k] !== undefined && k !== "customerWaiting" && problemOf(k, d[k], limitOf(k))) return "Check " + LABELS[k];
        for (const [i, c] of Object.entries(d.lines)) {
            const n = state.base.lines[Number(i)] ? state.base.lines[Number(i)].n || Number(i) + 1 : Number(i) + 1;
            if (c.qty !== undefined && !qtyOk(c.qty)) return "Check the quantity on line " + n;
            if (c.price !== undefined && !priceOk(c.price)) return "Check the price on line " + n;
            if (c.text !== undefined && noteProblem(c.text)) return "Check the note on line " + n;
        }
        if (linesAfter() > MAX_LINES) return "COSTAR has " + MAX_LINES + " lines: take a line out first";
        return "";
    }
    // A save of this Repair Order still being followed, or never seen to end.
    const saveOpen = doc => !!(tracks[doc] || pendingOf(doc));
    function updateSaveBar() {
        const bar = $("saveBar"); if (!state.base) { bar.hidden = true; document.body.classList.remove("ro-has-savebar"); return; }
        bar.hidden = $("detailView").hidden; document.body.classList.toggle("ro-has-savebar", !bar.hidden);
        const n = countChanges(), bad = invalid(), busy = saveOpen(state.base.doc);
        // 2.6.2: with no change, the review still offers Order and Print the Job Card.
        const extra = !n && (state.canPrint || Object.keys(orderPlan().set).length > 0);
        $("changeCount").textContent = n ? n + " change" + (n === 1 ? "" : "s") : "No changes";
        $("changeHint").textContent = busy ? "Your last save isn't finished yet" : bad ? bad : reading() ? (state.closingToken === state.token ? "COSTAR is closing it…" : "Reading COSTAR…") : n ? "Not in COSTAR yet" : "Edit anything above";
        $("review").disabled = (!n && !extra) || !!bad || reading() || busy;
        $("review").textContent = n ? "Review & save" : state.canPrint ? "Order / print…" : "Order…";
        $("discard").hidden = !n; $("discard").disabled = busy;
        // Nothing can be changed while a save is open: what was sent is what goes in.
        $("roForm").inert = busy; $("roForm").classList.toggle("is-locked", busy);
        bar.classList.toggle("has-changes", n > 0);
    }
    function buildEdit() {
        const b = state.base, d = state.draft;
        const edit = { schema: "tempe.ro-edit.v1", doc: b.doc, baseSig: b.sig };
        const header = {};
        for (const k of HEADER_KEYS) if (d.header[k] !== undefined) header[k] = String(d.header[k]).trim();
        if (Object.keys(header).length) edit.header = header;
        for (const k of JOB_KEYS) if (d[k] !== undefined) edit[k] = String(d[k]).trim();
        const lines = [];
        for (const [i, c] of Object.entries(d.lines)) {
            const line = b.lines[Number(i)]; if (!line) continue;
            const e = { index: Number(i), code: line.code };
            if (c.remove) e.remove = true;
            else {
                if (c.qty !== undefined) e.qty = String(c.qty).trim();
                if (c.price !== undefined) e.price = cleanMoney(c.price);
                if (c.text !== undefined) e.text = String(c.text).trim();
            }
            lines.push(e);
        }
        if (lines.length) edit.lines = lines;
        if (d.add.length) edit.add = d.add.map(a => a.kind === "item" ? Object.assign({ kind: "item", code: norm(a.code) }, a.qty ? { qty: a.qty } : {}, a.price ? { price: a.price } : {}) : { kind: "note", code: "M", text: a.text });
        return edit;
    }
    function describe() {
        const b = state.base, d = state.draft, out = [];
        const show = v => String(v ?? "").trim() || "(empty)";
        for (const k of HEADER_KEYS) if (d.header[k] !== undefined) out.push({ what: LABELS[k], from: show(b[k]), to: show(k === "email" ? String(d.header[k]).toLowerCase() : norm(d.header[k])) });
        for (const k of CAR_KEYS) if (d[k] !== undefined) out.push({ what: "Car " + LABELS[k].toLowerCase(), from: show(b[k]), to: show(norm(d[k])) });
        b.lines.forEach((line, i) => {
            const c = d.lines[i]; if (!c) return;
            const where = "Line " + (line.n || i + 1) + " · " + line.code;
            if (c.remove) {
                const was = [line.description, line.kind === "item" && line.qty ? "× " + num(line.qty) : "", line.kind === "item" && cents(priceOf(line)) != null ? "at " + money(cents(priceOf(line))) : ""].filter(Boolean).join(" ");
                out.push({ what: where, from: was || "(no words)", to: "Take out", danger: true }); return;
            }
            if (c.qty !== undefined) out.push({ what: where + " quantity", from: num(line.qty), to: num(c.qty) });
            if (c.price !== undefined) out.push({ what: where + " price", from: money(cents(priceOf(line))), to: money(cents(c.price)) });
            if (c.text !== undefined) out.push({ what: where, from: line.description, to: norm(c.text) });
        });
        for (const a of d.add) out.push(a.kind === "item" ? { what: "Add " + norm(a.code), to: [a.qty ? "× " + num(a.qty) : "", a.price ? "at " + money(cents(a.price)) : "at COSTAR's price"].filter(Boolean).join(" ") } : { what: "Add a note", to: norm(a.text) });
        if (d.shipVia !== undefined) out.push({ what: "Ship Via", from: show(b.shipVia), to: show(norm(d.shipVia)) });
        if (d.dateIn !== undefined) out.push({ what: "Date In", from: show(b.dateIn), to: fullDate(parseDate(d.dateIn)) });
        if (d.customerWaiting !== undefined) out.push({ what: "Customer Waiting", from: b.customerWaiting === "yes" ? "Ticked" : "Not ticked", to: d.customerWaiting === "yes" ? "Ticked" : "Not ticked" });
        return out;
    }
    // Try again (2.6.2): the review opens as soon as the Repair Order can be reviewed.
    function reviewIfAsked() {
        if (!state.reviewNext || state.reviewNext !== state.doc || !here(state.doc) || !state.base || reading() || saveOpen(state.doc)) return;
        state.reviewNext = null; if (!$("review").disabled) openReview();
    }
    function openReview() {
        if (!state.base || saveOpen(state.base.doc)) return;
        const items = describe(), list = $("reviewList"); list.replaceChildren();
        for (const c of items) list.append(el("li", { class: c.danger ? "is-danger" : "" }, el("b", { text: c.what }), c.from !== undefined ? el("span", { class: "ro-from", text: c.from }) : null, el("span", { class: "ro-to", text: c.to })));
        list.hidden = !items.length;
        $("reviewIntro").textContent = (items.length ? items.length + " change" + (items.length === 1 ? "" : "s") + " to " : "") + "RO " + state.base.doc + (state.base.name ? " (" + state.base.name + ")" : "") + ".";
        // 2.6.2 (Tommy, 27 Oct): both ticked each time.
        $("alsoOrder").checked = true; $("alsoPrint").checked = true;
        renderAlso();
        $("reviewSheet").showModal();
    }
    // ---------- 2.6.2: Order and Print the Job Card ----------
    // Order (Tommy, 27 Oct): Ship Via SHOP, Customer Waiting ticked, Date In (COSTAR's Repair Date) today.
    // Each part goes into the save only where the Repair Order isn't so already and isn't changed above by
    // you (your own change stays, the same as Order or not); a part the phone can't change on this Repair
    // Order is left for the PC.
    const ORDER_WORDS = { shipVia: "Ship Via SHOP", customerWaiting: "Customer Waiting ticked", dateIn: "Date In today" };
    function orderPlan() {
        const plan = { set: {}, mine: [], kept: [], already: [], byHand: [] }, b = state.base, d = state.draft;
        if (!b) return plan;
        const cannot = b.cannot || {}, want = { shipVia: "SHOP", customerWaiting: "yes", dateIn: iso(new Date()) };
        for (const k of Object.keys(want)) {
            if (d[k] !== undefined) { (same(k, d[k], want[k]) ? plan.mine : plan.kept).push(k); continue; }
            if (same(k, want[k], baseValue(b, k))) { plan.already.push(k); continue; }
            if (cannot[k]) { plan.byHand.push(k); continue; }
            plan.set[k] = want[k];
        }
        return plan;
    }
    // What goes: { kind: "edit", edit } (changes, maybe with print), { kind: "print" } (print alone) or { kind: null }.
    function finalPlan() {
        const edit = buildEdit(), print = state.canPrint && $("alsoPrint").checked;
        if ($("alsoOrder").checked) for (const [k, v] of Object.entries(orderPlan().set)) edit[k] = v;
        const changes = !!(edit.header || edit.lines || edit.add) || JOB_KEYS.some(k => edit[k] !== undefined);
        if (changes) { if (print) edit.print = true; return { kind: "edit", edit, print }; }
        return { kind: print ? "print" : null, edit: null, print };
    }
    function renderAlso() {
        if (!state.base) return;
        const plan = orderPlan(), parts = [];
        const set = Object.keys(plan.set).map(k => ORDER_WORDS[k]);
        if (set.length) parts.push(set.join(", "));
        if (plan.mine.length) parts.push("in your changes: " + plan.mine.map(k => ORDER_WORDS[k]).join(", "));
        if (plan.already.length) parts.push("already " + plan.already.map(k => ORDER_WORDS[k]).join(", "));
        if (plan.kept.length) parts.push("your " + plan.kept.map(k => LABELS[k]).join(" and ") + " above stays");
        if (plan.byHand.length) parts.push(plan.byHand.map(k => LABELS[k]).join(" and ") + ": at the PC (it can't be changed from the phone on this Repair Order)");
        const hint = parts.join(" · ");
        $("alsoOrderHint").textContent = hint ? hint.charAt(0).toUpperCase() + hint.slice(1) : "Nothing to change for it.";
        $("alsoPrintRow").hidden = !state.canPrint;
        const go = finalPlan(), n = countChanges();
        $("saveNow").disabled = !go.kind || (go.kind === "edit" && !!invalid());
        $("saveNow").textContent = go.kind === "print" ? "Print the Job Card" : go.kind === "edit" ? (go.print ? "Save and print" : "Save to COSTAR") : "Nothing to do";
        $("reviewTitle").textContent = go.kind === "print" ? "Print the Job Card?" : n || go.kind === "edit" ? "Save to COSTAR?" : "Order or print?";
        $("reviewHow").textContent = go.kind === "print" ? "The RDP helper opens this Repair Order in COSTAR, prints its Job Card and closes it again."
            : "The RDP helper opens this Repair Order in COSTAR, types " + (n ? "these changes, checks them" : "the order, checks it") + (go.print ? ", prints the Job Card" : "") + " and closes it again.";
    }
    function setStep(name, mode) { const li = document.querySelector('#saveSteps [data-step="' + name + '"]'); if (li) li.dataset.mode = mode; }
    // Where a save stopped: every step before it went through.
    function failAt(name) {
        for (const x of ["sent", "queued", "working", "done"]) { if (x === name) { setStep(x, "failed"); return; } setStep(x, "done"); }
    }
    // How far the desk PC got with it, from what the phone has seen.
    function reach(t, s) { if (s) t.reached = s.status === "working" || s.status === "done" ? "working" : t.reached || "queued"; }
    function resetSteps(p) {
        for (const li of document.querySelectorAll("#saveSteps li")) li.dataset.mode = "";
        $("saveWaiting").textContent = ""; $("saveProgress").textContent = ""; $("saveResult").hidden = true; $("saveActions").replaceChildren();
        // 2.6.2: a print with no change prints instead of typing.
        const print = !!(p && p.kind === "print"), working = document.querySelector('#saveSteps [data-step="working"]');
        if (working) for (const n of working.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { n.textContent = print ? "Printing in COSTAR" : "Typing into COSTAR"; break; }
        $("saveDoneText").textContent = print ? "Printed and closed" : "Checked and closed";
    }
    function saveActions(actions) {
        const box = $("saveActions"); box.replaceChildren();
        for (const a of actions) { const b = el("button", { type: "button", class: a.primary ? "ro-primary" : "ro-quiet", text: a.label }); b.addEventListener("click", a.run); box.append(b); }
    }
    function saveResult(kind, title, text, notes) {
        const box = $("saveResult"); box.hidden = false; box.dataset.kind = kind; box.replaceChildren(el("strong", { text: title }));
        if (text) box.append(el("p", { text }));
        if (notes && notes.length) { const ul = el("ul"); for (const n of notes) ul.append(el("li", { text: n })); box.append(el("p", { class: "ro-check", text: "Check by hand:" }), ul); }
    }
    function openSheet(doc, p) {
        state.sheetDoc = doc; resetSteps(p); $("saveTitle").textContent = p && p.kind === "print" ? "Printing the Job Card" : "Saving to COSTAR";
        if (!$("saveSheet").open) $("saveSheet").showModal();
    }
    function closeSheet() { state.sheetDoc = null; if ($("saveSheet").open) $("saveSheet").close(); updateSaveBar(); }

    // ---------- saving: written down, sent once, followed until it ends ----------
    const tracks = {};
    function pendingOf(doc) {
        const p = store("local", PENDING_KEY + doc);
        if (p && (!p.id || (!p.edit && p.kind !== "print") || p.doc !== doc || !(Date.now() - p.at < PENDING_MS))) { store("local", PENDING_KEY + doc, null); return null; }
        return p;
    }
    function save() {
        // Only from the review: what goes, Order and Print included, is what the person just saw there.
        if (!state.base || saveOpen(state.base.doc) || !$("reviewSheet").open) return;
        const go = finalPlan(); if (!go.kind || (go.kind === "edit" && invalid())) return;
        // kind (2.6.2): edit (changes, maybe with print) or print (the Job Card alone, nothing changed).
        const p = { id: "RO-" + uuid(), doc: state.base.doc, kind: go.kind, edit: go.edit, print: !!go.print, at: Date.now(), gap: false };
        // Written down before it is sent: from here on only this request (by its ID) is ever asked about,
        // and the draft remembers the fingerprint this save was made on (kept until proven not in).
        store("local", PENDING_KEY + p.doc, p);
        if (go.kind === "edit" && !state.sent) state.sent = { sig: go.edit.baseSig, id: p.id };
        persistDraft();
        $("reviewSheet").close(); openSheet(p.doc, p);
        track(p, true); updateSaveBar();
    }
    // Follows save p (send: send it first; the same ID again is never a second change) wherever the
    // phone goes; the sheet shows it while it is open for that Repair Order.
    function track(p, send) {
        let t = tracks[p.doc];
        if (t) { paintSave(t); return t; }
        t = tracks[p.doc] = { p, status: null, error: null, phase: send ? "sending" : "checking" };
        paintSave(t);
        (async () => {
            try {
                let status;
                try { status = send ? await client.roAsk(p.kind === "print" ? { id: p.id, kind: "print", doc: p.doc } : { id: p.id, kind: "edit", doc: p.doc, edit: p.edit }) : await client.roStatus(p.id); }
                catch (error) {
                    // The desk PC answered and refused it: nothing was queued.
                    if (send && error.status >= 400 && error.status < 500 && error.status !== 404 && error.status !== 408) {
                        t.phase = "refused"; t.error = error; store("local", PENDING_KEY + p.doc, null);
                        // Never queued; and with no earlier copy of it anywhere, nothing of it can be in COSTAR.
                        if (!p.gap) clearSent(p.doc, p.id);
                        return;
                    }
                    throw error;
                }
                if (status === null) { markGap(p); t.phase = "unknown"; return; }
                // 2.6.2: a print joins one of this Repair Order already waiting (one print at a time): from here
                // on that one is followed, also after a reload.
                if (send && p.kind === "print" && status.id && status.id !== p.id) { p.id = status.id; if (pendingOf(p.doc)) store("local", PENDING_KEY + p.doc, p); }
                t.status = status; reach(t, status); t.phase = "following"; paintSave(t);
                status = await follow(status, (s, error) => { t.error = error || null; if (s) { t.status = s; reach(t, s); } paintSave(t); }, null);
                if (status === null) { markGap(p); t.phase = "unknown"; return; }
                t.status = status; reach(t, status); t.error = null; t.phase = "ended";
                finishSave(p, status);
            } catch (error) { t.phase = "lost"; t.error = error; }
            finally {
                delete tracks[p.doc];
                paintSave(t);
                if (t.phase !== "ended" && t.phase !== "refused" && state.sheetDoc !== p.doc) toast("RO " + p.doc + ": " + (t.phase === "lost" ? "lost contact with the desk PC while " + (p.kind === "print" ? "printing" : "saving") + ": open it to check" : "the desk PC doesn't know your " + (p.kind === "print" ? "print" : "save") + " any more: open it to check"));
                if (here(p.doc)) updateSaveBar();
            }
        })();
        return t;
    }
    // The desk PC didn't have this save at some point (it restarted, or never got it): an earlier copy of it
    // may have gone in, so how this one ends can't prove the draft isn't in COSTAR.
    function markGap(p) { p.gap = true; if (pendingOf(p.doc)) store("local", PENDING_KEY + p.doc, p); }
    // 2.6.2: the helper's words when OK went on the print form (or may have) but how it ended isn't known.
    const MAYBE = /may have printed/i;
    // What a save that ended means for that Repair Order, whether or not the phone still shows it.
    function finishSave(p, status) {
        const doc = p.doc, changedMeanwhile = /^CHANGED:/.test(status.message || "");
        if (status.status === "failed" && /doesn't print Job Cards now/.test(status.message || "")) setCanPrint(false);
        if (status.leftOpen) markLeft(doc, true); else if (status.status === "done") markLeft(doc, false);
        store("local", PENDING_KEY + doc, null);
        if (status.status === "done") {
            // A print alone changed nothing: the draft (if any was made meanwhile) stays.
            if (p.kind !== "print") dropDraft(doc);
            if (status.snapshot) store("session", SNAP_KEY + doc, { snapshot: status.snapshot, at: Date.now() });
        } else {
            // Typed nothing, and the desk had this one copy of it all along: nothing of the draft is in COSTAR.
            if (!status.typed && !p.gap) clearSent(doc, p.id);
            // Part of it may be in COSTAR now: the copy kept here is old.
            if (status.typed) store("session", SNAP_KEY + doc, null);
            if (status.snapshot) store("session", SNAP_KEY + doc, { snapshot: status.snapshot, at: Date.now() });
        }
        delete tracks[doc];
        if (status.snapshot && state.doc === doc) setBase(status.snapshot, Date.now(), false);
        if (state.sheetDoc !== doc) {
            const words = status.message || "", maybe = MAYBE.test(words);
            const printWords = maybe ? ", the Job Card may have printed: check the printer" : /Job Card not printed/i.test(words) ? ", Job Card not printed: open it to see why" : /Job Card (printed|sent to the printer)/i.test(words) ? ", Job Card printed" : "";
            if (p.kind === "print") toast("RO " + doc + ": " + (maybe ? "the Job Card may have printed: check the printer" : status.status === "done" ? "Job Card printed" + (status.leftOpen ? " (not closed yet: open it to close it)" : "") : "Job Card not printed: open it to see why"), status.status === "done" && !maybe ? "ok" : "");
            else if (status.status === "done") toast("RO " + doc + ": " + (status.leftOpen ? "in COSTAR, not closed yet: open it to close it" : "saved to COSTAR") + printWords, "ok");
            else toast("RO " + doc + ": " + (changedMeanwhile ? "changed in COSTAR before your save: open it to check and save again" : status.typed ? "stopped part way: open it to check" : "not saved: open it to see why"));
        }
        if (here(doc)) { renderForm(); updateSaveBar(); }
    }
    function paintSave(t) {
        const doc = t.p.doc, print = t.p.kind === "print";
        if (state.sheetDoc !== doc || !$("saveSheet").open) return;
        resetSteps(t.p); $("saveTitle").textContent = print ? "Printing the Job Card" : "Saving to COSTAR";
        const s = t.status, offline = t.error ? "Can't reach the desk PC right now: " + t.error.message : "";
        if (t.phase === "sending" || t.phase === "checking") {
            setStep("sent", "active");
            $("saveProgress").textContent = offline || (t.phase === "checking" ? "Checking your save of " + clock(t.p.at) + "…" : "");
            return;
        }
        if (t.phase === "refused") {
            failAt("sent"); $("saveTitle").textContent = "Not sent";
            saveResult("error", "Not sent", t.error.message.replace(/^PC helper returned HTTP \d+\.\s*/, ""));
            saveActions([{ label: "Keep editing", primary: true, run: closeSheet }]); return;
        }
        if (t.phase === "lost") {
            failAt(t.reached || "sent"); $("saveTitle").textContent = "Lost contact";
            saveResult("warn", "Lost contact with the desk PC", "Your save may still go in. Checking again asks about this same save: it is never sent twice. (" + t.error.message + ")");
            saveActions([{ label: "Close", run: closeSheet }, { label: "Check again", primary: true, run: () => track(t.p, false) }]); return;
        }
        if (t.phase === "unknown" && print) {
            // A print can't be told from COSTAR afterwards: sent again only when asked, as a new print.
            failAt(t.reached || "sent"); $("saveTitle").textContent = "Not known";
            saveResult("warn", "The desk PC doesn't have this print", "It may have restarted, or the request never reached it, so the Job Card of " + clock(t.p.at) + " may or may not have printed. Check the printer; print again only if it didn't.");
            saveActions([
                { label: "Close", run: () => { store("local", PENDING_KEY + doc, null); closeSheet(); } },
                { label: "Print again", primary: true, run: () => { store("local", PENDING_KEY + doc, null); const again = { id: "RO-" + uuid(), doc, kind: "print", edit: null, print: true, at: Date.now(), gap: false }; store("local", PENDING_KEY + doc, again); track(again, true); } }]);
            return;
        }
        if (t.phase === "unknown") {
            failAt(t.reached || "sent"); $("saveTitle").textContent = "Not known";
            saveResult("warn", "The desk PC doesn't have this save", "It may have restarted, or the save never reached it, so your save of " + clock(t.p.at) + " may or may not be in COSTAR. Read the Repair Order again to see, or send the same save again: it only goes in if the Repair Order is still exactly as your phone read it.");
            saveActions([
                { label: "Read it again", run: () => { store("local", PENDING_KEY + doc, null); store("session", SNAP_KEY + doc, null); closeSheet(); openDetail(doc, true); } },
                { label: "Send it again", primary: true, run: () => { markGap(t.p); track(t.p, true); } }]);
            return;
        }
        setStep("sent", "done");
        if (s.status === "queued") { setStep("queued", "active"); $("saveWaiting").textContent = s.waiting || s.message || ""; }
        else if (s.status === "working" && s.snapshot && !print) {
            // 2.6.1: all of it is in and checked; COSTAR is closing the Repair Order (2.6.2: or printing first).
            for (const x of ["queued", "working"]) setStep(x, "done");
            setStep("done", "active"); $("saveDoneText").textContent = t.p.print ? "Checked; printing the Job Card…" : "Checked; closing it in COSTAR…";
            $("saveTitle").textContent = "In COSTAR and checked";
            if (s.notes && s.notes.length) saveResult("warn", "All of it is in", s.message, s.notes);
            // The sheet can go: the save is followed to its end anyway (a toast says how it ended).
            if (t.phase !== "ended") saveActions([{ label: "Done", primary: true, run: closeSheet }]);
        }
        else if (s.status === "working") { setStep("queued", "done"); setStep("working", "active"); $("saveProgress").textContent = s.progress || s.message || ""; }
        if (offline) $("saveProgress").textContent = offline;
        if (t.phase !== "ended") return;
        if (s.status === "done") {
            for (const x of ["sent", "queued", "working", "done"]) setStep(x, "done");
            // 2.6.2: what the print came to is in the helper's words (the change is in either way).
            const printing = print || t.p.print, maybe = printing && MAYBE.test(s.message || ""), notPrinted = printing && !maybe && /Job Card not printed/i.test(s.message || "");
            if (print) {
                $("saveTitle").textContent = maybe ? "Check the printer" : s.leftOpen ? "Printed, not closed" : "Job Card printed";
                $("saveDoneText").textContent = maybe ? "Printed? Check the printer" : s.leftOpen ? "Printed, not closed yet" : "Printed and closed";
                saveResult(maybe || s.leftOpen ? "warn" : "ok", maybe ? "The Job Card may have printed" : s.leftOpen ? "Printed; not closed yet" : "Job Card printed", s.message, s.notes);
            } else {
                $("saveTitle").textContent = s.leftOpen ? "In COSTAR, not closed" : maybe ? "Saved; check the printer" : notPrinted ? "Saved, not printed" : t.p.print ? "Saved and printed" : "Saved";
                $("saveDoneText").textContent = s.leftOpen ? "Checked, not closed yet" : "Checked and closed";
                saveResult(s.leftOpen || maybe || notPrinted || (s.notes && s.notes.length) ? "warn" : "ok", s.leftOpen ? "In COSTAR, not closed yet" : maybe ? "Saved to COSTAR; the Job Card may have printed" : notPrinted ? "Saved to COSTAR; Job Card not printed" : "Saved to COSTAR", s.message, s.notes);
            }
            const actions = [{ label: "Done", primary: true, run: closeSheet }];
            if (s.leftOpen) actions.unshift({ label: "Close it in COSTAR", run: () => closeInCostar(doc) });
            saveActions(actions); return;
        }
        if (print) {
            const maybe = MAYBE.test(s.message || "");
            $("saveTitle").textContent = maybe ? "Check the printer" : "Not printed";
            failAt(t.reached === "working" ? "working" : "queued");
            saveResult(maybe ? "warn" : "error", maybe ? "The Job Card may have printed" : "Job Card not printed", s.message);
            const close = s.leftOpen ? [{ label: "Close it in COSTAR", run: () => closeInCostar(doc) }] : [];
            saveActions(close.concat([{ label: "Done", run: closeSheet }])); return;
        }
        $("saveTitle").textContent = s.typed ? "Stopped part way" : "Not saved";
        failAt(s.typed || t.reached === "working" ? "working" : "queued");
        const close = s.leftOpen ? [{ label: "Close it in COSTAR", run: () => closeInCostar(doc) }] : [];
        if (/^CHANGED:/.test(s.message || "")) {
            saveResult("warn", "COSTAR's copy changed", (s.message || "").replace(/^CHANGED:\s*/, ""));
            saveActions(close.concat([{ label: "Check and save again", primary: true, run: closeSheet }]));
        } else if (s.typed) {
            saveResult("error", "Stopped part way", s.message);
            saveActions(close.concat([{ label: "Read it again", primary: true, run: () => { closeSheet(); openDetail(doc, true); } }]));
        } else {
            saveResult("error", "Not saved", s.message);
            // Again through the review: its Order and Print ticks are seen (and set) before anything goes
            // (once the Repair Order is read, when it is being read now).
            saveActions(close.concat([{ label: "Keep editing", run: closeSheet }, { label: "Try again", primary: true, run: () => { closeSheet(); if (state.doc === doc) { state.reviewNext = doc; reviewIfAsked(); } } }]));
        }
    }
    // 2.6.1: a Repair Order this phone's save or read left open in COSTAR (COSTAR didn't close it): marked
    // here, so opening it again can offer the close (the RDP helper waits while a Repair Order is open).
    function markLeft(doc, open) { store("local", LEFT_KEY + doc, open ? { at: Date.now() } : null); }
    function leftOpen(doc) { const m = store("local", LEFT_KEY + doc); return !!(m && Date.now() - m.at < DRAFT_MS); }
    // The Repair Order this phone left open most recently (this one first), or null.
    function anyLeftOpen(doc) {
        if (leftOpen(doc)) return doc;
        let best = null, at = 0;
        try {
            for (let i = 0; i < window.localStorage.length; i++) {
                const k = window.localStorage.key(i); if (!k || !k.startsWith(LEFT_KEY)) continue;
                const d = k.slice(LEFT_KEY.length), m = store("local", k);
                if (m && Date.now() - m.at < DRAFT_MS && m.at > at) { best = d; at = m.at; }
            }
        } catch (error) { return null; }
        return best;
    }
    async function closeInCostar(doc) {
        state.sheetDoc = doc; resetSteps(); $("saveTitle").textContent = "Closing it in COSTAR";
        if (!$("saveSheet").open) $("saveSheet").showModal();
        setStep("sent", "active");
        const mine = () => state.sheetDoc === doc && $("saveSheet").open;
        const at = {};
        const show = s => { reach(at, s); if (!mine()) return; setStep("sent", "done"); if (s.status === "queued") { setStep("queued", "active"); $("saveWaiting").textContent = s.waiting || ""; } else if (s.status === "working") { setStep("queued", "done"); setStep("working", "active"); $("saveProgress").textContent = s.progress || s.message || ""; } };
        let status = null, error = null;
        try { status = await ask("close", doc); show(status); status = await follow(status, show, null); }
        catch (e) { error = e; }
        // Closed (or already closed): no longer marked as left open, whether or not the sheet is still up.
        if (!error && status && status.status === "done") markLeft(doc, false);
        if (!mine()) return;
        if (error) { failAt(status ? at.reached || "queued" : "sent"); saveResult("error", status ? "Lost contact" : "Not sent", error.message); }
        else if (status && status.status === "done") { for (const s of ["sent", "queued", "working", "done"]) setStep(s, "done"); $("saveDoneText").textContent = "Closed"; saveResult("ok", "Closed", status.message); }
        else { failAt(at.reached || "queued"); saveResult("error", "Not closed", status ? status.message : "The desk PC lost track of it."); }
        // Reading it again only makes sense for the Repair Order on the screen (a waiting open of another one goes on by itself).
        const again = doc === state.doc ? [{ label: "Read it again", run: () => { closeSheet(); openDetail(doc, true); } }] : [];
        saveActions(again.concat([{ label: "Done", primary: true, run: closeSheet }]));
    }
    function dropDraft(doc) {
        store("local", DRAFT_KEY + doc, null);
        if (state.doc === doc) { state.draft = emptyDraft(); state.sent = null; }
    }

    // ---------- moving around ----------
    function route() {
        const m = /^#ro=([0-9A-Za-z-]{1,20})$/.exec(window.location.hash);
        if (m) { const doc = m[1].toUpperCase(); if (doc !== state.doc || $("detailView").hidden) openDetail(doc, false); }
        else { state.token++; if (state.sheetDoc) closeSheet(); state.doc = null; state.base = null; showView("list"); renderList(); renderMeta(); }
    }
    function goList() {
        if (state.base && countChanges()) toast("Your changes stay here as a draft until you save them.");
        if (window.history.length > 1 && /^#ro=/.test(window.location.hash) && state.cameFromList) window.history.back();
        else window.location.hash = "";
    }
    function showPairing(reason) {
        showView("list");
        setHelper("off", "This phone isn't connected to the desk PC.");
        const empty = $("listEmpty"); empty.hidden = false; empty.replaceChildren(
            el("strong", { text: "Connect this phone first" }),
            el("p", { text: reason || "On the desk PC click Show phone QR and scan the Job Card code with this phone, then come back to Repair Orders." }),
            el("a", { href: "Fitment_Planner.html", class: "ro-primary", text: "Open the Job Card" }));
        $("refreshList").disabled = true; $("search").disabled = true;
    }
    function bind() {
        $("search").addEventListener("input", e => { state.query = e.target.value; renderList(); });
        for (const chip of document.querySelectorAll(".ro-chips .ro-chip")) chip.addEventListener("click", () => {
            state.filter = chip.dataset.filter;
            for (const c of document.querySelectorAll(".ro-chips .ro-chip")) c.setAttribute("aria-pressed", c === chip ? "true" : "false");
            renderList();
        });
        $("refreshList").addEventListener("click", () => refreshList(null, true));
        $("roList").addEventListener("click", e => { const b = e.target.closest(".ro-row"); if (b) { state.cameFromList = true; window.location.hash = "ro=" + b.dataset.doc; } });
        $("backToList").addEventListener("click", goList);
        $("reopen").addEventListener("click", () => readFromCostar(state.token));
        $("roForm").addEventListener("submit", e => e.preventDefault());
        $("roForm").addEventListener("input", e => {
            const name = e.target.name;
            if (name && (HEADER_KEYS.includes(name) || JOB_KEYS.includes(name))) setValue(name, e.target.value);
            else onLineInput(e);
        });
        $("lines").addEventListener("click", onLineClick); $("newLines").addEventListener("click", onLineClick);
        $("shopButton").addEventListener("click", () => { const i = inputOf("shipVia"); i.value = "SHOP"; setValue("shipVia", "SHOP"); });
        $("todayButton").addEventListener("click", () => { const i = inputOf("dateIn"); i.value = iso(new Date()); setValue("dateIn", i.value); });
        $("waitingSwitch").addEventListener("click", () => {
            const sw = $("waitingSwitch"), on = sw.getAttribute("aria-checked") !== "true";
            sw.setAttribute("aria-checked", on ? "true" : "false"); setValue("customerWaiting", on ? "yes" : "no");
        });
        $("addItem").addEventListener("click", () => openAdd("item"));
        $("addNote").addEventListener("click", () => openAdd("note"));
        $("addForm").addEventListener("submit", confirmAdd);
        $("addCancel").addEventListener("click", () => $("addSheet").close());
        $("addCode").addEventListener("input", syncAddFields);
        for (const chip of document.querySelectorAll("#addSheet .ro-chip")) chip.addEventListener("click", () => { $("addCode").value = chip.dataset.code; syncAddFields(); $("addQty").focus(); });
        $("review").addEventListener("click", openReview);
        $("reviewCancel").addEventListener("click", () => $("reviewSheet").close());
        $("saveNow").addEventListener("click", save);
        $("alsoOrder").addEventListener("change", renderAlso); $("alsoPrint").addEventListener("change", renderAlso);
        $("discard").addEventListener("click", () => {
            if (locked() || !window.confirm("Undo all your changes to this Repair Order?")) return;
            dropDraft(state.base.doc); renderForm(); toast("Changes undone.");
        });
        // The sheet can be put away while a save goes on: it is followed all the same.
        $("saveSheet").addEventListener("close", () => { state.sheetDoc = null; updateSaveBar(); });
        window.addEventListener("hashchange", route);
        document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkHealth(); if (!$("listView").hidden) loadList(false); } });
    }
    function start() {
        if (window.TempeRoStartup) window.TempeRoStartup.ready();
        $("listView").hidden = false;
        bind();
        if (!client || !client.isPaired()) { showPairing(window.TempeCostarPairingError); return; }
        route();
        loadList(false);
        checkHealth(); setInterval(checkHealth, 15000);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
    // For the tests: the page's own rules and helpers.
    window.TempeRepairOrders = { parseDate, iso, num, cents, rebase, problemOf, noteProblem, lineKey };
})();
