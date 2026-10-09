/* Tempe Order Check: team sharing through Firebase
   (Firestore stored in Sydney, email + password logins).
   The board on the RDP PC publishes finished statuses; everyone else signs in
   and views them. Access is decided by the Firestore rules (firestore.rules). */
(() => {
  "use strict";
  const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  const MAX_SLIPS = 6;
  let fb = null, auth = null, db = null;
  const tab = Math.random().toString(36).slice(2, 10);
  const written = new Map();   // doc id → JSON this tab last wrote
  let primed = false;

  function toMs(t) {
    if (t && typeof t.toMillis === "function") return t.toMillis();
    return typeof t === "number" ? t : 0;
  }

  // Only what the board needs to draw a row. No phone numbers are ever read.
  function slim(r) {
    const row = r.row || {};
    const out = {
      status: r.status, label: r.label, reason: r.reason || "",
      row: {
        doc: String(row.doc || ""), orderDate: row.orderDate || "", name: row.name || "",
        total: Number(row.total) || 0, shipVia: row.shipVia || "", comment: row.comment || "",
        by: row.by || "", sig: row.sig || "",
      },
    };
    if (Array.isArray(r.reasons)) out.reasons = r.reasons.slice(0, 4);
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
    return JSON.parse(JSON.stringify(out));   // Firestore rejects undefined values
  }

  async function load(config) {
    const [app, authMod, store] = await Promise.all([
      import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js"),
    ]);
    fb = { ...app, ...authMod, ...store };
    const instance = fb.initializeApp(config);
    auth = fb.getAuth(instance);
    db = fb.getFirestore(instance);
  }

  function lower(list) { return Array.isArray(list) ? list.map((x) => String(x).trim().toLowerCase()) : []; }

  const api = {
    tab, toMs, _slim: slim,

    // Returns false when share-config.js still has placeholders (sharing not set up).
    async start(config, onAuth) {
      if (!config || !config.apiKey || /PASTE/i.test(String(config.apiKey) + String(config.projectId))) return false;
      if (location.protocol !== "https:") throw new Error("file");
      await load(config);
      fb.onAuthStateChanged(auth, async (user) => {
        if (!user) { onAuth({ user: null, role: "", error: "" }); return; }
        const email = String(user.email || "").toLowerCase();
        try {
          const snap = await fb.getDoc(fb.doc(db, "config", "access"));
          const data = snap.exists() ? snap.data() : {};
          const role = lower(data.publishers).includes(email) ? "publisher" : lower(data.viewers).includes(email) ? "viewer" : "";
          onAuth({ user, role, error: role ? "" : "This account isn't on the Order Check list yet. Ask Tommy to add it." });
        } catch (error) {
          onAuth({ user, role: "", error: error.code === "permission-denied" ? "This account isn't on the Order Check list yet. Ask Tommy to add it." : `Couldn't check access: ${error.message}` });
        }
      });
      return true;
    },

    signIn(email, password) { return fb.signInWithEmailAndPassword(auth, String(email).trim(), password); },
    signOut() { written.clear(); primed = false; return fb.signOut(auth); },
    resetPassword(email) { return fb.sendPasswordResetEmail(auth, String(email).trim()); },

    watchRows(onChange, onError) {
      return fb.onSnapshot(fb.collection(db, "wip"), (snap) => {
        const rows = new Map();
        snap.forEach((d) => rows.set(d.id, d.data()));
        onChange(rows);
      }, onError);
    },
    watchStatus(onChange, onError) {
      return fb.onSnapshot(fb.doc(db, "meta", "status"), (snap) => onChange(snap.exists() ? snap.data() : null), onError);
    },
    watchAcks(onChange, onError) {
      return fb.onSnapshot(fb.collection(db, "acks"), (snap) => {
        const acks = {};
        snap.forEach((d) => { const v = d.data(); acks[d.id] = { sig: v.sig, by: v.by, email: v.email, at: toMs(v.at), cloud: true }; });
        onChange(acks);
      }, onError);
    },

    // Writes only rows that changed since this tab's last write, and removes
    // jobs that have left Work-in-Progress.
    async publish(results) {
      if (!primed) {
        const existing = await fb.getDocs(fb.collection(db, "wip"));
        existing.forEach((d) => written.set(d.id, ""));
        primed = true;
      }
      const next = new Map();
      const batch = fb.writeBatch(db);
      let ops = 0;
      for (const r of results) {
        const id = String((r.row && r.row.doc) || "");
        if (!/^\d{5,10}$/.test(id) || next.has(id)) continue;
        const payload = slim(r);
        const json = JSON.stringify(payload);
        next.set(id, json);
        if (written.get(id) !== json) { batch.set(fb.doc(db, "wip", id), { ...payload, updatedAt: fb.serverTimestamp() }); ops++; }
      }
      for (const id of written.keys()) if (!next.has(id)) { batch.delete(fb.doc(db, "wip", id)); ops++; }
      if (ops > 480) throw new Error("Too many changes for one save.");
      if (ops) await batch.commit();
      written.clear();
      for (const [id, json] of next) written.set(id, json);
      return ops;
    },
    beat(meta) {
      return fb.setDoc(fb.doc(db, "meta", "status"), { ...JSON.parse(JSON.stringify(meta)), tab, beatAt: fb.serverTimestamp() });
    },

    ack(doc, sig, by) {
      return fb.setDoc(fb.doc(db, "acks", String(doc)), {
        sig: String(sig || ""), by: String(by || "?").slice(0, 12),
        email: String(auth.currentUser.email || "").toLowerCase(), at: fb.serverTimestamp(),
      });
    },
    unack(doc) { return fb.deleteDoc(fb.doc(db, "acks", String(doc))); },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.OrderShare = api;
})();
