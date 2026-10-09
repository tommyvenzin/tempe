# v2.3.0 checks

1. **Update from 2.2.1:** after uploading the GitHub files, restart the helper. The grey line offers 2.3.0; click it, then Yes. The window reopens with title **2.3.0 - any branch** and 85 + 16 self-test groups passed.
2. **Branches:** with COSTAR Branch 11 and Branch 1 open, both appear in the list as "Branch 11 (TEMPE)" and "Branch 1 (…)".
   - Pick Branch 1: the log says "Using Branch 1 …".
   - Restart the helper: Branch 1 is selected again.
3. **Branch switch with mobile running:** mobile pauses ("Mobile jobs are paused…"). Start / resume mobile shows "jobs go into Branch 1 …".
4. **Online, Branch 1:** on Tempe Orders pick the Branch 1 store, send an order, fill with Branch 1 selected. No question is asked if the store matches the branch name; otherwise "Check the branch" appears.
   - Send a Tempe order while Branch 1 is selected: "Check the branch" names Branch 11 if it's open. No: nothing is typed.
5. **DET first (online pickup):** DET on line 6, notes on 7–9 (PAYING BY on 10 if set), tyre(s) from line 1, M FB, then WA/WAFR above DET. The log says "DET is on line 6 with its notes directly under it."
6. **DET first (mobile):** same layout. Diagnostics: the "Create DET details" step passes, and items verify on lines 1, 2, …
7. **The bug Tommy saw:** close and reopen the Repair Order; DET's notes are still there.
8. **Deliveries:** unchanged (items, freight, TO SUIT, PAYING BY).
9. **Branch question with Auto-load on:** while "Check the branch" is open, copy another order: nothing loads or starts until you answer. Answer Yes: the order named in the question is the one entered.
10. **If 2.3.0 can't start:** the window says it was set aside and that your usual shortcut starts version 2.2.1 again; the shortcut then opens 2.2.1.

---

# v2.2.1 checks

1. **Auto-update:** with 2.2.1's files on GitHub, 2.2.0's status line offers "Update 2.2.1 ready". Yes: download, check, install, restart. The title shows **2.2.1 - finds Order Check**.
2. **Order Check tab:**
   - "Board data: http://127.0.0.1:8796/wip.json …" if 8795 is held, followed by "Port 8795 is held by another Order Check (version …)";
   - or 8795 as before when free.
3. **Tempe Orders (Today/Tomorrow):** the COSTAR check shows ✓/≈/✗ again, with "port 8796" if moved, plus a line about the old copy.
4. **Open board** opens the Order Check board on the right port (`?reader=…` in the address when not 8795).

---

# v2.2.0 checks

1. Start-RDP: title **2.2.0 - resume and updates**; 80 + 15 self-test groups pass.
2. **Resume:** start an online order and press Ctrl+Alt+F10 after its first item. Fill again:
   - "Going back to the Repair Order … was started in";
   - "This Repair Order already holds … Continuing where it stopped";
   - existing lines are "already entered; checked";
   - it ends READY FOR REVIEW with no duplicate rows and no second Repair Order.
3. **Missing orders:** with Order Check on, open Tempe Orders (Today, then Tomorrow).
   - Each order shows ✓/≈/✗ and the bar shows the counts.
   - **Make it** on a ✗ order: the helper enters it, and after a check it shows ✓ (entered by the helper).
4. **Auto-update** (after 2.2.0 and its latest.json are on GitHub, nothing should be offered for the same version):
   - when a newer version is uploaded, the status line offers it;
   - Yes: download, check, install, restart;
   - an old folder's Start-RDP.cmd starts the newest installed version.
5. **Boss report:** opens in the browser with today/7/30-day figures and no customer details. The status line shows today's time saved.

---

# v2.1.0 checks

