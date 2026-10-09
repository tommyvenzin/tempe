# Mobile receiver interface — Phone-first speed update 1.4

This interface is implemented by `Source/LocalHttp.cs` and consumed by the existing `Website/costar-client.js`. Pinad mode changes desk-side approval and queue progression; phone and worker API contracts are unchanged.
The online-order importer keeps its existing schema and validation unchanged.

## Connection

The desk helper QR code opens the Job Card with a fragment:
`#pc=<encoded private HTTPS origin>&key=<random pairing token>`.
The client stores this on that website origin and removes the fragment from
history. Tokens never go in API query strings. Requests use
`Authorization: Bearer <token>`, no cookies, no redirects, and an 8-second timeout.
The current client accepts private IPv4 addresses, loopback, and `.local` hosts
on HTTPS only. An iPhone must use the desk PC's LAN address, not localhost.

The server is designed to bind only the selected private interface, validate authentication
on every API route, restrict CORS to the actual permitted website origins,
validate request Host/Origin, limit request sizes, use a trusted TLS certificate,
and never log pairing tokens. Server-side schema validation is authoritative.
No public port forwarding or user-facing login is part of V1. Pairing should
have a revocable phone token, not a shared token embedded in site source.

All routes below are under `/api/mobile/v1`.

| Route | Response / action |
| --- | --- |
| `GET /health` | `{service:"tempe-mobile-jobcard",apiVersion:1,receiving:true,workerConnected:true,pendingCount:0}`. Submit requires both booleans true. |
| `POST /jobs` | Persist the complete fixed payload once, keyed by `submissionId`, then return its status. An identical replay returns the same job. A different payload under the same ID must return 409 without modifying the order. |
| `GET /jobs/{id}` | Return the status of that exact job; 404 only if not known. |
| `POST /jobs/{id}/retry` | Body `{submissionId}`. Resume the same saved job after a failure; never create another order or accept a replacement payload. Return current status if it is already queued, injecting or ready. |
| `GET /tyres?url=...` | Authenticated GET-only fetch returning `{ok:true,status:200,text:"..."}`. Permit only HTTPS `tempetyres.com.au` / `www.tempetyres.com.au` product search/detail paths, reject redirects off those hosts, credentials and non-443 ports. Do not implement an open proxy. |

Status shape:

```json
{
  "submissionId": "MJC-<UUID>",
  "status": "queued",
  "version": 1,
  "message": "Waiting for COSTAR",
  "progress": ""
}
```

Allowed statuses: `queued`, `awaiting_approval`, `injecting`, `failed`,
`ready_for_review`. Versions strictly increase per submission. A received job
continues independently of the phone. The client ignores older versions and
rejects a status for another ID. Reconnection polls only; it never creates work.
The receiver must atomically claim jobs, persist checkpoints and deduplicate
retry requests. The UI alone is not a duplicate-injection safeguard.

## Submission

```json
{
  "schema": "tempe.mobile-jobcard.v1",
  "submissionId": "MJC-<UUID>",
  "draftId": "<UUID>",
  "createdUtc": "2026-09-29T00:00:00.000Z",
  "customer": {"name": "TEST CUSTOMER", "mobile": "0400000000"},
  "vehicle": {"registration": "ABC123", "makeModel": "TEST VEHICLE", "odometer": 0},
  "products": [{"type": "tyre", "sku": "TEST123", "quantity": 4, "description": "TEST TYRE"}],
  "fittingCode": "M FB",
  "alignment": null,
  "additionalNotes": ""
}
```

Products: 1–3 unique SKU lines, explicit `wheel`/`tyre` type, quantity 1–100.
No prices or totals are submitted. Optional alignment is null, WA or WAFR.
Customer name/mobile, registration, make/model and odometer are mandatory.
Odometer 0 is valid. Additional notes are at most 400 characters.

The RDP worker reuses the existing native-control engine, preserving
COSTAR's prices for mobile jobs only. It enters wheels, tyres, mandatory M FB,
optional WA/WAFR, existing DET vehicle/rego/odometer fields, then an additional
M note only when supplied. Existing online-order price checks remain intact.

The 29 September inspector captures identify the main Add new button and the
Branch 11 RepairOrder window. Both captured windows share a PID and have different
window handles; the worker must support that case as well as a new process.
Opening uses live native controls rather than fixed guessed coordinates. Recover a partial
job by reconciling the saved checkpoint against the live customer's fields and
rows; never blindly replay products. A mismatch must stop for manual review.


## Supplied receiver and worker

