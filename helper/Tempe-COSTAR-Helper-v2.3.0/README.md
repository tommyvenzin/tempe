# Tempe COSTAR Helper — v2.3.0 — any branch

Two changes Tommy asked for (9 Oct 2026). Delivered by auto-update: upload the files to GitHub, then click the yellow line in the helper.

## 1. Works with any COSTAR branch open on the PC

- The COSTAR list shows **every** COSTAR open in the Remote Desktop session with its branch, e.g. "Branch 11 (TEMPE)", "Branch 1 (…)". Pick the one to enter into.
- Every Repair Order the helper opens, fills or checks must belong to the **selected branch**. If COSTAR shows an order from another branch, entry stops.
- The helper remembers the branch you used last and selects it at the next start (if exactly one COSTAR of that branch is open).
- **Mobile jobs** carry no branch, so they go into the selected COSTAR. If you switch branch while mobile is running, mobile **pauses** and the log says so. Click **Start / resume mobile** to take mobile jobs into the new branch. The mobile line shows "jobs go into Branch …".
- A new Repair Order in another branch may show that branch's own suburb. That's accepted (Branch 11 still expects TEMPE).
- **Tempe Orders page** (upload `testrun.html`): a **Store** picker next to Today/Tomorrow lists every store in the order list, remembered in Chrome. Any store's pickups can be sent.
  - Before typing, the helper checks the order's store against the selected branch ("Tempe NSW" ↔ Branch 11 Tempe). If they don't match, it asks first, and names the right branch if that COSTAR is open. Your answer is remembered until the helper closes.
  - The helper window comes forward for that question, and nothing else is loaded or started until you answer it.
  - Pickups from stores other than Tempe are sent in a new format that helpers older than 2.3.0 refuse ("Update both the HTML page and Windows helper"), so they can never be typed into Branch 11 by an old helper.
  - The COSTAR check (✓ / ≈ / ✗) still covers Tempe only, because Order Check reads the Tempe COSTAR.

## 2. DET first, on line 6

COSTAR could lose DET's notes when DET was entered last. Now, for online pickups and mobile jobs:

1. **DET goes in first, on line 6.** Its MAKE/MODEL, REGO NO and ODOMETER notes appear directly under it (lines 7–9), followed by PAYING BY or the job card notes if any.
2. **Then the items fill lines 1 down**: wheels, tyres, M FB, wheel alignment.
3. With more than four item lines, DET moves down so one empty line always stays between the last item and DET (5 items: DET on line 7).

The helper checks every step. If DET or its notes land anywhere else, entry stops and nothing is guessed. Before typing on a numbered line, it checks that COSTAR's 25 lines are evenly laid out. Deliveries (no DET) are unchanged.

A stopped online order resumes in its own Repair Order as before, including orders started by 2.2.x (DET straight after the items): any missing items go in after everything, the old way. If it stopped right after DET was typed, the resume clicks out of DET once so its notes appear. A **mobile** job half-entered by an older version still can't be resumed by 2.3.0 (the step order changed); finish it by hand. Jobs that hadn't started a step continue normally.

## Safer updates

If an installed update can't build or pass its self-tests on this PC, it now **sets itself aside**: the window says so, and your usual shortcut starts the version installed before it again (2.2.1 for this update). Send the startup report to Claude.

The update offer is now a **yellow, bold line** under the buttons: "UPDATE x.y.z READY - CLICK HERE TO INSTALL". This applies to the update after 2.3.0; for 2.3.0 itself, the 2.2.1 grey line still offers it.

Self-tests: **85** helper groups + **16** Order Check groups. New for this release: before delivery, the code was compiled here with a real C# 5 compiler and 81 of the 85 groups plus all 16 Order Check groups were run (the other 4 need Windows).

---

## Previous release notes (2.2.1)


**The first version delivered by auto-update.** Once these files are on GitHub, 2.2.0 offers it in its status line.

## Fixed: "COSTAR check unavailable … (setup)" while Order Check reads normally

Order Check serves the boards on **127.0.0.1:8795**. On the shared RDP server that address is shared by **every Windows session**, so another Order Check held it. Most likely an old standalone copy left running in another session, or another user's.
- Before, your helper's Order Check couldn't open its server. The error was then overwritten by "Reading normally", so you never saw it, and the Tempe Orders page was talking to the other copy, which was never set up.
- Now, if 8795 is taken, Order Check **uses the next free port** (8796, up to 8804). Its tab **keeps showing** what holds 8795 (for an old copy: its version and state). **Open board** opens the board on the right port automatically.
- The **Tempe Orders page** asks every Order Check on the PC and uses the one that has actually read COSTAR. Any other copies are listed under the COSTAR check, so you know they're there. Every helper's "entered" orders count.

**To clear the old copy for good:** on the RDP server open Task Manager → Users. Find your other session (or ask whoever owns it) and end **OrderCheck.exe** or **TempeMobile.exe** there, or sign that session out.

Self-tests: **80** helper groups + **16** Order Check groups (new: the server moves aside when its port is taken).

---

## Previous release notes (2.2.0)


Four improvements Tommy chose (6 Oct): resume, missing-order check, auto-update, time-saved report.

## 1. A stopped online order continues where it stopped

Before, a retry opened a **new** Repair Order and left the half-done one behind. Now the helper remembers which Repair Order a stopped order was in and **goes back to it**:
- the customer lookup is skipped (the account is already on the order);
- item lines already there are kept (only their quantity and price are checked), and missing ones are added;
- DET or Freight is not added twice, and notes are filled in only if they differ.

