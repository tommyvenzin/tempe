# Ebay-auto changes

## 1.1.10 - 24 November 2026

- Customer lookup uses Contact info only. The Ship to phone is kept for delivery contact and is never a fallback for choosing the billing account.
- A matching Contact info number in billing Mobile Ph, Home Ph or Bus Ph is accepted. COSTAR's account and phone-field placement are kept; the eBay Order/Buyer name still fills billing.
- Missing customer name/address details no longer stop the known details and order lines from being entered. Missing mandatory fields skip new-account creation; the result says CHECK BY HAND. Supplied invalid values still stop entry.
- A stopped older attempt that used a different Ship to phone is left for manual completion instead of silently changing its customer account.
- Sydney/Tempe routing, prices, totals, stock prompts, open Repair Orders, Next #, clipboard references and duplicate protection are unchanged.

Pause order entry and update BOTH app parts to 1.1.10 and the 404 extension to 1.6.1 before resuming. Keep the existing extension folder and pairing. Protocol 2 and order schema v3 are unchanged. Live COSTAR validation of the new customer behaviour is still required.

## 1.1.9 - 20 November 2026

- Each eBay order goes into COSTAR Sydney (Br1) or COSTAR Tempe (Br11): Seb chooses with two buttons in the 404 extension 1.6.0 panel.
- Suggested Tempe when an item's own title has the whole word wheel/wheels/package/packages; otherwise Sydney; nothing when titles can't be read.
- Choosing against the suggestion (or with unread titles) asks to confirm in the panel. Package SKUs are never trimmed.
- Same receiver and worker for both branches, one order at a time; one chosen COSTAR per branch (earliest started); never moved to the other branch.
- Order payload tempe.ebay-order.v3, protocol 2. Stored 1.1.8 orders stay Sydney orders and keep their duplicate-order hashes (a 1.1.8 order sent again with the same details is the same order, not a CONFLICT).
- Stock prompt, statuses, alerts and diagnostics name the order's branch.
- Includes the extension-only 1.5.3 wheel SKU fix (published 19 November).

Requires BOTH app parts 1.1.9 and extension 1.6.0 (a 1.1.8 part gets no orders from a 1.1.9 part). The first live Tempe order still needs a watched check.

## 1.1.8 - 19 November 2026

- Contact info phone first; Ship to fallback only when no account is found; restore Contact info if both miss.
- Billing X uses the real Order/Buyer name even on a linked account. Delivery Y uses Ship to; M BUY keeps the username.
- Sydney stock: above 2 continues, 0-2 needs typed ok/check, negative needs yes confirming Seb will contact the customer.
- check preserves the existing comment and adds low stock - currently checking. Prompts cannot be skipped; Stop remains available.
- Unit addresses use slash notation and capitals; clear number/street spacing is cleaned up in preview and COSTAR.
- Stable duplicate-order hashes, retry records and diagnostic detail retained.
- Successful Repair Orders stay open; ez, next and the Repair Order + DFE clipboard remain.

Requires BOTH app parts 1.1.8 and extension 1.5.2. Live Repair Order stock layout and RDP prompt still need a watched check.

# Ebay-auto: what changed, and known limitations

## 1.1.7 (18 Nov 2026)

Tommy, 18 Nov 12:09: "it will not show any popup, just click and the box will be filled with numbers"; 12:12: "its as
easy as order done -> press next# -> copy value in repair order + "DFE"". 1.1.6 was published earlier on 18 Nov: 1.1.7 has all of it
(below), plus the press. Ebay-auto only: the Tempe helper is unchanged.

- **Next # pressed once.** When the order is in and the number box is blank at both looks, the worker presses Next #
  once: the button right beside the box with COSTAR's words "Ne&xt #", enabled, inside this order's Repair Order, with
  that Repair Order in front and no COSTAR window over it; a direct press, as for COSTAR's other buttons. It then reads
  the box every 0.15 s until the number shows (10 s at most), reads it twice more with the order's PO#, copies
  "<number> DFE" and reads the clipboard back (as 1.1.6), and says "ez, next". A number already in the box is kept and
  Next # isn't pressed (it is greyed then, in every map).
