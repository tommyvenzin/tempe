// Node tests for Board/order-rules.js. Run: node Tests/test-order-rules.cjs
// WIP rows are the 32 real rows from the 2 Oct probe with customer names and
// regos replaced. Picking rows copy the intranet page's real markup.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const R = require(path.join(__dirname, "..", "..", "Website", "order-rules.js"));
const wip = JSON.parse(fs.readFileSync(path.join(__dirname, "wip-fixture.json"), "utf8"));
let groups = 0;
function group(name, fn) { fn(); groups++; console.log("PASS " + name); }

// ---------------------------------------------------------------- picking fixture

function slipRow(o) {
  const shipViaExtra = o.manual ? `<br><small><label class="label label-primary">MANUAL</label></small>` : "";
  const picked = o.picker
    ? `<td class="bg-success text-success">Picked (${o.qty})<br><div style="font-size:10px; color:#666666">${o.pickedAt}</div><label class="label label-success">${o.picker}</label></td>`
    : `<td class="bg-warning text-warning">Not Picked Yet</td>`;
  const progress = o.progress === "Completed"
    ? `<td class="bg-success text-success"><div><label class="label label-success">Completed</label></div><div style="font-size:10px; color:#666666">2026-10-02 15:08:31<br><div style="font-size:10px; color:#666666"><span class=" glyphicon glyphicon-time" aria-hidden="true"></span> 9 Min </div></div></td>`
    : o.progress === "Timed Out"
      ? `<td class="bg-warning text-warning">Timed Out<br><div style="font-size:10px; color:#ff0000"><span class=" glyphicon glyphicon-time" aria-hidden="true"></span> Timed Out</div></td>`
      : `<td class="bg-warning text-warning">In Progress<br><div style="font-size:10px; color:#666666"><span class=" glyphicon glyphicon-time" aria-hidden="true"></span> 40 Min </div><br>${o.driver ? `<div style="font-size:10px; color:#666666">${o.driver} &gt; Shop Driver (${o.qty})</div>` : ""}</td>`;
  const notes = o.notes ? `<br><div style="padding: 5px; " class="bg-info text-info">${o.notes}</div>` : "";
  return `
				<tr>
											<td>${o.time}</td>
					<td>
						<strong>${o.record}</strong><br>
						<small>
							${o.sku}						</small>
						<div class="label label-default">${o.bins}</div> <br>
						<small>
							${o.desc}${notes}						</small>
					</td>
					<td>${o.customer}<br><small>${o.note || ""}</small></td>
					<td>
						${o.doc}						<small><br>[ <a href="/retailpicking/history/?q=${o.by}" title="See all picking slips entered by ${o.by}">${o.by}</a> ]</small>
					</td>
					<td>
						<a href="/retailpicking/history/?q=${o.via}" title="See all picking slips of ${o.via}">${o.via}</a>${shipViaExtra}
					</td>
					<td>${o.qty}</td>
					<td class="bg-success text-success">Printed (${o.qty})<br><div style="font-size:10px; color:#666666">WH-SYD-LABELS-8</div><label class="label label-default">PCON</label></td>
					${picked}${progress}
				</tr>`;
}

function page(rows) {
  return `<html><body><div class="container"><span class="sub-header-title">RETAIL PICKING HISTORY<br><span class="branch-name">TEMPE BRANCH</span></span>
  <div class="row"><div class="col-md-12"><table class="table table-bordered table-condensed  table-striped table-responsive">
  <tbody><tr><th width="7%">Time</th><th width="25%">Record</th><th>Customer</th><th>Document</th><th>ShipVia</th><th>Qty</th><th>Labels Status</th><th>Picked</th><th>Progress</th></tr>
  <tr><td colspan="9" style="background-color:#eeeeee; font-weight:bold; font-size:20px; padding:15px 10px;">2026-10-02</td></tr>
  ${rows.map(slipRow).join("\n")}
  </tbody></table></div></div></div></body></html>`;
}

