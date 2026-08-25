# Research: Meta Lead Ads webhook + retrieval

- **Researched by:** crm-integrations-dev
- **Date:** 2026-08-23
- **Confidence:** High for payload shapes and permissions (official docs). Medium for App Review timeline (not documented as a number).

## Question
Exactly what does Meta send us when a Lead Ads form is submitted, how do we prove it came from Meta, and what do we need approved before any of it works for a customer?

## Findings

1. **The webhook does not contain the lead.** It carries a `leadgen_id`; the field data requires a second authenticated Graph API call. ([Meta: Webhooks for Leadgen](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/), read 2026-08-23)

2. **Webhook payload — exact shape:**
   ```json
   {
     "object": "page",
     "entry": [{
       "id": 153125381133,
       "time": 1438292065,
       "changes": [{
         "field": "leadgen",
         "value": {
           "leadgen_id": 123123123123,
           "page_id": 123123123,
           "form_id": 12312312312,
           "adgroup_id": 12312312312,
           "ad_id": 12312312312,
           "created_time": 1440120384
         }
       }]
     }]
   }
   ```
   Note `entry[].id` is the **page id**, and ids arrive as JSON **numbers**, not strings. Parse them as strings on our side — they exceed `Number.MAX_SAFE_INTEGER` territory and JS will silently mangle large ones. ([source](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/), read 2026-08-23)

3. **Retrieval response — exact shape:**
   ```json
   {
     "created_time": "2015-02-28T08:49:14+0000",
     "id": "<LEAD_ID>",
     "ad_id": "<AD_ID>",
     "form_id": "<FORM_ID>",
     "field_data": [
       { "name": "full_name", "values": ["Joe Example"] },
       { "name": "email", "values": ["joe@example.com"] }
     ]
   }
   ```
   `field_data` is a flat list of `{ name, values[] }`. **Field names are chosen by whoever built the form**, so `full_name` / `first_name` / `email` / `phone_number` are conventions, not guarantees — the normalizer must map defensively and the per-connection field-mapping UI is not optional. ([Meta: Retrieving Leads](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving), read 2026-08-23)

4. **Signature:** Meta signs every payload with an HMAC-SHA256 of the **raw body** using the App Secret, in the `X-Hub-Signature-256` header, prefixed `sha256=`. Verifying it is the only way to know the request is genuine. ([Meta Community Forums](https://communityforums.atmeta.com/discussions/dev-general/how-to-verify-a-webhook-request-sign/1171086), read 2026-08-23)
   → We must hash the **raw request body**, not a re-serialized object. `JSON.parse` then `JSON.stringify` changes whitespace and key order and the signature will never match.

5. **Verification handshake:** on subscription Meta GETs the endpoint with `hub.mode`, `hub.verify_token`, and `hub.challenge`; we must echo `hub.challenge` verbatim with a 200. (Widely documented; the leadgen page defers to the general Getting Started guide — treat the exact param casing as confirmed by the general Webhooks docs.)

6. **Subscription:** the page must be subscribed with the `leadgen` field — `POST /{page_id}/subscribed_apps?subscribed_fields=leadgen`. Without it Meta sends nothing. ([source](https://www.adamigo.ai/blog/meta-webhooks-how-they-work-for-ad-accounts), read 2026-08-23)

7. **Permissions, all requiring App Review:** `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_management`. ([Meta: Webhooks for Leadgen](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/), read 2026-08-23)

8. **Meta retains lead data for only 90 days.** Automated retrieval is not a convenience — anything older is unrecoverable. ([LeadSync guide](https://leadsync.me/blog/meta-lead-gen-api-guide/), read 2026-08-23)

9. **API version:** v25.0 is current as of February 2026; v20.0 stops working 24 September 2026. Pin the version in the URL and treat it as a maintenance item. `UNVERIFIED` — from a secondary source, confirm against Meta's changelog before launch.

## What this means for us

- The receiver must do three things and nothing else: verify the signature against the **raw body**, persist an `IngestionEvent`, and return 200 fast. Fetching field data is a background job — Meta retries on non-200 and a slow endpoint gets us throttled.
- `leadgen_id` is our idempotency key, which is exactly what `IngestionEvent.externalId` already is.
- `entry[].id` (page id) is how we resolve which `Connection`, and therefore which tenant, a payload belongs to. **This is the tenant-resolution path for unauthenticated traffic** — it must be exact-match against a stored `Connection.externalAccountId`, never inferred.
- Field-name variability means the normalizer needs a mapping layer per connection. Shipping with hardcoded `full_name`/`email` will work in our tests and fail on a real customer's form.
- **90-day retention makes a failed sync a permanent data loss**, not a delay. Dead-letter handling and visible connection health are launch requirements.

## Still unknown
- App Review turnaround for these five permissions. Not published; needs a real submission to measure. **This is question Q14 and the critical-path risk.**
- Whether Business Verification is required in addition to App Review for `ads_management` at our use case.
- Rate limits specific to lead retrieval.
