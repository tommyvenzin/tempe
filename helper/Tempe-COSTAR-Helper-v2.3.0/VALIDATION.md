# Validation — v2.3.0 — 9 October 2026

## Basis

- Tommy (9 Oct): COSTAR loses DET's notes on close when DET is entered last. Enter DET first on line 6, items above. Also: work with any COSTAR branch open on the PC (Branch 1 orders).
- Real captures (2 Oct, empty and filled Repair Orders): 25 item boxes, all enabled, 19 px apart, line labels 1–25 alongside, so box N is line N.
- Day logs 3–5 Oct: only "COSTAR:  11 Tempe Tyres Tempe" was ever seen, so the branch parser is written for the known format and tested on invented titles for other branches.

## Changes

- **Branches** (`CostarSession.cs`): `Branches.OfMain` / `NameOfMain` / `OfOrder` / `MainTitle(title,branch)` / `OrderTitle(title,branch)` / `OrLegacy` / `Place` / `StoreMatches`.
  - `CostarInstance` carries Branch, BranchName and Label; `Same` includes the branch.
  - Every former `Branch11` check compares with the selected or recorded branch: detection, Main, OnlineOrder, OpenNew, ValidateTarget, the Runner constructor, and online window reuse/resume.
  - `MobileCheckpoint.branch` (0 = legacy Branch 11). `Runner(pid, branch, …)`; diagnostics Env "branch".
  - `Selectors.Blank/BlankDelivery(s, branch)`: Branch 11 keeps TEMPE/NSW; other branches accept their own default suburb and a valid AU state.
  - Worker window: branch labels, a remembered branch (`preferred-branch.txt`), mobile paused when the branch changes while mobile is enabled, and the yellow bold update line.
- **Store check** (`AutofillForm.CheckStoreBranch`): pickup store vs branch place (strict). On a mismatch, a Yes/No dialog names any matching open COSTAR; the answer is remembered per store and branch for the session. Logged as `online_branch_question` / `online_branch_confirmed` / `online_branch_refused`.
  - While the dialog is open (`askingBranch`), the clipboard timer and `StartEntry` do nothing: a WinForms timer still ticks under a message box, and before this guard a newly copied order could replace the one being asked about. The order is captured before asking and must still be the one on screen afterwards. A minimised helper window is restored and activated first.
- **Website** (`OnlineOrders/Tempe-Orders-COSTAR.html` = GitHub testrun.html, and `transfer-core.js`, identical rules):
  - pickups from any store; `store` sent; schema 3 for non-Tempe pickups (refused by helpers before 2.3.0), schema 1 for Tempe;
  - Store picker (localStorage), store-aware titles and list;
  - COSTAR check limited to Tempe.
  - The helper validates schema 3 and requires a store.
- **DET first:**
  - `Order.DetLine(itemLines)` = max(6, itemLines+2).
  - `Grid.EvenLines` / `LineOf`; `Runner.LineRow` (requires empty line and even spacing), `ItemRowAbove` (next free line above DET, or the old after-everything rule when none fits), `RequireNotesUnderDet`.
  - `AddCode(…, line, above)`.
  - Online pickups: DET block (DET, template, notes check, MAKE/MODEL, REGO NO, ODOMETER, PAYING BY), then items above. Resume reuses an existing DET at its own line; if its notes are missing (stopped right after DET was typed), it leaves the grid once (`LeaveForDetNotes`, else `LeaveGrid`) so they appear. The final check requires exactly one DET.
  - Mobile plan v3: DET (line), notes, notes row, then items on lines 1..n. `MobileRow.line` comes from the snapshot. `After` checks the planned line for add/det steps (DET block consecutive from its line); line-0 steps keep the old rules. `PrepareCheckpoint` moves unstarted older-plan jobs to v3 and refuses started ones (as before).