const base = { customer: "TEST CUSTOMER", by: "MOR", via: "SHOP", qty: 4, bins: "SI08/Z1072", sku: "W43517", desc: "WINRUN 265/65R17 112T MAXCLAW A/T" };
const fixtureRows = [
  { ...base, time: "14:48:27", record: "RT-11-20261002-144827-0003", doc: "07450543", by: "YF", qty: 2, desc: "KUMHO 275/35R20 102Y PS71 ECSTA", sku: "2206663" },
  { ...base, time: "14:54:01", record: "RT-1-20261002-145401-5001", doc: "07450543", by: "YF", qty: 2, manual: true, desc: "NEXEN 275/30R20 97Y N'FERA SU1", sku: "12716NXK", picker: "2437-LAURENCE DOVER", pickedAt: "2026-10-02 14:56:16", driver: "14:56" },
  { ...base, time: "14:24:26", record: "RT-11-20261002-142426-0003", doc: "07450402", by: "DB", qty: 1, picker: "1560-ROHIT GURUNG", pickedAt: "2026-10-02 14:33:27", driver: "14:34" },
  { ...base, time: "14:36:27", record: "RT-11-20261002-143627-0004", doc: "07450507", by: "MRA", picker: "204-LACHLAN BECK", pickedAt: "2026-10-02 14:42:45" },
  { ...base, time: "09:32:27", record: "RT-11-20261002-093227-0010", doc: "07448737", qty: 2, picker: "2437-LAURENCE DOVER", pickedAt: "2026-10-02 09:55:25", progress: "Completed" },
  { ...base, time: "14:28:27", record: "RT-11-20261002-142827-0003", doc: "07450468", picker: "2381-AJIT BISHWAS", pickedAt: "2026-10-02 14:32:35" },
  { ...base, time: "14:58:43", record: "RT-11-20261002-145843-0007", doc: "07450584", by: "JZA", customer: "CASH", picker: "204-LACHLAN BECK", pickedAt: "2026-10-02 15:07:39" },
  { ...base, time: "08:16:26", record: "RT-11-20261002-081626-0018", doc: "07448209", by: "ST", qty: 1, picker: "2069-RAJU CHAUDRY", pickedAt: "2026-10-02 08:22:32", progress: "Timed Out" },
  { ...base, time: "08:36:26", record: "RT-11-20261002-083626-0008", doc: "07448372", qty: 1, picker: "812-ADAM TALEB", pickedAt: "2026-10-02 08:43:50", progress: "Timed Out", notes: "W: 66.1 * 12X1.25<br>W: 70.6 * 1/2" },
  { ...base, time: "08:35:48", record: "RT-1-20261002-083548-5001", doc: "ALI SHOP STOCK", by: "AF", manual: true, picker: "738-NIRAJAN POUDEL", pickedAt: "2026-10-02 08:47:08" },
];
const yesterdayRows = [
  { ...base, time: "08:16:26", record: "RT-11-20261001-081626-0020", doc: "07424332", by: "TOG", qty: 2, picker: "1162-RAJ KUMAR THAPA", pickedAt: "2026-10-01 08:51:13", progress: "Timed Out" },
  { ...base, time: "10:14:25", record: "RT-11-20261001-101425-0006", doc: "07443169", by: "MRA", picker: "1162-RAJ KUMAR THAPA", pickedAt: "2026-10-01 10:16:04", progress: "Timed Out" },
];

// ---------------------------------------------------------------- tests