- Receiver: chosen private IPv4 interface, HTTPS 8790. Public certificate download only on HTTP 8791. No HTTP.sys URL ACL or automatic firewall rule.
- Worker: authenticated POST `/api/worker/v1/poll` every three seconds, separate worker bearer key, paired worker ID and per-job lease. The worker pins the exported TLS leaf certificate SHA-256 and checks validity dates. It does not globally disable certificate validation.
- Phone status readiness requires a worker heartbeat within 15 seconds and receiving enabled. An occupied COSTAR window blocks opening a new job without making an already queued job disappear.
- Queue and worker journal use atomic file replacement and Windows current-user DPAPI. A failed queue persistence operation rolls back the in-memory change. Claims are replayed with the same lease until acknowledged, including after a lost reply.
- Reports use monotonically increasing worker sequence numbers. Duplicate/old reports do not regress the receipt. A close acknowledgement increments the completed receipt version and retains `ready_for_review`, with a reminder to review in COSTAR. The receipt remains readable by the phone after the window closes.
- Each native operation saves its intent before input and its verified state afterwards. Retry compares name/account/phone/reference and ordered row codes/descriptions/quantities against the checkpoint. Prices are deliberately excluded from mobile verification and entry.
- The Add New selector uses the observed visible/enabled BUTTON caption under the Branch 11 main window, validates the current hit-test target and tracks the new RepairOrder HWND. It does not rely on the old PID or recorded pixel coordinates.
- Phone key rotation is available in the desk UI. The worker connection is replaced by exporting/importing a new connection file after certificate/network setup changes.

Idle state is measured on the physical desk session, not the RDP host; Windows' [GetLastInputInfo documentation](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getlastinputinfo) specifies that the API only reports input for its calling session. With Pinad mode off, approval is fixed at receipt: waiting until the PC becomes idle does not approve an active arrival.

The desk checkbox stores `QueueState.pinadMode` atomically with the queue. Older saved queues without the field default to false; existing true values remain enabled. Enabling approves all open `awaiting_approval` receipts and increments their versions; new arrivals are approved regardless of idle state. Disabling affects future arrivals and automatic progression, preserving existing approvals. A failed save rolls back both the mode and receipt changes. The setting is desk-only; phone requests cannot enable it.

When Pinad mode is enabled, a poll from the accepting worker that owns the current `ready_for_review` job requests `close` if the next pending FIFO job is approved and queued. `available` is normally false at this point because the completed window is still open; it is required again before assigning the next job. The receiver saves `nextRequested` before returning `close`, replays that command after a lost reply, and waits for the existing authenticated `closed` acknowledgement before releasing the current job. Failed, partial and unapproved jobs are not skipped. Both new and replayed close commands respect Stop receiving / worker accepting state. A close already delivered can finish even after Pinad mode or receiving is disabled.

With no pending job, the completed window stays open. A late submission triggers the same close handshake on the next poll. Pinad mode off retains the manual Next Order workflow. The worker still validates the original window and pauses on a close prompt. Version 1.4 additionally validates the name/account retained during phone lookup against the saved checkpoint. The desk protocol is unchanged; install the updated RDP worker to use the entry improvements. The desk list retains the latest 20 closed receipts for later review; all receipts remain in the saved queue.

List cleanup sets the persistent `Receipt.hiddenFromList` flag for `ready_for_review` receipts only. Delete selected handles one receipt; Clear completed handles all completed receipts, including the current ready receipt and history outside the 20-row display limit. Existing receipts without the flag remain visible. The UI filters removed receipts before taking the latest 20 closed entries. Cleanup retains submission hashes, phone status/version, worker leases and currentId so replay protection and the next-order close handshake keep working. It makes no COSTAR call. Failed persistence rolls back the visibility change.


## Phone-first entry and checkpoint compatibility (1.4)

The first mutation is the customer phone. Phone lookup may select an account and name different from the submitted name; that resolved identity becomes part of the verified checkpoint. Later steps cannot change it. If no customer is found, the submitted name is used. The mobile payload has no address fields. Online entry separately replaces supplied address fields while retaining the matched account/name.

`MobileCheckpoint.planVersion = 2` identifies the phone/name/reference step order. A checkpoint with no started operation may adopt this plan; an older partial checkpoint is rejected before input. Completed older checkpoints remain usable for normal close, which compares their verified identity/reference. No queue or API migration is required.

All inserted strings pass through uppercase conversion. Customer and grid writes still validate the target process/window/control, commit through COSTAR's controls and read back results. DET alone needs the PO focus change; subsequent memo commits use Tab. Progress-only status writes are throttled to at most once per 500 ms, while before/after operation checkpoints and final status remain durable. Reports include elapsed/stage/snapshot timings.