It also recognises its own half-done order after a restart (PO# = the order number, same phone), as long as that's the only open Repair Order. The strict final check still catches anything unexpected, such as a duplicate row.

## 2. Missing orders: Tempe Orders page (upload `testrun.html` to GitHub)

The **Today Orders** and **Tomorrow Orders** lists now check COSTAR. Each order shows:
- **✓ In COSTAR**: its order number is in PO# or the comment, or the helper entered it (doc number shown when known);
- **≈ Probably in COSTAR**: no order number, but a job with the same amount (within $1 or 2%), with the doc number(s) to check;
- **✗ Not in COSTAR**, with a **Make it** button that sends it to the helper.

**Make all missing** at the top sends them one after another; turn on Fill automatically first. The list re-checks every 2 minutes, or click **Check again**. It needs **Order Check on** in the helper (second COSTAR on Work-in-Progress). The helper also lists the orders it entered itself, so they show as in COSTAR straight away.

## 3. Auto-update

The helper checks your GitHub page (`helper/latest.json`) at start and every 6 hours. When there's a newer version, the status line at the top says **"Update x.y.z ready: click here to install"**:
1. it downloads the ZIP;
2. it checks the ZIP against the fingerprint in latest.json, then checks **every file** against the package list;
3. it installs beside this version and restarts into it.

It never updates during entry, and only accepts downloads from your GitHub helper folder. Older folders and shortcuts start the newest installed version by themselves (Launch.ps1 hands over).

**To publish a version:** upload its ZIP and `latest.json` to the `helper` folder of the `tempe` repo. I provide both with every release.

## 4. Time saved (for the boss)

- The status line shows **"Today N orders by the helper, about M min saved"**.
- **Boss report** (top row) opens a one-page report: today, last 7 days, last 30 days and a day-by-day table. It shows orders, mobile jobs, how many needed a hand, the helper's time per order and typing saved. No customer details. Print it or save it as PDF from the browser.
- Typing saved = orders × minutes by hand: 4 min per online order and 4 min per mobile job to start with. Change them in `time-saved.json` in the helper's Diagnostics folder (created the first time you open the report).
- The end-of-day report shows it too.

Self-tests: **80** helper groups + **15** Order Check groups.

---

## Previous release notes (2.1.0)


Built from Tommy's video (6 Oct) of entering the order that kept failing (TTW1730345).

## What the video showed

The "two accounts" failures were really **"Nothing found!"**. COSTAR's phone lookup only searches **Tempe (Branch 11)**, and this customer's accounts are in other branches. So COSTAR opened its **Search for an Existing Customer** window with no results and **OK greyed out**. There was no row to pick, which is why 2.0.x couldn't choose one.

What Tommy did by hand, and what the helper now does the same way:
1. Type the phone into the Search window's **Phone** box.
2. **Clear the Branch box** (it says "11").
3. Click **Search**. The accounts from every branch appear, **row 1 highlighted**, OK available.
4. Press **OK**, taking row 1. The account, name, address and email load into the order.
5. Type **SHOP** into **Ship Via**.

If no branch has the phone, the helper presses **Cancel** and enters the order's customer details as a new customer, the same as before.

## New rule: Ship Via = SHOP

Any order whose customer has a **COSTAR customer number** (Account# filled in after the phone lookup) gets **SHOP** in **Ship Via** as the last step. This applies to:
- **online pickups:** just before the final check;
- **mobile jobs:** right after the final check.

It does not apply to:
- **online deliveries:** they keep the Ship Via from the order;
- **new customers:** no customer number.

If COSTAR won't take it, the order still finishes and the log says to enter SHOP by hand.

Self-tests: **77** helper groups + **15** Order Check groups. The new test rebuilds COSTAR's Search window from the layout recorded on 5 Oct.

## Test

- Send TTW1730345 again. The log shows "No account for this phone in Tempe (Branch 11): searching every branch", then row 1 is chosen, then "Entered Ship Via: SHOP".
- Any pickup for an existing customer ends with Ship Via SHOP. A brand-new customer's order has no SHOP.

---

## Previous release notes (2.0.3)


## How 2.0.2 did on 5 October (end-of-day report)

- **Lag fixed:** helper memory 42–56 MB all session, CPU 0.0% average (0.1% peak), no handle growth.
- **9 online orders in 5 minutes with Fill automatically:** 8 entered first or second time, about 7 s each from Send to done (entry itself about 5.2 s).
- **Time in = booking time:** worked on all 8 (8:00 am, 10:00 am, 2:30 pm…).
- **Problems:**
  - The two-account customer (TTW1730345) failed 3 times.
  - One "Release Shift/Ctrl/Alt" stop.
  - 7 "Repair Order not empty" entries made the day look like 42% success. They weren't failures: each was the helper checking the previous order's Repair Order before opening a fresh one.

## What 2.0.3 fixes

| Problem | Cause | 2.0.3 |
|---|---|---|
| Two accounts on one phone: "OK did not become available" | The helper searched the list's panels **smallest first**. It found the small search-criteria panel (a table with no customer rows) and **gave up there**, never reaching the results grid. | Every panel is tried, **largest first**, then one level deeper. Both ways COSTAR can expose rows are handled, header rows are skipped, and up to 3 top rows are tried, stopping as soon as OK lights up. The click lands near the row's left edge. If it still fails, the grid's structure (no names or values) goes into the report. |
| "Release Shift/Ctrl/Alt/Windows keys" | Checked once; a key down for a moment stopped the order | Waits up to 3 s for the key to be released. If it really stays down, the message names the key and explains how to clear a Remote Desktop stuck key. |
| An extra check before every order | Each order first tried the previous order's Repair Order (left for review) | The helper remembers which order it filled last and goes straight to Add New: about 0.5 s faster per order. |
| Report counted checks as failures | | Checks are counted separately. The completion % covers real orders only. |
| "Order Entry" logged as a COSTAR prompt on every order | It's COSTAR's own new-order window | Not logged any more |
| Report ZIP after each order | Best compression on the entry thread | Fastest compression: the next order starts sooner |

Self-tests: **76** helper groups + **15** Order Check groups.

## Test tomorrow

- Send the two-account customer (TTW1730345's phone) with Fill automatically. The first account should be chosen ("Two or more accounts share this phone: chose the first one").
- Send a batch of online orders. The log shows "online_skip_review_ro" instead of a check, and each order is a little faster.

---

## Previous release notes (2.0.2)


2.0.1 made COSTAR and the RDP session laggy. This release is only about speed and memory. No new features.

## What was causing the lag

Every time the helper reads a COSTAR field, COSTAR's screen thread has to answer it. While COSTAR is busy (searching a phone, loading an account, opening an order) it can't answer:
- The helper waited up to 3 s for COSTAR, then read about 250 fields **anyway**, one queued request per field, each waiting 100 ms.
- During a slow phone search it repeated that every 30 ms.
- COSTAR then had to work through the pile after its search, so everything froze.
- 2.0.1 made those waits 5× longer (15 s), so the lag got much worse.

## What 2.0.2 changes

| # | Change | Effect |
|---|---|---|
| 1 | **No reads while COSTAR is busy.** One tiny "are you there?" first; no field reads unless COSTAR answers. If a read fails because COSTAR stopped answering, the rest of that pass is skipped. | No request pile-up |
| 2 | Waits poll every 80–150 ms instead of every 30 ms, and back off while COSTAR is busy | Far fewer reads |
| 3 | The 1 ms Windows timer is no longer switched on during entry. On Windows Server 2012 it applied to the **whole server**. | Less load on everyone's session |
| 4 | **Order Check is OFF unless you turn it on** (button in its tab, remembered) | No background thread, server, timer or COSTAR reads by default |
| 5 | Order Check never reads the COSTAR the helper types into | No two jobs on one COSTAR |
| 6 | Mobile poll every 2 s (was 1 s); COSTAR availability checked at most every 3 s | Half the background work |
| 7 | JSON engine reused instead of a new one per message | Less memory churn |
| 8 | Smoother garbage collection (sustained low latency) | Fewer pauses |
| 9 | Fixed a small handle leak in Order Check's window search | |

## See it working

The status line under the COSTAR list now shows **Helper NN MB, CPU N%**, updated every 5 seconds. Expected: about 30–80 MB, and CPU under 1% when idle.

The day log records memory, CPU, handles and GDI/USER objects every 5 minutes and after each job. The END OF DAY page shows start, peak and now, and flags growth (possible leak) or high CPU. Each run also records how many reads were held back because COSTAR was busy (`costar_busy_skips`).

## Order Check

It's off after this update. To use it, open the **Order Check** tab, click **Turn Order Check on**, and choose a **second** Tempe COSTAR window (not the one the helper types into: Order Check refuses that one).

Self-tests: 75 helper groups + 15 Order Check groups. The Time in feature from 2.0.1 is unchanged.

---

## Previous release notes (2.0.1)


Bug-fix release after the first 2.0.0 runs (4 Oct 00:37–00:56), plus **Time in = booking time**.

## Fixed

| What you saw | Why | 2.0.1 |
|---|---|---|
| "COSTAR's search did not cancel" (the two-account customer) | COSTAR's phone search was slow (2–2.5 s+, COSTAR busy 6 s). After 3 s of "SEARCHING…" the helper pressed Escape, which **cancelled COSTAR's own search**, including the account list it was about to show. | A running search is left alone for up to 15 s. Escape is never sent while COSTAR is still searching. |
| "COSTAR did not commit the field after Tab" | A fixed 2.5 s limit; COSTAR took 2.5 s. | Up to 8 s. Normal fields still move on in milliseconds. |
| "The target field is covered" (3 of 7 runs) | Always the first click on a **brand-new** Repair Order; a retry on the same order always worked. | Waits up to 1.5 s for the field to clear, brings COSTAR back once if another app is on top, and records what was covering it. |
| "A bit slower" | After every job the helper emptied its own memory (1.8.0), so the next job started cold. Each online fill also made a web call from the helper to its own Order Check. | Memory is only cleaned when it has really grown. The duplicate check reads Order Check's data directly. |
| Order Check could read COSTAR while the helper was typing | Two jobs on one COSTAR. | Order Check waits while the helper is entering an order. |
| Add New took 31 s once (reviewed order still open) | Unknown | Any COSTAR prompt shown during Add New is now recorded in the day log. Nothing is pressed. |

The duplicate-check note no longer says "needs Order Check 1.4.0". It says whether Order Check has read the WIP list yet, or whether the list has no PO column.

## New: Time in = booking time (online pickups)

COSTAR fills **Time in** with the moment the Repair Order was opened (e.g. 12:50). For online pickups the helper now enters the **booking time** from the website order instead, in COSTAR's own format ("10:30 am"). Delivery orders and mobile jobs are unchanged. If COSTAR won't take it, the order is still finished and the log says "Set it by hand".

Self-tests: **74** helper groups + **15** Order Check groups.

---

## Previous release notes (2.0.0)


**One app now does everything:** mobile jobs, online orders and Order Check. Order Check is no longer a separate program. It is the third tab in the helper, built, started, self-tested and reported together with the rest. Replaces helper 1.9.0 and the separate Tempe Order Check 1.4.0.

| Tab | Does |
|---|---|
| **Mobile jobs** | Phone job cards → COSTAR (through the desk receiver) |
| **Online orders** | Website orders → COSTAR (Fill / Fill automatically) |
| **Order Check** | Reads a second Tempe COSTAR's Work-in-Progress list every 2 minutes and serves the Order Check board. Runs in the background whichever tab is showing. |

How the parts work together inside one app:
- **One COSTAR choice.** Pick the Work-in-Progress window in the Order Check tab, and the helper immediately switches its own entry to the *other* Tempe COSTAR. It never types into the WIP window.
- **No duplicate online orders.** Before filling, the helper checks the Order Check data. If that TTW number is already in Work-in-Progress, it refuses and names the document.
- **Helper jobs tagged on the board.** Jobs the helper typed in show "Online" (TTW) or "Mobile" (MJC) on the board.
- **One end-of-day report.** Order Check's start and status are in the same day log as everything else.

## Switching from two apps (once)

1. **Close the separate Order Check app:** right-click its tray icon, then **Exit**. Stop using `Start-OrderCheck.cmd`. If it is still running, the Order Check tab tells you to close it.
2. Extract **Tempe-COSTAR-Helper-v2.0.0** into a fresh folder in the RDP session and run **Start-RDP.cmd**. Title **2.0.0 - one system**. The self-tests report **73** helper groups and **15** Order Check groups.
3. **Order Check tab:** your WIP window choice, read interval and Mark OK marks carry over (same settings folder). If it says "Needs setup", choose the second Tempe COSTAR that stays on Work-in-Progress.
4. **Board on GitHub** (only if you haven't uploaded the 1.4.0 board yet): upload `Order_Check.html`, `order-rules.js`, `order-check.js` and `share.js` from this package's `Website` folder to your `tempe` repo.
5. **Chrome extension** (only if not done before): `OrderCheck\Extension-update` holds "Tom does it all" 1.0.2. Copy over the two files, reload the extension, and allow file URLs.

Sharing setup and notes are in `OrderCheck\` (`Sharing\SHARING-SETUP.md`, `ORDER-CHECK-NOTES.md`).

### Order Check tab
Same controls as the old app (WIP COSTAR window, read interval, shop hours, press Search before reading, Read now, Open board, Pause), without the tray icon or Exit button: closing the helper stops it. The board data is still served at `http://127.0.0.1:8795/wip.json` (this PC only), so the board in Chrome works exactly as before.

---

## Previous release notes (1.9.0)


Replaces 1.8.3. Ships together with **Tempe Order Check 1.4.0**.

## What 1.9.0 fixes (your 3 October 23:39–23:41 runs)

**"Fill automatically" didn't fill.** Windows only lets the app you are using change the active window. With auto-fill the order arrives while you are in Chrome, so the helper's request to bring COSTAR forward was refused. That caused "COSTAR is not ready to open a new order", "the target field is covered" and lost focus. Clicking Fill yourself worked because the helper was then the active app.
- COSTAR and the Repair Order are now brought forward the reliable way, even from Chrome.
- A brief moment with no active window (one window closing, another opening) is waited out instead of stopping entry.
- If another app takes the screen during entry and **nobody is typing**, the helper takes COSTAR back once (at most 3 times per order). If you are typing, it stops instead, so your keys never land in COSTAR. A COSTAR popup is never bypassed.
- Add New hands over the new Repair Order only after its window has stayed the same for 300 ms. On 3 Oct, COSTAR replaced the first window it showed.

**Two accounts on one phone now take the first account.** Your example showed COSTAR's customer **Search** list: a results grid with Add new, Include Inactive, Print Results, Search, Cancel, OK and Clear. OK stays greyed out until a row is highlighted, so 1.8.x fell back to Cancel and entered a new customer. 1.9.0:
1. highlights the top row of the results grid (Windows accessibility, the same way Order Check reads COSTAR's grids), plus a click on that row;
2. waits for OK;
3. presses OK.

It never presses Cancel, Add new, Search, Clear or Print, and never creates a new customer once the list was shown.

**Works with Order Check:**
- The helper never types into the COSTAR window Order Check reads, and picks the other Tempe COSTAR by itself. The list marks Order Check's window.
- Before filling an online order, it asks Order Check (if running) whether that TTW number is already in Work-in-Progress. If so it refuses, naming the document. This catches orders entered by someone else or in an earlier session. It needs Order Check 1.4.0 and COSTAR's PO column in the WIP list.

**Build:** now also references `Accessibility.dll`, the same Windows library Order Check already compiles with on this PC. Self-tests: **73 groups**.

### Test it

1. Fresh **Tempe-Mobile-COSTAR-v1.9.0** folder, **Start-RDP.cmd**. Title **1.9.0 - lean build**, **73 test groups passed**.
2. **Auto-fill from Chrome:** tick Fill automatically, go to Chrome, click Send to COSTAR, hands off. COSTAR comes forward and the order is entered.
3. **Two-account phone** (the 3 Oct customer): the first account is chosen. Diagnostics show `account_chooser` and `account_first_row`.
4. With Order Check running: the helper uses the other Tempe COSTAR; send the same online order twice and the second is refused ("already in COSTAR as document …").
5. End of day: **Save diagnostics**.

---

## Previous release notes (1.8.3)


Replaces 1.8.2. Use this one.

## What 1.8.3 fixes (your 3 October screenshot)

1.8.2 found the Tempe COSTAR ("1 Tempe COSTAR windows found") but would not use it. The status line said **"Mobile job pinned to its original instance."**

- **Why:** the last mobile job (Friday 17:00) finished as *ready for review* and was never closed through the desk. Then COSTAR was closed, taking that Repair Order with it. A new job only starts after the previous one is closed, so the helper kept the COSTAR list locked to the old COSTAR, which no longer exists. That blocked mobile **and** online orders. It is an old trap, not a 1.8 change: it happens whenever COSTAR is closed while a finished job is still waiting for Next Order.
- **Fix 1:** a lock to a COSTAR that is no longer running, or whose Repair Order window is gone, no longer blocks the COSTAR list. The current Tempe COSTAR is selected and online orders work straight away. The log explains which earlier job it was.
- **Fix 2:** when the desk asks to close a reviewed job whose Repair Order window is already gone, the helper confirms it closed instead of insisting on the old COSTAR. Next Order on the desk releases the old job and mobile jobs flow again.
- **Unchanged safety:** an unfinished entry still never resumes in a different COSTAR, and the automatic reset still applies only to jobs that entered no fields.

Self-tests: **71 groups**.

### What to do

1. Fresh **Tempe-Mobile-COSTAR-v1.8.3** folder, COSTAR Tempe open, **Start-RDP.cmd**. Title **1.8.3 - lean build**, **71 test groups passed**.
2. The log says the earlier job's COSTAR has closed, then "Using Tempe COSTAR (PID …)". Online orders work now.
3. For mobile: click **Start / resume mobile**, then **Next Order** on the desk receiver (or let Pinad move on when the next job arrives). The old job is confirmed closed and new jobs flow.
4. Check in COSTAR that Friday's last mobile job was saved.

---

## Previous release notes (1.8.2)


Replaces 1.8.1 (and 1.8.0 / 1.7.0). Use this one.

## What 1.8.2 fixes (from your 3 October diagnostics)

- **Finds COSTAR by itself.** 1.8.1 refused an online order with "Select a Branch 11 COSTAR instance above": the helper only looks for COSTAR when Refresh COSTAR list is clicked. 1.8.2 looks at startup, and again whenever Fill or Start / resume mobile needs it. With one Tempe COSTAR open, it is selected automatically.
- **Detection uses the proven 1.6.1 window-reading calls again.** The faster text reading from 1.8.0 is replaced by the exact Windows calls that worked through 1.6.1. Each thread still reuses one buffer, so most of the memory saving is kept.
- **Every search is logged.** The day log records how many Tempe COSTAR windows were found, which one is used, and which COSTAR windows were seen (main-window titles only). If none is found, the helper says so in plain words.
- **No more "field still loading" stop at startup.** A 1.6.1 mobile job stopped because COSTAR was still drawing the new Repair Order when it was checked. Startup now waits until every field reads.
- **DET about 0.5–1 s faster.** In 1.6.1 the first PO# click already created the car/rego/odometer notes, but the helper kept clicking until PO# held focus. It now finishes as soon as the notes exist, and falls back to the old routine if they don't appear.
- **Checkpoint save timing.** Saves still cost about 66 ms each after 1.6.1, so the forced flush was not the cause. Each save is now timed in parts (copy, JSON, encrypt, write, replace), shown in the end-of-day report.

Self-tests: **70 groups** (71 from 1.8.3).

### Test it

1. Fresh **Tempe-Mobile-COSTAR-v1.8.2** folder inside RDP, with COSTAR Tempe open. Run **Start-RDP.cmd**. Title **1.8.2 - lean build**, **70 test groups passed**.
2. Within a second or two, the log says **"Using Tempe COSTAR (PID …)"** without you clicking Refresh.
3. Run a few mobile jobs and online orders as usual. Use **Add note** if anything is odd.
4. End of day: **Save diagnostics**, upload the ZIP.

## End-of-day report (since 1.8.1)

**During the day:** work normally. If something odd happens, click **Add note** (top row) and type a few words, for example "COSTAR froze on the phone lookup". No customer names or numbers, please.

**At the end of the day:** click **Save diagnostics** and upload the ZIP to Claude. It now contains:
- `summary.txt`. The first page is **END OF DAY**:
  - **Today:** runs and completion rate, online orders loaded, filled, stopped, refused or queued, mobile jobs, stops pressed, desk connection drops, crashes, memory after jobs, and your notes with their times.
  - **Speed by version:** median times per job type for each helper version, so improvements show up as numbers.
  - **Things to look at:** crashes, repeated stop reasons, orders that would not load, read-plan misses, two-account lists seen, unusually slow runs and slow stages.
  - After that, the detailed per-stage and per-wait breakdown as before.
- `runs.csv` and `runs/` (one masked file per entry run, as before).
- `day-log/` (new): one line per event, for the last 14 days. It covers everything outside a single entry run, so failures before entry starts are no longer invisible: orders that failed to load, orders refused as duplicates, queue decisions, fills started and finished, fresh Repair Orders opened, mobile jobs picked up and finished, desk connection drops and recovery, stop presses, crashes with the failing code location, memory after each job, tab switches, and your notes.

Everything is masked: no customer names, phones, addresses or emails. Popups are recorded by shape (control type, position, size), not content, plus their button captions.

The day log lives in `%LOCALAPPDATA%\TempeCostarAutofill\Diagnostics\events-YYYYMMDD.jsonl` and is kept 180 days. Saved ZIPs older than 30 days are cleaned up automatically.


## What 1.8.0 changes

**Reads far less of the screen.** Diagnostics showed screen reading was 19–43% of every run: about 12,000 cross-process text reads in a 10-second mobile job. Most were wasted.
- **Item grid:** each read touched about 180 controls; the engine only ever uses the 5 column labels and the cells under them (about 45). Grid reads now read just those.
- **Customer header:** reused while the panel is unchanged (same windows, same positions), instead of a full form read every time; field values are read live when used.
- **Buttons:** captions are read only on popups; the form and grid never use them.
- **Safety net:** anything the read plan skips is still read on the spot if any check asks for it, so a missed field costs one extra read, never a wrong answer. Diagnostics count these ("late reads"); expected near zero.

**Much less memory churn.** Every text read used to allocate an 8 KB buffer plus a native copy — roughly 100 MB of throwaway memory per mobile job. Reads now reuse one buffer per thread; class names are looked up once per run. After each job the helper returns its memory to Windows.

**Two accounts on one phone → the first one.** When COSTAR shows a selection list, the helper keeps the first row and presses the list's OK/Select button (or Enter when no button could change data), for mobile and online. It never presses Yes/Save/New/Delete, never creates a new customer once a list was shown, and if the list is unfamiliar it stops with the list captured in the report so the exact behaviour can be finished.

**Online Fill always opens its own Repair Order.** With nothing open, with an empty one open, or with earlier orders still open for review: Fill uses an empty/same-customer order, otherwise clicks Add New itself (pressing the button directly if an open order covers it) and fills the new one. Orders that already hold another job are never touched.

**Fill automatically.** Tick it on the Online tab, then just click **Send to COSTAR** on the website. Each order is entered straight away in its own new Repair Order. Orders sent while one is being entered wait in line; the same order is never entered twice in a session. After a stop the line pauses; click Fill to carry on.

Self-tests: **70 groups**. Still Tempe Branch 11 only.

### Test it

1. Fresh **Tempe-Mobile-COSTAR-v1.8.1** folder inside RDP, **Start-RDP.cmd**. Title **1.8.1 - lean build**, **70 test groups passed**.
2. A few mobile jobs and online orders as usual. In the diagnostics summary, **SCREEN READS** should be far below the 1.6.x figures and **late reads** near zero.
3. A phone that has **two accounts** in COSTAR.
4. An online order while the **previous one is still open** for review.
5. **Fill automatically**: tick it, send two orders quickly, then send the first one again (it must be refused).
6. At the end of the day, **Save diagnostics** and upload the ZIP.

If 1.8.1 fails to build or start, keep using 1.6.1 and send the error.

---

## Previous release notes (1.6.1)


## What 1.6.1 changes (from the 1.6.0 diagnostics)

Measured on 2 October with 1.6.0: mobile entry 10.3 s (was 13.4 s), online pickup 5.2 s (was 6.9 s), an existing customer (TTW1730110) went straight through. Remaining waste:

- **DET:** COSTAR still undid the first one or two PO# clicks (1.2 s mobile, 0.5 s online). 1.6.1 first lets COSTAR finish looking up the DET code (its description fills in), then clicks PO# once. A re-click is no longer triggered before COSTAR has processed the previous click.
- **Checkpoint saves:** 17 saves took 1.2 s (about 70 ms each). Checkpoint saves no longer force a write-through to disk. They still reach Windows before entry continues and survive the helper crashing; a power cut would also lose COSTAR's unsaved order. Status reports and the desk queue still force the write.
- **Pickup and completion:** while mobile entry is enabled, the worker checks the desk every second instead of every three, so new jobs start and "ready" reaches the phone about a second sooner on average.

Self-tests: **66 groups** (the storage test now also covers a checkpoint save without forced flush).

### Test it

1. Fresh **Tempe-Mobile-COSTAR-v1.6.1** folder inside RDP, **Start-RDP.cmd**. Title **1.6.1 - speed build**, **66 test groups passed**.
2. Run a few mobile jobs and online orders. Please include **TTW1730342** (existing customer, delivery) and one online order with **no Repair Order open**; neither was covered in the 1.6.0 runs.
3. **Save diagnostics** and upload the ZIP.

---

## Previous release notes (1.6.0)


## What 1.6.0 changes (from the 1.5.5 diagnostics)

- **Waits for COSTAR instead of guessing.** Before reading the screen or clicking, the helper sends Windows' do-nothing message to the Repair Order and continues the moment COSTAR answers. It no longer reads half-drawn screens while COSTAR is loading.
- **Existing customers no longer stop entry.** When the phone matches an existing account, COSTAR rebuilds the customer panel for about 2 seconds. That redraw is now treated as "still loading", not as an unknown layout. Billing and delivery fields are then compared one by one: matching values are left alone, different values are replaced, and entry continues with the items.
- **DET is about 1.5–2 s faster.** Leaving the item grid re-clicks PO# within a fraction of a second when COSTAR pulls focus back, instead of waiting out a 2-second timeout.
- **Mobile checkpoints:** one safety save per step instead of two, with the same resume guarantees. Progress saves every 2.5 s instead of 0.5 s (the desk only receives progress every 3 s). The redundant re-read before each step is skipped after the first step; every step still verifies the whole order afterwards.
- **Faster polling:** shorter waits in the lookup, startup and item loops, and 1 ms timer resolution during entry.
- **Retry on the same Repair Order.** If the open order already holds this order's customer (same phone), with PO#/comment empty or this order's and no items, entry continues: it re-checks the customer and compares/updates the details instead of stopping with "not empty".
- **Online orders open their own Repair Order.** With no Repair Order open, Fill clicks Add New itself, the same way mobile jobs do. One open, empty Branch 11 order is still used as before.
- **Mobile customer-popup recovery** now applies only to the phone, name and reference steps. An unexpected popup during items stops entry instead of being dismissed.
- **Diagnostics:** stop stage is reported correctly, checkpoint-save and COSTAR-wait times are measured, time between steps is itemised, and the layout fingerprint uses label positions only.

Self-tests: **66 groups**. Focus remains Tempe Branch 11.

### Test it

1. Extract into a fresh **Tempe-Mobile-COSTAR-v1.6.0** folder inside RDP and run **Start-RDP.cmd**. The title must show **1.6.0 - speed build** and the self-test report **66 test groups passed**.
2. Run real jobs, including at least one online order whose customer already exists in COSTAR (TTW1730342 is a good one) and one with no Repair Order open.
3. Click **Save diagnostics** and upload the ZIP.

If 1.6.0 fails to build or start, keep using 1.5.5 or 1.5.4 and send the error.

---

## Previous release notes (1.5.5)


## What 1.5.5 changes

1.5.5 is 1.5.4 plus measurement. **Entry behaviour is unchanged**: the same steps, waits, checks and timeouts run in the same order. It adds:

- **Per-run diagnostics** (`diagnostics.json`): time per stage, how long each wait loop ran and why it ended, screen reads, time spent sleeping, focus/Tab timings, which window took focus when a run stopped, and the stop category.
- **A COSTAR responsiveness probe**: a separate background thread sends Windows' do-nothing message (WM_NULL) to the Repair Order about every 50 ms and records how long COSTAR takes to answer. It never delays or blocks the entry thread.
- **Environment and layout fingerprint**: screen size, DPI, Repair Order window size, COSTAR file version and where known labels (PO#, ITEM, QTY OR HRS…) sit.
- **Save diagnostics** button (top row): builds one ZIP with `summary.txt`, `runs.csv` and the per-run files from `%LOCALAPPDATA%\TempeCostarAutofill\Diagnostics`.
- **Report housekeeping**: each run now keeps only the ZIP (the duplicate folder is removed after zipping). Full reports older than 30 days and diagnostics older than 180 days are deleted automatically.

**Privacy:** diagnostics contain no values typed into or read from COSTAR fields. Step messages are masked (phone-like numbers and emails replaced), other applications' window titles are not recorded, and popup text is kept only for message-box-style popups. Order IDs (TTW…/MJC…) and SKUs are kept so runs can be matched. Open `summary.txt` before sharing if you want to check it. The full local entry reports still contain customer details and stay on this PC.

### 10-run test

1. Extract into a fresh **Tempe-Mobile-COSTAR-v1.5.5** folder inside RDP and run **Start-RDP.cmd**. The title must show **1.5.5 - diagnostics build** and the self-test report must show **65 test groups passed**.
2. Use it normally for about 10 real jobs. A mix of mobile jobs and online orders (pickup and delivery) is ideal. Work as you normally would — stops are useful data.
3. Click **Save diagnostics** and upload the `Tempe-COSTAR-Diagnostics-<date>.zip` it selects. No other files are needed.
4. Separately, if possible: run the existing **COSTAR Field Inspector** once on a **blank** Repair Order and upload its report. It shows whether COSTAR's fields have stable internal names.

If 1.5.5 fails to build or start, keep using your 1.5.4 folder and send the build error — 1.5.4 is untouched.

---

## Previous release notes (1.5.4)

One app inside RDP now contains **Mobile jobs** and **Online orders** tabs. Both use the same faster entry engine and the same selected Branch 11 COSTAR instance. The existing desk receiver stays outside RDP to connect the phone.

This complete package includes all dependencies, including ResourceBudget.cs (BoundedLog, LocalProcess and clipboard handling). It includes lowercase email entry, reduced background work and the mobile startup/recovery update. **Mobile starts paused, and clipboard auto-load starts off.**

## Update your working installation

1. Finish the current entry, then close the old RDP worker and standalone online autofill once.
2. Extract the whole ZIP into a **fresh folder inside RDP**. It contains **Tempe-Mobile-COSTAR-v1.5.4**. Use that folder as supplied, instead of mixing it with earlier patches. Previously imported settings are retained for the same Windows user. If your connection has not been imported, copy your existing `worker-connection.json` beside the new `Start-RDP.cmd`.
3. Run **Start-RDP.cmd**. It builds in your writable local user folder and runs the included self-tests for the new executable before opening the combined app. The title must show **1.5.4 - complete package**. Later launches reuse passing tests for the unchanged executable; Check-Build.cmd forces a fresh run.
4. The app opens paused. Click **Refresh COSTAR list**, then select the Branch 11 COSTAR you want to use. If only one is available it is selected automatically. With several, use the PID/window list and **Show selected COSTAR** to identify the right one.
5. For mobile jobs, click **Start / resume mobile**. For online orders, open the Online orders tab and use **Load copied order**, then **Fill Repair Order**. No closing/reopening of the helper is needed.

Your current desk receiver, website, certificates and phone pairing can stay as they are. Do not rerun Setup-Desk for this update. `Start-Online.cmd` is now an alias for the same combined app, opening its Online orders tab; launching it twice brings the existing app forward.

Builds and compiler output are under `%LOCALAPPDATA%\TempeMobileCostar\runtime`. This retains the local-build fix for redirected Desktops and UNC paths. A CMD UNC warning can still be displayed at initial launch; the compiler uses a local directory.

## Multiple COSTAR instances

- Only actual COSTAR main windows matching **COSTAR: 11 Tempe Tyres Tempe** in your current RDP session are offered. Browser subprocesses and other branches are excluded.
- Other COSTAR instances and their Repair Orders can stay open. They do not block the selected instance.
- The selected instance is checked by process, process start time, Windows session and main-window handle. Every Repair Order is checked for **Branch 11** again before entry.
- Selection is held for the complete entry. An unfinished mobile job remains tied to its original process and Repair Order; a retry never chooses a different instance. If the selected process closes, the helper stops and asks you to select again instead of silently moving to another one.
- Use a dedicated selected instance for automation. An open Repair Order in that instance blocks a new mobile order. If several Repair Orders are open within the same process, the online tab asks for one empty target; it does not guess which one to overwrite.
- During entry, leave the selected COSTAR visible and unobstructed. Switching to another application can stop entry. Keeping other instances open is supported; simultaneous typing into a different window during entry is not.

## Mobile jobs

Click **Start / resume mobile** after each app launch and keep the **Mobile jobs** tab selected to receive new mobile work. Until then the desk receiver may show the worker as offline/stopped. The app does not scan COSTAR or poll the desk receiver merely because it opened. The existing desk receiver still handles approval, Pinad mode, Retry, Next Order, Delete selected and Clear completed.

The worker enters phone first, keeps a matched COSTAR account/name, and fills a new name only if no match exists. It then enters:

**Wheels → tyres → M FB → optional WA/WAFR → DET → make/model → rego → odometer → optional M note.**

Mobile jobs keep COSTAR catalogue prices and existing addresses. Durable before/after checkpoints, submission IDs and duplicate protection are retained. This update keeps the v1.4 checkpoint step plan; older partial plans still stop for manual review.

Before filling a newly opened phone order, the worker waits for its customer fields and item grid to load. This targets the reported DESCRIPTION-label startup failure; the exact failing layout still requires its report if it persists.

For the existing failed job whose window was closed: check COSTAR for any manual entry, then use **Reset unstarted job** on the Mobile jobs tab. It only allows reset when the saved journal proves no field entry began and the original window is gone. It keeps an encrypted backup. Select Branch 11, start/resume mobile, then use **Retry selected** for the same job on the existing desk receiver outside RDP. A previously queued retry can start on resume. If reset is refused, keep its saved progress and send the relevant entry report; partial/uncertain jobs remain protected.

## Online orders

Selecting the **Online orders** tab pauses new mobile dispatch. A mobile entry already running is allowed to finish; online entry cannot start until it has finished. Switching back to Mobile jobs resumes dispatch if the worker is enabled.

1. Open a **new empty Branch 11 Repair Order in the selected COSTAR instance**.
2. Search/review your online order on the existing website and click **Send to COSTAR** as before.
3. Click **Load copied order** in the Online orders tab, check the preview, then click **Fill Repair Order**. Optional **Auto-load copied orders** watches new clipboard changes only while this tab is selected and entry is idle. It starts off and does not read an old clipboard merely when enabled. RDP may still need to fetch copied data when loading; leave auto-load off if redirected clipboard access is slow.
4. Review the completed order in COSTAR. Online completion leaves it open; normal staff controls handle saving, payment and invoicing. Close that Repair Order before returning the instance to mobile work.

The online flow retains its additional fields and rules:

| Area | Behaviour |
| --- | --- |
| Customer | Phone first. Dismiss the known not-found notice. Keep a matched COSTAR account and name even if the submitted name differs. |
| Billing | Use supplied online address/email fields, including clearing a stale second address line. |
| In-store fitting | Wheels, tyres, M FB when enabled, ordered WA/WAFR, then DET details. Keep the online date/time/rego comment and PO order reference. No odometer is invented when online data does not supply one. |
| Prices | Use online quantities and prices for complete product/service lines. Keep COSTAR descriptions. |
| Delivery/fitting partner | Separate billing and destination panels; contact, phones, email, Ship Via and instructions; freight using F/List; vehicle/rego using M C / TO SUIT; comment DFE. No in-store M FB or DET. |
| Incomplete package | Keep known SKU/quantity and its COSTAR unit price. Flag PACKAGE REVIEW; do not invent missing tyres or assign the full package price to one component. |
| Surcharge | COSTAR handles it; never add a duplicate surcharge line. Check the exact before/after-surcharge totals. |
| Discounts/services | Unmapped discounts or unknown service codes remain blocked. No mapping is guessed. |
| Payment note | Optional PAYING BY note is retained; it does not take payment. |

Customer and delivery email addresses are entered in **lowercase**. Other newly inserted text/codes use CAPITALS. Existing COSTAR account names and catalogue descriptions are kept as supplied by COSTAR. The bundled `OnlineOrders` files match your attached website/exporter; there is no website update required for this release.

## Speed changes

- Both tabs share the phone-first engine and consecutive detail entry. DET visits PO once, then each detail is committed without returning to PO.
- Item/memo reads scan the live item grid instead of every form field. Row handles, positions and values are rediscovered after layout changes; only the grid container identity is cached.
- Mobile verification reads mapped header fields live alongside the grid. Existing step comparison and durable checkpoints remain.
- Correct quantities are not re-entered, avoiding an unnecessary validation cycle.
- Diagnostic logs are buffered locally and flushed at stage boundaries. A redirected/network Desktop is not written to for every field.
- Mobile queue polling is now approximately **3 seconds plus request time**. A new job may take up to about 3 seconds longer to be picked up; the per-field entry engine keeps its existing timing.
- The UI timer displays cached status only. Target discovery is a single background operation when Refresh is clicked. Checks during mobile polling inspect only the selected PID and its windows, and stop while mobile is stopped, online is selected, or an entry is running.
- The online panel is created on its first visit. Clipboard reads are optional and limited to one order (200,000 characters) before allocating a managed copy.
- Each tab keeps at most 65,536 visible log characters and 16,384 pending log characters. Progress is batched instead of posting one UI event per field. Detailed entry reports remain on disk.

Phone lookup, product loading and validation still depend on COSTAR. There is no measured end-to-end speed claim for this build yet. An online fitting/delivery order contains more fields than a mobile card and can therefore take longer overall.

## Stop and reports

**Ctrl+Alt+F10** or **Stop all entry** stops the active mode and pauses mobile processing. Resume mobile explicitly when ready. The Online orders tab also has its own Stop button.

**Open entry reports** opens `%LOCALAPPDATA%\TempeCostarAutofill\Reports` inside RDP. Each run has a ZIP with controls, progress and `timing.json` (stage times, scan counts and skipped quantities). **Save worker report** exports connection/target/worker status. Reports may contain customer details; select the report for the relevant test. Never send pairing keys or `worker-connection.json` as diagnostics.

The app changes live COSTAR screens and cannot undo committed entries. It never selects Save/Sell/Print or takes payment. An uncertain popup, changed target, conflicting customer, unexpected row or total mismatch stops entry for review.

## Validation and setup

The ZIP contains source and Windows launchers, with no precompiled EXE. `Check-Build.cmd` compiles and runs **70 test groups** (64 in 1.5.4) without opening or modifying COSTAR. Normal launchers require passing tests for the current executable; unchanged successful builds reuse that result. Windows compilation, RAM/CPU use, the combined UI and live multiple-instance entry still need testing on your RDP PC; see `VALIDATION.md` and `TEST-PLAN.md`.

Settings, queue, certificates and mobile checkpoints retain their existing location at `%LOCALAPPDATA%\TempeMobileCostar`. Keep that folder when upgrading.

For an existing installation, no new setup is required. For a new installation, use `SETUP.md`. The desk receiver and the RDP app remain separate processes on their respective computers; the two entry apps inside RDP are now combined.
