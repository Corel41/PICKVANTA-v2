# Step 17C-A — Ingestion architecture and connector contract

**Status:** proposal for approval. **Step:** 17C-A (architecture and contracts only).
**Supersedes:** nothing. **Contains:** no executable connector, no migration, no schema change,
no frontend change, no dependency. **Apply order if approved:** this document, then 17C-B.

This document freezes the boundary between "outside merchant data" and "PickVanta records".
Everything in it is a design decision that later code must satisfy, not a description of
something that exists. Nothing here has been built.

Where this document names a table, a column, a status or a function, the name is the one in
`db/migrations/0001–0010`; where it proposes something new, it says so explicitly.

---

## 1. The frozen architectural rules

Six rules. Each has a mechanism, because a rule without one is a preference.

| # | Rule | Enforced by | Verified by |
| - | ---- | ----------- | ----------- |
| R1 | **The browser never fetches merchant data.** No page, script or build step in PickVanta contacts a merchant, feed or API. The deployed site stays a static, request-serving site. | The connector is server-side only (§7). `js/**` contains no connector code; `tools/vercel-config.js` reads only `SUPABASE_URL` + `SUPABASE_ANON_KEY` at build time. | Grep of `js/**` and the built output for merchant hosts: none. A browser test with the network log open shows only Supabase calls. |
| R2 | **No merchant credential is ever in frontend code or in a database row.** | `deal_sources_config_no_secrets` (0005) refuses credential-shaped config keys; `deal_source_validate()` (0006) refuses credential-shaped keys *and* values; the browser holds only the public anon key. | The constraint and the validator are already tested (Step 14/16 rigs). The runner's secret lives in its own environment (`.env`, git-ignored, or CI secrets). |
| R3 | **The connector never writes to tables directly.** It holds no table code path: no SQL, no PostgREST table writes, no Supabase client table calls. | The runner calls exactly two function endpoints (`import_ingest`, job lifecycle) and nothing else; its credential is used for those calls. | Code review of `connectors/**` for `rest/v1/` or `from(`/`insert(` patterns: must be absent. The 17C-C review checklist includes this grep. |
| R4 | **The connector only calls a controlled ingest boundary.** One validating entry point, `public.import_ingest(jsonb)`. | `import_ingest` is `security definer` with a pinned `search_path`, is `revoke`d from `public, anon, authenticated`, and is granted only to the runner's role (§6.4, §8.2). | Grants query after 0011: no browser role holds EXECUTE. A call as `anon` or `authenticated` fails with `42501`. |
| R5 | **`imported_deals` is the stopping point before human review.** Ingest writes the `imported` stage only. Validation, normalization, deduplication and promotion to `pending-review` are separate, later steps; publication is not part of 17C at all. | `import_ingest` cannot set `pipeline_status` above `imported` and rejects the key if a record tries; promotion is a later migration (0012). | Negative test: a payload carrying `pipeline_status: "pending-review"` is rejected by name, and the row's status is unchanged. |
| R6 | **Nothing creates products, variants, offers, public deals or affiliate links automatically.** The only path into the canonical layer remains `rpc/imported_deal_convert` (0010), a named administrator's decision, and it refuses any record not at `pending-review` + `review_status = 'pending'`. | No INSERT privilege or policy for any client role; no engine function in 17C writes canonical tables; `import_ingest` rejects canonical and review keys. | 0010's entry gate is already tested (Step 17A rig). 0011 adds no canonical write. An `insert into public.products` attempt from the runner's ingest path does not exist, because there is no such code path. |

Two consequences worth stating plainly, because they are the point of the boundary:

* **The runner's credential is powerful by construction.** In Supabase the `service_role` key
  bypasses RLS. The functions in 0010/0011 do not take that power away; they take away the
  *connector's need* to have table-shaped code, centralise validation in the database, and keep
  the audit trail. The real boundary is that the key exists only in the runner's environment —
  never in `js/**`, never in a row, never in a build output.
* **Hiding a control is not authorization.** The admin panel already decides what to *draw*
  from `profiles.role = 'admin'`; the database decides what may be *read or written* through
  RLS and `is_admin()`. Nothing in this design moves that line.

---

## 2. Architecture overview

```
  MERCHANT SOURCE                 RUNNER (server-side, holds the secret)          DATABASE
  ┌───────────────┐               ┌──────────────────────────────────────┐        ┌───────────────────────────┐
  │ feed file     │               │ 1. read deal_sources (status active) │        │ import_job_start()        │
  │ merchant API  │◄──HTTP(S)─────│ 2. job  = job lifecycle call ────────┼───────►│ import_ingest(batch)      │
  │ permitted URL │   structured  │ 3. fetch + map → batch payload       │        │ import_job_finish()       │
  └───────────────┘   data only   │ 4. call one ingest function ─────────┼───────►└───────────┬───────────────┘
                                  │ 5. report outcome, honestly          │                    │
                                  └──────────────────────────────────────┘                    ▼
                                                                              ┌──────────────────────────────┐
                                                                              │ imported_deals  (imported)   │
                                                                              │ external_merchants           │
                                                                              │ imported_deal_media          │
                                                                              │ deal_engine_events (imported)│
                                                                              │ deal_engine_jobs  (succeeded)│
                                                                              └───────────┬──────────────────┘
                                                                                          │  LATER (0012)
                                                            validation → normalization → deduplication
                                                                                          │
                                                                                          ▼
                                                                              pending-review  ◄── STOP LINE
                                                                                          │
                                                                administrator decision (UI + rpc/imported_deal_convert, 0010)
                                                                                          ▼
                                                                    products / product_variants / merchant_offers
                                                                                          │  LATER, not 17C
                                                                                          ▼
                                                                         published_deal_id → public.deals
```

