# Lead ingestion — what is actually built

Last verified 2026-08-23.

## Shipped

**Two-phase pipeline.** Meta's webhook carries only a `leadgen_id`, so ingestion splits:

| Phase | Function | Runs |
|---|---|---|
| 1. Record | `recordIngestionEvent()` | On the request path. Idempotent on `(org, provider, externalId)`. |
| 2. Materialize | `materializeLead()` | Off the request path. Dedupes, assigns an owner, creates the Lead. |

`ingestLead()` still does both in one call for sources whose payload already carries the lead — email, CSV, web forms.

**Webhook receiver** — `src/app/api/webhooks/facebook/route.ts`
- `GET` answers Meta's subscription handshake, echoing `hub.challenge`.
- `POST` verifies `X-Hub-Signature-256` against the **raw body**, resolves the tenant from `entry[].id` (the page id) against a stored `Connection`, records each payload, returns 200 fast.
- Unknown page → logged and skipped with a 200. There is no tenant to attribute it to, and retrying will not create one.

**Graph API client** — pinned to `v25.0`, 10s timeout, typed errors.

**Normalizer** — maps `field_data` onto our lead shape with alias lists, splits a single `full_name`, and appends unmapped custom questions to `message` instead of dropping them.

**Failure handling** — every failure marks the `IngestionEvent` FAILED with the reason and increments the connection's failure count. The raw payload is retained for replay.

## A bug live testing caught

Classifying auth failures on HTTP status was wrong. Meta returns a dead token as **HTTP 400 with `error.code: 190`**, not a 401 — so the first implementation marked the connection `ERROR` (transient) instead of `NEEDS_REAUTH`, and the customer would never have been told to reconnect. `GraphApiError` now carries Meta's own error code and classifies on that, falling back to HTTP status only when no code is present. Rate limits (codes 4/17/32) also arrive as 400 and are correctly retryable.

This is exactly the failure mode ADR-adjacent research warned about: a silently dropped lead is unrecoverable after Meta's 90-day retention window.

## Verified

- **65 unit/integration tests pass**, 23 of them for this feature: signature verification (forged, truncated, wrong algorithm, wrong secret, missing), Meta's documented payload parsed verbatim, large ids kept as strings, normalizer aliases and full-name splitting, two-phase idempotency, retry-safety, and error classification.
- **Live over HTTP:** handshake returns the challenge; wrong verify token → 403; unsigned and forged POSTs → 401; a correctly signed payload → 200 with the event recorded against the right tenant.
- **Live against real Meta infrastructure:** the background fetch reached `graph.facebook.com`, which rejected the placeholder token with a genuine `OAuthException` code 190. The event was marked FAILED with the reason preserved and the connection moved to `NEEDS_REAUTH`.

## Added 2026-08-23 (second pass)

**Retry with backoff.** Failures now schedule `nextAttemptAt` on a growing curve (~1m, 4m, 9m, 16m, 25m, 36m, capped at 60m) and give up after 6 attempts. A dead token is never retried — retrying cannot fix it and it burns the 90-day window — while a 5xx or a rate limit (Meta codes 4/17/32, which arrive as HTTP 400) is.

**Retry sweeper** — `sweepPendingIngestion()`, invoked by Vercel Cron every 5 minutes via an authenticated route. Catches events the `after()` callback dropped when its invocation died, and failed events whose backoff has elapsed. Cross-tenant by design, with an index leading on `status` rather than `organizationId` to match.

**Per-connection field mapping.** `Connection.fieldMapping` stores `{ "email": ["work_email"] }` style overrides, tried before the built-in aliases. A customer whose form uses field names we have never seen is now a settings change, not a deploy. Admin-only, audited, and validated — invalid JSON and unknown target fields are rejected rather than silently stored.

**Connection health page** — `/settings/connections`. Per-connection status, last successful sync, consecutive failure count, expandable last error, and event counts split into imported / duplicate / pending / failed / **given up**. Anything in "given up" raises a banner naming the 90-day deletion deadline. Admins get a manual "retry failed imports" button that re-queues even the events automatic retry abandoned.

## Notifications (added 2026-08-23)

In-app notifications, so a broken connection is noticed without anyone thinking to visit a page.

| Event | Who is told | Dedupe |
|---|---|---|
| Lead assigned | The assigned owner | none — every lead matters |
| Connection needs reconnecting | Owners + Admins | one standing alert per connection |
| Import abandoned after retries | Owners + Admins | one standing alert per provider |

Design points that were decisions, not defaults:

- **The lead-assigned notification is written inside the same transaction as the lead.** Speed to first contact is the metric this whole feature exists to move; an alert that can go missing while the lead lands is worse than no alert. A test asserts the counts stay equal.
- **Reps are not told about integration failures.** A rep cannot reconnect an OAuth token, so it is pure noise. Owners and Admins only.
- **A retryable 5xx does not notify.** The sweeper will handle it. Alerting on every transient blip trains people to ignore the bell — only a genuine reauth or a final give-up escalates.
- **Repeats are suppressed while unread, and re-arm once acknowledged.** Without this a broken connection would notify every admin every five minutes, forever.

## Not built

- **Meta OAuth connect flow.** `Connection` rows are created by hand today. Needs App Review first (Q14).
- **Email and Slack delivery.** In-app only. `notify()` is the single choke point, so adding a channel is one function — but it needs a provider account (Resend, Slack app), which is why it stopped here.
- **Real-time push.** The badge updates on navigation, not live. Needs polling or SSE.
- **SLA timers** and automatic escalation — the `LEAD_UNWORKED` notification type exists and nothing emits it yet.
- **Field-mapping UI is raw JSON.** Functional and validated, but it should be a picker populated from the field names actually seen on that connection's recent payloads.
- Messenger (M3c) and comments (M3d) normalizers.
