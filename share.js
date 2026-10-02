/* Tempe Order Check: team sharing through GitHub (no other service).
   The RDP board encrypts its results with the team passphrase (AES-256-GCM, key
   from PBKDF2-SHA256 with 600,000 rounds) and saves ONE file to a public GitHub
   repo. Everyone else downloads that file and unlocks it with the passphrase.
   GitHub only ever stores scrambled data; nothing is readable without the passphrase. */
(() => {
  "use strict";
  const FILE = "order-check.json";
  const ITERATIONS = 600000;
  const MIN_GAP_MS = 60000;          // at most one save a minute
  const HEARTBEAT_MS = 4 * 60000;    // save at least every 4 minutes so viewers know it's alive
  const POLL_MS = 60000;             // viewers check for a new file every minute
  const MAX_SLIPS = 6;
  const KEYS = { pass: "orderCheck.share.passphrase", token: "orderCheck.share.githubToken", board: "orderCheck.share.boardId" };
  const LEASE_MS = 6 * 60000;        // another board that saved this recently keeps the job
  const README = "# Order Check data\n\nEncrypted. Unreadable without the Tempe team passphrase.\n";
  const WORDS = ["able","acid","aged","also","arch","area","army","atom","aunt","away","baby","back","bake","ball","band","bank","barn","base","bath","beam","bean","bear","beef","bell","belt","bench","bike","bird","blue","boat","body","bold","bolt","bone","book","boot","bowl","brick","bride","brush","bulb","cake","calm","camp","card","cart","cash","cave","chair","chalk","cheek","chess","chin","city","clay","cliff","clock","cloud","coal","coast","coat","code","coin","cold","cook","cool","copy","corn","cotton","crab","crow","cube","cup","curve","dairy","dawn","deck","deer","desk","dial","dish","dock","dog","door","dove","draw","dream","dress","drum","duck","dune","eagle","east","echo","edge","egg","elbow","elk","empty","fair","farm","fern","field","film","fish","flag","flame","flock","flute","foam","fog","fork","fort","frog","fruit","gate","gear","gift","glass","glove","goat","gold","golf","grape","grass","gravel","green","grid","gulf","hall","hand","harp","hawk","heat","hedge","hill","honey","hook","horn","horse","hotel","house","ice","inch","iron","island","ivy","jacket","jam","jar","jelly","jet","jewel","judge","juice","kettle","kite","knee","knot","ladder","lake","lamb","lamp","lane","lawn","leaf","lemon","lens","lily","lime","lion","lock","loft","lunch","magnet","maple","map","marble","market","mask","meadow","melon","mill","mint","moon","moss","motor","mouse","mud","nail","nest","net","night","north","nut","oak","ocean","olive","orange","otter","owl","paint","palm","panda","paper","park","pearl","pencil","pepper","piano","pier","pillow","pine","pipe","plain","plant","plate","plum","pond","pony","pool","port","pot","pumpkin","quail","quilt","rabbit","rain","ranch","raven","reef","rice","ridge","ring","river","road","robin","rock","roof","rope","rose","ruby","sail","salt","sand","scarf","sea","seed","shell","ship","shirt","shore","silk","silver","sky","snow"];

  let cfg = null, onAuthCb = null, key = null, keyFor = "";
  let latestRows = null, latestMeta = null, lastRowsJson = "", lastProblems = "", dirty = false, lastSaved = 0, saving = null;
  let lastText = "", pollTimer = 0, lastRows = null, lastStatus = null;
  const listeners = { rows: new Set(), status: new Set(), errors: new Set() };
  let now = () => Date.now();

  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  // Identifies this browser as a sharing board. Kept across reloads, so
  // reloading the RDP tab doesn't lock it out of its own lease.
  const tab = store.get(KEYS.board) || (() => { const id = Math.random().toString(36).slice(2, 12); store.set(KEYS.board, id); return id; })();
  function fail(code, message) { const e = new Error(message); e.code = code; return e; }
  function toMs(t) { return t && typeof t.toMillis === "function" ? t.toMillis() : typeof t === "number" ? t : 0; }

  function toBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(text) {
    const s = atob(String(text || ""));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function gzip(text) {
    const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }

  async function keyFrom(passphrase) {
    if (key && keyFor === passphrase) return key;
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`tempe-order-check|${cfg.owner}/${cfg.repo}`), iterations: ITERATIONS },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    keyFor = passphrase;
    return key;
  }

  async function seal(payload, passphrase) {
    const k = await keyFrom(passphrase);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, await gzip(JSON.stringify(payload))));
    return JSON.stringify({ v: 1, app: "tempe-order-check", iv: toBase64(iv), data: toBase64(data) });
  }
  async function unseal(text, passphrase) {
    let file;
    try { file = JSON.parse(text); } catch { throw fail("damaged", "The shared file is damaged. It will fix itself at the next save."); }
    if (!file || file.v !== 1 || !file.iv || !file.data) throw fail("damaged", "The shared file isn't an Order Check file.");
    const k = await keyFrom(passphrase);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(file.iv) }, k, fromBase64(file.data)); }
    catch { throw fail("wrong-passphrase", "That passphrase doesn't open the team board."); }
    return JSON.parse(await gunzip(new Uint8Array(plain)));
  }

  // Only what the board needs to draw a row. No phone numbers are ever read.
  function slim(r) {
    const row = r.row || {};
    const out = {
      status: r.status, label: r.label, reason: r.reason || "",
      row: {
        doc: String(row.doc || ""), orderDate: row.orderDate || "", name: row.name || "",
        comment: row.comment || "", by: row.by || "", sig: row.sig || "",
      },
    };
    if (Array.isArray(r.reasons)) out.reasons = r.reasons.slice(0, 4);
    if (Array.isArray(r.codes)) out.codes = r.codes.slice(0, 4);
    if (r.until !== undefined && r.until !== null) out.until = r.until;
    if (r.summary) out.summary = r.summary;
    if (r.ack) out.ack = { by: r.ack.by || "?" };
    if (Array.isArray(r.slips) && r.slips.length) {
      out.slips = r.slips.slice().sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, MAX_SLIPS).map((s) => ({
        time: s.time, qty: s.qty, desc: s.desc, sku: s.sku, bins: s.bins, manual: !!s.manual,
        picked: !!s.picked, pickedAt: s.pickedAt || "", picker: s.picker || "", progress: s.progress || "",
        driver: Array.isArray(s.driver) ? s.driver : [],
      }));
    }
    return JSON.parse(JSON.stringify(out));
  }

  // ------------------------------------------------------------ GitHub

  function headers(token) {
    return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  }
  async function gh(token, method, path, body) {
    const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}${path}`, {
      method, cache: "no-store",
      headers: body ? { ...headers(token), "Content-Type": "application/json" } : headers(token),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.status === 204 ? null : res.json();
    if (res.status === 401) throw fail("token", "GitHub refused the token. It may have expired: set up team sharing again.");
    if (res.status === 403) throw fail("token", "GitHub refused the save. The token needs Contents: Read and write on the data repo.");
    if (res.status === 404) throw fail("repo", `GitHub can't find ${cfg.owner}/${cfg.repo} with this token.`);
    if (res.status === 409) throw fail("empty", "The data repo is empty. On GitHub, add a README to it once, then try again.");
    throw fail("github", `GitHub answered ${res.status} while saving.`);
  }
  async function checkRepo(token) {
    const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, { headers: headers(token), cache: "no-store" });
    if (res.status === 401) throw fail("token", "GitHub didn't accept that token. Copy it again from GitHub.");
    if (res.status === 404 || res.status === 403) throw fail("repo", `That token can't see ${cfg.owner}/${cfg.repo}. Give it access to that repo.`);
    if (!res.ok) throw fail("github", `GitHub answered ${res.status}.`);
    const repo = await res.json();
    if (repo.private) throw fail("private", "Make the data repo public. Its file is encrypted, and the team needs to download it without a GitHub login.");
  }
  async function save() {
    const token = store.get(KEYS.token), pass = store.get(KEYS.pass);
    if (!token || !pass) throw fail("setup", "Team sharing isn't set up on this PC.");
    // Only one board shares at a time: if another one saved in the last 6 minutes, leave it.
    const current = await gh(token, "GET", `/contents/${FILE}?ref=${encodeURIComponent(cfg.branch)}`).catch((e) => { if (e.code === "repo") return null; throw e; });
    if (current && current.content) {
      try {
        const previous = await unseal(atob(String(current.content).replace(/\s+/g, "")), pass);
        const m = previous.meta || {};
        if (m.tab && m.tab !== tab && now() - (m.publishedAt || 0) < LEASE_MS) {
          throw fail("other-board", "Another board is already sharing. Close it, or press Stop sharing on it.");
        }
      } catch (e) { if (e.code === "other-board") throw e; /* older passphrase: this board takes over */ }
    }
    const text = await seal({ meta: { ...(latestMeta || {}), tab, publishedAt: now() }, rows: latestRows || [] }, pass);
    // One fresh commit with no history, so the repo never grows.
    const tree = await gh(token, "POST", "/git/trees", { tree: [
      { path: FILE, mode: "100644", type: "blob", content: text },
      { path: "README.md", mode: "100644", type: "blob", content: README },
    ] });
    const commit = await gh(token, "POST", "/git/commits", { message: "Order check update", tree: tree.sha, parents: [] });
    await gh(token, "PATCH", `/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { sha: commit.sha, force: true });
  }
  async function maybeSave() {
    if (saving) return saving;
    const t = now();
    const due = latestRows && latestMeta && ((dirty && t - lastSaved >= MIN_GAP_MS) || t - lastSaved >= HEARTBEAT_MS);
    if (!due) return 0;
    saving = (async () => {
      try { await save(); lastSaved = now(); dirty = false; return 1; }
      finally { saving = null; }
    })();
    return saving;
  }

  async function download() {
    const res = await fetch(`https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${encodeURIComponent(cfg.branch)}/${FILE}?t=${now()}`, { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw fail("download", `GitHub answered ${res.status}.`);
    return res.text();
  }

  // ------------------------------------------------------------ viewers

  async function poll() {
    try {
      const text = await download();
      if (text === null || text === lastText) return;
      const payload = await unseal(text, store.get(KEYS.pass));
      lastText = text;
      const rows = new Map();
      for (const r of payload.rows || []) if (r && r.row && r.row.doc) rows.set(r.row.doc, r);
      const status = { ...(payload.meta || {}), beatAt: (payload.meta || {}).publishedAt || 0 };
      lastRows = rows; lastStatus = status;
      listeners.status.forEach((cb) => cb(status));
      listeners.rows.forEach((cb) => cb(rows));
    } catch (error) {
      if (error.code === "wrong-passphrase") {
        store.del(KEYS.pass); key = null; lastText = ""; lastRows = null; lastStatus = null; stopPolling();
        announce("The team passphrase has changed. Enter the new one.");
        return;
      }
      listeners.errors.forEach((cb) => cb(error));
    }
  }
  function startPolling() { if (!pollTimer) { pollTimer = setInterval(poll, POLL_MS); poll(); } }
  function stopPolling() { clearInterval(pollTimer); pollTimer = 0; }
  function watch(kind, cb, onError) {
    listeners[kind].add(cb);
    if (onError) listeners.errors.add(onError);
    // A late watcher gets the last unlocked data straight away.
    const cached = kind === "rows" ? lastRows : lastStatus;
    if (cached) setTimeout(() => { if (listeners[kind].has(cb)) cb(cached); }, 0);
    startPolling();
    return () => {
      listeners[kind].delete(cb);
      if (onError) listeners.errors.delete(onError);
      if (!listeners.rows.size && !listeners.status.size) stopPolling();
    };
  }

  function announce(error) {
    if (!onAuthCb) return;
    const pass = store.get(KEYS.pass), token = store.get(KEYS.token);
    if (!pass) { onAuthCb({ user: null, role: "", error: error || "" }); return; }
    onAuthCb({ user: { label: token ? "This PC shares the board" : "Unlocked on this device" }, role: token ? "publisher" : "viewer", error: "" });
  }

  const api = {
    kind: "github", canAck: false, staleMs: 12 * 60000, tab, toMs,

    // Returns false when share-config.js isn't set up for GitHub.
    async start(config, onAuth) {
      if (!config || config.backend !== "github" || !config.owner || !config.repo) return false;
      if (!(globalThis.crypto && crypto.subtle) || typeof CompressionStream === "undefined") throw new Error("This browser is too old for team sharing. Use an up-to-date Chrome.");
      cfg = { branch: "main", ...config };
      onAuthCb = onAuth;
      setTimeout(() => announce(), 0);
      return true;
    },

    // Viewers: signIn("", passphrase). The RDP PC: signIn("", passphrase, githubToken).
    async signIn(email, passphrase, token) {
      passphrase = String(passphrase || "").trim();
      token = String(token || "").trim();
      if (!passphrase) throw fail("empty-passphrase", "Type the team passphrase.");
      if (token) {
        if (passphrase.length < 16) throw fail("weak", "Use a passphrase of at least 16 characters. Suggest one makes a strong one.");
        await checkRepo(token);
        store.set(KEYS.token, token);
        dirty = true; lastSaved = 0;
      } else {
        const text = await download().catch(() => null);
        if (text) await unseal(text, passphrase);   // throws if it doesn't open the current file
      }
      store.set(KEYS.pass, passphrase);
      lastText = "";
      announce();
    },
    signOut() {
      store.del(KEYS.pass); store.del(KEYS.token);
      key = null; keyFor = ""; lastText = ""; lastRows = null; lastStatus = null; stopPolling();
      announce();
      return Promise.resolve();
    },
    resetPassword() { return Promise.reject(fail("unsupported", "Ask Tommy for the team passphrase.")); },
    suggestPassphrase() {
      const picks = crypto.getRandomValues(new Uint16Array(6));
      return Array.from(picks, (n) => WORDS[n % WORDS.length]).join("-");
    },

    watchRows(cb, onError) { return watch("rows", cb, onError); },
    watchStatus(cb, onError) { return watch("status", cb, onError); },
    watchAcks() { return () => {}; },   // "Mark OK" stays on the RDP board in GitHub mode

    async publish(results) {
      latestRows = results.map(slim);
      const json = JSON.stringify(latestRows);
      if (json !== lastRowsJson) { lastRowsJson = json; dirty = true; }
      return maybeSave();
    },
    async beat(meta) {
      latestMeta = JSON.parse(JSON.stringify(meta || {}));
      const problems = JSON.stringify(latestMeta.problems || []);
      if (problems !== lastProblems) { lastProblems = problems; dirty = true; }
      return maybeSave();
    },
    ack() { return Promise.reject(fail("unsupported", "Mark OK on the RDP board.")); },
    unack() { return Promise.reject(fail("unsupported", "Undo on the RDP board.")); },

    // For tests.
    _test: { slim, seal, unseal, words: WORDS, configure(c) { cfg = { branch: "main", ...c }; key = null; keyFor = ""; }, setClock(fn) { now = fn; }, store, KEYS },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.OrderShare = api;
})();