1. Start-RDP: title **2.1.0 - all branches**; 77 + 15 self-test groups pass.
2. **Customer only in other branches** (TTW1730345's phone):
   - the Search window's Phone is filled, Branch is cleared and Search is pressed;
   - row 1 is taken with OK and the account loads;
   - diagnostics show the wait `customer_search_all_branches` "accounts found".
3. **Phone in no branch:** the search finds nothing, Cancel is pressed and the order's customer details are entered (new customer).
4. **Ship Via:** an existing customer's pickup or mobile job ends with Ship Via SHOP (`ship_via` SHOP). A delivery keeps its own Ship Via. A new customer gets no SHOP.

---

# v2.0.3 checks

1. Start-RDP: title **2.0.3 - steady**; 76 + 15 self-test groups pass.
2. **Two-account phone:** the first account is chosen. Diagnostics show `account_chooser`, then `account_first_row` "row 1 selected…", and the run completes as `existing-customer-first-of-several`. If it fails, `account_grid_shape` holds the grid structure: send the report.
3. **Batch of online orders:** `online_skip_review_ro` in the day log; no "not empty" runs; END OF DAY counts checks separately.
4. **Hold Shift for a second** while an order starts: the helper waits and continues.
5. The status line meter stays about 40–60 MB, CPU under 1%.

---

# v2.0.2 checks (lag)

1. Start-RDP: title **2.0.2 - lag fix**; 75 + 15 self-test groups pass.
2. The status line shows "Helper NN MB, CPU N%". At idle: under about 80 MB and under 1% CPU.
3. Run online and mobile orders, including a slow phone search (the two-account customer). COSTAR stays responsive and doesn't freeze after the search. Diagnostics may show `costar_busy_skips`; that is the helper holding back.
4. Order Check tab: Off by default. Turn it on, choose the second Tempe COSTAR, and it reads. Choosing the entry COSTAR is refused ("That is the COSTAR the helper types into").
5. After a few hours: Save diagnostics. END OF DAY shows helper memory start/peak/now and CPU; no growth flags.

---

# v2.0.1 checks

1. Start-RDP: title **2.0.1 - one system**; 74 helper + 15 Order Check test groups pass.
2. **Two-account customer** (TTW1730377's phone): the search is not interrupted, the first account is chosen (`account_chooser`, `account_first_row`), and no "search did not cancel".
3. **Online pickup:** the Repair Order's **Time in** shows the booking time ("10:30 am"), and the log says "Entered Time in".
4. **Fresh Repair Order** from Fill automatically: no "target field is covered". If there's a `covered` event, `covered_wait` should say "cleared".
5. **Slow COSTAR:** phone lookups taking 2–5 s complete instead of stopping.
6. **Speed:** memory after jobs stays around 40–60 MB (no drop to 1 MB), and the next job starts promptly.

---

# v2.0.0 checks (one system)

1. Close the separate Order Check app. Start-RDP builds 13 source files (now including `OrderCheck.cs`). The self-test report shows **73** helper groups and **15** Order Check groups. Title **2.0.0 - one system**.
2. **Order Check tab:** it reads normally ("Reading normally", the board data link and "Helper tags use the … column" or "Helper tags off"). The board in Chrome loads.
3. **One COSTAR choice:** choose the WIP window in the Order Check tab. The helper's list marks it "Order Check's WIP window" and switches entry to the other Tempe COSTAR.
4. **Background reading:** switch to the Mobile or Online tab. Order Check keeps reading (board updates every 2 minutes).
5. **Old app still running:** the Order Check tab says to close it, and the helper itself works normally.
6. **Closing the helper** stops Order Check's reader and frees port 8795.
7. All 1.9.0 checks below.

---

# v1.9.0 checks

1. Start-RDP builds (now with Accessibility.dll) and passes **73** self-test groups; title **1.9.0 - lean build**.
2. Fill automatically with Chrome in front: COSTAR comes to the front, Add New opens a settled Repair Order, and entry completes. No "not ready", "covered" or "lost focus" stops.
3. Two accounts on one phone: the customer Search list shows, row 1 is highlighted, OK is pressed, and the first account loads (`existing-customer-first-of-several`). Cancel is never pressed.
4. Typing in another app during entry: entry stops (your keys never go to COSTAR). Not typing: COSTAR is taken back (`focus_recovered`, at most 3 per order).
5. Order Check running: its WIP COSTAR is marked in the list and skipped. A manual pick of it is refused. An online order already in WIP is refused (`online_duplicate_blocked`).

The 1.8.3 and earlier checks below still apply.

---

# v1.8.3 checks

1. Start-RDP builds and passes **71** self-test groups; title **1.8.3 - lean build**.
2. With Friday's finished job still in the journal and a restarted COSTAR: the log explains that the earlier job's COSTAR has closed, the list is enabled, and the current Tempe COSTAR is selected (`mobile_pin_released`, `costar_found` in the day log).
3. An online order fills without touching the COSTAR list.
4. Start / resume mobile, then Next Order on the desk: the worker confirms the old job closed ("already closed"), and the next job is entered in a new Repair Order.
5. Live-pin safety, unchanged: with an unfinished job whose original COSTAR is still running, the list stays on that COSTAR.

---

# v1.8.2 checks

1. With COSTAR Tempe open in the RDP session: Start-RDP builds, **70** self-tests pass, title **1.8.2 - lean build**.
2. **Without clicking Refresh**, the log shows "Using Tempe COSTAR (PID …)" and the list shows it selected. The day log has a `costar_found` line.
3. With COSTAR closed: the log explains that no Tempe COSTAR was found and lists the COSTAR windows it saw. Open COSTAR, click Refresh COSTAR list, and it is found.
4. **Online:** load an order and click Fill straight away, without touching the COSTAR list. It is entered.
5. **Mobile:** Start / resume mobile works without a manual Refresh. In diagnostics, `det_leave_once` is `ok` and the DET stage is shorter than in 1.6.1 (about 0.8–1.5 s).
6. **Save diagnostics:** THINGS TO LOOK AT shows the checkpoint-save breakdown (copy / JSON / encrypt / write / replace).

The 1.8.1 and earlier checks below still apply.

---

# v1.8.1 lean build + day log: checks

1. Start-RDP builds and passes **70** self-test groups; title **1.8.1 - lean build**.
8. **Day log:** after a few jobs, click **Add note**, type a test note, then **Save diagnostics**. The ZIP contains `day-log/events-<today>.jsonl`, and `summary.txt` starts with END OF DAY showing today's counts, your note with its time, SPEED BY VERSION and THINGS TO LOOK AT. No customer names, phones, addresses or emails anywhere in the ZIP.
9. **Failures outside entry are visible:** load something that is not a valid order with auto-load on, or start Fill with no COSTAR selected. The day log shows `online_load_failed` / `online_fill_refused` with the reason.
2. **Reads:** after a mobile job and an online order, the diagnostics summary's SCREEN READS shows text reads far below 1.6.x (about 12,000 per mobile job), "skipped by read plan" in the thousands, and "late" near zero. Entry behaves exactly as before.
3. **Two accounts on one phone:** the first account is chosen and entry continues (event `account_chooser`, wait result `existing-customer-first-of-several`). If it stops instead, the report ZIP contains `account-chooser-controls.json`.
4. **Online with an earlier order open:** leave the previous online order open for review, load the next order, click Fill. A fresh Repair Order is opened and filled; the earlier one is untouched.
5. **Fill automatically:** tick it; click Send to COSTAR for two orders in quick succession. Both are entered one after the other, each in its own Repair Order. Send the first again: the helper refuses it ("already entered in this session").
6. **Stop during automatic filling** (Ctrl+Alt+F10): the queue pauses; clicking Fill continues with the next order.
7. Memory: with the worker running across several jobs, its memory drops back after each job.

The 1.6.1 and earlier checks below still apply.

---

# v1.6.1 speed build: checks

1. Start-RDP builds and passes **66** self-test groups; title **1.6.1 - speed build**.
2. Mobile job: in the diagnostics, `det_lookup` is ok and `leave_grid` needs one attempt; checkpoint save time is well below the 1.6.0 figure (1.2 s for 17 saves).
3. The 1.6.0 checks below, especially TTW1730342 (existing customer, delivery) and Fill with no Repair Order open.

---

# v1.6.0 speed build: checks

1. Start-RDP builds and passes **66** self-test groups; the title shows **1.6.0 - speed build**.
2. **Existing customer, online delivery:** run an order whose phone already exists in COSTAR (for example TTW1730342 again). Entry must continue past the phone lookup, compare billing and delivery fields, change only those that differ, then add the items.
3. **Same Repair Order retry:** stop an online order right after the phone lookup, then click Fill again on the same order. It must continue (same phone, no items) instead of asking for an empty order. An order holding a different phone must still stop.
4. **No Repair Order open:** close every Branch 11 Repair Order, load an online order and click Fill. The helper must click Add New, wait for the new form and fill it.
5. **Mobile job:** the run completes; in the diagnostics summary the DET stage is well under 1 s of waiting and checkpoint saves are about one per step.
6. **Stop test:** press Ctrl+Alt+F10 during a test order; entry stops promptly and the summary shows `user_stop` with the right stage.

The 1.5.5 and 1.5.4 checks below still apply.

---

# v1.5.5 diagnostics build: checks

1. Start-RDP builds and passes **65** self-test groups; the title shows **1.5.5 - diagnostics build**.
2. Process one test mobile job and one online order exactly as with 1.5.4. Entry steps, speed and stops should look the same as 1.5.4.
3. After each run, `%LOCALAPPDATA%\TempeCostarAutofill\Reports` contains the run's ZIP only (no duplicate folder), and `%LOCALAPPDATA%\TempeCostarAutofill\Diagnostics` contains a matching `.json`.
4. **Save diagnostics** creates `Tempe-COSTAR-Diagnostics-<date>.zip` beside those folders and opens Explorer on it. Open `summary.txt`: it should list outcomes, stages, waits and environment, and no customer names, phone numbers, addresses or emails.
5. Stop one run on purpose (Ctrl+Alt+F10) on a test order. It should appear as `user_stop` in the summary.

The 1.5.4 checks below still apply.

---

# v1.5.4 complete package: first acceptance checks

First extract the complete ZIP into its fresh Tempe-Mobile-COSTAR-v1.5.4 folder. All 11 C# source files, especially ResourceBudget.cs and CostarSession.cs, must be present. The builder checks for missing dependencies before compiling. Close the old combined helper. If normal closing is unavailable inside RDP, try Ctrl+Alt+End to reach Task Manager and end only the Tempe helper. Forced termination can leave a partially entered order; inspect it before resuming. Keep COSTAR and its existing order data.

Run Start-RDP and leave it paused for one minute before submitting any work. It should remain responsive; no COSTAR discovery or mobile polling starts until requested. Record TempeMobile.exe CPU and memory at opening and after one minute. Click Refresh once and repeat. Start mobile and check again with no new job. Visit Online orders with auto-load off and check again. Stop at the first returning slowdown and note which action triggered it. No numerical RAM/CPU target has been verified yet.

Then run the following inside RDP after the launcher passes its Windows self-tests. Entry tests create live Repair Orders; use your normal approved test data.

1. Close the old worker and standalone autofill once. Start-RDP opens one app with Mobile jobs and Online orders. Start-Online should bring the same app forward, on Online orders, without creating a second worker.
2. Open two separate Branch 11 COSTAR instances and, if available, a different branch. Refresh the target list: only real Branch 11 instances appear. Select one and use Show selected COSTAR. The screenshot's CefSharp subprocesses must not appear as choices.
3. Keep a Repair Order open in the unselected process. Leave the selected process on Work-in-Progress. Click Start / resume mobile. A new mobile job should still open and fill the selected process only.
4. During a mobile run, the target selector must be disabled. Switching to Online orders must not interrupt the running mobile job or allow simultaneous online entry. Finish/review/close the mobile order normally.
5. With Online orders selected, queued mobile jobs wait. Open one new empty Branch 11 Repair Order in the selected process, Send to COSTAR from the website, click Load copied order, then Fill Repair Order. Confirm a different COSTAR account name is retained, the supplied address is used, prices/quantities are correct and entry order is wheels/tyres/M FB/alignment/DET. Make/model, rego and odometer template must stay correct after clicking away.
6. Check a known phone and a customer-not-found phone. New text/codes must be capitals; existing COSTAR account/name must remain intact. For delivery, check both addresses, F freight, DFE, TO SUIT, and surcharge handling. No missing package components may be guessed.
7. Close the online Repair Order and switch back to Mobile jobs. If mobile is enabled, queued work resumes in the selected instance. Stop all entry or Ctrl+Alt+F10 must stop either active mode; Resume mobile explicitly after a stop.
8. With no unfinished job, close the selected COSTAR. The app must not silently choose another instance. A reopened process requires refreshing/reselection. If a job is partial, its retry must remain tied to the original process and order; it must not create another order after process restart.
9. Open entry reports and compare stage times for the relevant order in timing.json. Do not compare online delivery/fitting and a simpler mobile job as if they had equal field counts.

For the failed phone job, confirm it was not completed manually before using Reset unstarted job. The button must reject a still-open original window, a pending/entered field, uncertain Add New, or a mismatched job/lease. After an allowed reset, retry the same job from the desk receiver; no new phone submission is required. With a new order loading, the worker should wait for the required grid/header controls without typing. An unknown blocking window must still stop entry for review.

Confirm both customer and delivery email fields are lowercase after clicking away. Other inserted text remains uppercase.

The entries below are the prior queue/recovery checks and still apply to the selected COSTAR instance.

---

# Controlled Windows acceptance test

Start with the single-job test in README. Use approved test records and known COSTAR SKUs. Stop at the first mismatch and save the worker report, rather than deleting the queue or starting a replacement submission.

| Check | Action | Expected result |
| --- | --- | --- |
| Build | Run Check-Build.cmd. | EXE compiles; all self-test groups pass. No COSTAR interaction. |
| Pairing | Launch desk and RDP helpers; refresh/select the target, Start / resume mobile, then open the phone QR link. | Both helpers show connected and phone Submit becomes available after required fields/products are filled. |
| Basic entry | Submit one tyre, quantity 1, complete vehicle details and notes. | One new RO; phone first, then retained COSTAR name or new name; tyre then M FB; DET make/model, rego, odometer; final M note; Ready for Review. |
| New customer | Use a phone with no existing record. | Phone is first; known not-found notice closes; submitted name is entered in capitals; no account is invented. |
| Existing mobile customer | Use an existing phone with a different submitted name. | COSTAR account/name and address are retained; details finish; the next queued job can still start. |
| Existing online customer | Use an existing phone with a different submitted name and billing address. | COSTAR account/name remain; supplied billing address replaces the old address, including clearing a stale second line. |
| Delivery address | Send an online delivery with a different recipient/address from billing. | Both panels contain their own data; DFE comment and normal freight are retained. |
| DET speed and commit | Watch MAKE/MODEL, REGO NO and ODOMETER entry, then click away. | PO is visited once after DET; no repeated PO trips; all entered values remain in their correct rows. |
| Capitals | Use mixed-case customer text, email and additional notes. | Inserted values are uppercase. Retained COSTAR names and catalogue descriptions are not rewritten. |
| Lookup still loading | Use a normal SKU that takes time to resolve. | The helper waits for the resolved row before quantity/price entry; no duplicate rows or skipped lines. |
| Timing report | Open the resulting COSTAR report ZIP. | timing.json records total/stage durations and snapshot totals; no new video is required to identify a slow stage. |
| Active arrival, Pinad off | Use desk keyboard/mouse immediately before phone submission. Leave the approval untouched for over 30 seconds. | Job remains awaiting approval until explicitly approved or Pinad mode is enabled. |
| Pinad mode | Enable Pinad mode, use desk keyboard/mouse, then submit with COSTAR available. | Job starts on the next worker poll without Approve selected; final RO stays open if no further job is waiting. |
| Continuous queue | With Pinad mode on, submit three distinct jobs. | Each job fills once in FIFO order. Each completed window closes before the next opens, without Approve or Next Order clicks. Recent completed jobs remain listed for later review in COSTAR. |
| Delete selected | Select a completed or READY FOR REVIEW entry and click Delete selected, then restart the desk helper. | Entry disappears and stays removed; the order remains in COSTAR. A later submission still advances normally. |
| Clear completed | With completed entries and pending jobs listed, click Clear completed. | All completed entries disappear; pending/failed/running jobs remain. COSTAR orders are kept. |
| Later arrival | With Pinad mode on, let the only job finish, then submit another job. | The completed window closes and the new job starts automatically. |
| Stop receiving | Stop receiving before the current job finishes, with another queued. | Filling may finish, but no new close/assignment is issued until receiving resumes. An action already received by the worker may finish. |
| Close prompt | If COSTAR presents a prompt on automatic closure, leave it unanswered. | Worker pauses and the next job remains queued. Handle the prompt normally, then resume the worker. |
| Existing waiting jobs | Enable Pinad mode with jobs awaiting approval. | Waiting jobs become approved in their existing order; only one starts at a time. |
| Remember mode | Restart the desk receiver with Pinad mode enabled, then disable it and submit a new job while active. | Checkbox stays enabled after restart. Disabling restores approval for the new job; previously approved jobs stay approved. |
| Idle arrival | With no RO open, leave desk input idle for over 30 seconds, then submit a test job. | Job starts when worker/COSTAR is available. |
| Full order | Use three distinct lines: wheel and two tyres; choose WAFR. | Wheels first, tyre order preserved, correct quantities, M FB, WAFR, details, notes. COSTAR prices retained. |
| Front alignment | On a separate approved test, choose WA. | WA follows M FB; no WAFR row. |
| Manual queue | With Pinad mode off, while a ready RO remains open, submit a second job. Then click Next Order. | Second job waits; first window closes normally; second receives its own RO. A close prompt stops for manual handling. |
| Phone loss | After the desk has received a job, temporarily disconnect the phone, then reconnect. | Worker continues; status recovers; no second RO or repeated rows. |
| Controlled Retry | On a test, stop between steps; inspect the partial order, then resume worker and Retry the same job. | Exact before/after state is reconciled. Partial/unrecognised state stops, with no repeated product rows. |
| Wrong target | Leave an unrelated RO open before submitting. | No automatic overwrite or second RO. Pending job waits. |

For an initial failure, send:

1. `bin\self-test-results.txt`, or the compilation error if no EXE was created.
2. The text from **Save worker report**.
3. The matching ZIP under `%LOCALAPPDATA%\TempeCostarAutofill\Reports` if native entry had begun.

Do not send the worker connection file or phone pairing QR. A report is enough to diagnose the first stop; no new screen recording is required at this stage.