group("Picking page parser", () => {
  const parsed = R.parsePicking(page(fixtureRows));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.slips.length, fixtureRows.length);
  const manual = parsed.slips.find((s) => s.record === "RT-1-20261002-145401-5001");
  assert.equal(manual.doc, "07450543"); assert.equal(manual.docKey, "7450543");
  assert.equal(manual.manual, true); assert.equal(manual.picked, true);
  assert.equal(manual.picker, "2437-LAURENCE DOVER"); assert.equal(manual.pickedAt, "2026-10-02 14:56");
  assert.equal(manual.time, "2026-10-02 14:54"); assert.equal(manual.desc, "NEXEN 275/30R20 97Y N'FERA SU1");
  assert.deepEqual(manual.driver, ["14:56 shop driver (2)"]);
  const notPicked = parsed.slips.find((s) => s.record === "RT-11-20261002-144827-0003");
  assert.equal(notPicked.picked, false); assert.equal(notPicked.progress, "In progress"); assert.equal(notPicked.enteredBy, "YF");
  const wheelNotes = parsed.slips.find((s) => s.doc === "07448372");
  assert.deepEqual(wheelNotes.notes, ["W: 66.1 * 12X1.25", "W: 70.6 * 1/2"]);
  assert.equal(wheelNotes.desc, "WINRUN 265/65R17 112T MAXCLAW A/T");
  assert.equal(wheelNotes.progress, "Timed out");
  assert.equal(parsed.slips.find((s) => s.doc === "07448737").progress, "Completed");
  const stock = parsed.slips.find((s) => s.doc === "ALI SHOP STOCK");
  assert.equal(stock.docKey, "", "non-numeric documents never match a WIP job");
  assert.equal(R.parsePicking("<html>Please log in</html>").ok, false, "login page detected");
});

group("Picking parser copes with the raw intranet markup", () => {
  const raw = page(fixtureRows).replace(/class="([^"]*)"/g, "class='$1' data-x=\"1\"").replace(/<label class=/g, "<label  class=");
  const slips = R.parsePicking(raw).slips;
  const s = slips.find((x) => x.record === "RT-1-20261002-145401-5001");
  assert.equal(s.picker, "2437-LAURENCE DOVER", "picker found without exact markup");
  assert.equal(s.bins, "SI08/Z1072");
  assert.deepEqual(slips.find((x) => x.doc === "07448372").notes, ["W: 66.1 * 12X1.25", "W: 70.6 * 1/2"]);
  assert.equal(R.parsePicking(page(fixtureRows)).slips.find((x) => x.doc === "07450402").picker, "1560-ROHIT GURUNG");
});

group("Comment reader", () => {
  const fri = "2026-10-02";
  assert.deepEqual(pick(R.readComment("CHECK STOCK ON TUESDAY", "2026-10-01")), { date: "2026-10-06", hold: "checking stock" });
  assert.deepEqual(pick(R.readComment("06/10/26 8AM", fri)), { date: "2026-10-06", hold: "" });
  assert.deepEqual(pick(R.readComment("05/10 12PM ORDER IF CM COMES", fri)), { date: "2026-10-05", hold: "order if" });
  assert.deepEqual(pick(R.readComment("03/10 8AM", fri)), { date: "2026-10-03", hold: "" });
  assert.deepEqual(pick(R.readComment("EAR26Z 02.10.26 8.00AM", "2026-10-01")), { date: "2026-10-02", hold: "" });
  assert.deepEqual(pick(R.readComment("COA36*** NEED TO CONFORM**", fri)), { date: "", hold: "waiting to confirm" });
  assert.deepEqual(pick(R.readComment("CALLING TO CONFIRM", fri)), { date: "", hold: "waiting to confirm" });
  assert.deepEqual(pick(R.readComment("hold until paramatta sold the invoice", fri)), { date: "", hold: "on hold" });
  assert.deepEqual(pick(R.readComment("DQ72DR **** CUSTOMER DID NOT PAY", fri)), { date: "", hold: "not paid" });
  assert.deepEqual(pick(R.readComment("CR99XJ MT ORDER? NO STOCK", fri)), { date: "", hold: "no stock" });
  assert.deepEqual(pick(R.readComment("CAP273 WAIT FOR 3 PIECE", fri)), { date: "", hold: "waiting" });
  assert.deepEqual(pick(R.readComment("EXJ67A    SAT 9:00", fri)), { date: "2026-10-03", hold: "" });
  assert.deepEqual(pick(R.readComment("SAT 9:00", "2026-09-25")), { date: "2026-09-26", hold: "" }, "day names count from the order date");
  assert.deepEqual(pick(R.readComment("DHD75D TODAY 12PM", "2026-10-01")), { date: "2026-10-01", hold: "" });
  assert.deepEqual(pick(R.readComment("CUSTOMER WAITING", fri)), { date: "", hold: "" }, "a waiting customer is not a hold");
  assert.deepEqual(pick(R.readComment("R28688", fri)), { date: "", hold: "" });
  assert.deepEqual(pick(R.readComment("14X1.5 BOLTS", fri)).date < fri, true, "thread sizes never read as a future date");
  assert.deepEqual(pick(R.readComment("PAID TT - MICK ORDERED THE TYRES", fri)), { date: "", hold: "" });
});
function pick(c) { return { date: c.date, hold: c.hold }; }