- **Never pressed twice** for an order. Not pressed (direct presses off, Next # not there or greyed, a COSTAR window over
  the Repair Order): CHECK BY HAND, press Next #, then copy the number followed by DFE. Pressed but no number within 10 s:
  CHECK BY HAND, check its number (press Next # once more only if it is still blank). A COSTAR window comes over the
  Repair Order while waiting: the wait ends, nothing in it is answered, CHECK BY HAND.
- **Diagnostics:** `ro_number_next` (pressed once; the box filled after how many ms and reads, its shape; or why not
  pressed / no number), and `ro_number` for the looks after Next #. Never the digits.
- Update the worker (one click from 1.1.0 or later), and the receiver to keep the two the same. The extension (1.5.1) and
  the protocol (1) are unchanged.

- **Pre-publication correction:** if the number appears together with a blocking COSTAR window, that window takes precedence and the order says CHECK BY HAND. The worker also checks again after the final number reads, before copying. It does not answer the window. A regression test covers the simultaneous number-and-window result.

### Known limitations (1.1.7)

- Not tested live: Next # on COSTAR Sydney (Tommy: no window opens, the box fills), the clipboard inside Remote Desktop
  and on Seb's PC.
- Otherwise as 1.1.6.

## 1.1.6 (18 Nov 2026)

Published on 18 Nov; retained in 1.1.7, which also presses Next # (below, "Next # is not pressed yet", was 1.1.6).
Asked for by Tommy on 18 Nov (10:13: "After all order details are entered and verified: 1. Read the Repair Order number
in the box at the top of the CURRENT Repair Order. 2. If it already has a number, keep it. 3. If it is blank, click
"Next#" … 4. Copy the number followed by one space and DFE to the clipboard … Once the number is copied, report "ez,
next" and release the job as usual."). Ebay-auto only: the Tempe helper is unchanged (the eBay code is still 2.9.14's).
It has all of 1.1.5: upload 1.1.6 whether or not 1.1.5 was uploaded.

- **The Repair Order's number on the clipboard.** Once an order is entered and verified and its Repair Order is left
  open for Seb (the default since 1.1.1), the worker looks twice, 0.3 s apart, at the box at the top of that order's own
  Repair Order (the read-only box beside COSTAR's "RepairOrder" label), each time with the order's PO# in the same
  look. A number already there is kept as COSTAR shows it. It goes on the clipboard as the number (leading zeros kept),
  one space, then DFE, for example `01234567 DFE`: Unicode text only, no label, no line break. The clipboard is read
  back; once it holds exactly that, the order says "ez, next" and the job is released as before. The next order still
  gets its own new Repair Order.
- **Never copied:** a Repair Order with no number yet; a number that couldn't be read, changed between the two looks,
  isn't COSTAR's 8 digits (0-9), or wasn't shown with this order's PO#; a box beside the label that isn't COSTAR's
  read-only number box; a number the worker copied before (it keeps the last 200 in its encrypted journal; an order
  entered again with Start again is in a new Repair Order); a clipboard that couldn't be set and read back in 3 tries.
  Then the order says "In COSTAR Sydney ✓ but CHECK BY HAND: Repair Order number not copied: <why>. <what to do>"
  (never "ez, next"), and Seb gets the worker's balloon as for any CHECK BY HAND. If the clipboard still holds exactly
  what the worker copied for the order before, it is taken off, so that number can't be pasted for this order (the
  note says so). The order stays entered and verified: it is never stopped, retried or entered again because of its
  number.
- **Next # is not pressed yet.** The existing maps identify the number box and Next # reliably (below), but none shows
  what pressing Next # does. A Repair Order with no number yet is left for Seb: "Repair Order number not copied: the
  Repair Order has no number yet. Press Next # on it, then copy its number followed by DFE." The worker records whether
  Next # was beside the box, and enabled or greyed. Pressing it comes once the capture in VALIDATION.md (1.1.6) shows
  what COSTAR does.
- **Diagnostics:** `ro_number` (the two looks: the number's shape, such as "8 digits, a leading zero" or "blank", never
  its digits; why not; Next # beside it, enabled or greyed), `ro_number_copy` (characters copied and read back the
  same, on which try and how long; or why not), `ro_number_clear` (whether the previous order's text was taken off),
  the run's `roNumber` (copied, blank, unreadable, …) and `roNumberShape`, the counts by reason in the worker's
  summary ("REPAIR ORDER NUMBERS"), and the journey's "completed" line. The number itself is only in the worker's window
  and its local entry report (review.json), never in the report to the receiver, the journey or the diagnostics.
- With "Close each Repair Order" ticked (off by default since 1.1.1): unchanged, nothing is read or copied.
- Update the worker (one click from 1.1.0 or later; 1.0.0 by hand), and the receiver to keep the two the same (its
  only change: the diagnostics' masked line). The extension (1.5.1) and the protocol (1) are unchanged.

### What the maps show (checked 18 Nov)

- 39 maps (28 Oct to 17 Nov) hold 21 Repair Order windows: 19 in Tempe (Branch 11), 2 in Sydney (Branch 1, 3 Nov). In
  every one: exactly one "RepairOrder" label at [37,83,176,17]; beside it the read-only box at [214,82,170,20] (8
  characters, or empty); and "Ne&xt #" at [388,81,97,21] on the same line (a COSTAR-drawn button that takes a direct
  press; accessibility "Next #", Alt+X).
- Next # was enabled in all 16 with an empty box and greyed in all 5 with 8 characters (3 in Tempe, both in Sydney).
- Missing: no map shows what pressing Next # does, and none shows a new Sydney Repair Order before it has a number (both
  Sydney maps already had one). On 28 Oct one Tempe Repair Order went from empty to 8 characters between two maps 47 s
  apart, but with COSTAR's Print form ("Print RepairOrder …") in front in the second, so that shows Print, not Next #.

### Known limitations (1.1.6)

- Next # is never pressed (above).
- Not tested live: the clipboard inside the Remote Desktop session and on Seb's PC (Remote Desktop's clipboard
  option), and the number box on real Sydney orders. If a new Sydney Repair Order has no number yet when the order is
  in, every order says CHECK BY HAND (press Next #, then copy it) until the worker presses Next # itself.
- Otherwise as 1.1.5.

## 1.1.5 (18 Nov 2026)

One fix, found in the Tempe helper's diagnostics of 18 Nov 08:36 (the same account step as here); everything else is as in
1.1.4. It is the same code as the Tempe helper 2.9.14's. 1.1.3 and 1.1.4 were never uploaded: upload 1.1.5 only (it has
both).

- **The new-customer account step waits for COSTAR's windows to be drawn.** At 08:15 on the Tempe RDP PC, the step looked
  at COSTAR's customer search 0.2 s after pressing the magnifier, while COSTAR was still drawing it (no Add new or Cancel
  yet), took it for another window and stopped the order (safely: nothing more pressed, no account made). Now COSTAR's
  customer search and its new-customer form are looked at again, every 0.15 s, until they are drawn (10 s at most). A
  window is left for Seb, as before, only when it has stopped changing for 1.5 s without being the one expected, or isn't
  recognised within 10 s. Nothing is pressed on a window that isn't recognised.
- **Diagnostics:** each of those windows gets a `new_account` event saying when it was known (looks, time, controls) or
  why not.
- Update both parts (one click each from 1.1.0 or later; 1.0.0 by hand), then the extension on Seb's PC if it isn't
  1.5.1 yet (unchanged since 1.1.4). The protocol (1) is unchanged.

### Known limitations (1.1.5)

- As 1.1.4. Not tested live: COSTAR Sydney's drawing times for these two windows (the worker's diagnostics show them).

