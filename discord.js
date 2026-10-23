/* Tempe Order Check: Discord alerts.
   Works out what to post, edit and delete, so the same code runs in the board and in the
   Node tests. The RDP board sends it to a Discord channel webhook through the
   "Tom does it all" extension (no bot, no commands).

   The channel shows only what's wrong right now: one card per salesperson, easy to find at a
   glance (Tommy, 23 Oct: "search his name quickly without squinting"). The card has their
   initials as its title and a red bar (orange when it's only "Not picked"); their tag sits above
   the card when their Discord ID is listed, so the post pings them:

     @Pinad does it all
     ┃ TOG
     ┃ 07510297 - TAEHO CHOI - $1,560 - EDC44U - **Tick Customer Waiting**
     ┃
     ┃ 07510467 - PHILIP INNESS - $30 - FFI80G - **Tick Customer Waiting**

   - A new problem re-posts that salesperson's message (old one deleted), so Discord notifies.
   - A fixed job's line is edited out (no notification); with nothing left the message is deleted.
   - New problems only go out Monday to Saturday, 7:00 to 18:30; overnight ones go out at 7:00.
   No links and no test messages. */
(function (root) {
  "use strict";
  const R = typeof module !== "undefined" && module.exports ? require("./order-rules.js") : root.OrderRules;

  const SETTINGS_KEY = "orderCheck.discord";
  const SENT_KEY = "orderCheck.discord.sent";
  const MAX_DESC = 3800;              // a card's text allows 4,096 characters
  const SUPPRESS_NOTIFICATIONS = 4096; // "silent" message: used once, when a new version redraws the channel
  const RED = 0xC0161F, ORANGE = 0xC45200;   // the board's own colours
  const HOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d{15,22})\/([A-Za-z0-9_-]{20,})\/?$/;

  // ------------------------------------------------------------ settings

  function parseWebhook(url) {
    const m = HOOK_RE.exec(String(url || "").trim());
    return m ? { id: m[1], url: `https://discord.com/api/webhooks/${m[1]}/${m[2]}` } : null;
  }

  function store() {
    try { return globalThis.localStorage || null; } catch { return null; }
  }
  function readJson(key, fallback) {
    try { const s = store(); const v = s && s.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function writeJson(key, value) {
    try { const s = store(); if (s) s.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  }
  function loadSettings() { const s = readJson(SETTINGS_KEY, {}) || {}; return { url: String(s.url || ""), people: String(s.people || ""), on: !!s.on }; }
  function saveSettings(cfg) { writeJson(SETTINGS_KEY, { url: cfg.url || "", people: cfg.people || "", on: !!cfg.on }); }

  // "TOG = 123456789012345678", one per line ("TOG 1234…", "TOG: <@1234…>" work too).
  function parsePeople(text) {
    const people = {}, bad = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = /^([A-Za-z][A-Za-z0-9]{0,5})\s*[=:,\s-]\s*<?@?!?(\d{15,22})>?$/.exec(line);
      if (m) people[m[1].toUpperCase()] = m[2]; else bad.push(line);
    }
    return { people, bad };
  }

  // persons: initials → { msgs: [{ id, content }] (what Discord shows now), docs: [...] (jobs already announced), lines }
  // cleanup: message ids still to delete. migrated: the next posts are silent (a redraw after an update).
  function emptyState() { return { v: 3, persons: {}, cleanup: [] }; }
  // Messages posted by 1.6.0–1.6.3 (plain text layouts) are all deleted and redrawn as cards, quietly.
  function upgrade(st) {
    if (st && st.v === 3 && st.persons) return { cleanup: [], ...st };
    if (st && st.v === 2 && st.persons) {
      const ids = Object.values(st.persons).flatMap((p) => (p.msgs || []).map((m) => m.id));
      return { v: 3, persons: {}, cleanup: [...(st.cleanup || []), ...ids], migrated: true };
    }
    if (st && st.v === 1 && st.msgs) return { v: 3, persons: {}, cleanup: Object.keys(st.msgs), migrated: true };
    return emptyState();
  }
  function loadSent() { return upgrade(readJson(SENT_KEY, null)); }
  function saveSent(st) { writeJson(SENT_KEY, st); }

  function inShopHours(date) {
    if (date.getDay() === 0) return false;
    const m = date.getHours() * 60 + date.getMinutes();
    return m >= 7 * 60 && m <= 18 * 60 + 30;
  }

  // The board's leave-out list (people no longer at Tempe, the boss): a Set, an array or "MD ST UBH YTA".
  function leaveOutSet(value) {
    if (value instanceof Set) return new Set([...value].map((x) => String(x).toUpperCase()));
    if (Array.isArray(value)) return new Set(value.map((x) => String(x).toUpperCase()));
    return R.parseInitials(value).set;
  }

  // ------------------------------------------------------------ lines

  // Names, comments and initials go into Discord as plain text, never as formatting or mentions.
  function md(s) { return String(s || "").replace(/([\\*_~`|<>[\]])/g, "\\$1").replace(/@/g, "@\u200b"); }
  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "";
    const digits = Math.round(Math.abs(n) * 100) % 100 ? 2 : 0;
    return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function by(r) { return String((r.row && r.row.by) || "?").trim().toUpperCase() || "?"; }

  // Doc# - Name - Amount - Comment - what's wrong
  function jobLine(r) {
    const pick = r.status === "warn" && r.summary && r.summary.pick ? r.summary.pick : "";
    const fix = r.status === "warn" ? `Not picked${pick ? ` (${pick})` : ""}` : R.shortFixes(r).join(", ");
    const parts = [String(r.row.doc), md(String(r.row.name || "").trim()), money(r.row.total), md(String(r.row.comment || "").trim())].filter(Boolean);
    return `${parts.join(" - ")} - **${md(fix)}**`;
  }

  // One card per salesperson: { m: their Discord ID (tag above the card), t: title, d: jobs, c: colour },
  // kept as text so the board can tell when Discord needs an edit. Split only past the card limit.
  function messagesFor(initials, lines, people) {
    const mention = (people || {})[initials] || "";
    const color = lines.some((l) => !/ - \*\*Not picked/.test(l)) ? RED : ORANGE;
    const card = (part) => JSON.stringify({ m: mention, t: initials, d: part.join("\n\n"), c: color });
    const out = [];
    let cur = [];
    for (const line of lines) {
      if (cur.length && [...cur, line].join("\n\n").length > MAX_DESC) { out.push(card(cur)); cur = []; }
      cur.push(line);
    }
    if (cur.length) out.push(card(cur));
    return out;
  }

  // ------------------------------------------------------------ planning

  /* results: every evaluated job, left-out people included (a job missing from results has
     left Work-in-Progress). state: from loadSent(). ctx: { shopHours, wipComplete (an
     unfiltered, fresh WIP read), leaveOut }.
     Returns { state, deletes: [id], edits: [{ person, index, id, content }],
               posts: [{ person, docs, lines, contents, silent, mention }] }.
     The board deletes, then edits, then posts, and records each step with done / edited / recordPost. */
  function plan(results, state, cfg, ctx) {
    const st = JSON.parse(JSON.stringify(upgrade(state)));
    const skip = leaveOutSet(ctx.leaveOut);
    const { people: tags } = parsePeople(cfg.people);
    const inWip = new Set(results.map((r) => String(r.row.doc)));
    const open = new Map();
    for (const r of results) {
      if (r.status !== "red" && r.status !== "warn") continue;
      const initials = by(r);
      if (skip.has(initials)) continue;
      if (!open.has(initials)) open.set(initials, []);
      open.get(initials).push({ doc: String(r.row.doc), line: jobLine(r) });
    }
    // A WIP read that's filtered or stale never removes a job that merely went missing.
    if (!ctx.wipComplete) {
      for (const [initials, p] of Object.entries(st.persons)) {
        if (skip.has(initials)) continue;
        for (const doc of p.docs) {
          if (inWip.has(doc) || !p.lines[doc]) continue;
          if (!open.has(initials)) open.set(initials, []);
          if (!open.get(initials).some((x) => x.doc === doc)) open.get(initials).push({ doc, line: p.lines[doc] });
        }
      }
    }
    const edits = [], posts = [];
    const people = [...new Set([...Object.keys(st.persons), ...open.keys()])].sort();
    for (const initials of people) {
      const prev = st.persons[initials] || { msgs: [], docs: [], lines: {} };
      const now = open.get(initials) || [];
      const fresh = now.filter((x) => !prev.docs.includes(x.doc));
      const lines = Object.fromEntries(now.map((x) => [x.doc, x.line]));
      if (fresh.length && ctx.shopHours) {
        // Something new: the old message goes and the whole list is posted again, so Discord notifies.
        st.cleanup.push(...prev.msgs.map((m) => m.id));
        st.persons[initials] = { msgs: [], docs: prev.docs.filter((d) => lines[d]), lines };
        posts.push({ person: initials, docs: now.map((x) => x.doc), lines, contents: messagesFor(initials, now.map((x) => x.line), tags), silent: !!st.migrated, mention: tags[initials] || "" });
        continue;
      }
      const shown = now.filter((x) => prev.docs.includes(x.doc));   // new ones wait for shop hours
      if (!shown.length) {
        st.cleanup.push(...prev.msgs.map((m) => m.id));
        if (fresh.length) st.persons[initials] = { msgs: [], docs: [], lines: {} };
        else delete st.persons[initials];
        continue;
      }
      const contents = messagesFor(initials, shown.map((x) => x.line), tags);
      const keep = { msgs: prev.msgs.slice(), docs: shown.map((x) => x.doc), lines: Object.fromEntries(shown.map((x) => [x.doc, x.line])) };
      if (!prev.msgs.length) { st.persons[initials] = keep; continue; }   // someone deleted it in Discord: wait for something new
      if (contents.length > prev.msgs.length) {                          // a longer list than fits: post it again, quietly
        st.cleanup.push(...prev.msgs.map((m) => m.id));
        st.persons[initials] = { msgs: [], docs: [], lines: {} };
        posts.push({ person: initials, docs: keep.docs, lines: keep.lines, contents, silent: true, mention: tags[initials] || "" });
        continue;
      }
      prev.msgs.forEach((m, i) => {
        if (i >= contents.length) st.cleanup.push(m.id);
        else if (m.content !== contents[i]) edits.push({ person: initials, index: i, id: m.id, content: contents[i] });
      });
      keep.msgs = prev.msgs.slice(0, contents.length);
      st.persons[initials] = keep;
    }
    st.cleanup = [...new Set(st.cleanup)];
    return { state: st, deletes: st.cleanup.slice(), edits, posts };
  }

  // Bookkeeping after each Discord call (the board saves the state after every step).
  function done(st, id) { st.cleanup = st.cleanup.filter((x) => x !== id); }
  function edited(st, edit) {
    const p = st.persons[edit.person];
    if (p && p.msgs[edit.index] && p.msgs[edit.index].id === edit.id) p.msgs[edit.index].content = edit.content;
  }
  // Someone deleted the message in Discord: stop editing it; the list comes back with the next new problem.
  function gone(st, edit) {
    const p = st.persons[edit.person];
    if (p) p.msgs = p.msgs.filter((m) => m.id !== edit.id);
  }
  function recordPost(st, post, ids) {
    st.persons[post.person] = { msgs: ids.map((id, i) => ({ id, content: post.contents[i] })), docs: post.docs.slice(), lines: { ...post.lines } };
  }
  function finishRound(st) { delete st.migrated; }

  // What Discord gets for a card. Only a new post pings, and only the salesperson it's for; edits never ping.
  function body(content, silent, mention) {
    let card;
    try { card = JSON.parse(content); } catch { card = null; }
    if (!card || typeof card !== "object") card = { m: "", t: "", d: String(content || ""), c: RED };
    const out = {
      content: card.m ? `<@${card.m}>` : "",
      embeds: [{ title: String(card.t || "").slice(0, 256), description: String(card.d || "").slice(0, 4096), color: card.c }],
      allowed_mentions: { parse: [], users: mention ? [mention] : [] },
    };
    if (silent) out.flags = SUPPRESS_NOTIFICATIONS;
    return out;
  }

  const api = {
    SETTINGS_KEY, SENT_KEY, parseWebhook, parsePeople, loadSettings, saveSettings, loadSent, saveSent, emptyState, upgrade, inShopHours,
    leaveOutSet, jobLine, messagesFor, plan, done, edited, gone, recordPost, finishRound, body, money, md,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrderDiscord = api;
})(this);
