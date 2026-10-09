// Node tests for Board/share.js (GitHub backend) with GitHub simulated in memory.
// Uses the real Web Crypto encryption, so the passphrase rounds take a few seconds.
const assert = require("node:assert/strict");
const path = require("node:path");
const file = path.join(__dirname, "..", "..", "Website", "share.js");
const saved = new Map();
globalThis.localStorage = { getItem: (k) => (saved.has(k) ? saved.get(k) : null), setItem: (k, v) => saved.set(k, String(v)), removeItem: (k) => saved.delete(k) };
let calls = [], repoFile = null;
const reply = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
  if (url.startsWith("https://raw.githubusercontent.com/tommyvenzin/tempe-board-data/main/order-check.json?t=")) return repoFile ? reply(200, repoFile) : reply(404, "404: Not Found");
  if (url === "https://api.github.com/repos/tommyvenzin/tempe-board-data") return reply(200, { private: false });
  if (url.includes("/contents/order-check.json?ref=main")) return repoFile ? reply(200, { content: Buffer.from(repoFile).toString("base64").replace(/(.{60})/g, "$1\n") }) : reply(404, { message: "Not Found" });
  if (url.endsWith("/git/trees")) { const b = JSON.parse(opts.body); repoFile = b.tree.find((t) => t.path === "order-check.json").content; assert.ok(b.tree.find((t) => t.path === "README.md")); return reply(201, { sha: "tree1" }); }
  if (url.endsWith("/git/commits")) { assert.deepEqual(JSON.parse(opts.body).parents, [], "orphan commit, no history"); return reply(201, { sha: "commit1" }); }
  if (url.endsWith("/git/refs/heads/main")) { assert.equal(opts.method, "PATCH"); assert.equal(JSON.parse(opts.body).force, true); return reply(200, {}); }
  return reply(500, "unexpected " + url);
};
const config = { backend: "github", owner: "tommyvenzin", repo: "tempe-board-data", branch: "main" };
const tick = () => new Promise((r) => setTimeout(r, 5));
function fresh() { delete require.cache[require.resolve(file)]; return require(file); }
const result = (doc, status, extra = {}) => ({ status, label: status, reason: "", row: { doc, orderDate: "2026-10-02", name: "CUSTOMER SECRET " + doc, total: 500, shipVia: "SHOP", comment: "ABC123", by: "MOR", sig: "s" + doc }, ...extra });
const saves = () => calls.filter((c) => c.url.endsWith("/git/refs/heads/main")).length;

