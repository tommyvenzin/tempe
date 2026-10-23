/* Tempe Order Check board 1.6.2
   On the RDP PC (Order Check reader running): reads WIP from the reader and
   picking from the intranet, works out every job's status and, when signed in
   as the publisher, shares the results with the team and sends Discord alerts.
   Anywhere else: sign in and see the shared results. */
(() => {
  "use strict";
  const VERSION = "1.6.2";
  const R = window.OrderRules;
  const Share = window.OrderShare || null;
  const SHARE_CONFIG = window.ORDER_CHECK_SHARE || null;
  const Discord = window.OrderDiscord || null;
  const params = new URLSearchParams(location.search);
  const READER = (params.get("reader") || "http://127.0.0.1:8795").replace(/\/+$/, "");
  const PICKING = "https://my.tempetyres.com.au/retailpicking/history/";
  const WIP_EVERY_MS = 60000;          // the reader itself refreshes every 1–5 min
  const PICKING_EVERY_MS = 120000;     // today's picking page
  const HISTORY_DAYS = 7;              // loaded once per day
  const SEARCH_TTL_MS = 12 * 3600000;  // a "no slip in history" answer is reused for 12 h
  const SEARCHES_PER_ROUND = 40;
  const RECHECK_MS = 10 * 60000;       // a "not picked" slip from an earlier day is looked up again this often
  const RECHECKS_PER_CYCLE = 10;
  const BRIDGE_TIMEOUT_MS = 25000;     // intranet pages can be slow
  const READER_TIMEOUT_MS = 5000;      // the reader answers from memory
  const BEAT_EVERY_MS = 110000;        // "still alive" note for the team view
  const LEASE_MS = 4 * 60000;          // another board counts as sharing for this long
  const STALE_MS = 5 * 60000;          // the team view warns after this
  const STORE_KEY = "orderCheck.v1";
  const UPDATE_KEY = "orderCheck.autoUpdate";
  const LEAVE_OUT_KEY = "orderCheck.leaveOut";
  const LEAVE_OUT_DEFAULT = "MD ST UBH YTA";   // Tommy, 23 Oct: ST is the boss, MD, UBH and YTA have left

  const $ = (id) => document.getElementById(id);
  const state = {
    wip: null, wipError: "", wipAt: 0, readerOk: null,
    slips: new Map(), recordsSeen: new Set(),
    daysLoaded: new Set(), pickingError: "", pickingAt: 0, loadingDays: false,
    searched: new Map(), searching: new Set(), rechecked: new Map(),
    results: [], allResults: [], lastRed: null, expanded: new Set(), bridgeOk: null,
    prefs: { view: "action", by: "ALL", sound: false, me: "" },
    query: "",
    share: { started: false, note: "", user: null, role: "", error: "", otherPublisher: false, showForm: false, sending: false, lastShared: 0, lastSharedAt: 0 },
    cloud: { rows: null, status: null, acks: {} },
    pending: new Map(),
    lastBeat: 0, lastBeatKey: "", checkedOnce: false, updateNote: "",
  };

  // Source = this browser can read COSTAR (the reader answered at least once).
  const isSource = () => state.readerOk === true;
  const isViewer = () => !isSource() && !!state.share.role;
  const haveData = () => (isViewer() ? !!state.cloud.rows : !!state.wip);

  // ------------------------------------------------------------ storage

  function loadStore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      Object.assign(state.prefs, saved.prefs || {});
      const now = Date.now();
      for (const [key, entry] of Object.entries(saved.history || {})) {
        if (!entry || now - entry.at > SEARCH_TTL_MS) continue;
        state.searched.set(key, entry.at);
        for (const slip of entry.slips || []) addSlip(slip);
      }
    } catch { /* first run or cleared storage */ }
    const hashBy = /(?:^|&)by=([A-Za-z0-9]{1,6})/.exec(location.hash.slice(1));
    if (hashBy) state.prefs.by = hashBy[1].toUpperCase();
  }
  function saveStore() {
    try {
      const wipKeys = new Set((state.wip?.rows || []).map((r) => R.docKey(r.doc)));
      const history = {};
      for (const [key, at] of state.searched) {
        if (wipKeys.size && !wipKeys.has(key)) continue;
        history[key] = { at, slips: state.slips.get(key) || [] };
      }
      localStorage.setItem(STORE_KEY, JSON.stringify({ prefs: state.prefs, history }));
    } catch { /* storage full or blocked: the board still works */ }
  }

  // People whose jobs Order Check leaves out everywhere: this board, the team view (it only gets
  // what this board shares) and Discord. Kept on the RDP board; the link next to the salespeople edits it.
  function leaveOutText() {
    try { const v = localStorage.getItem(LEAVE_OUT_KEY); return v === null ? LEAVE_OUT_DEFAULT : v; } catch { return LEAVE_OUT_DEFAULT; }
  }
  function leaveOut() { return R.parseInitials(leaveOutText()).set; }
  function editLeaveOut() {
    const answer = prompt("Leave these salespeople out of Order Check: the board, the team view and Discord.\n\nTheir initials, separated by spaces:", [...leaveOut()].join(" "));
    if (answer === null) return;
    const parsed = R.parseInitials(answer);
    if (parsed.bad.length) { alert(`"${parsed.bad.join(" ")}" isn't initials, so nothing changed.`); return; }
    try { localStorage.setItem(LEAVE_OUT_KEY, [...parsed.set].join(" ")); } catch { /* storage blocked */ }
    evaluateAll(); render(); publish();
    alerts.lastRun = 0; runAlerts();
  }

  // ------------------------------------------------------------ network

  let bridgeCounter = 0;
  function viaExtension(url, options = {}, timeoutMs = BRIDGE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const id = `order-check-${Date.now()}-${++bridgeCounter}`;
      const timer = setTimeout(() => { window.removeEventListener("message", onMessage); reject(new Error("bridge-timeout")); }, timeoutMs);
      function onMessage(event) {
        const data = event.data;
        if (event.source !== window || !data || data.source !== "GENERAL_FETCH_BRIDGE" || data.id !== id) return;
        clearTimeout(timer); window.removeEventListener("message", onMessage);
        state.bridgeOk = true;
        const result = data.result;
        if (!result?.ok) reject(new Error(result?.error || "The extension couldn't fetch the page."));
        else resolve(result);
      }
      window.addEventListener("message", onMessage);
      window.postMessage({ source: "LOCAL_HELPER_PAGE", type: "GENERAL_FETCH_REQUEST", id, url, options }, "*");
    });
  }

  async function readerRequest(path, body) {
    const options = body === undefined
      ? { method: "GET", cache: "no-store" }
      : { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "X-Order-Check": "1" }, body: JSON.stringify(body) };
    if (state.bridgeOk !== false) {
      try {
        const result = await viaExtension(READER + path, options, READER_TIMEOUT_MS);
        if (result.status >= 400) throw new Error(errorText(result.text, result.status));
        return JSON.parse(result.text || "{}");
      } catch (error) {
        if (error.message !== "bridge-timeout") throw readerError(error);
        state.bridgeOk = false;
      }
    }
    // With team sharing on, a browser without the extension can't check picking,
    // so it shows the shared board instead of reading the reader directly.
    if (state.share.started) throw new Error("This browser shows the shared board.");
    try {
      const response = await fetch(READER + path, options);
      const text = await response.text();
      if (!response.ok) throw new Error(errorText(text, response.status));
      return JSON.parse(text || "{}");
    } catch (error) { throw readerError(error); }
  }
  function errorText(text, status) { try { return JSON.parse(text).error || `Error ${status}`; } catch { return `Error ${status}`; } }
  function readerError(error) {
    if (/Failed to fetch|NetworkError|ECONNREFUSED|ERR_CONNECTION/i.test(error.message)) {
      return new Error("Order Check isn't running on this PC. Start it with Start-OrderCheck.cmd.");
    }
    return error;
  }

  async function fetchPicking(url) {
    if (state.bridgeOk === false) throw new Error("extension");
    let result;
    try { result = await viaExtension(url, { method: "GET", cache: "no-store" }); }
    catch (error) {
      if (error.message === "bridge-timeout") { state.bridgeOk = false; throw new Error("extension"); }
      throw error;
    }
    const parsed = R.parsePicking(result.text);
    if (!parsed.ok) throw new Error("login");
    return parsed.slips;
  }

  function addSlip(slip) {
    if (!slip || !slip.docKey || state.recordsSeen.has(slip.record)) return false;
    state.recordsSeen.add(slip.record);
    if (!state.slips.has(slip.docKey)) state.slips.set(slip.docKey, []);
    state.slips.get(slip.docKey).push(slip);
    return true;
  }
  function updateSlip(slip) {
    if (!slip.docKey) return;
    if (addSlip(slip)) return;
    const list = state.slips.get(slip.docKey) || [];
    const i = list.findIndex((s) => s.record === slip.record);
    if (i >= 0) list[i] = slip;
  }

  function dayUrl(iso) {
    const d = R.parseIso(iso);
    return `${PICKING}?day=${d.getDate()}&month=${d.getMonth() + 1}&year=${d.getFullYear()}&q=&searchin=ALL`;
  }
  async function loadDay(iso) {
    const slips = await fetchPicking(dayUrl(iso));
    slips.forEach(updateSlip);
    state.daysLoaded.add(iso);
  }

  async function refreshPicking(force) {
    const today = R.isoOf(new Date());
    if (!force && Date.now() - state.pickingAt < PICKING_EVERY_MS && state.daysLoaded.has(today)) return;
    try {
      await loadDay(today);
      if (!state.loadingDays) {
        state.loadingDays = true;
        for (let i = 1; i < HISTORY_DAYS; i++) {
          const iso = R.addDays(today, -i);
          if (!state.daysLoaded.has(iso)) await loadDay(iso);
        }
        state.loadingDays = false;
      }
      state.pickingAt = Date.now();
      state.pickingError = "";
    } catch (error) {
      state.loadingDays = false;
      state.pickingError = pickingProblem(error);
    }
  }
  function pickingProblem(error) {
    if (error.message === "extension") return "The Tom does it all extension isn't answering on this page. Install the 1.0.2 update, then reload.";
    if (error.message === "login") return "The intranet sent its login page. Log in to my.tempetyres.com.au in this Chrome, then press Refresh now.";
    return `Couldn't load picking: ${error.message}`;
  }

  async function searchHistory(results) {
    const queue = results.filter((r) => r.status === "checking" && !state.searching.has(r.key)).slice(0, SEARCHES_PER_ROUND);
    if (!queue.length || state.pickingError) return false;
    let index = 0;
    async function worker() {
      while (index < queue.length) {
        const item = queue[index++];
        state.searching.add(item.key);
        try {
          const url = `${PICKING}?day=0&month=0&year=0&q=${encodeURIComponent(item.row.doc)}&searchin=Document`;
          const slips = await fetchPicking(url);
          slips.filter((s) => s.docKey === item.key).forEach(updateSlip);
          state.searched.set(item.key, Date.now());
        } catch (error) {
          state.pickingError = pickingProblem(error);
        } finally { state.searching.delete(item.key); }
      }
    }
    await Promise.all([worker(), worker()]);
    saveStore();
    return true;
  }

  // Older days' picking pages are loaded once, so a slip printed yesterday and picked today
  // would still look unpicked. Before a job stays orange, look its slips up again.
  async function recheckStuck(results) {
    if (state.pickingError) return false;
    const today = R.isoOf(new Date()), now = Date.now();
    const newestDay = (r) => r.slips.reduce((max, s) => (s.time > max ? s.time : max), "").slice(0, 10);
    const due = results.filter((r) => r.status === "warn" && r.slips && r.slips.length && newestDay(r) !== today
      && !state.searching.has(r.key) && now - (state.rechecked.get(r.key) || 0) > RECHECK_MS).slice(0, RECHECKS_PER_CYCLE);
    for (const item of due) {
      state.searching.add(item.key);
      try {
        const url = `${PICKING}?day=0&month=0&year=0&q=${encodeURIComponent(item.row.doc)}&searchin=Document`;
        const slips = await fetchPicking(url);
        slips.filter((s) => s.docKey === item.key).forEach(updateSlip);
        state.rechecked.set(item.key, Date.now());
      } catch (error) {
        state.pickingError = pickingProblem(error);
        break;
      } finally { state.searching.delete(item.key); }
    }
    if (due.length) saveStore();
    return due.length > 0;
  }

  // ------------------------------------------------------------ sharing

  const watchers = { status: null, acks: null, rows: null };

  async function startSharing() {
    if (!Share || !SHARE_CONFIG) return;
    try {
      state.share.started = await Share.start(SHARE_CONFIG, onAuth);
    } catch (error) {
      state.share.note = error.message === "file" ? "Team sharing works from the GitHub page, not from a file copy." : `Team sharing isn't available: ${error.message}`;
    }
    renderAccount();
  }

  function onAuth(info) {
    state.share.user = info.user;
    state.share.role = info.role;
    state.share.error = info.error || "";
    state.share.showForm = false;
    if (!info.role) stopWatchers();
    ensureWatchers();
    evaluateAll(); render();
    publish(true);
  }

  function ensureWatchers() {
    if (!state.share.role) return;
    const failed = (error) => {
      state.share.error = error.code === "permission-denied" ? "This account can't read the team board. Check it's in config/access." : `Team sharing stopped: ${error.message}`;
      renderAccount();
    };
    const github = Share.kind === "github";
    if (!watchers.status && !(github && isSource())) watchers.status = Share.watchStatus((s) => { state.cloud.status = s; if (isViewer() && s) maybeUpdate(s.version); evaluateAll(); render(); }, failed);
    if (isSource()) {
      if (github && watchers.status) { watchers.status(); watchers.status = null; state.cloud.status = null; }
      if (watchers.rows) { watchers.rows(); watchers.rows = null; state.cloud.rows = null; }
      if (!watchers.acks) watchers.acks = Share.watchAcks((acks) => { state.cloud.acks = acks; evaluateAll(); render(); publish(); }, failed);
    } else if (state.readerOk === false) {
      if (watchers.acks) { watchers.acks(); watchers.acks = null; state.cloud.acks = {}; }
      if (!watchers.rows) watchers.rows = Share.watchRows((rows) => { state.cloud.rows = rows; evaluateAll(); render(); }, failed);
    }
  }
  function stopWatchers() {
    for (const key of Object.keys(watchers)) { if (watchers[key]) { watchers[key](); watchers[key] = null; } }
    state.cloud = { rows: null, status: null, acks: {} };
  }

  // The RDP board shares its version. When it's newer than this page, reload once
  // with a fresh address so GitHub's cache can't serve the old files. If GitHub
  // hasn't caught up yet, wait 10 minutes before trying again (never a reload loop).
  function newerThan(a, b) {
    const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }
  function maybeUpdate(version) {
    if (!version || !newerThan(version, VERSION)) { state.updateNote = ""; return; }
    let last = {};
    try { last = JSON.parse(localStorage.getItem(UPDATE_KEY) || "{}"); } catch { /* ignore */ }
    const tries = last.to === version ? last.n || 1 : 0;
    if (tries >= 3) { state.updateNote = `Board ${version} is on GitHub. Reload this page to get it.`; return; }
    if (last.to === version && Date.now() - last.at < 10 * 60000) {
      state.updateNote = `A newer board (${version}) is on its way from GitHub. It loads by itself within 10 minutes.`;
      return;
    }
    try { localStorage.setItem(UPDATE_KEY, JSON.stringify({ to: version, at: Date.now(), n: tries + 1 })); } catch { /* ignore */ }
    const url = new URL(location.href);
    url.searchParams.set("v", version);
    location.replace(url.toString());
  }

  async function checkForUpdate() {
    if (location.protocol !== "https:") return;
    try {
      const res = await fetch(`order-check.js?check=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const found = /const VERSION = "([\d.]+)"/.exec(await res.text());
      if (found) { maybeUpdate(found[1]); render(); }
    } catch { /* offline: try again later */ }
  }

  function canPublish() {
    if (!Share || state.share.role !== "publisher" || !isSource() || !state.wip || state.wipError) return false;
    // Never share before Order Check has really read COSTAR, and never let a list
    // that suddenly drops to nothing wipe what the team is looking at.
    if (!state.wip.readAt || !Array.isArray(state.wip.rows)) return false;
    if (!state.checkedOnce) return false;   // wait until picking and the history search have run once
    // Don't share jobs that are still being checked (for example at midnight, when tomorrow's
    // bookings become today's): wait for the search, unless the team hasn't had an update for 5 minutes.
    const halfChecked = !state.pickingError && state.results.some((r) => r.status === "checking");
    if (halfChecked && Date.now() - state.share.lastSharedAt < 5 * 60000) return false;
    if (!state.wip.rows.length && state.share.lastShared >= 5) return false;
    if (Share.kind === "github") return true;   // GitHub mode checks who saved last when it saves
    const s = state.cloud.status;
    const other = !!(s && s.tab && s.tab !== Share.tab && Date.now() - Share.toMs(s.beatAt) < LEASE_MS);
    if (other !== state.share.otherPublisher) { state.share.otherPublisher = other; renderAccount(); }
    return !other;
  }

  let publishing = false, publishAgain = false;
  async function publish(force) {
    if (!canPublish()) return;
    if (publishing) { publishAgain = true; return; }
    publishing = true;
    state.share.sending = true;
    try {
      await Share.publish(state.results);
      const problems = currentProblems(true);
      const key = JSON.stringify(problems) + (state.wip.readAt || "");
      if (force || key !== state.lastBeatKey || Date.now() - state.lastBeat > BEAT_EVERY_MS) {
        await Share.beat({ readAt: state.wip.readAt || "", jobs: state.wip.jobs || 0, pickingAt: state.pickingAt || 0, problems, version: VERSION });
        state.lastBeat = Date.now(); state.lastBeatKey = key;
      }
      if (/^Sharing failed/.test(state.share.error)) state.share.error = "";
      state.share.lastShared = state.results.length;
      state.share.lastSharedAt = Date.now();
      if (Share.kind === "github") state.share.otherPublisher = false;
    } catch (error) {
      if (error.code === "other-board") state.share.otherPublisher = true;
      else state.share.error = `Sharing failed: ${error.message}`;
    } finally {
      publishing = false; state.share.sending = false;
      renderAccount();
      if (publishAgain) { publishAgain = false; publish(); }
    }
  }

  // ------------------------------------------------------------ Discord alerts (RDP board only)

  const alerts = { busy: false, error: "", retryAt: 0, lastSent: 0, lastRun: 0 };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Two tabs of this board in one Chrome share the same storage: only one of them sends.
  const ALERT_LOCK_KEY = "orderCheck.discord.lock";
  const TAB_ID = Math.random().toString(36).slice(2, 12);
  function holdAlertLock() {
    try {
      const now = Date.now();
      const lock = JSON.parse(localStorage.getItem(ALERT_LOCK_KEY) || "null");
      if (lock && lock.tab !== TAB_ID && now - lock.at < 3 * 60000) return false;
      localStorage.setItem(ALERT_LOCK_KEY, JSON.stringify({ tab: TAB_ID, at: now }));
      return JSON.parse(localStorage.getItem(ALERT_LOCK_KEY)).tab === TAB_ID;
    } catch { return true; }
  }
  window.addEventListener("pagehide", () => {   // closing or reloading hands over straight away
    try { const lock = JSON.parse(localStorage.getItem(ALERT_LOCK_KEY) || "null"); if (lock && lock.tab === TAB_ID) localStorage.removeItem(ALERT_LOCK_KEY); } catch { /* ignore */ }
  });
  function boardLink() {
    return location.protocol === "https:" ? location.origin + location.pathname : "https://tommyvenzin.github.io/tempe/Order_Check.html";
  }
  // Only the board that reads COSTAR (and shares with the team) sends, and only from fresh data:
  // a WIP read in the last 10 minutes and picking checked in the last 6.
  function alertsReady() {
    const w = state.wip, now = Date.now();
    if (!Discord || !isSource() || !state.checkedOnce || !w || state.wipError || state.pickingError || state.share.otherPublisher) return false;
    const readAt = Date.parse(w.readAt || "");
    return Number.isFinite(readAt) && now - readAt < 10 * 60000 && state.pickingAt > 0 && now - state.pickingAt < 6 * 60000;
  }
  async function discordCall(method, url, body) {
    const result = await viaExtension(url, { method, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let data = null;
    try { data = result.text ? JSON.parse(result.text) : null; } catch { /* not JSON */ }
    return { status: result.status, data };
  }
  function discordProblem(res) {
    if (res.status === 401 || res.status === 404) return "Discord refused the webhook link (deleted, or copied wrong). Paste a new one under Discord alerts.";
    return `Discord answered ${res.status}${res.data && res.data.message ? `: ${res.data.message}` : ""}.`;
  }

  async function runAlerts() {
    if (!Discord || alerts.busy || Date.now() < alerts.retryAt || Date.now() - alerts.lastRun < 15000) return;
    const cfg = Discord.loadSettings();
    const hook = Discord.parseWebhook(cfg.url);
    if (!cfg.on || !hook || !alertsReady() || !holdAlertLock()) return;
    alerts.busy = true; alerts.lastRun = Date.now();
    try {
      const now = new Date(), w = state.wip;
      const ctx = {
        nowMs: now.getTime(), today: R.isoOf(now), shopHours: Discord.inShopHours(now), boardUrl: boardLink(),
        wipComplete: w.state === "ok" && !w.filter && Array.isArray(w.rows) && w.rows.length > 0, leaveOut: leaveOut(),
      };
      const p = Discord.plan(state.allResults, Discord.loadSent(), cfg, ctx);
      const st = p.state;
      Discord.saveSent(st);
      for (const post of p.posts) {
        const res = await discordCall("POST", `${hook.url}?wait=true`, Discord.postBody(post));
        if (res.status === 429) { alerts.retryAt = Date.now() + 60000; break; }
        if (res.status >= 300 || !res.data || !res.data.id) throw new Error(discordProblem(res));
        Discord.recordPost(st, post, String(res.data.id), ctx.nowMs);
        Discord.saveSent(st);
        alerts.lastSent = Date.now();
        await pause(800);
      }
      for (const id of p.patches) {
        if (Date.now() < alerts.retryAt) break;
        const res = await discordCall("PATCH", `${hook.url}/messages/${id}`, Discord.editBody(st, id));
        if (res.status === 404 && res.data && res.data.code === 10008) Discord.forget(st, id);   // someone deleted the message
        else if (res.status === 429) { alerts.retryAt = Date.now() + 60000; break; }
        else if (res.status >= 300) throw new Error(discordProblem(res));
        else Discord.edited(st, id);
        Discord.saveSent(st);
        await pause(800);
      }
      for (const id of p.deletes || []) {   // every line in it belonged to someone now left out
        if (Date.now() < alerts.retryAt) break;
        const res = await discordCall("DELETE", `${hook.url}/messages/${id}`);
        if (res.status === 429) { alerts.retryAt = Date.now() + 60000; break; }
        if (res.status >= 300 && !(res.status === 404 && res.data && res.data.code === 10008)) throw new Error(discordProblem(res));
        Discord.deleted(st, id);
        Discord.saveSent(st);
        await pause(800);
      }
      alerts.error = "";
    } catch (error) {
      alerts.error = `Discord alerts: ${error.message === "bridge-timeout" ? "the extension didn't answer." : error.message}`;
      alerts.retryAt = Date.now() + 5 * 60000;
    } finally {
      alerts.busy = false;
      renderDiscordButton(); renderFeed();
    }
  }

  function renderDiscordButton() {
    const button = $("openDiscord");
    const show = !!Discord && isSource();
    button.hidden = !show;
    if (!show) { $("discord").hidden = true; return; }
    const cfg = Discord.loadSettings();
    const on = cfg.on && !!Discord.parseWebhook(cfg.url);
    button.textContent = alerts.error ? "Discord alerts: problem" : on ? "Discord alerts on" : "Discord alerts";
    button.classList.toggle("is-on", on && !alerts.error);
    button.classList.toggle("is-bad", !!alerts.error);
  }
  function setDiscordMsg(text, good) { const m = $("dcMsg"); m.textContent = text || ""; m.classList.toggle("is-good", !!good); }
  function openDiscord() {
    const cfg = Discord.loadSettings();
    $("dcUrl").value = cfg.url; $("dcPeople").value = cfg.people;
    $("dcOn").checked = cfg.url ? !!cfg.on : true;
    setDiscordMsg(alerts.error || (alerts.lastSent ? `Last alert sent ${timeOf(alerts.lastSent)}.` : ""), !alerts.error);
    $("discord").hidden = false;
    $("discord").scrollIntoView({ block: "start" });
    $("dcUrl").focus();
  }
  function discordForm() {
    const url = $("dcUrl").value.trim(), people = $("dcPeople").value;
    const hook = Discord.parseWebhook(url);
    return { cfg: { url: hook ? hook.url : url, people, on: $("dcOn").checked }, hook, parsed: Discord.parsePeople(people) };
  }
  function formProblem(f, needLink) {
    if ((f.cfg.url || needLink) && !f.hook) return "That isn't a Discord webhook link. Copy it again: Edit Channel, Integrations, Webhooks, Copy Webhook URL.";
    if (f.parsed.bad.length) return `Not understood: ${f.parsed.bad.slice(0, 3).join("; ")}. Write each line like MOR = 123456789012345678.`;
    return "";
  }
  function saveDiscord() {
    const f = discordForm();
    const problem = formProblem(f, false);
    if (problem) { setDiscordMsg(problem); return; }
    const before = Discord.parseWebhook(Discord.loadSettings().url);
    if (!before || !f.hook || before.url !== f.hook.url) Discord.saveSent(Discord.emptyState());   // another channel: start fresh
    Discord.saveSettings(f.cfg);
    alerts.error = ""; alerts.retryAt = 0; alerts.lastRun = 0;
    const n = Object.keys(f.parsed.people).length;
    setDiscordMsg(!f.hook ? "Saved without a webhook link, so alerts are off."
      : f.cfg.on ? `Saved. Alerts are on${n ? `, tagging ${n} ${n === 1 ? "person" : "people"}` : ""}.` : "Saved. Alerts are off.", true);
    renderDiscordButton(); renderFeed();
    runAlerts();
  }
  async function testDiscord() {
    const f = discordForm();
    const problem = formProblem(f, true);
    if (problem) { setDiscordMsg(problem); return; }
    setDiscordMsg("Sending…", true);
    try {
      const res = await discordCall("POST", `${f.hook.url}?wait=true`, Discord.testBody(f.cfg, { boardUrl: boardLink(), leaveOut: leaveOut() }));
      if (res.status >= 300) throw new Error(res.status === 429 ? "Discord is busy. Try again in a minute." : discordProblem(res));
      setDiscordMsg("Sent. In the channel every tag should show a name. \"@unknown-user\" means a wrong ID, or that person hasn't joined yet.", true);
    } catch (error) {
      setDiscordMsg(error.message === "bridge-timeout" ? "The extension didn't answer. Reload this page and try again." : error.message);
    }
  }

  // ------------------------------------------------------------ main loop

  let busy = false;
  async function cycle(forcePicking) {
    if (busy) return;
    busy = true;
    try {
      if (state.bridgeOk !== false || state.readerOk) {
        try {
          state.wip = await readerRequest("/wip.json");
          state.wipError = ""; state.wipAt = Date.now(); state.readerOk = true;
        } catch (error) {
          state.wipError = error.message;
          if (state.readerOk !== true) state.readerOk = false;
        }
      } else if (state.readerOk === null) state.readerOk = false;
      ensureWatchers();
      evaluateAll(); render();
      if (!isSource()) return;
      await refreshPicking(forcePicking);
      evaluateAll(); render();
      // Keep searching until nothing is left "checking" (or a round makes no progress).
      for (let round = 0; round < 3; round++) {
        const before = state.results.filter((r) => r.status === "checking").length;
        if (!before || !(await searchHistory(state.results))) break;
        evaluateAll(); render();
        if (state.results.filter((r) => r.status === "checking").length >= before) break;
      }
      if (await recheckStuck(state.results)) { evaluateAll(); render(); }
      state.checkedOnce = true;
      await publish(true);
      await runAlerts();
    } finally { busy = false; }
  }

  function fromCloud(data) { return { ...data, doc: data.row.doc, key: R.docKey(data.row.doc) }; }

  function evaluateAll() {
    const now = Date.now();
    if (isViewer()) {
      state.results = state.cloud.rows ? [...state.cloud.rows.values()].filter((d) => d && d.row).map(fromCloud).sort(R.compare) : [];
      state.allResults = state.results;
    } else {
      for (const [key, at] of state.searched) if (now - at > SEARCH_TTL_MS) state.searched.delete(key);
      const acks = { ...(state.wip?.acks || {}), ...state.cloud.acks };
      const ctx = { today: R.isoOf(new Date()), nowMs: now, slips: state.slips, searched: state.searched, acks };
      state.allResults = (state.wip?.rows || []).map((row) => R.evaluate(row, ctx)).sort(R.compare);
      const out = leaveOut();
      state.results = out.size ? state.allResults.filter((r) => !out.has(String(r.row.by || "").trim().toUpperCase())) : state.allResults.slice();
    }
    applyPending(now);
    const alerts = new Set(state.results.filter((r) => r.status === "red" || r.status === "warn").map((r) => `${r.status}|${r.row.doc}`));
    if (state.lastRed && state.prefs.sound) {
      for (const key of alerts) if (!state.lastRed.has(key)) { chime(); break; }
    }
    if (haveData()) state.lastRed = alerts;
  }

  // Shows a Mark OK or Undo straight away while it travels to the RDP board and back.
  function applyPending(now) {
    for (const [doc, p] of state.pending) {
      const i = state.results.findIndex((r) => r.row.doc === doc);
      const r = i >= 0 ? state.results[i] : null;
      const done = !r || (p.kind === "ok" ? r.status === "ok" : r.status !== "ok");
      if (done || now - p.at > 10 * 60000) { state.pending.delete(doc); continue; }
      state.results[i] = p.kind === "ok"
        ? { ...r, status: "ok", label: "Marked OK", reason: "Saving. The RDP board confirms it within a minute." }
        : { ...r, label: "Undoing", reason: "Saving. The RDP board confirms it within a minute." };
    }
  }

  function chime() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.frequency.value = 880; gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    } catch { /* audio blocked until the page is clicked once */ }
  }

  // ------------------------------------------------------------ rendering

  const VIEWS = {
    action: (r) => r.status === "red" || r.status === "warn" || r.status === "new" || r.status === "checking",
    warn: (r) => r.status === "warn",
    amber: (r) => r.status === "amber",
    green: (r) => r.status === "green",
    ok: (r) => r.status === "ok",
    grey: (r) => r.status === "grey",
    all: () => true,
  };

  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function timeOf(ms) { return new Date(ms).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }); }
  // COSTAR's Doc Total: "$1,260", or "$29.95" when there are cents. Blank for no amount.
  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "";
    const digits = Math.round(Math.abs(n) * 100) % 100 ? 2 : 0;
    return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function render() {
    renderAccount();
    renderFeed();
    renderDiscordButton();
    const people = new Map();
    for (const r of state.results) {
      const by = (r.row.by || "?").toUpperCase();
      if (!people.has(by)) people.set(by, { red: 0, warn: 0, total: 0 });
      const p = people.get(by); p.total++; if (r.status === "red") p.red++; if (r.status === "warn") p.warn++;
    }
    if (state.prefs.by !== "ALL" && haveData() && !people.has(state.prefs.by)) people.set(state.prefs.by, { red: 0, warn: 0, total: 0 });
    const mine = state.results.filter((r) => state.prefs.by === "ALL" || (r.row.by || "?").toUpperCase() === state.prefs.by);
    const counts = { red: 0, warn: 0, pending: 0, amber: 0, green: 0, ok: 0, grey: 0 };
    for (const r of mine) {
      if (r.status === "new" || r.status === "checking") counts.pending++;
      else if (r.status in counts) counts[r.status]++;
    }
    renderTally(counts);
    renderPeople(people);
    renderTable(mine);
    const alerts = counts.red + counts.warn;
    document.title = alerts ? `(${alerts}) Order check` : "Order check";
  }

  function currentProblems(forTeam) {
    const w = state.wip, problems = [];
    const onlyHere = ["waiting", "sleeping", "paused"];   // e.g. "You're using the WIP COSTAR window"
    if (w && w.state && w.state !== "ok" && !(forTeam && onlyHere.includes(w.state))) problems.push(w.message);
    if (w && w.state === "ok" && w.filter) problems.push(w.message);
    if (state.pickingError) problems.push(state.pickingError);
    if (!forTeam && state.updateNote) problems.push(state.updateNote);
    if (!forTeam && alerts.error) problems.push(alerts.error);
    return problems.filter(Boolean);
  }

  function renderFeed() {
    const wipLine = $("feedWip"), p = $("feedPicking");
    let problems = [];
    if (isViewer()) {
      const s = state.cloud.status;
      const beat = s ? Share.toMs(s.beatAt) : 0;
      wipLine.className = ""; p.className = "";
      wipLine.textContent = s && s.readAt ? `COSTAR read ${timeOf(Date.parse(s.readAt))}, ${s.jobs} jobs` : "Waiting for the board on the RDP PC";
      p.textContent = s && s.pickingAt ? `Picking checked ${timeOf(s.pickingAt)}` : "";
      problems = s && Array.isArray(s.problems) ? s.problems.slice() : [];
      if (state.updateNote) problems.unshift(state.updateNote);
      if (beat && Date.now() - beat > (Share.staleMs || STALE_MS)) {
        wipLine.className = "feed-warn";
        problems.unshift(`The board on the RDP PC stopped updating at ${timeOf(beat)}. Open it there to bring this up to date.`);
      }
    } else if (state.share.started && state.readerOk === false) {
      // A team member's PC: the reader isn't meant to run here, so don't mention it.
      wipLine.textContent = ""; wipLine.className = ""; p.textContent = ""; p.className = "";
    } else {
      const w = state.wip;
      if (state.wipError) { wipLine.textContent = state.wipError; wipLine.className = "feed-bad"; }
      else if (!w) { wipLine.textContent = "Connecting to Order Check…"; wipLine.className = ""; }
      else {
        const at = w.readAt ? new Date(w.readAt) : null;
        const age = at ? Math.round((Date.now() - at) / 60000) : null;
        wipLine.textContent = at ? `COSTAR read ${timeOf(at)}, ${w.jobs} jobs` : "Waiting for the first COSTAR read";
        wipLine.className = age !== null && age > Math.max(6, (w.intervalSeconds || 120) / 60 * 3) ? "feed-warn" : "";
      }
      if (state.pickingError) { p.textContent = "Picking not loaded"; p.className = "feed-bad"; }
      else if (state.pickingAt) { p.textContent = `Picking checked ${timeOf(state.pickingAt)}`; p.className = ""; }
      else { p.textContent = isSource() ? "Loading picking…" : ""; p.className = ""; }
      problems = currentProblems();
    }
    const box = $("problem");
    box.hidden = !problems.length;
    box.textContent = problems.join(" ");
    $("refresh").hidden = !isSource();
  }

  function renderTally(c) {
    const main = $("tallyMain");
    const ready = haveData();
    main.classList.toggle("is-clear", c.red === 0 && ready);
    $("countRed").textContent = ready ? c.red : "–";
    $("capRed").textContent = !ready ? (isViewer() ? "waiting for the RDP board" : "waiting for COSTAR") : c.red === 1 ? "job not ordered" : c.red ? "jobs not ordered" : "nothing missing";
    $("countWarn").textContent = c.warn;
    $("tallyWarn").classList.toggle("has-warn", c.warn > 0);
    $("countPending").textContent = c.pending;
    $("countAmber").textContent = c.amber;
    $("countGreen").textContent = c.green;
    $("countOk").textContent = c.ok;
    $("countGrey").textContent = c.grey;
    for (const b of document.querySelectorAll("[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === state.prefs.view));
  }

  function renderPeople(people) {
    const nav = $("people");
    const list = [...people.entries()].sort((a, b) => b[1].red - a[1].red || b[1].warn - a[1].warn || a[0].localeCompare(b[0]));
    const totalRed = list.reduce((n, [, p]) => n + p.red, 0);
    const totalWarn = list.reduce((n, [, p]) => n + p.warn, 0);
    const chip = (by, label, red, warn) =>
      `<button type="button" class="person" data-by="${esc(by)}" aria-pressed="${state.prefs.by === by}">${esc(label)}${red ? `<span class="person-red" aria-label="${red} not ordered">${red}</span>` : ""}${warn ? `<span class="person-warn" aria-label="${warn} not picked">${warn}</span>` : ""}</button>`;
    const out = isSource() ? [...leaveOut()] : [];
    const edit = isSource() ? `<button type="button" class="link people-out" id="editLeaveOut" title="Their jobs aren't shown, shared or sent to Discord">${out.length ? `Left out: ${esc(out.join(", "))}` : "Leave someone out"}</button>` : "";
    nav.innerHTML = chip("ALL", "Everyone", totalRed, totalWarn) + list.map(([by, p]) => chip(by, by, p.red, p.warn)).join("") + edit;
  }

  function renderTable(mine) {
    const view = VIEWS[state.prefs.view] || VIEWS.action;
    const q = state.query.trim().toUpperCase();
    const rows = mine.filter(view).filter((r) => !q || [r.row.doc, r.row.name, r.row.comment, r.helper ? r.helper.ref : ""].some((v) => String(v || "").toUpperCase().includes(q)));
    $("jobsBody").innerHTML = rows.map(rowHtml).join("");
    const empty = $("empty");
    empty.hidden = rows.length > 0 || !haveData();
    if (!rows.length && haveData()) {
      empty.textContent = q ? "No jobs match that search."
        : state.prefs.view === "action" ? "Every SHOP job with an amount has a picking slip or a reason in its comment."
        : state.prefs.view === "warn" ? "Every printed slip has been picked."
        : "No jobs in this group.";
    }
  }

  // Jobs the COSTAR helper typed in: online orders (TTW…) and mobile job cards (MJC-…).
  function helperTag(r) {
    if (!r.helper || !r.helper.ref) return "";
    const mobile = r.helper.kind === "mobile";
    return ` <span class="tag ${mobile ? "t-mobile" : "t-online"}" title="Entered by the COSTAR helper: ${esc(r.helper.ref)}">${mobile ? "Mobile" : "Online"}</span>`;
  }

  function rowHtml(r) {
    const row = r.row;
    let detail = "";
    if (r.status === "warn" && r.summary) {
      const s = r.summary;
      detail = `<span class="slip">${esc(s.headline)}</span><span class="sub">${esc(s.pick)}${s.more ? `, plus ${s.more} more slip${s.more > 1 ? "s" : ""}` : ""}</span>`;
    } else if (r.status === "green" && r.summary) {
      const s = r.summary;
      detail = `<span class="slip">${esc(s.headline)}</span><span class="sub">${esc(s.pick)}${s.progress && s.progress !== "Timed out" ? `, ${esc(String(s.progress).toLowerCase())}` : ""}${s.more ? `, plus ${s.more} more slip${s.more > 1 ? "s" : ""}` : ""}</span>`;
    } else if (r.status === "red") {
      detail = R.shortFixes(r).map((x) => `<span class="why">${esc(x)}</span>`).join("");
    } else {
      detail = `<span class="sub">${esc(r.reason || "")}</span>`;
    }
    const canAct = isSource() || (isViewer() && Share.canAck !== false);
    let action = "";
    if (canAct && (r.status === "red" || r.status === "warn")) action = `<button type="button" class="act" data-ack="${esc(row.doc)}">Mark OK</button>`;
    if (canAct && r.status === "ok" && r.label === "Marked OK") action = `<button type="button" class="act quiet" data-unack="${esc(row.doc)}">Undo</button>`;
    const open = state.expanded.has(row.doc);
    const hasSlips = r.slips && r.slips.length;
    const main = `<tr class="job s-${r.status}${hasSlips ? " has-slips" : ""}" data-doc="${esc(row.doc)}"${hasSlips ? ` aria-expanded="${open}" tabindex="0"` : ""}>
      <td class="c-status"><span class="pill">${esc(r.label)}</span></td>
      <td class="c-doc">${esc(row.doc)}${helperTag(r)}</td>
      <td class="c-name">${esc(row.name)}</td>
      <td class="c-total">${esc(money(row.total))}</td>
      <td class="c-comment" title="${esc(row.comment)}">${esc(row.comment)}</td>
      <td class="c-by">${esc(row.by)}</td>
      <td class="c-detail"${r.detail ? ` title="${esc(r.detail)}"` : ""}>${detail}</td>
      <td class="c-act">${action}</td>
    </tr>`;
    if (!open || !hasSlips) return main;
    const slips = r.slips.slice().sort((a, b) => (a.time < b.time ? 1 : -1)).map((s) => {
      const driver = Array.isArray(s.driver) && s.driver.length;
      const parts = [`Slip ${s.time}${s.manual ? " (manual)" : ""}`];
      if (s.picked) parts.push(`picked ${String(s.pickedAt).slice(11)} by ${String(s.picker).replace(/^\d+-/, "")}`);
      else if (!driver) parts.push("not picked yet");
      parts.push(String(s.progress).toLowerCase());
      if (driver) parts.push(s.driver.join(", "));
      return `<li><strong>${esc(s.qty)} × ${esc(s.desc || s.sku)}</strong> <span>${esc(s.sku)}${s.bins ? `, bins ${esc(s.bins)}` : ""}</span>
        <span>${esc(parts.join(", "))}</span></li>`;
    }).join("");
    return main + `<tr class="slips"><td colspan="8"><ul>${slips}</ul></td></tr>`;
  }

  function renderAccount() {
    const s = state.share;
    const github = !!(Share && Share.kind === "github");
    const box = $("account");
    let html = "";
    if (s.note) html = `<span class="acct-what">${esc(s.note)}</span>`;
    else if (s.started && !s.user && isSource()) html = `<button type="button" class="link" id="openSignin">${github ? "Set up sharing" : "Sign in to share with the team"}</button>`;
    else if (s.user) {
      let what = "Team view";
      if (isSource()) what = s.role === "publisher" ? (s.otherPublisher ? "Another board is already sharing" : s.sending ? "Sharing with the team…" : "Sharing with the team") : (github ? "Viewing only, not sharing" : "Signed in");
      if (s.error) what = s.error;
      const leave = github ? (s.role === "publisher" ? "Stop sharing" : "Lock") : "Sign out";
      const who = s.user.email || s.user.label || "";
      html = `${who ? `<span class="acct-who">${esc(who)}</span>` : ""}<span class="acct-what${s.error ? " is-bad" : ""}">${esc(what)}</span><button type="button" class="link" id="signOut">${leave}</button>`;
    }
    box.innerHTML = html;
    box.hidden = !html;

    // The card replaces the board when this browser has nothing else to show,
    // or opens on the RDP PC when sharing is being set up.
    const needCard = s.started && !isSource() && (!s.user || !s.role);
    const setup = s.started && !s.user && s.showForm && isSource();
    $("signin").hidden = !(needCard || setup);
    $("signinForm").hidden = !!s.user;
    $("signinNoAccess").hidden = !(s.user && !s.role);
    $("signinNoAccessText").textContent = s.error || "";
    $("signinTitle").textContent = github
      ? (setup ? "Share this board with the team" : "Enter the team passphrase")
      : (setup ? "Sign in to share with the team" : "Sign in to see the team board");
    $("rowEmail").hidden = github; $("email").required = !github;
    $("rowToken").hidden = !(github && setup); $("token").required = github && setup;
    $("passLabel").textContent = github ? "Team passphrase" : "Password";
    $("suggest").hidden = !(github && setup);
    $("forgot").hidden = github;
    $("setupHelp").hidden = !(github && setup);
    if (github && SHARE_CONFIG) $("setupRepo").textContent = `${SHARE_CONFIG.owner}/${SHARE_CONFIG.repo}`;
    $("signinSubmit").textContent = github ? (setup ? "Start sharing" : "Unlock") : "Sign in";
    if (!s.user && s.error && !$("signinMsg").textContent) $("signinMsg").textContent = s.error;
    document.body.dataset.mode = needCard ? "signin" : "board";
  }

  // ------------------------------------------------------------ actions

  async function markOk(doc) {
    const result = state.results.find((r) => r.row.doc === doc);
    if (!result) return;
    let me = state.prefs.me || (state.prefs.by !== "ALL" ? state.prefs.by : "");
    const question = result.status === "warn" ? `Clear "Not picked" on ${doc} (${result.row.name})?` : `Mark ${doc} (${result.row.name}) as not needing an order?`;
    const answer = prompt(`${question}\n\nIt alerts again if the job changes. Your initials:`, me);
    if (answer === null) return;
    me = answer.trim().toUpperCase().slice(0, 12) || "?";
    state.prefs.me = me; saveStore();
    try {
      if (state.share.role && Share.canAck !== false) {
        await Share.ack(doc, result.row.sig, me);
        state.pending.set(doc, { kind: "ok", at: Date.now() });
      } else {
        state.wip = await readerRequest("/ack", { doc, sig: result.row.sig, by: me });
      }
      evaluateAll(); render(); publish();
    } catch (error) { alert(`Couldn't save: ${error.message}`); }
  }

  async function undoOk(doc) {
    try {
      if (state.share.role && Share.canAck !== false && (state.cloud.acks[doc] || isViewer())) {
        await Share.unack(doc);
        state.pending.set(doc, { kind: "undo", at: Date.now() });
      }
      if (isSource() && state.wip?.acks?.[doc]) state.wip = await readerRequest("/unack", { doc });
      evaluateAll(); render(); publish();
    } catch (error) { alert(`Couldn't undo: ${error.message}`); }
  }

  function signInMessage(error) {
    const code = error && error.code ? error.code : "";
    if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return "That email or password isn't right.";
    if (/too-many-requests/.test(code)) return "Too many tries. Wait a minute, or use Forgot password.";
    if (/network/.test(code)) return "No internet connection. Check it and try again.";
    return error && error.message ? error.message : "Couldn't sign in.";
  }

  function wire() {
    document.addEventListener("click", (event) => {
      const t = event.target.closest("button, tr.has-slips");
      if (!t) return;
      if (t.dataset.view) { state.prefs.view = t.dataset.view; saveStore(); render(); return; }
      if (t.dataset.by) {
        state.prefs.by = t.dataset.by; saveStore();
        history.replaceState(null, "", t.dataset.by === "ALL" ? location.pathname + location.search : `#by=${t.dataset.by}`);
        render(); return;
      }
      if (t.dataset.ack) { markOk(t.dataset.ack); return; }
      if (t.dataset.unack) { undoOk(t.dataset.unack); return; }
      if (t.id === "refresh") { refreshNow(); return; }
      if (t.id === "openSignin") { state.share.showForm = true; renderAccount(); $("email").focus(); return; }
      if (t.id === "signOut" || t.id === "signOutNoAccess") { Share.signOut(); return; }
      if (t.id === "forgot") { forgotPassword(); return; }
      if (t.id === "suggest") { $("password").type = "text"; $("password").value = Share.suggestPassphrase(); $("password").focus(); return; }
      if (t.id === "openDiscord") { openDiscord(); return; }
      if (t.id === "editLeaveOut") { editLeaveOut(); return; }
      if (t.id === "dcClose") { $("discord").hidden = true; return; }
      if (t.id === "dcTest") { testDiscord(); return; }
      if (t.matches("tr.has-slips")) toggle(t.dataset.doc);
    });
    document.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target.matches?.("tr.has-slips")) { event.preventDefault(); toggle(event.target.dataset.doc); }
    });
    $("signinForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = $("signinMsg");
      const button = $("signinSubmit");
      const github = Share.kind === "github";
      const setup = isSource() && state.share.showForm;
      button.disabled = true;
      message.textContent = github ? (setup ? "Checking GitHub…" : "Unlocking…") : "Signing in…";
      try {
        if (github) await Share.signIn("", $("password").value, setup ? $("token").value : "");
        else await Share.signIn($("email").value, $("password").value);
        message.textContent = ""; $("password").value = ""; $("token").value = ""; $("password").type = "password";
      } catch (error) { message.textContent = signInMessage(error); }
      finally { button.disabled = false; }
    });
    $("discordForm").addEventListener("submit", (event) => { event.preventDefault(); saveDiscord(); });
    $("q").addEventListener("input", (event) => { state.query = event.target.value; render(); });
    const sound = $("sound");
    sound.checked = !!state.prefs.sound;
    sound.addEventListener("change", () => { state.prefs.sound = sound.checked; saveStore(); if (sound.checked) chime(); });
  }

  async function forgotPassword() {
    const email = $("email").value.trim();
    const message = $("signinMsg");
    if (!email) { message.textContent = "Type your email first, then press Forgot password."; $("email").focus(); return; }
    try { await Share.resetPassword(email); message.textContent = "If that email is on the list, a reset link is on its way."; }
    catch (error) { message.textContent = signInMessage(error); }
  }

  function toggle(doc) {
    if (state.expanded.has(doc)) state.expanded.delete(doc); else state.expanded.add(doc);
    render();
    const row = document.querySelector(`tr.job[data-doc="${CSS.escape(doc)}"]`);
    if (row) row.focus();
  }

  async function refreshNow() {
    const button = $("refresh");
    button.disabled = true; button.textContent = "Refreshing…";
    try { await readerRequest("/refresh", {}); } catch { /* the reader may be paused; still refresh picking */ }
    setTimeout(async () => {
      await cycle(true);
      button.disabled = false; button.textContent = "Refresh now";
    }, 4000);
  }

  $("ver").textContent = `v${VERSION}`;
  loadStore();
  wire();
  render();
  startSharing();
  cycle(true);
  setInterval(() => cycle(false), WIP_EVERY_MS);
  setInterval(() => {   // grace periods and dates roll over without a fetch
    evaluateAll(); render();
    if (isSource() && state.results.some((r) => r.status === "checking")) cycle(false); else { publish(); runAlerts(); }
  }, 30000);
  setTimeout(checkForUpdate, 30000);
  setInterval(checkForUpdate, 10 * 60000);
})();