Read the diagram as two boundaries crossing:

* **left → right** is trust: untrusted outside data enters through one validating function;
* **top → bottom** is authority: a record moves toward the public catalogue only through a
  human decision, and nothing in 17C writes below the stop line.

---

## 3. Connector contract

### 3.1 What a connector receives

| Input | Source | Notes |
| ----- | ------ | ----- |
| Source configuration | one `public.deal_sources` row, read through the runner's own connection | `source_type` ∈ `marketplace-feed`, `affiliate-network-feed`, `merchant-api`, `merchant-product-feed`, `permitted-url-source`; `endpoint_url`; non-secret `config`; `market_country`; `status` must be `active` or the run is refused |
| Credential | the **runner's environment**, keyed by source | never the database, never the payload, never a log line. Only `merchant-api` and some `affiliate-network-feed` sources need one; a public feed needs none |
| Job identity | the runner, by calling `import_job_start` first | the batch cannot be ingested without a running job row (§5) |
| Run parameters | the runner (page limit, `since`, batch ceiling) | bounded by the source's `config` and the ceilings in §4.4 |
| The source's response body | the merchant | the connector's own problem to fetch, parse and map; PickVanta's database never sees the raw HTTP exchange |

### 3.2 What a connector returns

Exactly one payload shape, mapped field-for-field onto columns that already exist. No renaming
in transit, no invented keys, no nesting beyond what is shown here.

```jsonc
{
  "batch_version": 1,                       // integer, required; a future change to this shape bumps it
  "source_id": "…uuid…",                    // required; must match the configured source
  "job_id": "…uuid…",                       // required; a job in status 'running' for this source
  "connector": { "name": "woo-store-api", "version": "0.1.0", "method": "json-api" },
  "fetched_at": "2026-09-26T10:00:00Z",     // required, ISO 8601 with offset
  "records": [
    {
      "external_product_id": "SKU-123",     // required by 0011; the source's own id, verbatim
      "source_url": "https://merchant.example/p/sku-123",   // required; the provenance address
      "title": "…",                         // required, 1..500 characters after trimming
      "description": "…",                   // optional, plain text, ≤ 8000 characters
      "price": { "amount": "129.50", "currency": "USD" },   // optional as a pair; never a symbol,
                                                            // never converted, never defaulted
      "availability_text": "in stock",      // optional free text, ≤ 200 characters
      "category_text": "Audio > Headphones",// optional free text, ≤ 300 characters
      "merchant": {
        "name": "…",                        // required, ≤ 200 characters
        "merchant_ref": "…",                // optional; the source's own merchant id
        "website_url": "https://…",         // optional
        "country": "KE"                     // optional ISO 3166-1 alpha-2
      },
      "media": [                            // optional, ≤ 30 entries, references only
        { "url": "https://…", "media_type": "image", "sort_order": 0,
          "attribution": "…", "fallback_url": "" }
      ],
      "raw": { "…": "the source's own record, unchanged" }   // required, JSON object, ≤ 20 KB
    }
  ]
}
```

**Rules of the shape**

1. `raw` is the source's own object (or row) verbatim — the keys the source used, the values the
   source sent. The connector may not "clean" it, rename its keys, drop HTML from it, or merge
   its own fields into it. It is the evidence a reviewer decides against
   (`imported_deals.imported_metadata` is documented as "unchanged").
2. `title`, `description`, `source_url`, `merchant.*` and the price pair are the *mapped* form:
   the connector's own reading of the source record. Both are kept, because they answer
   different questions ("what did the source say" vs "what did we read it as").
3. Every URL is `http(s)` and is validated again by `import_ingest` and by the table's CHECK
   constraints. A URL that is not a URL is a rejected record, never a stored string.
4. Price is a decimal **string** plus an ISO-4217 code. A symbol, a thousands separator, a
   comma decimal, a negative amount, a missing currency, or more than two decimal places is a
   rejected record — not a rounded one.
5. Availability and category arrive as the source's own words. They are never translated to
   `normalized_availability` or `normalized_category_id` by the connector; that is the
   normalization stage's decision, made later and recorded separately.
6. A record with no `external_product_id` is refused by 0011 (§8.4, decision D3). A source that
   cannot supply a stable per-product identifier is not yet a supported source; inventing an
   identity is how a pipeline starts duplicating records.
7. A record that fails validation is rejected **with the field and the reason named**, in the
   batch result. It does not abort the batch and it does not create a partial row.
8. Unknown keys are refused, not ignored. This is what makes R3/R6 enforceable rather than
   aspirational: the boundary says no to a key it did not define.

### 3.3 What a connector is forbidden from writing