group("A $ in the comment means waiting for payment", () => {
  for (const c of ["$", "$$", "$$$", "ABC123 $$ BEFORE FITTING", "UNPAID $$$"]) {
    assert.equal(R.readComment(c, "2026-10-02").hold, "waiting for payment", "should hold: " + c);
  }
  for (const c of ["PAID TT", "PAID $$$", "PAID TT - MICK ORDERED THE TYRES"]) {
    assert.notEqual(R.readComment(c, "2026-10-02").hold, "waiting for payment", "PAID wins: " + c);
  }
  const ctx = { today: "2026-10-02", nowMs: 0, slips: new Map(), searched: new Map([["7329537", 1], ["7251024", 1]]), acks: {} };
  const dollars = R.evaluate({ doc: "07329537", orderDate: "2026-08-21", total: 3768, shipVia: "SHOP", comment: "$$$", by: "KTJ", sig: "a" }, ctx);
  assert.equal(dollars.status, "amber"); assert.equal(dollars.label, "On hold"); assert.equal(dollars.reason, "Waiting for payment");
  const paid = R.evaluate({ doc: "07251024", orderDate: "2026-07-25", total: 2000, shipVia: "SHOP", comment: "PAID TT", by: "KTJ", sig: "b" }, ctx);
  assert.equal(paid.status, "red", "PAID TT stays not ordered"); assert.deepEqual(paid.reasons, ["Incorrect date"]);
});

group("Comments that clear a job (no order needed)", () => {
  for (const c of ["NO ORDER", "ABC123 no order - alignment", "DON'T ORDER", "DO NOT ORDER", "SERVICE ONLY", "OWN TYRES", "CUSTOMERS OWN TYRES", "ALIGNMENT ONLY", "FIT ONLY", "REPAIR ONLY", "NOT NEEDED"]) {
    assert.ok(R.readComment(c, "2026-10-02").noOrder, "should clear: " + c);
  }
  for (const c of ["PAID TT - MICK ORDERED THE TYRES", "ORDER TYRES", "NO STOCK", "CUSTOMER WAITING", "R28688"]) {
    assert.equal(R.readComment(c, "2026-10-02").noOrder, "", "should not clear: " + c);
  }
  const ctx = { today: "2026-10-02", nowMs: 0, slips: new Map(), searched: new Map([["7450001", 1]]), acks: {} };
  const r = R.evaluate({ doc: "07450001", orderDate: "2026-09-30", total: 120, shipVia: "SHOP", comment: "ABC123 ALIGNMENT ONLY", by: "DB", sig: "x" }, ctx);
  assert.equal(r.status, "ok"); assert.equal(r.label, "No order needed");
});