## 1.1.4 (18 Nov 2026)

Not uploaded: replaced by 1.1.5, which has all of it. One fix, asked for by Tommy on 18 Nov (02:20: "the missing-state fallback has one gap … deliveries and eBay cannot reach
it when the state is missing … Resolve a missing state before the checks that require it, using the existing suburb +
postcode lookup. Don't simply remove validation."); everything else is as in 1.1.3. It is the same code as the Tempe
helper 2.9.13's. 1.1.3 was never uploaded: upload 1.1.4 instead (it has all of 1.1.3).

- **An eBay order with no state gets in.** The 404 extension 1.5.1 sends it (1.5.0 stops it on the eBay page: "Can't
  send to COSTAR: the state was not found"). The receiver, before its check, looks the state up by the address's suburb
  AND postcode (1.1.3's address list and rules) and takes the order only when they are in exactly one state. The
  worker's own check and the entry find the same state, so the customer panel and Ship to get it, and the account step
  uses it. The order is kept exactly as sent, so a second Send of it is still the same order.
- **Still not found** (a suburb and postcode in two states, such as Texas 4385, or a suburb not under that postcode):
  refused before it is queued, as before, and the eBay page says why: "Not sent: The address has no state, and it
  couldn't be looked up from its suburb and postcode: … Enter this order by hand." Never a default state.
- **Written states: as before** (a code or a full name, never replaced). One that isn't a state ("Jervis Bay
  Territory"): still stopped on the eBay page.
- **Diagnostics:** the receiver's journey (`received`) and the worker's (`claim_received`) end with "state as written"
  or "state looked up from the suburb and postcode"; a refusal (`send_invalid`) says why. The worker's run: its details
  (`billingState`, `deliveryState`), an `address_states` event and review.json (`BillingStateFrom`,
  `DeliveryStateFrom`); the account step's `NewAccountState` says `lookup` for such an order. Never the state, suburb or
  postcode themselves.
- Update both parts (one click each from 1.1.0 or later; 1.0.0 by hand), then the extension on Seb's PC (1.5.1: extract
  `404-but-its-found-1.5.1.zip` over its folder and reload it). A worker older than 1.1.4 refuses an order with no state
  that a 1.1.4 receiver took ("Not entered: The state must be …"), so update the worker too. The protocol (1) is
  unchanged.

### Known limitations (1.1.4)

- As 1.1.3: the address list is a community-compiled copy of Australia Post's (6 Sep 2025): a locality added since, or
  spelt another way, isn't found (such an order is refused with the reason, for Seb to enter by hand).
- Not tested live: how eBay shows a buyer's address with no state, and such an order going through COSTAR.

## 1.1.3 (18 Nov 2026)

Not uploaded: replaced by 1.1.4, which has all of it. One change, asked for by Tommy on 18 Nov (00:44: the state for a new customer's COSTAR account); everything else is as
in 1.1.2. It is the same code as the Tempe helper 2.9.12's.

- **The state for a new buyer's COSTAR account:** the one written in the eBay address first (a code or a full name, any
  case, extra spaces or dots: eBay always gives one, and the extension already requires it), never replaced. Only when an
  order has none is it looked up by the suburb AND the postcode in the address list (Australia Post's localities and
  postcodes as compiled by Matthew Proctor's *Australian Postcodes*, 6 Sep 2025), and used only when that suburb under
  that postcode is in one state. Never from the postcode alone, the store, or COSTAR's default. None: no account,
  Account# blank, the order goes on as before.
- **Diagnostics:** where the state came from (`address`, `lookup`, or `none:` and why) in the run's events
  (`new_account_state`), review.json (`NewAccountState`) and the run's details; never the buyer's suburb, postcode or state.
- Updated by one click from 1.1.2, 1.1.1 or 1.1.0 (Updates tab); from 1.0.0 once by hand (MIGRATE-FROM-1.0.0.txt). The
  protocol (1) and the extension (1.5.0) are unchanged.

### Known limitations (1.1.3)

- The address list is a community-compiled copy of Australia Post's list (6 Sep 2025), not Australia Post's own: a
  locality added since, or spelt another way than Australia Post spells it, isn't found (no account then).
- Not tested live: as for 1.1.2.

## 1.1.2 (17 Nov 2026)

One change, asked for by Tommy on 17 Nov (15:18 and 15:25: "Apply this to every order-entry workflow in both the Tempe
helper and Ebay-auto where all mandatory customer-creation details are available"); everything else is as in 1.1.1. It
is the same code as the Tempe helper 2.9.11's.

- **A new buyer gets a COSTAR customer account.** When the phone lookup in COSTAR Sydney ends with **Customer Not
  found** and nothing else (no list of accounts, no other branch, no recovery), Account# is blank, and the eBay order has
  every detail COSTAR's new-customer form asks for (a name of at least two words, street address, suburb, state,
  postcode, a phone of 8 digits or more):
  1. X (the customer panel) is filled as before and checked against the order: Account# blank, the name word for word,
     street, suburb, state, postcode and phone.
  2. The magnifier beside X's Account# (never Ship to's), then **Add new** in COSTAR's customer search.
  3. COSTAR's **Add new cash customer** form opens filled from X. Each required box is checked against the order: Last
     and First name hold every word of the name (repeats too; none lost or added), address, city, state, postcode, the
     phone in one of its phone boxes, and a personal service file chosen (COSTAR's default). Nothing on the form is
     changed: COSTAR's defaults and ticks stay as they are.
  4. Nobody using the session (a few seconds at most), the form still as read: **OK**, once for that order, ever.
  5. The account counts as made only when the form is gone, nothing of COSTAR's is over the order, the Repair Order is
     in front and free, and Account# shows a number, the same at two looks, with the same name's words and phone.
  6. X is checked again: COSTAR's account number and its name formatting are kept, the order's other details are put
     back where COSTAR changed them. Then Ship to gets the order's delivery details (COSTAR copies X there as it makes
     the account), and the order goes on as before: Rebill to EBAY, the items, every check, "ez, next". Ship to's
     Account# stays blank (normal).
- **No account, and the order goes on as before with Account# blank** (the worker's log says why): a detail missing
  (never made up); the tick off; direct presses off; X not holding the order's details; the magnifier not found; a COSTAR
  window already open; COSTAR's form laid out differently or not holding the order's details, or someone using the
  session just before OK (Cancel pressed, back to the Repair Order: Cancel makes nothing, seen on 17 Nov).
- **Unsure after OK** (COSTAR may have made the account): the order stops ("Stopped: COSTAR may have made a customer
  account for this order …"), nothing more is pressed, and **no attempt of that order makes an account again**. Then:
  - **Retry**: the Repair Order it stopped in is compared without Account#, the name's word order and Ship to (what
    COSTAR changes as it makes an account); an account on it is kept and used. Account# blank: gone on with only when it
    reads blank twice with the Repair Order in front and free, with a CHECK BY HAND to check COSTAR for the customer. A
    COSTAR window still open over the order (a message or the form) is left for Seb, nothing pressed on it, and the
    retry stops saying so.
  - **Start again in a new RO**: the phone lookup finds the account if COSTAR made it; Customer Not found again: no
    account, a CHECK BY HAND.
- **The worker's record** of OK pressed (`new-accounts.dat` in its Windows-protected private folder: part of a SHA-256
  of each eBay order number, a state and a time, kept a year). Never in diagnostics or a package. If it can't be
  written, OK isn't pressed (Cancel, no account).
- **The tick**: worker, Settings tab, "Make a COSTAR customer account for a new buyer …": on by default, also after the
  update. Unticked, new buyers are entered without an account, as in 1.1.1. It needs direct presses.
- **Fixed on the way:** COSTAR's new-customer form, opened by hand during a lookup, could have been taken for a list of
  accounts (and its OK pressed). It is now never taken for one, and nothing else answers or cancels it.
- **Diagnostics:** each step and its time in the run's events (`new_account`), the result in review.json
  (`NewAccount`); never the buyer's details; the journey notes the tick being changed.
- Updated by one click from 1.1.1 or 1.1.0 (Updates tab); from 1.0.0 once by hand (MIGRATE-FROM-1.0.0.txt). The
  protocol is unchanged (1), and so is the receiver's behaviour (it gets the same words from the worker). The extension
  is unchanged (1.5.0).

### Known limitations (1.1.2)

- **Not tested live**: the worker's own presses on the magnifier, Add new and OK in COSTAR Sydney (the sequence was
  captured on Tempe; BM_CLICK already works on COSTAR buttons of the same kind), COSTAR's account after OK as the worker
  reads it, Terms after Rebill to EBAY with a new account, an unsure stop and its retry.