| Forbidden | Why |
| --------- | --- |
| `pipeline_status`, `validation_status`, `validation_result`, `normalization_status`, `normalization_result`, `deduplication_status`, `deduplication_result`, `dedup_match_class`, `dedup_matched_deal_id` | the pipeline position is the engine's record of what actually happened, not a claim by a caller |
| `review_status`, `review_note`, `reviewed_at`, `reviewed_by`, `published_deal_id` | administrator decisions; a connector that could set these could publish |
| `normalized_name`, `normalized_brand`, `normalized_category_id`, `normalized_availability`, `model_number`, `gtin` | normalization output — 0005 groups all six under one comment; they are populated by a later processor, and writing them at ingest time would show a record as partly normalized while `normalization_status` still says `not-run` |
| `affiliate_url` | never generated, never supplied by a source, never equal to `source_url` (0005 constraint) |
| `external_merchant_id` | assigned by the ingest function from the merchant the record names, so a caller cannot attach a record to someone else's merchant |
| `id`, `created_at`, `updated_at`, `imported_at`, `error` | database-generated state |
| `job_id`, `source_id` inside a record | they belong to the batch envelope, so one call cannot mix records across sources or runs |
| any write to `products`, `product_variants`, `merchant_offers`, `merchant_offer_media`, `imported_deal_conversions`, `public.deals`, `public.listings`, `public.sellers` | the canonical and public layers are unreachable from ingest by design (R6) |
| any UPDATE or DELETE of `deal_engine_events` | append-only trigger (0005) |
| any write to `deal_sources` | configured by an operator through `rpc/deal_source_save` (0006); read-only to the connector |

Enforcement is layered: `import_ingest` refuses an unrecognised key with a named error; the
function has no code path that writes any table outside the five listed in §4.1; and no client
role holds a write privilege on any of these tables (0005 §8, 0008 §9).

### 3.4 Failure reporting

A connector reports through two channels and invents neither:

* **The job row.** `import_job_finish` records `status` (`succeeded` / `failed` / `cancelled`),
  `progress`, `stats` and — required on failure — `error` (`deal_engine_jobs_failure_explained`
  refuses a silent failure).
* **The batch result.** `import_ingest` returns per-record outcomes so the runner can put an
  honest count in the job's `stats` instead of guessing.

A connector never writes "success" it did not measure, and never hides a partial run: a run
that imported 40 of 50 records is `succeeded` with `rejected: 10` and the reasons, not a clean
`succeeded` with no numbers.

---

## 4. Ingest payload schema

### 4.1 Field → column map

| Payload | Destination | Validation at the boundary |
| ------- | ----------- | -------------------------- |
| `batch_version` | not stored | must equal `1` |
| `source_id` | `imported_deals.source_id`, and the lookup of the source row | uuid shape; row must exist and be `status = 'active'` |
| `job_id` | `imported_deals.job_id` | uuid shape; job must exist, be `running`, belong to this `source_id`, and have a record-producing `job_type` (`feed-import`, `source-scan`, `extraction`, `url-discovery`) |
| `connector.*` | `deal_engine_events.data` on the `imported` event, and the job's `stats` | strings, ≤ 120 characters each; `method` ∈ `json-api`, `csv`, `xml`, `merchant-api` |
| `fetched_at` | `deal_engine_events.data.fetched_at` | ISO 8601; recorded, never used as a timestamp in the row |
| `external_product_id` | `imported_deals.external_product_id` | required, non-blank, ≤ 200 characters, no control characters |
| `source_url` | `imported_deals.source_url` | required; `^https?://[^[:space:]]+$`, ≤ 1000 characters |
| `title` | `imported_deals.imported_title` | required non-blank after trimming, ≤ 500 characters |
| `description` | `imported_deals.imported_description` | ≤ 8000 characters, plain text (tags stripped by the connector, not stored) |
| `price.amount` | `imported_deals.imported_price` | decimal string, `>= 0`, ≤ 2 decimal places, fits `numeric(14,2)`; `null` when the source has no price |
| `price.currency` | `imported_deals.imported_currency` | `^[A-Z]{3}$`; required when `amount` is present; `''` when both are absent; never defaulted, never converted |
| `availability_text` | `imported_deals.imported_availability` | ≤ 200 characters; free text |
| `category_text` | `imported_deals.imported_category` | ≤ 300 characters; free text, kept as a path if the source sent one |
| `merchant.name` | `imported_deals.merchant_name` and `external_merchants.name` (upsert) | required non-blank, ≤ 200 characters |
| `merchant.merchant_ref` | `imported_deals.merchant_ref` and `external_merchants.merchant_ref` | ≤ 200 characters; the upsert key when non-blank |
| `merchant.website_url` | `external_merchants.website_url` | `http(s)` or `''` |
| `merchant.country` | `external_merchants.country` | `^[A-Z]{2}$` or `''` |
| `media[].url` | `imported_deal_media.source_media_url` | `http(s)`; references only — nothing is downloaded, proxied or resized |
| `media[].media_type` | `imported_deal_media.media_type` | ∈ `image`, `video`, `document`; default `image` |
| `media[].sort_order` | `imported_deal_media.sort_order` | integer ≥ 0, unique within the record (index `imported_deal_media_order_key`) |
| `media[].attribution` | `imported_deal_media.attribution` | ≤ 200 characters |
| `media[].fallback_url` | `imported_deal_media.fallback_url` | `http(s)` or `''` |
| `raw` | `imported_deals.imported_metadata` | JSON **object** (an array or scalar is rejected), ≤ 20 KB of canonical JSON, stored verbatim |

The columns 0005 marks as normalization output (`normalized_*`, `model_number`, `gtin`) have no
payload field. A source's brand, model number or GTIN travels inside `raw` and is lifted by the
normalization processor later — which is also why `imported_deals_gtin_idx` exists before
anything writes it.

### 4.2 Envelope rules

* Max 500 records per call. A larger run is split into batches by the connector, all under one
  job row, so the job remains the unit of work and the calls stay bounded.
* The call is one transaction. An envelope error writes nothing at all.
* A record error writes nothing for that record; the rest of the batch proceeds.
* `import_ingest` returns (never raises) for record-level problems:

