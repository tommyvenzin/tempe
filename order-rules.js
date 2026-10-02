/* Tempe Order Check: matching rules.
   Pure functions only (no page, no network) so the same code runs in the
   board and in the Node tests. */
(function (root) {
  "use strict";

  const GRACE_MINUTES = 5;          // a fresh SHOP job normally gets its slip within ~2 min
  const SHOP = "SHOP";

  // Words in the COSTAR comment that mean this job never needs an order.
  // Salespeople type one of these to clear a job from the team view.
  const NO_ORDER_RULE = /\bNO\s+ORDER\b|\bDO\s*N[O']?T\s+ORDER\b|\bNOT\s+NEEDED\b|\bSERVICE\s+ONLY\b|\bOWN\s+TYRES?\b|\bCUSTOMERS?'?\s+(OWN\s+)?TYRES?\b|\bALIGN(MENT)?\s+ONLY\b|\bFIT(TING)?\s+ONLY\b|\bREPAIR\s+ONLY\b/;

  // Words in the COSTAR comment that mean "don't order yet".
  const HOLD_RULES = [
    [/^(?!.*\bPAID\b).*\$/, "waiting for payment"],   // "$", "$$", "$$$" … but "PAID TT" stays a normal job
    [/\b(ON\s+)?HOLD\b/, "on hold"],
    [/\bCONF[IO]RM/, "waiting to confirm"],
    [/\bCHECK\s+STOCK\b/, "checking stock"],
    [/\bORDER\s+IF\b/, "order if"],
    [/\bWAIT(ING)?\s+(FOR|ON|TILL|UNTIL)\b/, "waiting"],
    [/\bCALL(ING)?\s+(BACK|TO)\b|\bCALLING\b|\bWILL\s+CALL\b/, "calling customer"],
    [/\bNO\s+STOCK\b/, "no stock"],
    [/\bORDER\s*\?/, "order?"],
    [/\b(DID\s+)?NOT\s+PA(Y|ID)\b/, "not paid"],
    [/\bQUOTE\b/, "quote"],
    [/\bTB[CA]\b/, "to be confirmed"],
  ];

  const DAY_RE = /\b(MON(?:DAY)?|TUE(?:S(?:DAY)?)?|WED(?:NESDAY)?|THU(?:R(?:S(?:DAY)?)?)?|FRI(?:DAY)?|SAT(?:URDAY)?|SUN(?:DAY)?)\b/;
  const DAY_INDEX = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

  // ------------------------------------------------------------ dates

  function pad(n) { return String(n).padStart(2, "0"); }
  function isoOf(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
  function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function addDays(iso, n) { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoOf(d); }
  function validDate(y, m, d) { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; }
  function friendlyDate(iso, todayIso) {
    const d = parseIso(iso);
    if (!d) return iso || "";
    if (todayIso && iso === todayIso) return "today";
    if (todayIso && iso === addDays(todayIso, 1)) return "tomorrow";
    return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  }

  // A date without a year gets the year that puts it closest to the anchor.
  function closestYear(day, month, anchorIso) {
    const anchor = parseIso(anchorIso);
    let best = anchor.getFullYear(), bestGap = Infinity;
    for (const y of [best - 1, best, best + 1]) {
      if (!validDate(y, month, day)) continue;
      const gap = Math.abs(new Date(y, month - 1, day) - anchor);
      if (gap < bestGap) { bestGap = gap; best = y; }
    }
    return best;
  }

  // Reads a COSTAR comment. Day names and TODAY/TOMORROW are counted from the
  // anchor (the order date when it's in the past, otherwise today).
  function readComment(comment, anchorIso) {
    const text = String(comment || "").toUpperCase();
    const result = { date: "", dateText: "", hold: "", noOrder: "" };
    const none = NO_ORDER_RULE.exec(text);
    if (none) result.noOrder = none[0].replace(/\s+/g, " ");
    const numeric = /(^|[^0-9])(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?(?![0-9])/g;
    let m;
    while ((m = numeric.exec(text))) {
      const day = +m[2], month = +m[3];
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      let year = m[4] ? +m[4] : closestYear(day, month, anchorIso);
      if (year < 100) year += 2000;
      if (!validDate(year, month, day)) continue;
      result.date = `${year}-${pad(month)}-${pad(day)}`;
      result.dateText = m[0].replace(/^[^0-9]/, "");
      break;
    }
    if (!result.date) {
      if (/\bTOMORROW\b/.test(text)) { result.date = addDays(anchorIso, 1); result.dateText = "TOMORROW"; }
      else if (/\bTODAY\b/.test(text)) { result.date = anchorIso; result.dateText = "TODAY"; }
      else {
        const d = DAY_RE.exec(text);
        if (d) {
          const want = DAY_INDEX[d[1].slice(0, 3)];
          const have = parseIso(anchorIso).getDay();
          result.date = addDays(anchorIso, (want - have + 7) % 7);
          result.dateText = d[1];
        }
      }
    }
    for (const [re, label] of HOLD_RULES) { if (re.test(text)) { result.hold = label; break; } }
    return result;
  }

  // ------------------------------------------------------------ picking page

  function decode(s) {
    return String(s || "")
      .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&amp;/g, "&");
  }
  function clean(html) { return decode(String(html || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
  function docKey(value) {
    const s = String(value || "").trim();
    return /^\d{5,10}$/.test(s) ? s.replace(/^0+/, "") : "";
  }
  function first(re, text) { const m = re.exec(text); return m ? m[1] : ""; }

  function parseSlip(c) {
    const record = clean(first(/<strong>([\s\S]*?)<\/strong>/i, c[1]));
    if (!/^RT-\d+-\d{8}-\d{6}-\d+$/.test(record)) return null;
    const r = /^RT-(\d+)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d+)$/.exec(record);
    const smalls = [...c[1].matchAll(/<small>([\s\S]*?)<\/small>/gi)].map((x) => x[1]);
    const descHtml = smalls[1] || "";
    const notes = [...descHtml.matchAll(/class=["'][^"']*\bbg-info\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
      .flatMap((x) => x[1].split(/<br\s*\/?>/i)).map(clean).filter(Boolean);
    const doc = clean(c[3].replace(/<small>[\s\S]*$/i, ""));
    const pickedText = clean(c[7]);
    const progressText = clean(c[8]);
    return {
      record,
      time: `${r[2]}-${r[3]}-${r[4]} ${r[5]}:${r[6]}`,
      manual: /MANUAL/.test(c[4]),
      sku: clean(smalls[0] || ""),
      bins: clean(first(/<div\b[^>]*class=["'][^"']*\blabel-default\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, c[1])),
      desc: clean(descHtml.replace(/<div[\s\S]*$/i, "")),
      notes,
      customer: clean(String(c[2]).split(/<br\s*\/?>/i)[0]),
      doc,
      docKey: docKey(doc),
      enteredBy: clean(first(/<a\b[^>]*>([\s\S]*?)<\/a>/i, c[3])),
      shipVia: clean(first(/<a\b[^>]*>([\s\S]*?)<\/a>/i, c[4])),
      qty: parseInt(clean(c[5]), 10) || 0,
      zone: clean(([...c[6].matchAll(/<label\b[^>]*class=["'][^"']*\blabel-default\b[^"']*["'][^>]*>([\s\S]*?)<\/label>/gi)].pop() || [])[1] || ""),
      picked: /Picked \(\d+\)/.test(pickedText),
      pickedQty: +(first(/Picked \((\d+)\)/, pickedText) || 0),
      pickedAt: first(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}):\d{2}/, c[7]),
      picker: first(/Picked \(\d+\)\s*\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?\s*(.+)$/, pickedText).trim(),
      progress: /Completed/.test(progressText) ? "Completed" : /Timed Out/i.test(progressText) ? "Timed out" : /In Progress/i.test(progressText) ? "In progress" : progressText,
      driver: [...c[8].matchAll(/(\d{2}:\d{2})\s*(?:&gt;|>)\s*Shop Driver \((\d+)\)/g)].map((x) => `${x[1]} shop driver (${x[2]})`),
    };
  }

  // Returns { ok, slips }. ok is false when the intranet sent something other
  // than the picking history page (usually the login page).
  function parsePicking(html) {
    const text = String(html || "");
    const ok = /RETAIL PICKING HISTORY/i.test(text);
    const slips = [];
    if (!ok) return { ok, slips };
    const start = text.search(/<table\b/i);
    const body = start >= 0 ? text.slice(start) : text;
    for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
      if (cells.length < 9) continue;
      const slip = parseSlip(cells);
      if (slip) slips.push(slip);
    }
    return { ok, slips };
  }

  // ------------------------------------------------------------ status

  const ORDER = { red: 0, new: 1, checking: 2, amber: 3, ok: 4, green: 5, grey: 6 };

  // The fix a salesperson sees on a red job. Every board writes these itself from
  // the codes, so the wording never depends on which version the RDP board runs.
  const FIX = { shop: "Put SHOP", date: "Incorrect date", waiting: "Tick Customer Waiting" };
  function shortFixes(r) {
    if (Array.isArray(r.codes) && r.codes.length) return r.codes.map((c) => FIX[c] || c);
    const out = [];
    for (const text of r.reasons || []) {       // results shared by an older RDP board
      const t = String(text);
      if (/ship via is blank|put shop/i.test(t)) out.push(FIX.shop);
      else if (/order date|incorrect date/i.test(t)) out.push(FIX.date);
      else if (/no picking slip|customer waiting/i.test(t)) out.push(FIX.waiting);
      else out.push(t);
    }
    return [...new Set(out)];
  }

  function slipSummary(slips, today) {
    const latest = slips.slice().sort((a, b) => (a.time < b.time ? 1 : -1))[0];
    const day = (latest.pickedAt || "").slice(0, 10);
    const when = !day || day === today ? latest.pickedAt.slice(11) : `${friendlyDate(day, today)} ${latest.pickedAt.slice(11)}`;
    const slipDay = (latest.time || "").slice(0, 10);
    const pick = latest.picked
      ? `picked ${when}${latest.picker ? " by " + latest.picker.replace(/^\d+-/, "") : ""}`
      : `not picked yet${slipDay && slipDay !== today ? ` (slip printed ${friendlyDate(slipDay, today)})` : ""}`;
    return {
      headline: `${latest.qty} × ${latest.desc || latest.sku}`,
      pick,
      progress: latest.progress,
      more: slips.length > 1 ? slips.length - 1 : 0,
    };
  }

  /* row: one WIP row from the reader.
     ctx: { today, nowMs, slips: Map(docKey → slip[]), searched: Map(docKey → ms),
            acks: { doc: {sig, by, at} } } */
  function evaluate(row, ctx) {
    const key = docKey(row.doc);
    const shipVia = String(row.shipVia || "").trim().toUpperCase();
    const today = ctx.today;
    const base = { doc: row.doc, key, row };

    if (!(Number(row.total) > 0)) return { ...base, status: "grey", label: "Not checked", reason: "No amount" };
    if (shipVia && shipVia !== SHOP) return { ...base, status: "grey", label: "Not checked", reason: `Ship via ${row.shipVia}` };

    const slips = (ctx.slips && ctx.slips.get(key)) || [];
    if (slips.length) return { ...base, status: "green", label: "Ordered", slips, summary: slipSummary(slips, today) };

    const anchor = row.orderDate && row.orderDate < today ? row.orderDate : today;
    const note = readComment(row.comment, anchor);
    if (note.noOrder) return { ...base, status: "ok", label: "No order needed", reason: `${note.noOrder} in comment` };
    if (row.orderDate && row.orderDate > today) {
      return { ...base, status: "amber", label: "Booked", until: row.orderDate, reason: `Booked for ${friendlyDate(row.orderDate, today)}` };
    }
    if (note.date && note.date > today) {
      return { ...base, status: "amber", label: "Waiting", until: note.date, reason: `Waiting until ${friendlyDate(note.date, today)}` };
    }
    if (note.hold) return { ...base, status: "amber", label: "On hold", reason: note.hold === "on hold" ? "HOLD in comment" : note.hold.charAt(0).toUpperCase() + note.hold.slice(1) };

    if (!(ctx.searched && ctx.searched.has(key))) {
      return { ...base, status: "checking", label: "Checking", reason: "Checking picking history" };
    }

    const changed = Date.parse(row.changedAt || "");
    if (Number.isFinite(changed) && ctx.nowMs - changed < GRACE_MINUTES * 60000) {
      return { ...base, status: "new", label: "Just changed", reason: "Slip due within 2 min", until: changed + GRACE_MINUTES * 60000 };
    }

    const ack = ctx.acks && ctx.acks[row.doc];
    if (ack && ack.sig === row.sig) {
      return { ...base, status: "ok", label: "Marked OK", reason: `Cleared by ${ack.by}`, ack };
    }

    // Short fixes for the salesperson; the longer explanation shows on hover.
    const codes = [], detail = [];
    if (!shipVia) { codes.push("shop"); detail.push("Ship Via is blank."); }
    if (row.orderDate && row.orderDate < today) { codes.push("date"); detail.push(`Order date is ${friendlyDate(row.orderDate, today)}; the slip only prints for today's date.`); }
    if (!codes.length) { codes.push("waiting"); detail.push("SHOP and the date are right, but no picking slip has printed."); }
    const reasons = codes.map((c) => FIX[c]);
    return { ...base, status: "red", label: "Not ordered", codes, reasons, reason: reasons.join(", "), detail: detail.join(" ") };
  }

  function compare(a, b) {
    if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
    if (a.status === "green") return a.row.doc < b.row.doc ? 1 : -1;
    if (a.status === "amber") return String(a.until || "9") < String(b.until || "9") ? -1 : 1;
    return (a.row.orderDate || "") < (b.row.orderDate || "") ? -1 : (a.row.orderDate || "") > (b.row.orderDate || "") ? 1 : (a.row.doc < b.row.doc ? -1 : 1);
  }

  const api = { GRACE_MINUTES, ORDER, FIX, shortFixes, isoOf, parseIso, addDays, friendlyDate, readComment, parsePicking, docKey, evaluate, compare, slipSummary, clean };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrderRules = api;
})(this);