- After OK the account number appearing (steady, the form gone, the same name and phone) decides; Ship to holding X's
  name is recorded, not required, and "Edit..." isn't read. A false "unsure" stops the order for Seb, and its Retry keeps
  the account.
- An order that stopped unsure keeps its record for a year: Start again or Retry never makes its account, even if none
  was made (make it by hand if COSTAR has none).

## 1.1.1 (17 Nov 2026)

One change, asked for by Tommy on 17 Nov ("Seb prefers every successfully entered eBay Repair Order to stay OPEN in
COSTAR so he can check it and close it manually"); everything else is as in 1.1.0.

- **Each entered and verified Repair Order is left open.** Every entry and verification step is as before, including
  the steps that came just before the close (out of the item lines so COSTAR keeps the last line, PO# and total checked
  again); then the Repair Order is left open: the close (WM_CLOSE) is not sent.
- **The worker reports "ez, next"**: on the eBay page ("In COSTAR Sydney ✓ ez, next", green), in the receiver's list and
  in the worker's window. The job is released at once and the next order goes into its **own new Repair Order** (Add new
  on Work-in-Progress, as before with a Repair Order open); the one left open is never touched.
- It is **not a warning or NEEDS YOU**: counted as "fully entered and verified (completed without help)", no tray
  balloon, no Discord message, no "close it by hand" note. COSTAR's customer Notes seen on the way are still said after
  "ez, next". Something to check by hand (CHECK BY HAND) and an unknown item (NEEDS YOU) are as before.