```jsonc
{
  "source_id": "…", "job_id": "…",
  "received": 50, "imported": 41, "updated": 6, "unchanged": 2,
  "skipped": 1, "rejected": 0,
  "results": [
    { "index": 0, "external_product_id": "SKU-123", "outcome": "imported",
      "imported_deal_id": "…uuid…", "event_id": "…uuid…", "errors": [] },
    { "index": 1, "external_product_id": "SKU-124", "outcome": "rejected",
      "imported_deal_id": null, "event_id": null,
      "errors": [ { "field": "price.currency", "reason": "must be three upper-case letters" } ] }
  ]
}
```

* Envelope errors raise with a SQLSTATE the runner can distinguish: `22023` (a value the
  boundary does not accept), `22001` (over a length limit), `P0002` (no such source or job),
  `42501` (not allowed to call this function).

### 4.3 `imported_metadata` and extraction metadata

`imported_metadata` holds **only** what the source sent. Everything PickVanta measured about the
fetch — HTTP status, content type, etag, `fetched_at`, connector name and version — is
PickVanta's own record of the run, so it goes into the `imported` event's `data` jsonb and the
job's `stats`. This keeps the "unchanged evidence" promise literally true while still recording
how the evidence was obtained.

### 4.4 Proposed limits (decision D7)

| Limit | Value | Reason |
| ----- | ----- | ------ |
| records per batch | 500 | bounded transaction; a large feed becomes several batches under one job |
| `raw` size | 20 KB | enough for a realistic product object; refuses an accidental whole-page dump |
| media per record | 30 | references only; a gallery longer than this is not a product page |
| `external_product_id` | 200 chars | matches the longest identifier seen in feed formats |
| title / description | 500 / 8000 chars | matches the schema's `imported_*` text columns' intended use |

---

## 5. Job lifecycle

`deal_engine_jobs` (0005) is the unit of work. Its vocabulary is already fixed:
`job_type ∈ {source-scan, feed-import, url-discovery, extraction, normalization, deduplication,
price-check, availability-check, deal-expiry, link-health}` and
`status ∈ {queued, running, succeeded, failed, cancelled}`.

```
                     import_job_start()
   (no row) ─────────────────────────────► running ────── import_job_finish('succeeded') ─► succeeded
                                              │
                                              ├───────── import_job_finish('failed',  error) ─► failed
                                              │
                                              └───────── import_job_finish('cancelled') ──────► cancelled

   queued  — reserved for a future scheduler. 0011 never creates a queued row: a run that is
             starting now is running now, and a "queued" row that nothing will pick up would be
             a lie the admin Jobs screen would faithfully display.
```

| Transition | Function | Rules |
| ---------- | -------- | ----- |
| none → `running` | `import_job_start(p_job_type, p_source_id, p_detail)` | source exists and is `status = 'active'`; `job_type` in the vocabulary; refuses if a job for this source is already `running` (message names the running job; see the note below); sets `started_at = now()`, `progress = 0` |
| `running` → `succeeded` / `failed` / `cancelled` | `import_job_finish(p_job_id, p_status, p_stats, p_error, p_progress)` | job must be `running` (a second finish is refused with `22023`); `failed` requires non-blank `error`; `stats` must be a JSON object ≤ 8 KB; sets `finished_at = now()`; `progress` defaults to 100 for `succeeded`, `0` otherwise |
| `running` → `running` | `import_job_progress(p_job_id, p_progress, p_detail)` *(optional, only if a run proves long enough to need it)* | `0..100`; updates `detail` |

Notes:

* **One running job per source** is enforced in `import_job_start`, not by a partial unique
  index. A unique index would be airtight but would also let a crashed run block every future
  run of that source until someone with database access finished it by hand — the wrong failure
  mode for an unattended runner. The function refuses with a message naming the stuck job, which
  is recoverable through `import_job_finish('failed', …)`.
* **`stats` is the run's honest summary**, written by the runner from the batch result:
  `{ received, imported, updated, unchanged, skipped, rejected, rejected_examples: [ {index,
  external_product_id, errors} ] (first 20), pages_fetched, http_statuses, duration_ms,
  connector: {name, version} }`.
* **A record-level failure is not a job failure.** A run that rejects 10 of 50 records is
  `succeeded` with the reasons recorded; a run that could not reach the source is `failed` with
  the transport error recorded.
* **Retention** is out of 0011. `imported_deals.job_id` is `on delete set null` precisely so a
  job row can be pruned later without touching provenance.

---

## 6. Security boundaries

### 6.1 Trust classification

| UNTRUSTED — every string from outside | TRUSTED — generated or decided inside |
| ------------------------------------- | ------------------------------------- |
| `title`, `description`, `availability_text`, `category_text`, source `brand`/`model`/`gtin` text | every `id` (`gen_random_uuid()`), `source_id` (a configured row), `job_id` (an engine row) |
| `price.amount`, `price.currency`, any numeric claim | all timestamps (`now()`), `imported_at`, `created_at`, `updated_at` |
| `merchant.name`, `merchant.merchant_ref`, `merchant.website_url`, `merchant.country` | every status column and every state transition |
| `external_product_id`, `source_url`, every media URL, `fallback_url`, `attribution` | deduplication decisions (deterministic only; uncertainty goes to a person) |
| `raw` (`imported_metadata`) in its entirety, including any HTML, script or `javascript:` URL inside it | `reviewed_by` / `reviewed_at` / review decisions; canonical records; `public.deals`; `affiliate_url` |
| the connector's own `name`/`version`/`method` strings | counts, `stats`, `progress`, event rows |

