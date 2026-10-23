/* Tempe Order Check: Discord alerts.
   Works out what to post and what to edit, so the same code runs in the board and in the
   Node tests. The RDP board sends it to a Discord channel webhook through the
   "Tom does it all" extension (no bot, no commands).

   - A job that turns red (Not ordered) or orange (Not picked) gets one line, tagging the
     salesperson. Lines that appear together go in one message (at most 10 per message).
   - When the job is fixed, its line is edited to ✅ (editing never pings anyone).
   - New alerts only go out in shop hours (Monday to Saturday, 7:00 to 18:30); anything that
     turns red overnight goes out together at 7:00. */
(function (root) {
  "use strict";
  const R = typeof module !== "undefined" && module.exports ? require("./order-rules.js") : root.OrderRules;

  const SETTINGS_KEY = "orderCheck.discord";
  const SENT_KEY = "orderCheck.discord.sent";
  const LINES_PER_MESSAGE = 10;
  const POST_CHARS = 1400;            // Discord allows 2,000; ✅ lines are longer than the alerts they replace
  const MAX_CHARS = 1990;
  const KEEP_MS = 7 * 86400000;       // finished messages are forgotten after a week
  const FORGET_MS = 21 * 86400000;    // anything older is forgotten too
  const SUPPRESS_EMBEDS = 4;          // no link preview under the board link
  const SETTLED = ["green", "ok", "amber", "grey"];
  const HOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/(\d{15,22})\/([A-Za-z0-9_-]{20,})\/?$/;

  // ------------------------------------------------------------ settings

  function parseWebhook(url) {
    const m = HOOK_RE.exec(String(url || "").trim());
    return m ? { id: m[1], url: `https://discord.com/api/webhooks/${m[1]}/${m[2]}` } : null;
  }

  // "MOR = 123456789012345678", one per line ("MOR 1234…", "MOR: <@1234…>" work too).
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

  function store() {
    try { return globalThis.localStorage || null; } catch { return null; }
  }
  function readJson(key, fallback) {
    try { const s = store(); const v = s && s.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function writeJson(key, value) {
    try { const s = store(); if (s) s.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  }
  function loadSettings() { return { url: "", people: "", names: false, on: false, ...readJson(SETTINGS_KEY, {}) }; }
  function saveSettings(cfg) { writeJson(SETTINGS_KEY, { url: cfg.url || "", people: cfg.people || "", names: !!cfg.names, on: !!cfg.on }); }
  // The board's leave-out list (people no longer at Tempe, the boss): a Set, an array or "MD ST UBH YTA".
  function leaveOutSet(value) {
    if (value instanceof Set) return new Set([...value].map((x) => String(x).toUpperCase()));
    if (Array.isArray(value)) return new Set(value.map((x) => String(x).toUpperCase()));
    return R.parseInitials(value).set;
  }
  // msgs: Discord message id → { at, items, dirty }; active: doc → message id of its open line;
  // quiet: doc → status, for alerts whose message someone deleted (not posted again until it changes).
  function emptyState() { return { v: 1, msgs: {}, active: {}, quiet: {} }; }
  function loadSent() {
    const st = readJson(SENT_KEY, null);
    return st && st.v === 1 && st.msgs && st.active ? { quiet: {}, ...st } : emptyState();
  }
  function saveSent(st) { writeJson(SENT_KEY, st); }

  function inShopHours(date) {
    if (date.getDay() === 0) return false;
    const m = date.getHours() * 60 + date.getMinutes();
    return m >= 7 * 60 && m <= 18 * 60 + 30;
  }

  // ------------------------------------------------------------ lines

  // Customer names and initials go into Discord as plain text, never as formatting or mentions.
  function md(s) { return String(s || "").replace(/([\\*_~`|<>[\]])/g, "\\$1").replace(/@/g, "@\u200b"); }
  function money(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "";
    const digits = Math.round(Math.abs(n) * 100) % 100 ? 2 : 0;
    return n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function by(r) { return String((r.row && r.row.by) || "?").trim().toUpperCase() || "?"; }

  function describe(r, cfg, people) {
    const doc = String(r.row.doc);
    const initials = by(r);
    const id = people[initials] || "";
    const fix = r.status === "warn" ? "Not picked" : R.shortFixes(r).join(", ");
    const extra = r.status === "warn" && r.summary && r.summary.pick ? r.summary.pick : "";
    const parts = [doc];
    if (cfg.names && r.row.name) parts.push(md(r.row.name));
    const amount = money(r.row.total);
    if (amount) parts.push(amount);
    const who = id ? `<@${id}>` : `**${md(initials)}**`;
    const head = [`**${doc}**`, ...parts.slice(1)].join(" · ");
    return {
      doc, status: r.status, mention: id, who,
      line: `${r.status === "warn" ? "🟠" : "🔴"} ${head} — **${md(fix)}**${extra ? ` (${md(extra)})` : ""} · ${who}`,
      plain: `${parts.join(" · ")} — ${md(fix)}`,
    };
  }

  function newestClock(r, today) {
    const newest = (r.slips || []).reduce((max, s) => (String(s.time) > max ? String(s.time) : max), "");
    if (!newest) return "";
    const day = newest.slice(0, 10);
    return day === today ? newest.slice(11, 16) : R.friendlyDate(day, today);
  }

  // What the ✅ line says once the job no longer needs anyone.
  function resolution(item, r, today) {
    if (!r) return "no longer in Work-in-Progress";
    if (r.status === "green" || r.status === "warn") {
      if (item.status === "warn" && r.status === "green") return (r.summary && r.summary.pick) || "picked";
      const at = newestClock(r, today);
      return at ? `ordered ${at}` : "ordered";
    }
    if (r.status === "ok") return r.label === "Marked OK" ? `marked OK by ${(r.ack && r.ack.by) || "?"}` : `cleared: ${r.reason || "no order needed"}`;
    if (r.status === "red") return "see the newer alert";
    return r.reason || r.label || "cleared";
  }

  function doneLine(item, short) { return short ? `✅ ~~${item.doc}~~ ${md(item.done)}` : `✅ ~~${item.plain}~~ ${md(item.done)} · ${item.who}`; }
  function renderItems(items, ctx) {
    const footer = ctx && ctx.boardUrl ? [`-# [Open the board](${ctx.boardUrl})`] : [];
    for (const short of [false, true]) {
      const text = [...items.map((i) => (i.done ? doneLine(i, short) : i.line)), ...footer].join("\n");
      if (text.length <= MAX_CHARS || short) return text.slice(0, MAX_CHARS);
    }
    return "";
  }

  // ------------------------------------------------------------ planning

  function activeItem(st, doc) {
    const id = st.active[doc];
    const msg = id && st.msgs[id];
    return msg ? msg.items.find((i) => i.doc === doc && !i.done) || null : null;
  }
  // A left-out salesperson's open line comes out of its message altogether.
  function drop(st, doc) {
    const id = st.active[doc];
    delete st.active[doc];
    const msg = id && st.msgs[id];
    if (!msg) return;
    msg.items = msg.items.filter((i) => !(i.doc === doc && !i.done));
    msg.dirty = true;
  }
  function finish(st, doc, text, nowMs) {
    const id = st.active[doc];
    const item = activeItem(st, doc);
    delete st.active[doc];
    if (!item) return;
    item.done = text; item.doneAt = nowMs;
    st.msgs[id].dirty = true;
  }

  /* results: the board's evaluated jobs. state: from loadSent(). cfg: loadSettings().
     ctx: { nowMs, today, shopHours, wipComplete (an unfiltered, fresh WIP read), boardUrl, leaveOut }.
     results must include left-out people's jobs, so their open lines can be taken out of messages
     (a job missing from results means it left Work-in-Progress).
     Returns { state, posts: [{ items, content, mentions }], patches: [message id] }.
     The board posts, then calls recordPost; after each edit it calls edited. */
  function plan(results, state, cfg, ctx) {
    const st = JSON.parse(JSON.stringify(state && state.v === 1 ? { quiet: {}, ...state } : emptyState()));
    prune(st, ctx.nowMs);
    const { people } = parsePeople(cfg.people);
    const skip = leaveOutSet(ctx.leaveOut);
    const byDoc = new Map(results.map((r) => [String(r.row.doc), r]));
    for (const [doc, status] of Object.entries(st.quiet)) {
      const r = byDoc.get(doc);
      if (!r || r.status !== status) delete st.quiet[doc];
    }
    for (const doc of Object.keys(st.active)) {
      const r = byDoc.get(doc);
      if (r && skip.has(by(r))) drop(st, doc);
    }
    const fresh = [];
    for (const r of results) {
      if (r.status !== "red" && r.status !== "warn") continue;
      if (skip.has(by(r))) continue;
      const now = describe(r, cfg, people);
      if (st.quiet[now.doc]) continue;
      const item = activeItem(st, now.doc);
      if (item && item.status === r.status) {
        if (item.line !== now.line) { Object.assign(item, now); st.msgs[st.active[now.doc]].dirty = true; }
        continue;
      }
      if (item) finish(st, now.doc, resolution(item, r, ctx.today), ctx.nowMs);
      fresh.push(now);
    }
    for (const doc of Object.keys(st.active)) {
      const r = byDoc.get(doc);
      if (!r ? ctx.wipComplete : SETTLED.includes(r.status)) finish(st, doc, resolution(activeItem(st, doc) || {}, r, ctx.today), ctx.nowMs);
    }
    const posts = [];
    if (ctx.shopHours) {
      let items = [], chars = 0;
      const flush = () => {
        if (items.length) posts.push({ items, content: renderItems(items, ctx), mentions: [...new Set(items.map((x) => x.mention).filter(Boolean))] });
        items = []; chars = 0;
      };
      for (const item of fresh) {
        if (items.length >= LINES_PER_MESSAGE || (items.length && chars + item.line.length + 1 > POST_CHARS)) flush();
        items.push(item); chars += item.line.length + 1;
      }
      flush();
    }
    const dirty = Object.keys(st.msgs).filter((id) => st.msgs[id].dirty);
    return {
      state: st, posts,
      patches: dirty.filter((id) => st.msgs[id].items.length),
      deletes: dirty.filter((id) => !st.msgs[id].items.length),   // nothing left in it: delete the message
    };
  }

  function recordPost(st, post, id, nowMs) {
    st.msgs[id] = { at: nowMs, items: post.items.map((i) => ({ ...i, done: "" })) };
    for (const i of post.items) st.active[i.doc] = id;
  }
  function edited(st, id) { if (st.msgs[id]) delete st.msgs[id].dirty; }
  function deleted(st, id) {
    for (const [doc, msgId] of Object.entries(st.active)) if (msgId === id) delete st.active[doc];
    delete st.msgs[id];
  }
  // The message is gone from Discord (someone deleted it): stop editing it, and don't post its
  // open alerts again unless the job changes.
  function forget(st, id) {
    if (!st.quiet) st.quiet = {};
    const msg = st.msgs[id];
    for (const [doc, msgId] of Object.entries(st.active)) {
      if (msgId !== id) continue;
      const item = msg && msg.items.find((i) => i.doc === doc && !i.done);
      if (item) st.quiet[doc] = item.status;
      delete st.active[doc];
    }
    delete st.msgs[id];
  }
  function prune(st, nowMs) {
    for (const [id, msg] of Object.entries(st.msgs)) {
      const finished = msg.items.every((i) => i.done) && !msg.dirty;
      if (finished && nowMs - msg.at > KEEP_MS) delete st.msgs[id];
      else if (nowMs - msg.at > FORGET_MS) {   // three weeks on: post it again as a reminder
        for (const [doc, msgId] of Object.entries(st.active)) if (msgId === id) delete st.active[doc];
        delete st.msgs[id];
      }
    }
  }

  function postBody(post) { return { content: post.content, allowed_mentions: { parse: [], users: post.mentions }, flags: SUPPRESS_EMBEDS }; }
  function editBody(st, id, ctx) { return { content: renderItems(st.msgs[id].items, ctx), allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS }; }

  // The Send test message: shows every tag as a name (nobody is pinged).
  function testBody(cfg, ctx) {
    const { people } = parsePeople(cfg.people);
    const skip = leaveOutSet(ctx && ctx.leaveOut);
    const tags = Object.entries(people).map(([initials, id]) => `${md(initials)} → <@${id}>`).join(", ");
    const lines = ["✅ **Order Check alerts are connected.**", tags ? `Tags: ${tags}` : "No people listed yet, so alerts show initials without tagging anyone."];
    if (skip.size) lines.push(`Left out: ${md([...skip].join(", "))}`);
    if (ctx && ctx.boardUrl) lines.push(`-# [Open the board](${ctx.boardUrl})`);
    return { content: lines.join("\n"), allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS };
  }

  const api = {
    SETTINGS_KEY, SENT_KEY, LINES_PER_MESSAGE, parseWebhook, parsePeople, leaveOutSet, loadSettings, saveSettings, loadSent, saveSent,
    emptyState, inShopHours, plan, recordPost, edited, deleted, forget, postBody, editBody, testBody, renderItems, money, md,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrderDiscord = api;
})(this);