- **Diagnostics**: the worker's journey records each order as entered and verified and its Repair Order "left open on
  purpose for Seb to check and close by hand" (with its window), the run records `ebay_left_open`, the receiver records
  it as verified and left open on purpose, and the worker looks every 30 s and records when each is closed by hand
  (`left_open_ro_closed`, with how long it was open). The worker's diagnostics list them (open / closed by hand).
- **The existing installation too**: "Close each Repair Order once it's in" (worker, Settings tab) is now off by
  default, and on the first start of 1.1.1 an earlier installation's tick is turned off **once** (recorded in the
  journey; the worker's window says so). Ticked again later, it is kept: then Repair Orders are closed as in 1.1.0.
- Updated by one click from 1.1.0 (Updates tab); from 1.0.0 once by hand (MIGRATE-FROM-1.0.0.txt). The protocol is
  unchanged (1): a 1.1.0 or 1.0.0 receiver works with a 1.1.1 worker, and the other way round. The extension is unchanged
  (1.5.0): it already shows the worker's words after "In COSTAR Sydney ✓".

### Known limitations (1.1.1)

- **Not tested live**: leaving the Repair Order open after the final checks, and the next order's Add new beside it, were
  not run against COSTAR here (that Add new path is the one 1.1.0 already uses when a Repair Order is open).
- Repair Orders left open add up in COSTAR until Seb closes them. If Add new ever stops being available while others are
  open, orders stop with COSTAR's reason as before (nothing is pressed).
- When Seb has the open Repair Order in front and nobody has used the session for 3 s, the next order brings COSTAR's
  main window forward and opens a new Repair Order over it (as in 1.1.0).
- The "closed by hand" record comes from the window disappearing (looked at every 30 s); if COSTAR closes, the same is
  recorded ("or COSTAR closed").

## 1.1.0 (16 Nov 2026)

Three improvements asked for after Seb's first use of 1.0.0; everything else is unchanged (order entry, the unknown-SKU
hand-over, duplicate protection, the queue, retries, diagnostics, the 404 extension 1.5.0).

### 1. COSTAR Sydney found by itself, with other COSTARs open (`EbayAutoCostar.cs`, `EbayWorker.cs`)

**What 1.0.0 did** (traced in its discovery, readiness and window-selection code): every 3 s `FindTarget` listed the
COSTAR main windows of the session by title, sorted by PID, kept those of Branch 1, and went on only when exactly one was
left: with two COSTAR Sydney open, every order waited ("close all but one"). Other branches were filtered out by their
titles, so they alone never stopped it. Just taking the first of several would not have been safe: the list was made
again every 3 s in PID order (not by when a COSTAR started), a Sydney whose title couldn't be read for a moment dropped
out of it, and any failed check on the chosen one (busy, a window over it, not on Work-in-Progress) cleared the choice,
so the next look could have picked the other Sydney. A Retry of an order typed part-way was checked against whichever
COSTAR was chosen at that time, not its own. COSTAR can also switch branch inside one running program (seen in the day
logs), so a title is not a fixed identity.

**Now:**
- Each COSTAR is known by its process: PID **and** Windows' start time for it (and its session). A restarted COSTAR is
  a new one even if Windows gives it the same PID. Order Check's COSTAR is never used.
- One Sydney open: that one. Several: the **earliest-started** (by the process start time, never PID order, window
  order or which is in front).
- The choice is **kept** while it is valid: another Sydney opening, the windows changing order, or an earlier-started
  COSTAR switching to Sydney change nothing.
- The chosen COSTAR busy, not answering, with a window of its own over it, off Work-in-Progress, or its title
  unreadable for a moment: new orders **wait** with the reason (on the eBay page and in the worker); nothing else is
  chosen meanwhile. A branch change counts only when it shows another branch on two looks at least a second apart.
- Closed, restarted or changed: the earliest-started Sydney still open is chosen, **for new orders only**. None open:
  orders wait for one.
- An order being entered stays in its COSTAR and Repair Order (as before). **The Retry of an order typed part-way goes
  back only into its own COSTAR process and Repair Order**, whichever Sydney is chosen for new orders; if that COSTAR
  closed or restarted, the Retry is refused as in 1.0.0 (check COSTAR, then Mark done by hand or Start again). It is
  never typed into another COSTAR.
- The worker's window shows the COSTAR in use (branch, PID, start time) and how many Sydney are open.
- Journey (diagnostics): `costar_scan` (every change in the COSTARs seen: branch, PID, start time, Order Check's
  marked), `costar_target` (every choice and why: the only one, the earliest-started of N, kept, closed, restarted,
  changed branch), `costar_pinned` (a Retry sent back to its own COSTAR), and the waiting reasons. Never a window title
  (it can name a customer).

### 2. One-click updates from GitHub (`EbayAutoUpdate.cs`, `EbayAutoTray.cs`, `EbayAutoProgram.cs`, `Launch.ps1`, `Build.ps1`)