An untrusted value is not dangerous by existing; it is dangerous by being *used as* an
identifier, a path, a URL, an inventory claim or a price. The design therefore keeps untrusted
values in columns that are displayed, and never lets them become a key, a decision or a public
record without a person.

### 6.2 Where validation happens, in order of authority

1. **The connector**, as a pre-flight for its own error messages. Never authority: its checks
   can be skipped, bypassed or wrong, and the payload is the only thing the database sees.
2. **`import_ingest`**, the authority for the ingest boundary: shape, required fields, lengths,
   numeric and currency rules, URL shapes, media ordering, forbidden keys, source/job gates.
   It raises with a named field and reason.
3. **Table constraints**, the last line: `imported_deals_identifiable`,
   `imported_deals_price_not_negative`, `imported_deals_source_url_shape`,
   `imported_deals_gtin_shape`, `imported_deals_source_and_affiliate_differ`,
   `imported_deal_media_url_shape`, `deal_engine_jobs_failure_explained`, the currency and
   country patterns, `imported_deals_review_note_length`, `deal_engine_events_data_object`.
   A constraint name in an error message is a bug in the function above it, not a message to a
   human.
4. **Rendering**, which escapes: the admin panel already escapes text and refuses
   non-`http(s)` URLs before drawing them (`esc` / `safeUrlCell` in `js/admin.js`). Untrusted
   strings reach a screen escaped, never as markup.

### 6.3 Threats this design must hold against

| Threat | Mitigation |
| ------ | ---------- |
| SSRF — a URL-driven connector pointed at `169.254.169.254`, `localhost` or an internal host | scheme allowlist (`https` only for remote sources), host allowlist per source, deny private/link-local/loopback literal IPs and redirects that leave the allowlist; response size cap |
| Credential leakage through a row, a payload or a log | nothing credential-shaped is storable (§6.4); the runner redacts its environment in every log line |
| Injection through merchant strings | parameterised SQL only; no dynamic SQL built from payload values; HTML stripped by the connector and escaped at render |
| Data loss by re-import overwrite | re-import semantics are state-aware and never overwrite a human decision (§8.5) |
| Denial of service by a large or hostile feed | record/batch/size limits, per-run page ceiling, timeouts, backoff, and a refused run rather than an unbounded one |
| Silent failure | `deal_engine_jobs_failure_explained`; the batch result counts; no fabricated success |
| Scope creep into automatic publishing | R6 plus 0010's gate; the boundary has no canonical code path |

### 6.4 Secrets

| Secret | Where it lives | Where it must never appear |
| ------ | -------------- | -------------------------- |
| Supabase `service_role` key (the runner) | runner environment: a git-ignored `.env` for local runs, or CI secrets for a scheduled run | `js/**`, HTML, `vercel.json`, `tools/**` output, a `deal_sources` row, the ingest payload, any log line, the repository |
| Supabase anon key (the browser) | `.gitignore`d `js/config.local.js`, generated by `tools/vercel-config.js` from two public env vars | — |
| Merchant API credentials | the same runner environment as above | the database (R2), and the payload |

`deal_sources.config` remains what 0005 made it: non-secret configuration, with a constraint
that refuses a credential-shaped key at any depth, and a validator (0006) that refuses
credential-shaped values too.

---

## 7. Data flow, stage by stage

| # | Stage | Performed by | Input | Written | State after | In 17C? |
| - | ----- | ------------ | ----- | ------- | ----------- | ------- |
| 0 | Source configured | operator + `rpc/deal_source_save` (0006) | the operator's form | `deal_sources` | `status = 'active'` | existing |
| 1 | Job started | runner → `import_job_start` | job type + source | `deal_engine_jobs` | `running`, `started_at` | **0011** |
| 2 | Fetch and map | connector (server-side) | source endpoint + credential | nothing (in memory) | — | 17C-B |
| 3 | Ingest | runner → `import_ingest` | the batch payload | `external_merchants` (upsert), `imported_deals` (insert/refresh), `imported_deal_media` (replace), `deal_engine_events` (`stage = 'imported'`) | `pipeline_status = 'imported'`, `review_status = 'not-required'`, `validation_status = 'not-run'` | **0011** |
| 4 | Job finished | runner → `import_job_finish` | counts + errors | `deal_engine_jobs` | `succeeded` / `failed` / `cancelled`, `stats`, `error` | **0011** |
| 5 | Validation | processor (later) | the imported record | `validation_status`, `validation_result`, event `stage = 'validation'` | `pipeline_status = 'validated'` when it passes | 0012 |
| 6 | Normalization | processor (later) | the imported record + taxonomy | `normalized_name`, `normalized_brand`, `normalized_category_id`, `normalized_availability`, `model_number`, `gtin`, `normalization_status`, event `stage = 'normalization'` | `pipeline_status = 'normalized'` | 0012 |
| 7 | Deduplication | processor (later) | the normalized record + what is already recorded | `deduplication_status`, `dedup_match_class`, `dedup_matched_deal_id`, event `stage = 'deduplication'` | `pipeline_status = 'deduplicated'`; deterministic matches recorded, uncertainty left visible | 0012 |
| 8 | Promotion | processor (later) | a record that passed 5–7 | `pipeline_status = 'pending-review'`, `review_status = 'pending'`, event `stage = 'review'` | **the stop line** | 0012 |
| 9 | Human review | administrator, in the panel | the record, its media, its events | `review_note`, then `rpc/imported_deal_convert` (0010) | `approved` + one canonical product/variant/offer + conversion row + one `review` event | existing (17A) |
| 10 | Publication | not built | — | `published_deal_id`, `public.deals` | `published` | **not 17C** |
| — | Affiliate link | not built | — | `affiliate_url` | — | **not 17C** |

