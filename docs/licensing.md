# Licensing

A signed key per organisation. Off unless a public key is configured; then it is enforced. A deterrent for honest customers, not DRM.

## Flow

Normal use is the web issuer page (below); the CLI (`scripts/issue_license.py`) stays for automation. The private key never reaches the server either way.

```
operator's browser (web page)          customer's LARIS server                      customer owner
-----------------------------          -----------------------                      --------------
private key (kept in the browser,
  signs with WebCrypto)
public key -> POST /license/admin/public-key -> license_config row (or env LICENSE_PUBLIC_KEY; env wins)
                                                                                  <- POST /api/license/request {plan, seats}
GET /license/admin/requests <------------ license_requests row + email to LICENSE_ISSUER_EMAIL
sign payload in the browser
POST /license/admin/issue {request_id, token} -> verified, stored on the request, emailed to the requester
  (CLI instead: keygen / requests / issue --email --plan --seats --days [--send]; token sent by hand)
                                                                                  GET /api/license -> offer; POST /api/license/accept-offer
                                                                                  (or paste the key: POST /api/license {key})
                                         verify signature, email == owner's verified email,
                                         not expired by trusted time, licence id unused elsewhere,
                                         seats >= active users -> stored on the tenant, audited
                                         every request: status (cached 60 s) = missing | active | expiring |
                                         expired | invalid | clock_unverified; writes 402 unless active/expiring
```

Token: `LARIS1.<b64url(payload json)>.<b64url(ed25519 signature over the payload bytes)>`; payload `{v:1, lid, email, org, plan, seats, issued_at, expires_at}`. Verification is strict (exact field set, types, ranges, signature). One licence id belongs to one tenant (unique index).

## Issuing from the web page

Platform admin = a signed-in owner whose verified email equals env `LICENSE_ISSUER_EMAIL` (case-insensitive). Everyone else gets 404 from `/api/license/admin/*`. The server only ever holds the PUBLIC key: from env / `src/license_public.key` (source `environment`, cannot be changed from the page) or the one row of `license_config` (source `dashboard`, set by `POST /api/license/admin/public-key`; replacing a key that would stop verifying stored licences needs `confirm:true`). Changing the key also resets the 60 s status cache. A key set from the page is read again within 60 s by other server processes.

`POST /api/license/admin/issue {request_id, token}` verifies the token exactly as activation does, then requires: payload email == the request's email, seats <= requested, plan not above the requested plan (order starter < standard < pro; any other plan name is refused), else 422 `token_mismatch`. It stores the token on the request, emails it to the requester and answers `{ok, emailed}`. The customer's `GET /api/license` then carries `offer:{plan, seats, expires_at}` and `POST /api/license/accept-offer` activates it through the same code as `POST /api/license`.

Payload field formats (the signer must match byte for byte; the server checks the same rules as `src/license.py` `_valid`):

| field | type | rule |
|---|---|---|
| `v` | integer | exactly `1` |
| `lid` | string | a lowercase UUID version 4, canonical form `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`, new for every licence |
| `email` | string | lowercase, contains `@`, at most 254 characters; must equal the request's email |
| `org` | string | at most 200 characters (may be empty) |
| `plan` | string | `[a-z0-9_-]{1,30}`, normally `starter`, `standard` or `pro` |
| `seats` | integer | 1..10000, JSON number without decimals |
| `issued_at` | integer | Unix seconds (UTC), 0..4102444800 |
| `expires_at` | integer | Unix seconds, greater than `issued_at`, at most 4102444800 (`issued_at + days*86400` in the CLI) |

Exactly these 8 fields; any extra or missing field is refused. Integers must be JSON integers (not strings, not `1.0`, not booleans).

Browser signing recipe:

1. Build the payload object with exactly the 8 fields above.
2. Serialise it as JSON with the keys sorted alphabetically (`email, expires_at, issued_at, lid, org, plan, seats, v`), no spaces anywhere (separators `,` and `:`), integers without decimals, UTF-8. Non-ASCII text in `org` may be written either way (`\uXXXX` or raw UTF-8): the server signs nothing and verifies the exact bytes you send, so only use what you sign.
3. Encode that string to UTF-8 bytes. These bytes are what you sign: `signature = Ed25519.sign(privateKey, bytes)` (WebCrypto algorithm `Ed25519`; 64 bytes).
4. `token = "LARIS1." + b64url(bytes) + "." + b64url(signature)`, where b64url is URL-safe base64 (`+` becomes `-`, `/` becomes `_`) with the `=` padding removed.
5. Send `{request_id, token}` to `POST /api/license/admin/issue`.