- The same way as the Tempe helper (Tommy uploads, Seb clicks Update), from **Ebay-auto's own folder** in the same
  repository and GitHub page: `https://tommyvenzin.github.io/tempe/ebay-auto/latest.json`, beside the helper's `helper`
  folder. Its own `latest.json` (product "Ebay-auto", version, protocol, one package per part with SHA-256 and size)
  and packages (`Ebay-auto-Receiver-v<v>.zip`, `Ebay-auto-Worker-v<v>.zip`).
- **Never the Tempe helper**: a release file without `"product": "Ebay-auto"` is refused; only the two Ebay-auto package
  names are accepted; downloads only from that folder (no redirects); the unpacked package must be one folder named for
  this part and version, every file must match its `PACKAGE-SHA256.json`, `VERSION.txt` and `PART.txt` must say this
  version and part, its `Source\Product.cs` must be Ebay-auto's, and a package with the Tempe helper's launchers
  (`Start-RDP.cmd`, `Start-Desk.cmd`, `Setup-Desk.cmd`) is refused.
- **Each part updates itself** (Updates tab: Check for updates, Update now, Cancel update; tray: Update to X): this
  version and the one on GitHub with its notes, the other part's version, progress (download with a bar, checking,
  building, waiting, switching) and any failure in words. It checks a minute after starting and every 6 hours (a
  balloon once per new version).
- **Built before anything changes**: the new version is downloaded, checked and unpacked beside the running one
  (`%LOCALAPPDATA%\EbayAuto\packages`), then built and self-tested on the PC (hidden, below normal priority) while the
  running version keeps working. A version that doesn't build or pass is never switched to.
- **Waits for a safe point**: the worker switches only with no order being entered and the receiver told to hold new
  orders; the receiver only while the worker isn't entering one, holding new orders meanwhile (the extension's orders
  are still taken and kept). Held orders go into COSTAR straight after. Nothing is interrupted.
- **The switch**: the running version saves its state (receiving or paused, eBay orders on or paused, window open or
  hidden), lets go of its ports, poll, tray icon and single-instance lock, and starts the new version in the same part.
  The new one restores that state and, once up, says so; only then does the old one close, and every launcher and
  "Start ... when I sign in" now start the new one (`packages\current-<part>.txt`). If the new version doesn't say it
  is up within 90 s, or stops, it is closed and the old version starts again by itself, opens its window and says why
  (kept for diagnostics). If an installed version can't build on a later start, `Launch.ps1` sets it aside and starts
  the newest earlier version.
- Kept through an update (all in `%LOCALAPPDATA%\EbayAuto`, never touched): pairing, keys, certificate, settings, the
  queue, the duplicate history, the worker's journal and any result not yet acknowledged, diagnostics, Discord, Start
  with Windows. The newest three packages of each part stay on the PC; older builds are tidied ten minutes after a
  start (the two newest and the running one are kept).
- **Mixed versions**: the two parts say their version and a protocol number in every poll and reply (1.0.0 said none:
  it counts as 1, the same as 1.1.0, so 1.0.0 and 1.1.0 work together). A part that meets a protocol it doesn't know
  hands out or takes no orders, and both say which part to update; orders wait on the receiver, nothing is lost.
- **1.0.0 can't update itself** (it has no updater): MIGRATE-FROM-1.0.0.txt moves each part once by hand; after that,
  one click.
- Journey: `update_checked` / `update_available` / `update_started` / `update_installed` / `update_built` /
  `update_waiting` (and why) / `update_switching` / `update_handed_over` / `update_completed` (in the new version) /
  `update_failed` / `update_start_failed` / `update_cancelled`, `protocol_mismatch` / `protocol_ok`.

### 3. Compact windows, hidden properly in the notification area (`EbayAutoTray.cs`, `EbayAutoReceiver.cs`, `EbayAutoWorker.cs`)

- Both parts start hidden in the notification area (as before; the worker opens its window when it has no connection
  yet). **Minimise and X hide the window completely** (no taskbar button), also when minimised another way (Windows+M,
  the taskbar). Hidden, everything keeps running (queue, worker, timers, connection, diagnostics). Double-click the icon
  or Open brings it back (restored, on screen even if the screen got smaller meanwhile). Exit stays the only way to
  close a part, and is safe as before.
- **Compact windows with tabs**, sized from the screen and its scaling (100–200 %), by the clock: receiver about
  600×480 at 100 % (Orders, Pairing, Updates, More), worker about 600×500 (Activity, Connection, Settings, Updates,
  More); a status line at the top of each. Controls wrap and pages scroll on small screens. Every function of 1.0.0 is
  on a tab.
- Message boxes open the window first (never a box behind nothing). One tray icon per part (it is removed before an
  update's switch). The update's build and the Start with Windows launch run hidden; no launcher window stays on the
  taskbar. Windows' own notification-area settings are not changed.
- Journey: `layout_check` (each tab the first time it shows: scaling, window and screen size, and anything that doesn't
  fit).

### Known limitations (1.1.0)

- **Not tested live.** Nothing here ran on Windows, inside Remote Desktop, or with COSTAR (VALIDATION.md says exactly
  what was tested and how). Not tested live: choosing Sydney among real COSTAR processes, the tray and windows on
  Windows at the different scalings, the update's build and switch between two running programs on Windows, GitHub
  Pages serving `ebay-auto/latest.json`, Start with Windows after an update.
- **The first move to 1.1.0 is by hand** (1.0.0 has no updater).
- While the **receiver** switches (about a minute), the 404 extension can't reach it: an order sent then says so; Send
  again (nothing is entered twice). While the **worker** switches, orders wait on the receiver.
- An update waits for the order being entered to finish; held orders wait until the switch (about a minute). Cancel
  update ends the wait.
- **Which Sydney** can't be picked in the window: the earliest-started one is used. To move the worker to another
  Sydney, close the one in use while no order is being entered. "Earliest-started" is when the COSTAR program started,
  not when it was switched to Sydney.
- A Retry of an order typed part-way whose COSTAR was closed or restarted is refused (as in 1.0.0): check COSTAR.
- **Scaling** is read when a part starts: after changing Windows' display scaling (or reconnecting Remote Desktop at
  another scaling), Exit and start the part again for the best fit.