- **Launch.ps1:** if the build or self-tests fail in the package `current.txt` points to, the pointer is renamed `current.txt.failed` first. Then it points at the newest earlier installed package (`packages\Tempe-COSTAR-Helper-v*` with a lower `VERSION.txt` and a Launch.ps1), so old shortcuts hand over to it (2.2.1 on Tommy's PC). With none, there is no pointer and each shortcut starts its own folder. The message names the version that starts.
- **Self-tests 81–85:** branch titles and instances; store and suburb rules; DET placement and line-checked item proofs (positive and negative); grid lines and the DET line rule; old-plan checkpoints; schema 3.

## Checks performed here

- **Compiled with a real C# compiler** (new for this release): Roslyn from PowerShell 7.4.6 (GitHub release) at `LanguageVersion.CSharp5`, against .NET Framework 4.8 reference assemblies (`mono/reference-assemblies` on GitHub), with Build.ps1's reference list and again with the framework's full csc.rsp list: **0 errors**, the same 3 harmless warnings as 2.2.1. The known-good 2.2.1 compiles the same way, so the method agrees with the RDP PC's csc. (Against 4.5 references the X509 `using` blocks fail in both versions: the PC has .NET 4.6 or later.)
- **Self-tests run** under .NET 8 (compiled as above; a stand-in for `JavaScriptSerializer`; `AutofillForm.SelfTest` moved out of the Form class in the scratch copy only): **81 of 85** helper groups and **16 of 16** Order Check groups pass. The 4 that fail need Windows (process identity, a WinForms TextBox, folder ACLs, user32) and fail identically for 2.2.1 (76 of 80 there).
- **Launcher fallback**, 6 scenarios with PowerShell: a failed update points back to 2.2.1 ("starts version 2.2.1 again") and an old 2.2.0 shortcut then hands over to 2.2.1; with only 2.3.0 installed the pointer is set aside; a failing folder that isn't the pointer target leaves it alone; a passing update changes nothing and old shortcuts hand over to it.
- **Page:** the inline script parses and runs against a fake DOM (Store picker rendered with Tempe NSW, a choice is remembered and the list reloads). `transfer-core.js` is embedded verbatim; Tempe → schema 1, other stores → schema 3 with the store named.
- Static checks (balance, C# 6+ syntax, shadowing, `using`s, one entry point) and a line-by-line diff review against 2.2.1.
- Node: package, job card, startup, Order Check rules/sharing/C# 5 (7 tests).
- ZIP, manifest and latest.json; the install replayed with the helper's own `Updater.Validate`, `Extract` and `VerifyManifest` from the compiled code.

## Not verified here

- Live COSTAR behaviour: typing on line 6 with empty lines above, the notes appearing under DET, and other branches' window titles (parsed from the known format).
- On the PC only: the 4 Windows-only self-test groups and the WinForms screens (the branch question, the yellow update line). A failed build or self-test sets the update aside automatically.

---

# Validation — v2.2.1 — 7 October 2026

## Basis

- **Tommy's screenshot (2.2.0):** Order Check reading normally (98 jobs, PO column found, WIP COSTAR PID 227392).
- **The saved Tempe Orders page:** "COSTAR check unavailable … Order Check has not read COSTAR yet (setup)".
- So a different Order Check answered on 127.0.0.1:8795. `HttpServer.Start` failed silently: `SetState("error")` was overwritten by the next successful read. Loopback ports are machine-wide on the shared RDP server, while Order Check's mutex is session-local (`Local\TempeOrderCheck_v1`).

## Changes

- `HttpServer` tries 8795–8804 (ExclusiveAddressUse) and keeps `Port`. `Route` checks the Host header against the served port.
- `Problem` names the occupant of 8795 (its `/health`: version, state, user, session) and stays in the status text permanently.
- `/health` adds port, state, session and user.
- **Open board** appends `?reader=http://127.0.0.1:<port>` when not 8795 (the board already supports `?reader`).
- **Tempe Orders page** (`testrun.html`):
  - `findOrderChecks()` probes ports 8795–8804 (`/health`, then `/wip.json`) and uses the most recently read Order Check in state "ok";
  - merges `/entered.json` from all;
  - lists idle copies as a note, and gives a clear error when only an unready copy answers.
- Order Check self-test group 16 (`PortTest`): a busy port → the next port is served, the busy port is reported, own Host is accepted, the other port's Host gets 403.

## Checks performed here

- 14 C# files clean (balance, C# 6+ syntax, shadowing; one entry point). Order Check C# 5 check.
- Node end-to-end: two fake Order Checks (old copy on 8795 in setup; healthy on 8796 with WIP and entered) → the page uses 8796, matches PO# / helper-entered / missing, and notes 8795. With only the old copy: a clear message.
- All package tests. ZIP, manifest and latest.json fingerprint verified.

---

# Validation — v2.2.0 — 6 October 2026

## Changes

- **Resume:**
  - `Selectors.SameOrderInProgress` (PO# = order number, same phone, comment empty or equal).
  - `Run()`: resume path skips the empty check and the phone lookup (account and name taken from the order), reuses item rows by code and occurrence (`ExistingRow`, `FinishLine`), and reuses DET/F rows (`FinishFreight`). Memos are idempotent as before.
  - AutofillForm remembers `stoppedIn[orderId] = window` when a run stops after typing (`Runner.Writes > 0`), retries there, and forgets on success. `Verify` still requires the exact item sequence.
- **Missing orders:**
  - `OnlineOrders/Tempe-Orders-COSTAR.html` (= GitHub `testrun.html`) gains the COSTAR check: `/wip.json` and `/entered.json` from 127.0.0.1:8795; matching by PO#, by the order number in the comment (digit-boundary safe), by helper-entered, or by amount ±max($1, 2%) as "probably".
  - **Make it** reuses Send to COSTAR; **Make all missing** spaces sends 3 s apart.
  - Order Check route `/entered.json` ← `Hosting.Entered` ← `EnteredOrders.Json()` (today and yesterday's `online_fill_ok` from the day log; order numbers and times only).
- **Auto-update:**
  - `Updater.cs`: HTTPS GET of `latest.json` only under `https://tommyvenzin.github.io/tempe/helper/` (TLS 1.2, no redirects).
  - Release validation: version, ZIP name matching the version, SHA-256 format, size 10 KB–50 MB.
  - Download size limit; ZIP SHA-256 must match; extraction with a zip-slip guard; every file checked against `PACKAGE-SHA256.json`; install to `packages\Tempe-COSTAR-Helper-vX`; `current.txt` pointer; restart through the matching Start-*.cmd after the helper closes.
  - `Launch.ps1` hands over to a newer version found via `current.txt` (`VERSION.txt` comparison; `-NoHandOver` prevents loops).
  - Worker window: checks at start and every 6 h, offers in the status line, refuses during entry.
- **Time saved:**
  - `TimeSaved` counts `online_fill_ok` / `mobile_job_ready` / stopped from the day logs.
  - Minutes in `time-saved.json` (default 4/4, written only when a report is made).
  - Status line (cached 1 min); Boss report HTML (today/7/30 days, day table, no order details); END OF DAY line.
- Self-tests 78–80: resume recognition (made-up customer), time-saved counting and report, updater validation, manifest tamper detection and the zip-slip guard.

## Checks performed here

- 14 C# files: balance, C# 6+ syntax and shadowing scans clean, one entry point.
- Argument-count check on all new methods (flags reviewed: all framework/LINQ/lambda false positives).
- Order Check C# 5 check. All Node tests, including the page's JavaScript syntax.
- Matching logic unit-tested in Node: PO#, comment, helper-entered, amount, missing, and digits inside a phone number not matching.
- ZIP, manifest and latest.json fingerprint verified.

## Not verified here

- Compilation and live COSTAR.
- PowerShell syntax of the Launch.ps1 hand-over (no PowerShell here; reviewed by hand).
- Chrome's private-network access from the GitHub page to 127.0.0.1 (Order Check's board already does the same).

---

# Validation — v2.1.0 — 6 October 2026

## Basis

Tommy's screen recording TEIK.mp4 (22 s, silent), frame by frame:
- the phone is entered in the Repair Order;
- the "Search…" window (Search for an Existing Customer) opens with "Nothing found!", the Phone box empty, Branch "11" and OK disabled;
- the phone is typed into Phone, Branch is cleared and Search is pressed;
- 3 accounts appear (other branches), row 1 highlighted and OK enabled;
- row 1 is taken, the account loads, and SHOP is typed into Ship Via.

## Changes

- **Selectors:**
  - `NothingFound` (a static "Nothing found!");
  - `FieldRightOf(label)` (a box to the right of its label, same vertical centre ±6);
  - `ShipVia` (the box under "Ship Via", same parent).
- **`TryChooseFirstAccount`:**
  - if OK is disabled (not a list box), `SearchAllBranches` runs: WM_SETTEXT Phone (digits of the phone typed for the lookup), WM_SETTEXT Branch "", BM_CLICK Search, then wait up to 15 s for OK enabled ("accounts found") or "Nothing found!" (after 800 ms, non-busy popup snapshot);
  - none found: BM_CLICK Cancel, `lookupCancelled`, and the new-customer path.
  - `sawChooser` is set only when an account is chosen.
- **`SetShipViaShop`:** if Account# is non-empty, PutMapped Ship Via "SHOP". Online pickups run it as stage "Ship Via SHOP" before the final check; mobile runs it after the final check (Ship Via is not part of the mobile proof) and it is non-fatal.
- `lookupPhone` is recorded where the phone is typed (online header, mobile phone step).
- **Fixed before release** (found by a new argument-count check): `Diag.Write()` had no matching overload, so `Diag.Write(0,0)`.
- Self-test 77: Search window boxes, Nothing found, chooser with a disabled OK, and Ship Via (geometry from the 5 Oct popup_layout).

## Checks performed here

- 13 C# files: balance, C# 6+ syntax and shadowing scans clean, one entry point.
- **New:** a method-existence and argument-count check for every helper call (all flags reviewed; the only real one is fixed).
- Order Check C# 5 check. All Node tests. ZIP and manifest verified.

## Not verified here

Compilation, and live COSTAR behaviour of the Search window's Search button and Ship Via.

---

# Validation — v2.0.3 — 5 October 2026

## Basis: end-of-day report 5 Oct 22:37–22:51 (2.0.2)

- 19 runs: 8 completed; 7 open-order checks (about 60 ms, "not empty"); 2 account-list stops; 1 modifier stop; 1 focus stop after a failed list.
- Memory 42–56 MB, CPU 0.0% average.
- **Account list:**
  - The popup was recognised (`account_chooser` accept=True, acceptEnabled=False).
  - `account_first_row_error` ArgumentException on the first panel, then "grid found but it has no rows": the smallest panels were tried first and the code returned at the first table without rows.

## Changes

- `Msaa`:
  - `Children` (AccessibleChildren, falling back to get_accChild; handles simple int child IDs), `RoleOf`, `LocationOf`, `SelectChild`;
  - `FindTable(root, depth)`, exception-tolerant;
  - `TopRows(table, take)`: rows by screen position, header rows (first child role 25) skipped;
  - `Shape` (roles/counts/positions only).
- `SelectFirstRow(front, ok)`:
  - candidate panels ≥200×60, largest first; depth 1, then 2;
  - per row: accSelect, check OK, click left edge inside the popup, wait ≤700 ms for OK; up to 3 rows;
  - on failure logs `account_grid_shape`.
- `Native.NoModifiers`: waits ≤3 s; the message names the key.
- `AutofillForm.lastFilledWindow`: the Repair Order of the last successful fill is not re-tried (`online_skip_review_ro`).
- `RunDiagnostics.Stopped`: RepairOrderInUseException → Outcome "probe". `DiagnosticsBundle.IsProbe` also recognises 2.0.2-style checks (online, "not empty", under 1 s, at the empty-order stage). Excluded from TODAY counts and the detailed completion %.
- `OpenNew`: "Order Entry" is not logged as a prompt.
- Report ZIPs use CompressionLevel.Fastest.
- Self-test 76: probe counting (current and legacy checks excluded; a genuine mobile "not empty" stop still counted).

## Checks performed here

13 C# files: balance, C# 6+ syntax and shadowing scans clean, one entry point. Order Check C# 5 check. All Node tests. ZIP and manifest verified.

## Not verified here

Compilation, and COSTAR's customer list grid under the new selection (the report records its shape if it still fails).

---

# Validation — v2.0.2 (lag fix) — 4 October 2026

## Findings in code

- `Snapshot()`: `WaitIdle(3000)` and then reads **regardless**. Each WM_GETTEXT is a SendMessageTimeout of 100 ms to COSTAR's UI thread, up to 8 s per snapshot.
- `LookupCustomer` / `CustomerFormReady` repeat full snapshots every 30–50 ms while COSTAR searches. 2.0.1 extended that to 15 s, so queued requests built up on COSTAR's thread.
- `timeBeginPeriod(1)` during every entry: global on NT 6.2.
- Order Check always on (thread, server, timer).
- Worker poll 1 s, with a window scan per poll.
- `new JavaScriptSerializer()` per message.
- `Process.GetCurrentProcess()` not disposed in Order Check's window search.

## Changes

- `Snapshot`:
  - `WaitIdle(8000)`, then `Responsive(window,60)`. If not answering: no text reads; readable controls marked `busy`.
  - A failed read with COSTAR not answering stops further reads.
  - Sets `lastSnapshotBusy`; counts `busySkips`/`busySnapshots` (logged per run as `costar_busy_skips`).
- `Current()` waits (150 ms steps, up to 20 s) for a non-busy snapshot. `Settled()` and the startup wait treat busy as not ready.
- Lookup loops back off 150 ms on busy and poll 120 ms while "SEARCHING" (was 30–50 ms).
- `FastTimer()` is no longer called (no `timeBeginPeriod`).
- Order Check is opt-in (flag file `order-check-on` in the helper's data folder; tab button).
  - `Hosting.EntryPid` stops reads of the entry COSTAR; `Hosting.Hold` stops reads during entry.
  - Process leak fixed.
- Worker poll 2 s while enabled; `Available()` cached 3 s.
- `Wire` uses one `JavaScriptSerializer` per thread.
- `GCSettings.LatencyMode = SustainedLowLatency`.
- `PerfMonitor`:
  - samples every 5 s for the status line;
  - writes `perf` (ws, private, heap, handles, gdi, user, threads, cpu) to the day log every 5 minutes, and `perf_after_job` after each job;
  - END OF DAY shows start/peak/now and CPU, and flags >300 MB, handle growth >500, GDI/USER growth >200, or CPU >5%.
- Self-test 75: perf parsing and the report lines.

## Checks performed here

13 C# files: balance, C# 6+ syntax and shadowing scans clean, one entry point. Order Check C# 5 check. All Node tests. ZIP and manifest verified.

## Not verified here

Compilation, live CPU/memory on the RDP server (the new meter and day log will show it).

---

# Validation — v2.0.1 — 4 October 2026

## Basis: diagnostics 4 Oct 00:37–00:56 (2.0.0, 7 online runs, 1 completed)

- 3× "target field is covered": first click on a fresh Repair Order, 70–430 ms after it appeared.
- 1× "search did not cancel": the commit dialog appeared 2236 ms after Tab, then "SEARCHING" with COSTAR busy for 6 s, then Escape at 3 s cancelled the search.
- 1× commit timeout: 2523 ms with a 2500 ms limit.
- 1× Add New 30.9 s beside a reviewed order.
- Memory dropped to 1 MB after every run (EmptyWorkingSet).

## Changes

- `SearchPatienceMs=15000` for a running search (LookupCustomer and CustomerFormReady). Popups keep 750 ms; other waits keep 3 s.
- `CommitField` limit 8000 ms.
- `ClickTarget`: if covered, it logs `covered` (masked: COSTAR or another app, window class) and waits up to 1.5 s, re-aiming at the live rectangle. If another process is on top and nobody is typing, `BringToFront(root)` once. Then `covered_wait`.
- `Memory.Trim`: `GC.Collect()` only above 96 MB managed heap; no EmptyWorkingSet.
- `TempeOrderCheck.Hosting.Store` (hosted Store) is read directly by `OrderCheckLink`; HTTP remains only as a fallback.
- `Hosting.Hold` (= coordinator busy) makes `Poller.Cycle` wait during entry.
- `OpenNew` logs the first foreground COSTAR prompt (title/class) as `add_new_prompt`.
- **Time in:**
  - `Selectors.TimeIn` finds the "Time in" label → combo directly below → its single inner Edit (optional).
  - `Order.TimeInText("HH:mm")` → "h:mm am/pm"; `Order.ClockMinutes` compares formats.
  - `SetTimeIn()` runs after the online header for pickups. It is non-fatal and logs `time_in` set / not kept / box not found.
  - `Verify` adds a non-fatal note if Time in differs from the booking.
- Self-test 74: Time in format, comparison and box finding (real layout: label 109,295; combo 109,309; Edit 112,312; Promised beside it).

## Checks performed here

13 C# files: bracket balance, C# 6+ syntax and shadowing scans clean, one entry point. Order Check C# 5 check (no lambdas). All Node tests (helper package/job card/startup, Order Check rules/sharing). ZIP and manifest verified.

## Not verified here

Compilation and live COSTAR behaviour (RDP PC). Whether COSTAR accepts "10:30 am" typed into Time in: the helper reports either way.

---

# Validation — v2.0.0 (one system) — 3 October 2026

## Merge

- `Source/OrderCheck.cs` (Order Check 1.4.0 reader, namespace `TempeOrderCheck`) is compiled into the helper.
  - Its `Program`/`Main` is replaced by `Hosting` (claims the old app's mutex `Local\TempeOrderCheck_v1`, works out the board address). One entry point remains: `TempeCostar.Program.Main`.
  - The old app lowered the whole process to below-normal priority. Not done here, so entry speed is unaffected. Its reader and Search threads already run at below-normal thread priority.
- `MainForm(board, hosted)` is embedded as the third tab (TopLevel=false).
  - Hosted: no tray icon, no Exit; `Shutdown()` runs when the helper closes.
  - `TargetChanged` tells the helper to forget its cached WIP key and refresh its own COSTAR list.
  - If the helper's current target becomes the WIP window, it is dropped and the other Tempe COSTAR is chosen.
- Self-test: `--self-test` runs `MobileTests.Run()` and `TempeOrderCheck.SelfTests.Run()` and writes both reports. Failure of either fails the build.
- Board files are in `Website/`, mirroring the GitHub repo. Sharing docs, the extension update and notes are in `OrderCheck/`. Order Check's Node tests are in `Tests/OrderCheck` with repointed paths.
- Data folders unchanged: `%LOCALAPPDATA%\TempeOrderCheck` (WIP window, interval, Mark OK marks), so settings carry over.

## Checks performed here

- All 13 C# files: bracket balance, C# 6+ syntax scan, loop-shadowing scan. Exactly one `Main`.
- Order Check's own C# 5 checker (no lambdas) on `OrderCheck.cs`.
- Order Check Node tests (10 rules groups, GitHub sharing, Firebase payload).
- Helper package, job card and startup tests (website script references include the board).
- ZIP and SHA-256 manifest verified from a fresh extract.

## Not verified here

Compilation and the 88 self-test groups run on the RDP PC.

---

# Validation — v1.9.0 — 3 October 2026

## Basis (diagnostics 3 Oct 23:39–23:41, helper 1.8.3)

- **Auto-fill runs:**
  - "The selected COSTAR is not ready to open a new order": the main window did not come forward.
  - "The target field is covered": the Repair Order was behind another window.
  - "Open one empty Repair Order": the window Add New returned was gone a moment later.
- **Manual run:** the phone matched several accounts. COSTAR showed its customer Search list (WinForms form, 53 controls; buttons Add new / Include Inactive / Print Results / Search / Cancel / OK / Clear). The helper pressed Cancel and entered a new customer. Later "no foreground window" stopped it at the first item.

## Changes

- `Native.BringToFront`: SetForegroundWindow, then a short AttachThreadInput to the active window's thread (BringWindowToTop + SetForegroundWindow), then SwitchToThisWindow. Used by `Runner.Activate`, popup recovery and `OpenNew`.
- `Runner.Check(foreground)`:
  - a null foreground is waited out (up to 1.5 s);
  - if another process holds the foreground, COSTAR's window is enabled, and no real user input arrived in the last 2 s (`Native.UserActiveWithin`, which ignores the helper's own SendInput), COSTAR is brought back, at most 3 times per run;
  - COSTAR popups are never bypassed.
- `CommitField` re-checks the foreground right before sending Tab.
- `OpenNew` returns a new Repair Order only after the same window has stayed visible and titled for 300 ms.
- **Account list:**
  - `Selectors.AccountChooser` accepts the OK button even when disabled.
  - `TryChooseFirstAccount`: highlight the top row (`Msaa` from Order Check: table → top row by screen position → `accSelect`, plus a click inside the list), wait for OK to enable, then BM_CLICK OK.
  - The popup's structure is captured once.
- **`OrderCheckLink`:**
  - reads Order Check's `targetKey` (PID@local start ticks) and matches it to the helper's UTC start ±2 s;
  - auto-select skips that window, and a manual pick is refused;
  - before online entry, GET `127.0.0.1:8795/wip.json` (1.5 s timeout) and refuse when a row's `po` equals the TTW number;
  - an absent or old Order Check never blocks.
- `Build.ps1` references `Accessibility.dll`.
- Self-tests 73: Order Check key/lookup, and the real Search-list shape.

## Checks performed here

Exact replacements reviewed. Bracket balance, C# 6+ syntax and loop-shadowing scans are clean. JavaScript/package tests pass. ZIP and manifest verified. Order Check 1.4.0: its own package, rules (10 groups), sharing and C# 5 checks all pass here.

## Not verified here

Compilation and self-tests (on the RDP PC). Whether COSTAR's grid accepts `accSelect` (the click on row 1 covers it). The exact WIP PO column name (Order Check reports it).

---

# Validation — v1.8.3 — 3 October 2026

## Basis

1.8.2 screenshot: "1 Tempe COSTAR windows found: choose one in the list above". The list was disabled and the status read "Mobile job pinned to its original instance". The journal held the 2 October 17:00 job as ready_for_review. Its COSTAR process and Repair Order window no longer existed.

## Cause

- The worker accepts a new job only after the journal job is closed.
- The desk closes a reviewed job by sending "close", which the worker acknowledges.
- `ApplyTargets` auto-selects only the pinned process while a pin exists. `UpdateStatus` disables the list while pinned.
- `Worker.Run("close")` required the pinned COSTAR before reaching its existing "window already gone" acknowledgement.
- Result: once COSTAR closed, nothing could be selected, closed or started.

## Changes

- `CostarWindows.OrderWindowGone(cp)`: the window no longer exists, or belongs to another process. `CostarWindows.PinnedProcessGone(cp)`: no COSTAR process with that PID, start time and session.
- `Worker.Run("close")`: the closed-or-gone acknowledgement now runs before the same-COSTAR requirement. Live windows are unchanged (same-COSTAR check, `ValidateTarget`, `CloseMobile`).
- `WorkerForm.ApplyTargets`: a pin whose window or process is gone ("dead pin") no longer restricts selection or locks the list. It is logged and explained. Live pins behave as before.
- `MobileRecovery.CanReset` unchanged: the existing safety tests (no reset after any entered field) still hold.
- Self-test 71: gone-window and gone-process recognition.

## Checks performed here

Counted replacements reviewed as diffs. Bracket balance, C# 6+ syntax and loop-shadowing scans are clean. JavaScript/package tests pass. ZIP and manifest verified. Compilation and self-tests run on the RDP PC.

## Known remaining edge

COSTAR closed **in the middle of** a mobile entry leaves a failed job with entered fields. It no longer locks the list, but the automatic reset deliberately refuses it. It needs its own guarded recovery, to be designed with care.

---

# Validation — v1.8.2 — 3 October 2026

## Basis: 1.8.1 day log and 1.6.1 runs (diagnostics of 3 October)

- **1.8.1:** started 4 times with no crash. An online order (TTW1730376) was refused with "Select a Branch 11 COSTAR instance above": no COSTAR target was selected. The helper never searched for COSTAR at startup, and the search result was not logged. Detection code was identical to 1.6.1 except the 1.8.0 window-title reading.
- **1.6.1 mobile:** 7.96 / 8.92 / 8.05 s.
  - DET lookup about 80 ms, but leave-grid needed 3 clicks (0.47–1.16 s) although the DET notes existed after the first click.
  - Checkpoint saves about 66 ms each (20 per job) even without forced flush.
  - One startup stop: "A COSTAR field is still loading" while COSTAR was busy (1.16 s) drawing the new order.

## Changes

- `Native.Class`, `Native.Caption`, `Native.TryText`: the 1.6.1 P/Invoke calls (StringBuilder, CharSet.Unicode), with one reused StringBuilder per thread and per kind. The unmanaged buffer code is removed.
- `CostarWindows.Choices` records what it saw (`LastScan`: COSTAR main-window titles and process-check failures). `WorkerForm`:
  - searches at startup;
  - `EnsureTarget()` before Start / resume mobile and before online Fill;
  - logs `costar_found` / `costar_not_found`;
  - explains a failed search in the log.
- `WaitForMobileStartup` waits while any control text read failed. The online reuse path uses `Settled(Current())`, up to 5 s.
- DET: `LeaveForDetNotes` clicks PO# once and accepts when the three DET notes exist and are stable. Otherwise it falls back to `LeaveGrid`.
- `PrivateFiles.Save` times JSON / encrypt / write / replace. `Worker.Persist` times the checkpoint copy. Per-run totals go in the run file, and the end-of-day page shows the per-save breakdown and any COSTAR-not-found searches.

## Checks performed here

Exact counted replacements reviewed as diffs. Bracket balance, C# 6+ syntax scan and loop-variable shadowing scan are clean. JavaScript/package tests pass. ZIP and SHA-256 manifest verified. No C# compiler or COSTAR here; compilation and the 70 self-tests run on the RDP PC.

---

# Validation — v1.8.1 (1.8.0 + day log) — 3 October 2026

## Added in 1.8.1

- `Diagnostics.cs`:
  - `AppLog`: a thread-safe, masked JSON-lines day log (`events-YYYYMMDD.jsonl`), working-set MB on every line, rate-limited desk-connection errors (first, every 20th, recovery), crash capture via `AppDomain.UnhandledException` (type, message, first 4 stack frames). Never throws.
  - Retention: day logs 180 days; saved bundles 30 days.
  - Bundle: adds `day-log/` (last 14 days). The summary now starts with `EndOfDay`: today, speed by version, things to look at. `Summary(reports)` is unchanged for callers.
  - `Popup` also records a text-free `popup_layout` (control kind, position, size, enabled).
- Hooks:
  - `Program`: app start, exit and startup crash.
  - `Worker`: mobile start/stop, job start (with resume step and job-card age), ready, failed, close, unstarted reset, connection drops and recovery.
  - `AutofillForm`: order loaded or failed to load, queue decisions, duplicate refusals, fill start (manual/auto, seconds after loading, queue length), fresh Repair Order opened beside one in use, Add New time, fill result (seconds, run file), queue paused, stop pressed.
  - `Runner.Dispose`: memory before and after the trim.
  - `WorkerForm`: **Add note** dialog, tab switches, Stop all, report saved.
- `MobileTests.cs`: 70 groups (adds the end-of-day page check, on synthetic data; tests never write to the real day log).

## Checks performed here

Exact counted replacements reviewed as diffs. C# tokenizer bracket balance, C# 6+ syntax scan, and a scan for loop variables that share a name with a lambda in their own header: all clean. Lambda-name overlaps are only in sibling scopes, the same patterns that compiled in 1.6.1. JavaScript/package tests pass. ZIP and SHA-256 manifest verified.

## Not verified here

Same as 1.8.0: no C# compiler or COSTAR in this environment. Compilation, the 70 self-tests and live behaviour are confirmed on the RDP machine.

---

# Validation — v1.8.0 lean build — 3 October 2026

## Basis

1.6.x diagnostics (4 runs, COSTAR 5.7.6.0, Tempe Branch 11): screen reading took 19–43% of each run; a 10.3 s mobile job made ~12,200 text reads (14 full form reads, 53 grid reads). A real capture shows the item grid has ~214 controls (100 edits, 51 statics, 32 buttons) of which the engine's grid logic uses the 5 column labels and the cells under them.

## Changes

- **Text reads (Native):** WM_GETTEXT, GetClassName and GetWindowText write into one reusable unmanaged buffer per thread (freed with the thread); previously each read allocated a 4,096-char StringBuilder plus a marshalled native copy.
- **Snapshot:** phase 1 collects geometry/class/state for all controls (local calls); phase 2 reads text only for the controls a read plan names. Skipped controls are marked and read on demand through `ControlInfo.Late` if anything asks (counted as late reads, first 20 logged). Button captions are read only for popups. Control classes are cached per window for the run.
- **Grid read plan:** after the grid labels are learned from a full read, grid reads take the 5 labels plus edits within each label's column tolerance (the same tolerance `ProductGrid`/`Cell` use). If a label disappears or its text changes, that snapshot is completed in full and the labels are learned again.
- **Label searches** (`Selectors.Label`, `Selectors.Header`) use only text that was actually read (`Peek`), so skipped display labels are never fetched.
- **Header cache:** `HeaderNow` reuses the last map while all 11 fields are the same windows, visible, enabled, same parent, same rectangle; returned fields are fresh copies read live on first use. Any change falls back to the previous full read.
- **Customer lookup:** `Selectors.AccountChooser` classifies a selection list (list control, or a WinForms form with a list area and exactly one OK/Select-type button; message boxes `#32770` excluded). `TryChooseFirstAccount` selects row 0 for list boxes, presses that button via BM_CLICK, or Enter only when no risky button exists; bounded to 2 attempts; the lookup then waits up to 5 s for the chosen account and never falls back to a new customer.
- **Online:** `RepairOrderInUseException` is raised before any input when a reused open order is not empty; the online tab then opens a fresh order (`OpenNew(...,allowExisting:true)` identifies the window that was not there before, and uses BM_CLICK if an open order covers Add New). `OrderQueue` + "Fill automatically" queue copied orders while one is entered, refuse duplicates and orders already entered this session, and pause after a stop.
- **Memory:** after each job, full GC + `EmptyWorkingSet`.
- **Diagnostics:** text reads, skipped, late and header-cache counts per run (summary SCREEN READS, CSV columns).
- **Self-tests:** 69 groups (adds read plan + on-demand reads, account chooser, order queue).

## Checks performed here

Exact counted replacements, reviewed as diffs against 1.6.1; every grid-snapshot consumer audited (only labels plus the five columns are used; totals and delivery checks use full reads); C# tokenizer bracket balance and C# 6+ syntax scan clean; JavaScript/package tests pass; ZIP and SHA-256 manifest verified.

## Not verified here

No C# compiler or COSTAR in this environment: compilation, the 69 self-tests, live read counts and the real two-account popup are confirmed on the RDP machine. 1.5.5–1.6.1 compiled there with the same toolchain.

---

# Validation — v1.6.1 speed build — 2 October 2026

## Basis (1.6.0 diagnostics, 2 runs on COSTAR 5.7.6.0)

- Mobile 10.3 s; leave-grid needed 3 attempts (1.18 s). Online pickup 5.2 s; leave-grid 3 attempts (0.53 s), the second re-click fired 44 ms after the first because COSTAR was briefly busy before processing the click.
- Mobile: 17 checkpoint saves between steps took 1.20 s (about 70 ms each).
- Existing customer lookup on an online pickup completed without a stop.

## Changes

- `CostarAutofill.cs`: before leaving the grid after DET, wait up to 1.5 s for the DET row's description (COSTAR's code lookup), then leave; if it does not fill, continue as 1.6.0 did. Leave-grid re-clicks after a settle only once 120 ms have passed since the click.
- `MobileModel.cs`: `PrivateFiles.Save` takes an optional `flush` flag (default true: unchanged for settings, desk queue and status reports).
- `Worker.cs`: checkpoint saves use `flush=false`; 1 s desk poll while mobile entry is enabled and not paused (3 s otherwise).
- `MobileTests.cs`: storage round-trip also covers `flush=false`.

## Checks performed here

Exact counted replacements reviewed as diffs; C# tokenizer balance and C# 6+ syntax scan clean; JavaScript/package tests pass; ZIP and SHA-256 manifest verified. C# compilation and the 66 self-tests run on the RDP machine at first launch (1.6.0 built there with the same toolchain).

---

# Validation — v1.6.0 speed build — 2 October 2026

## Basis

Changes target what the 1.5.5 diagnostics measured on 2 October (4 runs, COSTAR 5.7.6.0, Tempe Branch 11):
- DET: leaving the item grid failed its first click in both runs and waited a full 2 s before the second click worked.
- Mobile: about 2.9 s between steps, consistent with two encrypted checkpoint saves per step plus progress saves.
- Existing customer (TTW1730342): COSTAR did not answer for more than 2 s after the phone entry; the helper read the screen mid-redraw, found no labels and stopped with a layout error.

## Changes

- `CostarAutofill.cs`: `WaitIdle` (WM_NULL via SendMessageTimeout, abort-if-hung, capped) before every screen read, before Ready checks and before clicks; `HeaderNow` tolerates a brief header redraw (3 s cap, stops at once on focus loss); the customer lookup treats a missing header during redraw as transient within its existing 20 s limit; leave-grid re-clicks within 0.7 s and accepts PO# after COSTAR settles or after a 300 ms hold (6 s total budget, as before); shorter polls; 1 ms timer resolution during a run (released in Dispose); online Fill opens a Repair Order with the existing Add New routine when none is open.
- `MobileRunner.cs`: one checkpoint save per step (the pending marker), final save after the last step; pre-step re-read only for the first step of a run; customer-popup recovery limited to phone/name/reference steps; shorter startup/stability polls.
- `Worker.cs`: progress saves throttled to 2.5 s; checkpoint and progress save times sent to diagnostics.
- `Diagnostics.cs`: correct stop stage, idle-wait and save counters, time between steps, wait outcome labels, label-only layout fingerprint.
- `MobileTests.cs`: 66 groups (adds stop-stage, between-step and wait-label checks).

## Resume safety of the single save per step

Before each step the journal records all verified steps and marks the step pending. If entry stops after the step's input, the existing recovery compares COSTAR with the verified view: unchanged means not applied, exactly the step's change means applied, anything else stops without guessing. This is the same reconciliation used before; the removed "after" save only shortened what recovery had to re-check.

## Checks performed here

- Every edit applied as an exact, counted replacement and reviewed as a diff against 1.5.5.
- C# tokenizer bracket balance and a scan for C# 6+ syntax (`/langversion:5`): clean.
- JavaScript/package tests pass; ZIP and SHA-256 manifest verified.

## Not verified here

No Windows compiler or COSTAR is available in this environment. C# compilation, the 66 self-tests and live timing are verified by the first run on the RDP machine. 1.5.5 compiled and ran there with the same toolchain.