Example payload bytes (also asserted in `tests/test_license_admin.py`, which signs it with a key made by `scripts/issue_license.py keygen`):

```
{"email":"owner@shop.test","expires_at":1831536000,"issued_at":1800000000,"lid":"0b0f6f06-8d0b-4a39-9d0e-5d4e2a8a7c11","org":"Shop","plan":"pro","seats":25,"v":1}
```

The public key shown on the page is the base64 (standard alphabet, with padding) of the raw 32-byte Ed25519 public key (WebCrypto `exportKey("raw")`).

## Trusted time

`src/clock.py` asks NTP (`pool.ntp.org`, then `time.google.com`, 2 s each, in a background thread; a request waits at most 2 s; an answer is reused 6 h, a failure is retried after 5 min). The table `license_clock` holds one row: the highest trusted time ever seen (the watermark). A trigger stops the watermark moving back and the row being deleted by the app. Trusted now = NTP time, else the system clock, and never below the watermark. If the system clock is more than 5 minutes behind the watermark with no NTP, `rollback` is set and the status is `clock_unverified` until real time passes the watermark or NTP returns. No NTP for more than `LICENSE_OFFLINE_GRACE_DAYS` (default 7) also gives `clock_unverified`.

Clock write rules: the request only READS the watermark (no row lock, so a slow request in one tenant cannot block the licence check of another). The watermark and `last_ntp_ok` are written in a short separate transaction, only when the trusted time has moved on by 60 s or more, or a rollback is seen for the first time; a failed write is logged and retried on a later call. An NTP answer more than 2 days from the system clock is ignored with one warning (treated as NTP unavailable), so a forged reply cannot ratchet every licence into expiry; the cost is that a system clock that is genuinely more than 2 days wrong can no longer be corrected by NTP. Activating a valid key works while `clock_unverified` is only due to blocked NTP (UDP/123) as long as the system clock is not behind the watermark: the key's expiry is judged against max(system clock, watermark), so this cannot extend a key. The status stays `clock_unverified` (read-only) until NTP answers. With the system clock behind the watermark, activation is still refused with 409 `clock_unverified`.

## Threat model

1. Forging a key needs the private key, which only the issuer holds. The app has no signing code path, EXCEPT the optional pay-online webhook (`src/api/license_pay.py`): it signs only when env `LICENSE_PRIVATE_KEY` is set, which you do on the vendor deployment only. Anyone who can read that Secret or edit that code can mint keys, so never set it on a customer's install.
2. Editing the stored key or its columns: the token is re-verified on every status read; a changed token is `invalid`.
3. Sharing one key between organisations: refused (unique licence id), and the key is bound to the activating owner's verified email.
4. Using more seats than paid: new users and reactivations stop at the seat limit; activation needs seats >= active users.
5. Setting the clock back to dodge expiry: see below.
6. Blocking NTP: after the grace period writes pause (`clock_unverified`); data capture does not.
7. Not covered: anyone who can edit the code or use the database owner role (remove the check, rewrite `license_clock`), run a copy with no key set, or hand a leaked key to a second licensed email.
8. Customers are never locked out of their data: reads, inbound webhooks and sign-in keep working; only writes and outbound sends pause.
9. A public key set on an existing deployment stops writes (402) until each owner activates a key: issue keys first.
10. If the system clock was ever far in the future with no NTP, the watermark followed it (it only moves forward); the issuer has to repair that row by hand as the schema owner.

## What clock rollback protection does and does not stop

Does: stop a licence outliving its expiry by setting the system clock back (time cannot go below the watermark, and writes pause while the clock is behind it); stop "unplug the network forever" past the grace period; ignore an NTP answer older than the watermark.

Does not: stop someone who restores an old database backup (the watermark goes back with it), resets the row as the schema owner, starts on a fresh empty database, or feeds a forged NTP answer that is later than real time (that only shortens their own licence). NTP over UDP is unauthenticated; the echoed originate timestamp only blocks off-path forgers.