- Windows decides whether a new tray icon shows by the clock or in the arrow's overflow (it can be dragged out).
- Older Ebay-auto folders aren't removed by themselves; the old 1.0.0 folders can be deleted once both parts run 1.1.0.
- The limitations of 1.0.0 below still apply (keep the Remote Desktop session connected, the network, the cut-over,
  Windows policy, unknown items, wheel/package SKUs).

## 1.0.0 (16 Nov 2026)

Built from Tempe COSTAR Helper 2.9.10 (commit f77a254, its eBay implementation) and 404 But It's Found 1.4.3.
Every eBay feature of those two is kept (FEATURES.md lists each one and where it is now); nothing that isn't eBay is
started or shown.

### What changed

**One standalone app, two parts, Tommy's PC not used**
- `EbayAuto.exe` (built on each PC from `Source`, as the Tempe helper is) runs as the **receiver** on Seb's physical PC
  (Start-Receiver.cmd) or as the **worker** inside Seb's Remote Desktop session (Start-Worker.cmd).
- The flow is 404 extension → receiver (Seb's PC) → worker (Seb's RDP session) → COSTAR Sydney (Branch 1).
- The worker reaches the receiver at Seb's PC's real network address (it refuses localhost/127.0.0.1: inside Remote
  Desktop that is the Remote Desktop server). It only ever looks at COSTAR in its own Windows session.

**Kept apart from the Tempe helper**
- Own data folder `%LOCALAPPDATA%\EbayAuto` (settings, queue `ebay.dat`, journal `ebay-journal.dat`, keys, logs,
  diagnostics, build), own ports **8811/8812** (the Tempe desk's 8790/8791 and Order Check's 8795–8804 are refused),
  own single-instance names (`Global\EbayAuto_<part>_<user>`), own Start-with-Windows files (`Ebay-auto - Receiver.cmd`,
  `Ebay-auto - Worker.cmd`), own diagnostics names (`Ebay-auto-*`), own package names (`Ebay-auto-v*`).