group("Real WIP rows on Friday 2 Oct afternoon", () => {
  const slips = new Map();
  for (const s of [...R.parsePicking(page(fixtureRows)).slips, ...R.parsePicking(page(yesterdayRows)).slips]) {
    if (!s.docKey) continue;
    if (!slips.has(s.docKey)) slips.set(s.docKey, []);
    slips.get(s.docKey).push(s);
  }
  const searched = new Map(wip.map((r) => [R.docKey(r.doc), Date.parse("2026-10-02T16:00:00+10:00")]));
  const ctx = { today: "2026-10-02", nowMs: Date.parse("2026-10-02T16:30:00+10:00"), slips, searched, acks: {} };
  const status = Object.fromEntries(wip.map((r) => [r.doc, R.evaluate(r, ctx)]));
  const expect = {
    green: ["07450543", "07450402", "07450507", "07448737", "07424332", "07450468", "07450584", "07443169", "07448209", "07448372"],
    grey: ["07083476", "07437348", "07450651", "06889029", "07450537", "07446718"],
    amber: ["07377421", "07447742", "07447520", "07401877", "07444431", "07449214", "07450839", "07242097", "06832143", "07432349"],
    red: ["07423746", "07251024", "06864628", "07179244", "07372696", "07431410"],
  };
  for (const [want, docs] of Object.entries(expect)) {
    for (const doc of docs) assert.equal(status[doc].status, want, `${doc} should be ${want}, got ${status[doc].status} (${status[doc].reason || ""})`);
  }
  assert.equal(Object.values(expect).flat().length, wip.length, "every row is covered");
  assert.equal(status["07444431"].until, "2026-10-06", "CHECK STOCK ON TUESDAY waits until Tuesday");
  assert.equal(status["07447742"].label, "Booked");
  assert.deepEqual(status["07179244"].reasons, ["Put SHOP", "Incorrect date"]);
  assert.deepEqual(status["07179244"].codes, ["shop", "date"]);
  assert.deepEqual(R.shortFixes({ reasons: ["Ship Via is blank. Put SHOP and tick Customer waiting.", "Order date is Sat, 25 July. Change it to today, or the slip won't print."] }), ["Put SHOP", "Incorrect date"], "older RDP board's sentences");
  assert.deepEqual(R.shortFixes({ reasons: ["No picking slip. Check Customer waiting is ticked."] }), ["Tick Customer Waiting"]);
  assert.deepEqual(R.shortFixes({ codes: ["waiting"], reasons: ["anything"] }), ["Tick Customer Waiting"]);
  assert.match(status["07179244"].detail, /Ship Via is blank\. Order date is .*today's date/);
  assert.equal(status["07432349"].label, "On hold"); assert.equal(status["07432349"].reason, "HOLD in comment");
  assert.equal(status["07449214"].reason, "Waiting to confirm");
  assert.equal(status["07447520"].reason, "Waiting until " + R.friendlyDate("2026-10-06", "2026-10-02"));
  assert.equal(status["07450839"].reason, "Booked for tomorrow");
  assert.equal(status["07437348"].reason, "Ship via DFE");
  assert.equal(status["07450543"].summary.more, 1, "two slips on one document");
  assert.equal(status["07443169"].status, "green", "a slip beats a HOLD comment");
  assert.equal(status["07450402"].summary.pick, "picked 14:33 by ROHIT GURUNG", "today's pick shows the picker");
  assert.match(status["07424332"].summary.pick, /^picked .*1.* 08:51 by RAJ KUMAR THAPA$/, "older picks show their date");
  assert.equal(status["07450543"].summary.pick, "picked 14:56 by LAURENCE DOVER");
});

group("Old order date with SHOP set (the slip will never print)", () => {
  const row = { doc: "07450001", orderDate: "2026-09-30", total: 640, shipVia: "SHOP", comment: "ABC123", by: "MOR", sig: "a", changedAt: "" };
  const ctx = { today: "2026-10-02", nowMs: Date.parse("2026-10-02T10:00:00+10:00"), slips: new Map(), searched: new Map([["7450001", 1]]), acks: {} };
  const r = R.evaluate(row, ctx);
  assert.equal(r.status, "red");
  assert.deepEqual(r.reasons, ["Incorrect date"]);
});

group("History search, grace period and OK marks", () => {
  const row = { doc: "07450999", orderDate: "2026-10-02", total: 500, shipVia: "SHOP", comment: "", by: "DB", sig: "s1", changedAt: "2026-10-02T10:00:00+10:00" };
  const base = { today: "2026-10-02", slips: new Map(), acks: {} };
  assert.equal(R.evaluate(row, { ...base, nowMs: Date.parse("2026-10-02T10:01:00+10:00"), searched: new Map() }).status, "checking", "unsearched documents are looked up first");
  const searched = new Map([["7450999", 1]]);
  assert.equal(R.evaluate(row, { ...base, nowMs: Date.parse("2026-10-02T10:03:00+10:00"), searched }).status, "new", "2 minutes after SHOP was set");
  const late = R.evaluate(row, { ...base, nowMs: Date.parse("2026-10-02T10:06:00+10:00"), searched });
  assert.equal(late.status, "red", "6 minutes later with no slip");
  assert.deepEqual(late.reasons, ["Tick Customer Waiting"], "SHOP and date right: customer waiting wasn't ticked");
  const acked = { ...base, nowMs: Date.parse("2026-10-02T10:06:00+10:00"), searched, acks: { "07450999": { sig: "s1", by: "MOR" } } };
  assert.equal(R.evaluate(row, acked).status, "ok");
  assert.equal(R.evaluate({ ...row, sig: "s2", changedAt: "" }, acked).status, "red", "an OK mark stops counting when the job changes");
  const blank = R.evaluate({ ...row, shipVia: "", changedAt: "" }, { ...base, nowMs: 0, searched });
  assert.deepEqual(blank.reasons, ["Put SHOP"]);
  assert.equal(R.evaluate({ ...row, total: 0 }, { ...base, nowMs: 0, searched }).status, "grey");
});

group("Sorting puts alerts first", () => {
  const items = ["green", "red", "amber", "grey", "new", "ok", "checking"].map((s, i) => ({ status: s, row: { doc: "0" + i, orderDate: "2026-10-02" } }));
  assert.deepEqual(items.sort(R.compare).map((x) => x.status), ["red", "new", "checking", "amber", "ok", "green", "grey"]);
});

group("COSTAR helper tags come only from TTW / MJC references in the PO column", () => {
  assert.deepEqual(R.helperRef(" ttw1730377 "), { kind: "online", ref: "TTW1730377" });
  assert.deepEqual(R.helperRef("MJC-09D93BDAD411"), { kind: "mobile", ref: "MJC-09D93BDAD411" });
  for (const po of ["", null, undefined, "PO 4471", "FLEET-2231", "TTW", "TTW12", "MJC-123", "MJC-09D93BDAD41G"]) assert.equal(R.helperRef(po), null, "not a helper reference: " + po);
  const ctx = { today: "2026-10-02", nowMs: 0, slips: new Map(), searched: new Map([["7450002", 1], ["7450003", 1]]), acks: {} };
  const job = { doc: "07450002", orderDate: "2026-10-02", total: 450, shipVia: "SHOP", comment: "ABC123 - SAT - ONLINE 10:30", by: "TOG", sig: "s" };
  const online = R.evaluate({ ...job, po: "TTW1730377" }, ctx), untagged = R.evaluate(job, ctx);
  assert.equal(online.status, untagged.status, "the tag never changes the status");
  assert.equal(online.label, untagged.label);
  assert.equal(online.status, "amber", "a helper pickup comment (REGO - DAY - ONLINE time) waits until its day");
  assert.deepEqual(online.helper, { kind: "online", ref: "TTW1730377" });
  const grey = R.evaluate({ doc: "07450003", orderDate: "2026-10-02", total: 0, shipVia: "SHOP", comment: "", by: "TOG", sig: "s", po: "MJC-09D93BDAD411" }, ctx);
  assert.equal(grey.status, "grey");
  assert.equal(grey.helper.kind, "mobile", "every status carries the tag");
  const plain = R.evaluate({ doc: "07450004", orderDate: "2026-10-02", total: 0, shipVia: "", comment: "", by: "MOR", sig: "s", po: "FLEET-2231" }, ctx);
  assert.equal(plain.helper, undefined, "a customer's own PO is never tagged or shared");
});

console.log(`${groups} test groups passed.`);
