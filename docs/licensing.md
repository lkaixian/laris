# Licensing

A signed key per organisation. Off unless a public key is configured; then it is enforced. A deterrent for honest customers, not DRM.

## Flow

```
issuer machine                         customer's LARIS server                      customer owner
--------------                         -----------------------                      --------------
keygen -> private.pem (kept)
       -> public key  ----------------> LICENSE_PUBLIC_KEY (only this is on the server)
                                                                                  <- POST /api/license/request {plan, seats}
requests (lists them)  <---------------- license_requests row + email to LICENSE_ISSUER_EMAIL
issue --email --plan --seats --days
  token LARIS1.<payload>.<signature> ---- emailed (--send) or sent by hand ------> POST /api/license {key}
                                         verify signature, email == owner's verified email,
                                         not expired by trusted time, licence id unused elsewhere,
                                         seats >= active users -> stored on the tenant, audited
                                         every request: status (cached 60 s) = missing | active | expiring |
                                         expired | invalid | clock_unverified; writes 402 unless active/expiring
```

Token: `LARIS1.<b64url(payload json)>.<b64url(ed25519 signature over the payload bytes)>`; payload `{v:1, lid, email, org, plan, seats, issued_at, expires_at}`. Verification is strict (exact field set, types, ranges, signature). One licence id belongs to one tenant (unique index).

## Trusted time

`src/clock.py` asks NTP (`pool.ntp.org`, then `time.google.com`, 2 s each, in a background thread; a request waits at most 2 s; an answer is reused 6 h, a failure is retried after 5 min). The table `license_clock` holds one row: the highest trusted time ever seen (the watermark). A trigger stops the watermark moving back and the row being deleted by the app. Trusted now = NTP time, else the system clock, and never below the watermark. If the system clock is more than 5 minutes behind the watermark with no NTP, `rollback` is set and the status is `clock_unverified` until real time passes the watermark or NTP returns. No NTP for more than `LICENSE_OFFLINE_GRACE_DAYS` (default 7) also gives `clock_unverified`.

Clock write rules: the request only READS the watermark (no row lock, so a slow request in one tenant cannot block the licence check of another). The watermark and `last_ntp_ok` are written in a short separate transaction, only when the trusted time has moved on by 60 s or more, or a rollback is seen for the first time; a failed write is logged and retried on a later call. An NTP answer more than 2 days from the system clock is ignored with one warning (treated as NTP unavailable), so a forged reply cannot ratchet every licence into expiry; the cost is that a system clock that is genuinely more than 2 days wrong can no longer be corrected by NTP. Activating a valid key works while `clock_unverified` is only due to blocked NTP (UDP/123) as long as the system clock is not behind the watermark: the key's expiry is judged against max(system clock, watermark), so this cannot extend a key. The status stays `clock_unverified` (read-only) until NTP answers. With the system clock behind the watermark, activation is still refused with 409 `clock_unverified`.

## Threat model

1. Forging a key needs the private key, which only the issuer holds. The app has no signing code path.
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