Stages 5–8 exist as columns, statuses and vocabulary today and as nothing else. 17C builds
stages 1–4 only: a record arrives, is validated enough to be stored faithfully, and **stops at
`imported`** until a later step advances it.

---

## 8. Migration 0011 — design only

Not created. This is the shape it would take, for review.

### 8.1 Scope

**In:** `import_ingest`, the job lifecycle functions, and the indexes/columns listed below.
**Out:** validation/normalization/deduplication processors, promotion, publication, affiliate
links, and any change to `0001`–`0010` (including `0005`'s tables' existing constraints, which
are not touched).

### 8.2 Functions

```sql
-- One entry point for outside data. Security definer, pinned search path.
create or replace function public.import_ingest(p_batch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
-- gates: is the caller allowed (grant), source active, job running + matching + record-producing
-- writes: external_merchants (upsert), imported_deals (insert/refresh), imported_deal_media (replace),
--         deal_engine_events (append one 'imported' event per touched record)
-- never: pipeline_status above 'imported', review_* , normalized_* , canonical tables, affiliate_url

create or replace function public.import_job_start(
  p_job_type text, p_source_id uuid, p_detail text default ''
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
-- gates: source exists and is active; job_type in 0005's vocabulary; no running job for this source
-- writes: one deal_engine_jobs row at 'running' with started_at = now()
-- returns: { job_id, job_type, source_id, status, started_at }

create or replace function public.import_job_finish(
  p_job_id uuid, p_status text, p_stats jsonb default '{}'::jsonb,
  p_error text default '', p_progress smallint default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
-- gates: job exists and is 'running'; p_status in ('succeeded','failed','cancelled');
--        'failed' requires non-blank error; stats is an object within the size ceiling
-- writes: that job row only (status, progress, stats, error, finished_at)
-- returns: { job_id, status, started_at, finished_at, progress }
```

Optional, only if a run proves long enough to need visible progress:
`public.import_job_progress(p_job_id uuid, p_progress smallint, p_detail text default '')`.

**Grants (the whole point of the boundary):**

```sql
revoke all on function public.import_ingest(jsonb) from public, anon, authenticated;
revoke all on function public.import_job_start(text, uuid, text) from public, anon, authenticated;
revoke all on function public.import_job_finish(uuid, text, jsonb, text, smallint) from public, anon, authenticated;
grant execute on function public.import_ingest(jsonb) to service_role;
grant execute on function public.import_job_start(text, uuid, text) to service_role;
grant execute on function public.import_job_finish(uuid, text, jsonb, text, smallint) to service_role;
```

`service_role` exists on Supabase but not in a bare local PostgreSQL rig, so the grant is
wrapped in a role-existence guard (`if exists (select 1 from pg_roles where rolname =
'service_role')`) — the same portability the project's test rigs need, and the reason the
migration must still be applicable to a local 16.2 instance. The `revoke`s are unconditional.

**Internal validation helper.** The record rules in §4.1 belong in one place, in the same style
as `deal_source_validate` (0006): an internal function whose EXECUTE is revoked from clients, so
it cannot be used as an oracle from a browser or from a partially-trusted caller.

### 8.3 Indexes and columns

Safe on an empty table (no backfill, no rewrite), and additive to the schema:

| Object | Definition | Why |
| ------ | ---------- | --- |
| `deal_engine_jobs_created_at_idx` | `(created_at desc)` | the Jobs screen and a job history read newest-first and have no index today |
| `deal_engine_jobs_source_created_idx` | `(source_id, created_at desc) where source_id is not null` | "the runs of this source", which is how a failing source is diagnosed |
| `external_merchants_source_ref_key` | unique `(source_id, merchant_ref) where merchant_ref <> ''` | makes the merchant upsert idempotent instead of creating a twin merchant on every run |
| `imported_deals_merchant_idx` | `(external_merchant_id) where external_merchant_id is not null` | "the records from this merchant" has no index path today |
| `imported_deals.last_seen_at timestamptz` *(decision D4)* | default `now()`, set on every touch | answers "when did we last see this record", which `imported_at`/`updated_at` cannot after the first refresh |
| `imported_deals.raw_hash text not null default ''` *(decision D4)* | `md5(imported_metadata::text)`, with a shape check `= '' or ~ '^[0-9a-f]{32}$'` | cheap change detection: an unchanged re-import writes nothing but `last_seen_at` |

No existing constraint is weakened, dropped or edited. `imported_deals_source_external_key`
(the partial unique index on `(source_id, external_product_id) where external_product_id <> ''`)
remains the identity guard exactly as 0005 defined it; 0011 only relies on it.

### 8.4 Idempotency strategy

**Identity.** `(source_id, external_product_id)`, enforced by 0005's partial unique index. Two
consequences, both intended: the same product from the same source is one record no matter how
many times it is imported; the same product from two different sources stays two records, each
with its own provenance. Records without an `external_product_id` are refused (D3), because any
fallback identity — a URL, a title, a hash — is a guess, and a pipeline that guesses identities
duplicates records and corrupts its own deduplication stage.

**Per-record algorithm** (one transaction per `import_ingest` call):

1. Validate the record (§4.1). On failure: no row, no event, one `rejected` result entry.
2. `select … from imported_deals where source_id = … and external_product_id = … for update`.
3. **Existing, locked** (`pipeline_status ∈ approved, published, rejected, archived`): write
   nothing to the row; append one `imported` event with outcome `skipped-locked` (the trail
   records that the source re-sent it while a human decision stood); count `skipped`.
