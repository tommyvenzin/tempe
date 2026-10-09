# Order Check (WIP vs retail picking) — v1.4.0

Added 2 October 2026. Separate package from the 1.6.1 helper (the helper ZIP was not touched).

## Why

A Repair Order only creates a retail picking slip (the tyres get "ordered") when the salesperson sets
Ship Via = SHOP, ticks Customer waiting, and the order date is **today**. ROs made on an earlier day keep
their old date, so the slip never prints. Order Check flags SHOP jobs with an amount and no slip.

## Architecture

| Part | Where | Notes |
|---|---|---|
| Reader `OrderCheck.exe` (C# 5, `Source/OrderCheck.cs`) | RDP session | Reads WIP grid `ultraGrid1` (Infragistics) via MSAA. Only 9 of 45 columns. Presses the WIP Search button via MSAA `accDoDefaultAction` (no focus or mouse). Below-normal priority, every 2 min, shop hours. Serves `GET /wip.json`, `POST /ack /unack /refresh` on `127.0.0.1:8795` (Host and Origin checked, POST needs `X-Order-Check: 1`). |
| Board `Board/Order_Check.html` | Chrome in the RDP session (file:// or GitHub Pages) | Gets WIP from the reader and picking from `my.tempetyres.com.au/retailpicking/history/` through the extension (needs bridge 1.0.2: `order_check.html` allowlisted). Loads 7 days, then today every 2 min; any doc without a slip gets one history search `?day=0&month=0&year=0&q=<doc>&searchin=Document`, cached 12 h. |
| Rules `Board/order-rules.js` | Board + Node tests | Picking parser (regex, no DOM), comment reader, status engine. |

Data source facts (from the 2 Oct probes): WIP grid exposes all 79 rows (not just visible ones) through
MSAA; it lists the active row twice (dedupe by doc); `PICKSTATUS` exists but is always empty.

## Team sharing (1.2.0): encrypted file on GitHub

Chosen over Firebase (kept as last resort in `Sharing/firebase-last-resort`) and the desk receiver.

- The **RDP board** (reader reachable, set up with a fine-grained token for the public repo
  `tommyvenzin/tempe-board-data`, Contents read/write only) gzips and encrypts `{meta, rows}` with
  AES-256-GCM (key: PBKDF2-SHA256, 600,000 rounds, salt `tempe-order-check|owner/repo`) and saves
  `order-check.json` as an orphan commit force-pushed to `main` (no history growth). It saves only when
  rows or problems change, at most once a minute, plus a heartbeat every 4 minutes.
- **Viewers** poll `raw.githubusercontent.com/.../order-check.json?t=` every minute (the CDN may add up to
  5 minutes), decrypt with the team passphrase stored on their device, and warn after 12 minutes stale.
- **Mark OK** stays on the RDP board (reader acks). Anyone can clear a job with a COSTAR comment:
  NO ORDER, SERVICE ONLY, ALIGNMENT ONLY, FIT ONLY, REPAIR ONLY, OWN TYRES, NOT NEEDED → "No order needed".
- 1.2.1 fixes (found on the first real run, 2 Oct evening): a board whose reader hadn't read yet
  shared an EMPTY list and overwrote the team board. Now: no sharing before a real read or when the list
  suddenly drops to zero; one sharing board at a time (6-minute lease checked through the GitHub API before
  each save; board id kept in localStorage across reloads); browsers without the extension always show the
  shared board (no direct reader fallback when sharing is on); the reader does its first read straight after
  starting even outside shop hours.
- 1.2.2 (first real board, 2 Oct): picker names were missing because the raw intranet HTML differs from a
  DOM copy; the picker is now read from the cell text and class matching tolerates quote style and extra
  attributes. Older picks show their date; "timed out" is left out of the summary line.
- 1.3.0 (Tommy's layout request): Order date, Total and Ship via columns removed; red rows say only the fix
  ("Put SHOP", "Incorrect date", "Tick Customer waiting") with the explanation on hover; other statuses use
  short phrases. HOLD in the comment is the advertised way to clear a job (amber "On hold"). The shared file
  no longer carries totals or Ship Via.
- 1.3.1: GitHub Pages caches files for up to 10 minutes, so phones kept old boards. Scripts now load with
  `?v=<version>`, the version shows in the header, and a team view reloads itself (once, fresh address) when the
  RDP board shares a newer version (retry after 10 minutes, never a loop). Operator-only notes ("You're using the
  WIP COSTAR window", shop hours, paused) are no longer shared with the team.
- 1.3.2: red fixes are shared as codes (shop/date/waiting) and every board renders "Put SHOP", "Incorrect date",
  "Tick Customer Waiting" itself (older RDP boards' sentences are translated). No hint text. Every board checks
  `order-check.js?check=<time>` 30 s after loading and every 10 minutes and reloads itself once when GitHub has a
  newer version, so after uploading files nothing needs a manual refresh.
- 1.3.2 also: a "$" in the comment means waiting for payment → On hold (unless the comment says PAID, e.g.
  "PAID TT" stays a normal job). Jobs still "checking" are never shared: at midnight tomorrow's bookings
  became today's, the 30-second timer re-evaluated and shared them mid-search, so the team saw "Checking
  picking history" for minutes while the RDP board had already resolved them. Now the timer searches
  first, the cycle repeats search rounds (40 per round), and sharing waits for the search (max 5 minutes).
- Removing someone = change the passphrase. The token and passphrase live in the RDP Chrome's storage.
- Tested with GitHub simulated (API calls, encryption, throttling, wrong or changed passphrase, tampering).
  Not yet run against real GitHub.

## 1.4.0: works with the COSTAR helper (3 Oct 2026)

- Reader: optional PO column, found by name (PO, PO #, PO No, PO Number, Customer PO, Cust PO, Purchase Order). It is read with the other columns and published as `po`; `poColumn` and the full WIP `columns` list are in wip.json. The reader window says "Helper tags use the "…" column" or "Helper tags off".
- Rules: `helperRef(po)` gives `{kind: online, ref: TTW…}` or `{kind: mobile, ref: MJC-…}`; `evaluate` adds `helper` to every result without changing its status.
- Board: "Online" / "Mobile" tag next to the document number; search matches the reference. Sharing carries only `{kind, ref}`, never raw PO numbers.
- Helper 1.9.0 uses `po` to refuse entering an online order that is already in WIP, reads `%LOCALAPPDATA%\TempeOrderCheck\settings.json` (`targetKey` = PID@local start ticks) to never type into Order Check's COSTAR, and auto-selects the other Tempe COSTAR.
- Helper online pickup comments (`REGO - DAY - ONLINE time`) read as "Waiting until <day>" (amber), which fits booked pickups.
- 15 C# self-test groups (adds PO column), 10 rules test groups.
- Not yet confirmed: the exact WIP PO column name. If the reader says "Helper tags off", send its column list (wip.json `columns`).

## Status rules

grey ($0 or Ship Via not SHOP/blank) → green (any slip for the doc) → amber (order date in future;
comment date in future; hold word) → checking (history not searched yet) → new (changed < 5 min) →
OK (Mark OK with matching signature) → red. Signature = Ship Via | order date | total | comment | Written By.

## Known gaps / next

- Service-only SHOP jobs show red until Mark OK. Level 2 would read RO lines.
- Target COSTAR window is remembered by PID + start time, so it is re-chosen after a COSTAR restart.
- Not yet run on Windows: confirm compile, 15 self-test groups, first read time, Search press.
