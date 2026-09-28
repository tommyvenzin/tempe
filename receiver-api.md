# Mobile receiver interface — pending implementation

This is the interface consumed by `costar-client.js`, **not a supplied server**.
The online-order importer keeps its existing schema and validation unchanged.

## Connection

A future helper QR code opens the Job Card with a fragment:
`#pc=<encoded private HTTPS origin>&key=<random pairing token>`.
The client stores this on that website origin and removes the fragment from
history. Tokens never go in API query strings. Requests use
`Authorization: Bearer <token>`, no cookies, no redirects, and an 8-second timeout.
The current client accepts private IPv4 addresses, loopback, and `.local` hosts
on HTTPS only. An iPhone must use the desk PC's LAN address, not localhost.

The server must bind only the selected private interface, validate authentication
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

The later RDP worker must reuse the existing native-control engine, preserving
COSTAR's prices for mobile jobs only. It will enter wheels, tyres, mandatory M FB,
optional WA/WAFR, existing DET vehicle/rego/odometer fields, then an additional
M note only when supplied. Existing online-order price checks remain intact.

A real Add New selector and verified main/order PID transition are still
required. Do not implement these from guessed coordinates. Recover a partial
job by reconciling the saved checkpoint against the live customer's fields and
rows; never blindly replay products. A mismatch must stop for manual review.