- **No updater feed**: Ebay-auto never checks, downloads or installs updates (it can't reach the Tempe release feed).
- The one thing shared on purpose: COSTAR's input lock in a Windows session, so Ebay-auto and a Tempe helper in the
  same session never type into COSTAR at once.

**Receiver (Seb's PC)**
- Setup-Receiver.cmd: builds, picks this PC's LAN address, makes the receiver's own certificate (trusted for this
  Windows user; about 2 years, warned 30 days before), opens 8811–8812 in Windows Firewall for private addresses on
  Private/Domain networks only, sets the receiver up. Re-running it keeps the pairing keys and the list.
- Serves only the eBay routes (no phone jobs, website or Repair Orders). The extension pairs with a PIN as before.
- The eBay list as on the Tempe desk (Retry, Start again in a new RO, Mark done by hand, Remove, Hide finished, the one
  retry by itself), plus a Job column and the new **NEEDS YOU: finish by hand** state.
- Worker connection: Export worker connection (file) as before, and **Copy connection** (text for the Remote Desktop
  clipboard; taken off the clipboard after 2 minutes).

**Worker (inside Remote Desktop)**
- The 2.9.10 eBay engine and COSTAR entry, unchanged for a complete order: phone lookup and identity rules, header,
  Ship to, Rebill to EBAY + Card#, Written By/Salesperson, items at the eBay price, freight, memo lines, the final check,
  close to Work-in-Progress, retry in the same unchanged Repair Order, the journal and duplicate checks, Stop all.
- **Waits instead of stopping** when COSTAR Sydney doesn't answer or a COSTAR window is over it (the reason is shown on
  the eBay page), as before when someone is using the session.
- Paste connection (text), Import connection (file, offers to delete it), or worker-connection.json beside the launcher.

**Unknown item (an eBay SKU COSTAR doesn't know, e.g. a wheel or a package)** (Runner.EbayAuto.cs)
- No SKU conversion or guessing (wheel/package mapping is left for later).
- Recorded first: the SKU, the code typed, the item's position, quantity and price, and COSTAR's window (title, class,
  owner, buttons, stage).
- Only a window that is exactly COSTAR's **Quick Item Add** (that title, owned by this job's Repair Order, one usable
  Cancel and one Add item) is answered, with **Cancel**. **Add item is never pressed.** Anything else is left as it is and
  the order stops as in 2.9.10.
- After Cancel the worker looks at what is there (the Repair Order usable, no other COSTAR window, what the line holds).
  It never deletes or overwrites a line. If all is clear it carries on with the safe remaining steps (the other items,
  freight, memo lines); if anything is unclear, or COSTAR asks about the code again, it stops right there.
- Then it checks what it can (header, Ship to, every line it entered) but never reports the order verified: no
  balancing amounts, no moved prices, the total check stays on for every other order.
- The order is **handed over**: the Repair Order is left **open** (never closed), the job is released, and the receiver,
  the eBay panel ("NEEDS YOU …"), the tray and Discord say what is left to do by hand. It is never retried or continued
  by itself, nor by Retry or Send again; Start again (new RO), Mark done by hand and Remove stay. The duplicate check
  treats it as entered. The next order goes into its own new Repair Order and never touches the handed-over one (the
  worker also notes when that one is closed).

**Tray (both parts)**
- Start hidden in the notification area and work hidden; X hides; double-click or Open brings the window back;
  right-click: Open, Pause/Resume receiving or Pause/Start eBay orders, Export diagnostics, Exit. Exit asks, and the worker
  first stops an entry at a safe point (recorded for Retry/Start again). The icon's colour and words give the state;
  balloons for orders that need Seb, a stop, the worker out of touch for 5 minutes, the certificate running out.
- A second start of a part opens the running one's window.

**Diagnostics (both parts)**
- Export diagnostics on either part. The receiver's ZIP: summary, queue (no buyer details), the journey, the day log,
  and the worker's ZIP (asked over its poll) or a note saying why it isn't there. The worker's ZIP: summary, run
  records, outcome counts, the journey, the day log, and the receiver's ZIP or a note.
- A journey line per event with the time and time zone and the job (J-…), attempt (A-…) and request (R-…) ids:
  received, queued, claimed, started, completed, handed over, stopped, waiting reasons when they change, Retry / Start
  again / Mark done / Remove, unknown items with the SKU, code, position and quantity, the Quick Item Add window and what
  was done with it, what was found after Cancel, the handed-over Repair Order open/closed, connection interruptions and
  restarts, errors, stage timings.
- Counts keep apart: fully entered and verified (completed without help), entered and verified with CHECK BY HAND,
  handed over (manual completion needed, not verified), marked done by hand, waiting, stopped/uncertain. CHECK BY HAND
  is never counted as completed without help (the 16 Nov example: 20 completed, 19 without help).
- No buyer names, phones, addresses, emails, eBay order numbers, keys, tokens or card details.

**404 But It's Found 1.5.0**
- Sends to the Ebay-auto receiver: the address takes a port (default 8811), the certificate link uses port + 1, and
  Tommy's PC's address is no longer in the manifest.
- Its own pairing (stored apart from the 1.4 pairing with Tommy's PC, which is never used and left as it was).
- Each send and retry carries a request id (X-Request-Id) for the diagnostics.
- The panel's **NEEDS YOU** state (button "Needs you", never sent or retried from the page) with what is left.
- **Cut-over check**: an order sold on or before the day of the switch from Tommy's PC that the receiver doesn't know
  may already be in COSTAR: the panel says so and its button reads "Send to COSTAR anyway".

### Known limitations (1.0.0)

- **Not tested live.** Nothing here was run against COSTAR, in Remote Desktop, or on Windows. Not tested live: the
  Quick Item Add recognition and Cancel, what COSTAR shows after it, carrying on after an unknown item, the hand-over
  in COSTAR, the next order beside a handed-over Repair Order, the worker in an RDP session, the tray, Setup-Receiver
  (certificate, firewall), Chrome on Windows reaching the receiver (the Allow tab). VALIDATION.md says exactly what was
  tested and how.
- **What COSTAR does after Quick Item Add is cancelled is unknown.** The window's title and buttons come from a
  recorded run (5 Nov). If COSTAR keeps the unknown code in the line, or asks again when the line is left, the worker
  stops at that point and hands over with what is left (it never deletes the line); the first live unknown-item order
  may therefore stop earlier than "everything else entered". Please send its diagnostics.
- **Wheel and package SKUs are not mapped**: such orders are always handed over for Seb.
- **Keep the Remote Desktop session connected**, with its window open (behind other windows is fine). As in 2.9.10,
  a disconnected, locked or minimised session was not tested; Windows may stop the session's screen when the window is
  minimised, and then the worker can't type (if it must be minimised, IT can set
  `RemoteDesktop_SuppressWhenMinimized = 2` for Remote Desktop on Seb's PC, then test with one order).
- **The network**: the Remote Desktop server must reach Seb's PC at its LAN address on TCP 8811–8812. The firewall rule
  only allows private addresses on Private/Domain networks; a VPN or NAT path may need IT. Keep Seb's PC's address
  fixed (DHCP reservation); after a change run Setup-Receiver again, pair the extension again and give the worker a new
  connection. Seb's PC must be on, with the receiver running, for orders to be taken.
- **Cut-over**: Ebay-auto can't see what Tommy's PC entered. The extension asks before sending an order sold on or
  before the pairing day (that also asks once for older orders never sent). Turn **eBay orders off in the Tempe helper**
  once Ebay-auto works, and don't keep 1.4.3 paired with Tommy's PC on another browser, so only one system enters eBay
  orders.
- **Windows policy**: the launchers run PowerShell with `-ExecutionPolicy Bypass` and build an unsigned EbayAuto.exe in
  `%LOCALAPPDATA%`; AppLocker/WDAC on the Remote Desktop server could block that (then IT must allow it).
- The worker connection is a key: Windows clipboard history (if turned on) may keep a copy of Copy connection.
- Balloons depend on Windows notification settings (Focus assist can hide them); the icon colour and the windows always
  show the state.
- The receiver's list shows buyer names, on Seb's PC only (as the Tempe desk did).