4. **Existing, refreshable** (`imported`, `validated`, `normalized`, `deduplicated`, `failed`):
   compare `md5(raw::text)` with `raw_hash`.
   * equal → `last_seen_at` moves; count `unchanged`; no event (nothing happened).
   * different → replace the provenance columns and `imported_metadata`, replace the media set,
     **reset** the record to `pipeline_status = 'imported'`,
     `validation_status`/`normalization_status`/`deduplication_status = 'not-run'`, their result
     texts and `normalized_*` to `''`, `dedup_match_class = 'unknown'`, `dedup_matched_deal_id =
     null`, `error = ''`; append one `imported` event with outcome `refreshed`; count `updated`.
     Rationale: the new evidence invalidates the earlier processing, and leaving a record at
     `deduplicated` with stale normalized columns would be a lie the review screen would display.
5. **Existing at `pending-review`** (a reviewer has not decided yet): refresh the provenance
   columns, metadata and media **in place**; keep `pipeline_status` and `review_status = 'pending'`;
   keep any `review_note`; append an `imported` event with outcome `refreshed`; count `updated`.
   Rationale: the record is in front of a person, and the person should see the current source
   data; the event trail makes the change visible rather than silent.
6. **Not found**: `insert … on conflict (source_id, external_product_id) where
   external_product_id <> '' do nothing returning id`, then insert media and append the
   `imported` event with outcome `imported`; count `imported`. If the conflict path fires
   (another runner won the race), re-select `for update` and continue from step 3.

**Merchant upsert.** Keyed on `(source_id, merchant_ref)` when `merchant_ref` is non-blank —
"this source's merchant X". With a blank `merchant_ref` the function matches on
`(source_id, name)` within that source rather than creating a new merchant per run; the
`external_merchants_source_ref_key` index makes the non-blank case a single atomic statement.

**Batch idempotency.** Sending the same batch twice is just a re-run: every record lands in
`unchanged`, no new rows, no new events, one job row each time. No batch table exists and none
is needed — the job rows plus the events are the record of what ran.

**`job_id` on refresh** (decision D5): the row's `job_id` is updated to the current run, so
"the records this run wrote" stays answerable from the row itself through
`imported_deals_job_idx`; the event's `data` carries both the previous and the current job id so
the history is not lost.

### 8.5 Self-check

Following 0005/0006/0010: the migration ends with a `do $$ … $$` block that fails the migration
rather than leaving a quiet hole — the three functions exist with `prosecdef`, `proconfig`
pinning `search_path`, no EXECUTE for `anon`/`authenticated`, the new indexes exist, and
`import_ingest` contains no reference to any canonical table or to a forbidden column.

---

## 9. Runner options

### 9.1 What the runner actually needs

* to hold one secret, out of the browser and out of the repository;
* to make ordinary HTTPS requests with timeouts, redirect control and a real User-Agent;
* to run the same code repeatedly, with the same result;
* to keep a run bounded (pages, records, seconds);
* to be observable: a log a human can read when a source changes shape.

It does **not** need a public URL, does not need low latency, does not need to be near the
database, and does not need to run inside the deployed site.

### 9.2 Comparison

| | Local Node runner | GitHub Actions | Vercel function | Supabase Edge Function |
| - | ----------------- | -------------- | --------------- | ---------------------- |
| Fits today's repository | **Yes** — Node 22 already present (`node -v` = v22.22.3, `fetch` built in), no `package.json` needed, no deployment change | Yes — the repo already runs Actions (`auto-sync-main.yml`), the job is just another workflow using the same code | No — the project deliberately has no runtime, no `api/`, no dependencies; a function changes the deployment shape and adds a publicly reachable endpoint | No — there is no `supabase/` directory and the standing rule is no Supabase CLI |
| Secrets | git-ignored `.env` on the operator's machine | Actions secrets, scoped to the repo | Vercel project env vars | Supabase project secrets |
| Scheduling | manual, or a local `cron` | native `schedule:` | Vercel Cron (a plan-dependent extra) | pg_cron / external trigger |
| Execution limits | none | generous | function duration limit is a hard ceiling on a crawl | edge runtime limits; Deno environment |
| Reproducibility of a run | high (fixtures + the same command) | highest (logged, versioned, re-runnable) | medium | medium |
| Blast radius if misused | one machine | repo secrets scope | a live endpoint + a new deploy surface | a new deploy surface next to the data |
| New dependencies | none | none (reuses the same code) | `package.json` + runtime + `api/` | `supabase/` + CLI |

### 9.3 Recommendation

**Build the runner as a local Node script first (17C-B/17C-C), and make the exact same code the
body of a GitHub Actions workflow in 17C-E.** One codebase, two entry points, no new deployment
surface, no dependency, and the secret stays where it already has to live — the runner's
environment. A Vercel function and a Supabase Edge Function are rejected for now: both would
add a permanently reachable surface and a second place for privileged configuration, in exchange
for scheduling that Actions already provides without changing how the site is deployed.

---

## 10. First connector test source

### 10.1 Requirements (all mandatory)