setTimeout(() => { console.error("FAIL: timed out"); process.exit(1); }, 90000).unref();
(async () => {
  // ---- RDP PC sets up sharing
  const pub = fresh(); let clock = 1_000_000; pub._test.setClock(() => clock);
  const auths = [];
  assert.equal(await pub.start({ ...config, backend: "firebase" }, () => {}), false, "other backends are ignored");
  assert.equal(await pub.start(config, (a) => auths.push(a)), true); await tick();
  assert.equal(auths.at(-1).user, null, "not set up yet");
  await assert.rejects(pub.signIn("", "too short", "tok"), /at least 16/);
  const pass = pub.suggestPassphrase();
  assert.equal(pass.split("-").length, 6); assert.ok(pass.split("-").every((w) => pub._test.words.includes(w)));
  assert.equal(new Set(pub._test.words).size, 256, "256 different words");
  await pub.signIn("", pass, "github_pat_TEST");
  assert.equal(auths.at(-1).role, "publisher");
  const repoCall = calls.find((c) => c.url === "https://api.github.com/repos/tommyvenzin/tempe-board-data");
  assert.equal(repoCall.headers.Authorization, "Bearer github_pat_TEST");

  // ---- first save
  const rows = [result("07450421", "red", { reasons: ["No picking slip."] }), result("07450468", "green", { summary: { headline: "4 × KUMHO", pick: "picked 14:32", progress: "In progress", more: 0 } })];
  await pub.publish(rows); await pub.beat({ readAt: "2026-10-02T16:28:10+10:00", jobs: 2, problems: [] });
  assert.equal(saves(), 1, "saved once");
  assert.ok(repoFile && !/CUSTOMER|SECRET|07450421|MOR|KUMHO/.test(repoFile), "nothing readable in the GitHub file");
  assert.deepEqual(Object.keys(JSON.parse(repoFile)), ["v", "app", "iv", "data"]);

  // ---- throttling: unchanged = no save; changed = wait for the 1-minute gap; heartbeat every 4 min
  await pub.publish(rows); assert.equal(saves(), 1, "unchanged rows are not saved again");
  const changed = [result("07450421", "ok", { ack: { by: "MOR" } }), rows[1]];
  clock += 20_000; await pub.publish(changed); assert.equal(saves(), 1, "a change within a minute waits");
  clock += 45_000; await pub.publish(changed); assert.equal(saves(), 2, "then saves");
  clock += 60_000; await pub.publish(changed); assert.equal(saves(), 2, "no change, no save");
  clock += 4 * 60_000; await pub.publish(changed); assert.equal(saves(), 3, "heartbeat save after 4 minutes");

  // ---- a second sharing board (another PC) can't overwrite the first
  const boardKey = pub._test.KEYS.board;
  const keep = new Map(saved); saved.delete(boardKey);
  const other = fresh(); let otherClock = clock; other._test.setClock(() => otherClock);
  await other.start(config, () => {}); await tick();
  await other.signIn("", pass, "github_pat_TEST");
  await other.beat({ readAt: "2026-10-02T16:30:00+10:00", jobs: 1, problems: [] });
  const before = saves();
  await assert.rejects(other.publish([result("07450999", "red")]), (e) => e.code === "other-board");
  assert.equal(saves(), before, "nothing overwritten while the first board is active");
  otherClock = clock + 7 * 60_000;
  await other.publish([result("07450999", "red")]);
  assert.equal(saves(), before + 1, "takes over after 6 quiet minutes");
  // the first board, reloaded (same browser, same board id), takes it back once it's quiet again
  for (const [k, v] of keep) saved.set(k, v);
  const reloaded = fresh(); reloaded._test.setClock(() => otherClock + 7 * 60_000);
  assert.equal(reloaded.tab, pub.tab, "board id survives a reload");
  await reloaded.start(config, () => {}); await tick();
  await reloaded.beat({ readAt: "2026-10-02T16:40:00+10:00", jobs: 2, problems: [] });
  await reloaded.publish(changed);
  assert.equal(saves(), before + 2);

  // ---- a salesperson's phone
  saved.clear();
  const view = fresh(); view._test.setClock(() => clock + 1);
  const vAuth = [];
  await view.start(config, (a) => vAuth.push(a)); await tick();
  assert.equal(vAuth.at(-1).user, null);
  await assert.rejects(view.signIn("", "wrong wrong wrong wrong"), (e) => e.code === "wrong-passphrase");
  await view.signIn("", pass);
  assert.equal(vAuth.at(-1).role, "viewer");
  const got = await new Promise((resolve) => { const stop = view.watchRows((m) => { stop(); resolve(m); }); });
  assert.equal(got.get("07450421").status, "ok");
  assert.equal(got.get("07450421").row.name, "CUSTOMER SECRET 07450421", "decrypted on the phone");
  assert.equal(got.get("07450468").summary.headline, "4 × KUMHO");
  const status = await new Promise((resolve) => { const stop = view.watchStatus((s) => { stop(); resolve(s); }); });
  assert.equal(status.jobs, 2); assert.ok(status.beatAt > 0);

  // ---- tampering is detected
  const f = JSON.parse(repoFile); f.data = f.data.slice(0, 10) + (f.data[10] === "A" ? "B" : "A") + f.data.slice(11);
  await assert.rejects(view._test.unseal(JSON.stringify(f), pass), (e) => e.code === "wrong-passphrase");

  // ---- passphrase changed on the RDP PC: the phone asks for the new one
  const pub2 = fresh(); pub2._test.setClock(() => clock + 10);
  saved.clear(); await pub2.start(config, () => {}); await tick();
  await pub2.signIn("", "new-team-passphrase-2026", "github_pat_TEST");
  await pub2.beat({ readAt: "2026-10-02T16:50:00+10:00", jobs: 2, problems: [] });
  await pub2.publish(changed);
  saved.clear(); saved.set(view._test.KEYS.pass, pass);
  const asked = await new Promise((resolve) => {
    const v2 = fresh(); v2._test.setClock(() => clock + 20);
    v2.start(config, (a) => { if (a.user) v2.watchRows(() => {}); else if (a.error) resolve(a.error); });
  });
  assert.match(asked, /passphrase has changed/);
  console.log(`PASS GitHub sharing: setup, encryption (nothing readable on GitHub), ${saves()} throttled saves as orphan commits, phone unlock, wrong passphrase, tampering, passphrase change.`);
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
