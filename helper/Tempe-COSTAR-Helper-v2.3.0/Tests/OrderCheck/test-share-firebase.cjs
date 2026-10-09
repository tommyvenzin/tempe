// Node tests for Board/share.js (the part that runs without Firebase).
const assert = require("node:assert/strict");
const path = require("node:path");
const Share = require(path.join(__dirname, "..", "..", "OrderCheck", "Sharing", "firebase-last-resort", "share.js"));
const slip = (i) => ({ time: `2026-10-0${i % 2 ? 1 : 2} 1${i}:00`, qty: 4, desc: "WINRUN 265/65R17", sku: "W43517", bins: "SI08", manual: false, picked: true, pickedAt: "2026-10-02 14:00", picker: "1162-RAJ", progress: "Completed", driver: [], record: "RT-" + i, docKey: "7450421", customer: "SECRET" });
const out = Share._slim({
  status: "green", label: "Ordered", reason: undefined, until: undefined,
  row: { doc: "07450421", orderDate: "2026-10-02", name: "TEST", total: "1260.00", shipVia: "SHOP", comment: "R1", by: "MOR", sig: "abc", phone: "0400000000" },
  summary: { headline: "4 × WINRUN", pick: "picked 14:00", progress: "Completed", more: 7 },
  slips: Array.from({ length: 8 }, (_, i) => slip(i)),
  ack: { sig: "abc", by: "MOR", email: "x@y" },
});
assert.equal(out.row.total, 1260, "total is a number");
assert.equal(out.row.phone, undefined, "no phone numbers");
assert.equal("until" in out, false, "undefined values removed");
assert.equal(out.reason, "");
assert.equal(out.slips.length, 6, "at most 6 slips");
assert.ok(out.slips[0].time >= out.slips[5].time, "newest slips first");
assert.equal(out.slips[0].customer, undefined, "slip customer not shared");
assert.equal(out.slips[0].record, undefined);
assert.deepEqual(out.ack, { by: "MOR" }, "OK mark keeps only initials");
assert.equal(Share.toMs({ toMillis: () => 5 }), 5);
assert.equal(Share.toMs(7), 7);
assert.equal(Share.toMs(null), 0);
console.log("PASS share payload: numbers, no phone or slip customer, 6-slip cap, newest first, undefined removed.");