| # | Requirement | Why |
| - | ----------- | --- |
| 1 | **Structured data** — JSON, CSV or XML with a documented, stable shape | the PoC must prove the boundary, not a parser; HTML scraping starts as a mapping problem and ends as a maintenance problem |
| 2 | **Permission allowed** — a public documented endpoint, an operator's own store, or written permission | `deal_sources.source_type` already says "permitted" for a reason; the check and its evidence are recorded in the source row's `notes` |
| 3 | **No anti-bot dependency** — an ordinary `User-Agent` gets the data; no CAPTCHA, JS challenge, or IP reputation gate | the runner must never become a bot-arms race |
| 4 | **No browser automation** — the data is in the HTTP response, not rendered by JavaScript | a headless browser is a whole new dependency and an explicit non-goal |
| 5 | **Reproducible fixture** — one saved response, committed to the test rig, sanitised of personal data | the tests must be deterministic and offline; a source that changes shape should break a fixture test, not a production run |

### 10.2 Candidates, in order

1. **A merchant's own structured product feed or API** (`merchant-product-feed` / `merchant-api`)
   — the cleanest legally and technically: the operator can supply the endpoint and permission
   in one sentence, and the data is published for exactly this purpose. A WooCommerce store's
   Store API (`/wp-json/wc/store/v1/products`) is a documented public read for a store the
   operator controls.
2. **A permitted storefront JSON endpoint** (`permitted-url-source`) — Shopify's
   `/products.json?limit=250&page=N` returns title, price, variants (with SKU and availability)
   and images without authentication. It is widely used for feeds and SEO, but it is not a
   documented public contract and some stores disable or rate-limit it, so it ranks below option
   1 and requires the operator's permission for the specific store.
3. **A partner/affiliate product feed** (`affiliate-network-feed`) — well structured, but it
   pulls affiliate terms into scope earlier than 17C wants them. Later.

**Do not start with:** a large marketplace (Amazon, eBay, AliExpress) — ToS and anti-bot
constraints make it a poor proof of a pipeline; or any JavaScript-rendered catalogue.

### 10.3 Success criteria (measured, not asserted)

| # | Criterion | How it is measured |
| - | --------- | ------------------ |
| 1 | One source configured with `status = 'active'` and its permission recorded | row + `notes` |
| 2 | One run ingests N records (N > 0) inside the batch limit | job `stats.received` = `imported` + `updated` + `unchanged` + `skipped` + `rejected`; rows counted in `imported_deals` |
| 3 | Re-running the same source creates **0** new rows | second job reports `imported: 0`, `unchanged: N`; row count unchanged; `(source_id, external_product_id)` count = N |
| 4 | A changed source record produces exactly one `updated`, not a duplicate | fixture edit → `updated: 1`, row count unchanged, one new `imported` event |
| 5 | Zero writes to canonical or public tables, zero writes from a browser | counts before/after on `products`, `product_variants`, `merchant_offers`, `public.deals`; the browser performs only Supabase calls |
| 6 | Every record carries provenance and an event | `imported_metadata` non-empty and equal to the fixture's raw object; one `imported` event per touched record |
| 7 | A malformed record is rejected by name and leaves no partial row | deliberately broken fixture → one `rejected` result with `field` + `reason`; no row, no media, no event |
| 8 | A forbidden key is refused rather than ignored | fixture with `pipeline_status` → rejection naming the field |
| 9 | The job lifecycle is honest | `succeeded` with stats on the happy path; a source returning 500 produces `failed` with a non-blank `error`, and the admin Jobs screen shows it |
| 10 | No credential anywhere it should not be | grep of the repository, the payload and the logs; `deal_sources` row passes `deal_sources_config_no_secrets` |
| 11 | Bounded and polite | per-run page/record ceilings respected; timeouts and a real User-Agent; request count recorded in `stats` |
| 12 | The stop line holds | the new records sit at `pipeline_status = 'imported'`; 0010 refuses them (they are not `pending-review`); the review queue is unchanged |

---

## 11. Decisions to ratify

| # | Decision | Recommendation |
| - | -------- | -------------- |
| D1 | Runner platform | **Local Node runner now; the same code under GitHub Actions in 17C-E.** (§9.3) |
| D2 | Credential model | **The runner holds the Supabase `service_role` key in its own environment**; 0011's functions are granted to `service_role` only. A dedicated least-privilege Postgres role is possible later; it requires a role/login in the live project and is not needed for 17C-B/C. (§6.4, §8.2) |
| D3 | Identity rule | **Refuse records without a non-blank `external_product_id`.** A content-hash fallback identity is an alternative, but it invents identity and weakens the deduplication stage before it exists. (§8.4) |
| D4 | Evidence columns | **Add `imported_deals.last_seen_at` and `raw_hash` in 0011.** Both are additive, need no backfill, and are what make "unchanged" and "last seen" answerable. (§8.3) |
| D5 | `job_id` on refresh | **Update it to the run that last wrote the row**, and record both ids in the event. Keeping the first-import id is the alternative, at the cost of not being able to ask which records a run touched. (§8.4) |
| D6 | A `derived` block in the payload | **Not in the first cut.** Brand/model/GTIN text stays inside `raw`; the normalization processor lifts it later. Adding a derived block now would put a normalization output in the ingest contract before the normalization stage exists. (§4.1) |
| D7 | Limits | **500 records per batch, 20 KB `raw`, 30 media per record, 200-char external id, 500/8000-char title/description.** (§4.4) |

## 12. Out of scope, explicitly

No scraper. No browser automation. No dependency added. No connector folder created. No `api/`,
no `supabase/`, no worker, no scheduler, no cron. No migration file, no schema change, no policy
change, no grant change. No frontend file touched. No canonical record, public deal, listing or
affiliate link created. No AI, fuzzy matching, currency conversion or price tracking. No commit
and no push until this package is approved.
