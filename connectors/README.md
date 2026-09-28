# The connector runner (Steps 17C-B, 17C-C, 17C-D, 17C-E, 17C-F and 17C-G)

A server-side runner that reads a **source**, maps what it finds onto the Step 17C-A
**ingest contract**, puts every mapped record through a pure **normalization** pass, validates
the result, and then either reports what the ingest boundary *would* accept and refuse
(`--dry-run`) or asks the boundary to store it (`--commit`).

```
source payload → adapter → normalization → contract validation → identity → ingest boundary
                mapping     canonical form    refused by name     deterministic  three RPC endpoints
                                  (17C-F)                           identity (17C-G)
```

Every run reports what it was: its own identity and duration, the transport counters
(pages, requests, bytes), the record counters, the warnings it raised and the errors it hit,
with enough context to debug a failure from the output alone. **Nothing about a run is
persisted** — the run context lives in the process, is printed with the report, and dies
with it (see *What a run reports*, below).

A **fixture source** is read from saved responses, so a rehearsal is offline and the test
suite is deterministic. A **remote source** (`"transport": "http"` in its manifest) is read
over the network under that source's own host policy — an allowlist it must name, `https`
only, no private or loopback address, no redirect off the list, a per-response size cap and
a real User-Agent.

**`--dry-run` stores nothing and never contacts the database.** **`--commit` writes, and
only through the three RPC endpoints of migration 0011** (`import_job_start`,
`import_ingest`, `import_job_finish`). Exactly two files in this directory may reach the
network, and each has one job: `lib/db/client.js` (the boundary: three RPC endpoints, no
table path, no SQL, no environment, prints nothing) and `lib/transport/http.js` (the
source: the endpoint the source named, under the policy the source declared, and nothing
else). `connectors/test/boundary.test.js` enforces both halves by reading the source. The
boundary — not the runner — decides every outcome.

The architecture this implements is written down in
[`docs/17c-a-ingest-architecture.md`](../docs/17c-a-ingest-architecture.md).

## Quick start

```bash
# a dry run over the fixture source: fetch, map, validate, report
node connectors/run.js --source connectors/fixtures/merchant-alpha --dry-run

# the same source read twice, to simulate a re-import
node connectors/run.js --source connectors/fixtures/merchant-alpha --dry-run --repeat 2

# a second adapter and a second source shape, with no change to the runner
node connectors/run.js --source connectors/fixtures/merchant-beta --dry-run

# one of the failure scenarios
node connectors/run.js --source connectors/fixtures/merchant-alpha --dry-run --scenario timeout

# machine-readable output
node connectors/run.js --source connectors/fixtures/merchant-alpha --dry-run --json

# the first real source shape: a WooCommerce Store API's saved pages
node connectors/run.js --source connectors/fixtures/woocommerce-store --dry-run

# a remote source: a manifest outside this repository, read over the network
# (see "Reading a real source" below for the manifest and its host policy)
node connectors/run.js --source ~/pv-sources/my-store --dry-run

# a real commit: one job, one call per batch, one closing call (needs the environment)
node connectors/run.js --source connectors/fixtures/merchant-alpha --commit

# is this environment able to run a write?
node connectors/run.js --check-env

# every test
node --test 'connectors/test/*.test.js'
```

Modes: `--dry-run` (read, map, validate, report), `--commit` (the same, then write through
the ingest boundary), `--check-env`.
Options: `--source <dir>`, `--scenario <name>` (fixture sources), `--repeat <n>`,
`--timeout-ms <n>`, `--json`, `--help`. One mode at a time; asking for both is refused.

A commit run needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see **Secrets**), and
migration `0011_import_engine_ingest.sql` applied. Without either it exits 2 before
opening a job; with both, it opens one job, sends each batch as one call, and closes the
job with the boundary's own counts. A run that fails after the job was opened closes it as
`failed` with the reason, and says whether that closing call succeeded — an unclosed job is
reported, never hidden. Interrupting a commit run (`SIGINT` or `SIGTERM`) closes the open
job as `cancelled`, with a reason that says a batch in flight may already have been stored:
a cancellation is not a rollback.

Exit codes: **0** every record valid · **1** the run completed but some records were
rejected or a payload listed the same product twice · **2** the run could not complete
(usage, source, transport, response, environment) or asked for something this build
refuses.

## Layout

```
connectors/
  run.js                     the CLI: gates, orchestration, reporting, exit codes
  lib/contract.js            the 17C-A ingest contract as a strict validator
  lib/errors.js              the error types every layer raises, and the exit codes
  lib/normalize.js           the normalization boundary: canonical form, form only
  lib/identity.js            identity: inputs, priority order, keys, collision handling
  lib/simulate.js            the offline stand-in for what 0011 does (dry runs)
  lib/preflight.js           environment readiness and the secret rules
  lib/db/client.js           the write path: three RPC endpoints, and nothing else
  lib/report.js              the human report and the JSON result
  lib/run-context.js         one execution's own facts: metadata, counters, warnings, errors
  lib/transport/index.js     which transport a source's manifest asks for
  lib/transport/file.js      the fixture transport (pages of text; simulates failures)
  lib/transport/http.js      the network: host policy, size cap, timeout, redirects
  lib/adapters/store-json.js one source shape: JSON pages of store products
  lib/adapters/product-csv.js one source shape: a CSV product feed
  lib/adapters/woo-store-api.js the real source shape: a WooCommerce Store API
  lib/adapters/index.js      the registry: name -> adapter
  fixtures/merchant-alpha/   fixture source, one directory per scenario
  fixtures/merchant-beta/    a second shape, to prove the boundary is not shaped
                             around one source
  fixtures/woocommerce-store/ saved Store API pages (bare arrays) for the real adapter
  test/                      177 tests, node:test only, no dependency
```

## The contract, in one paragraph

One batch carries the source, the job, the connector's name and version, the fetch time,
and up to 500 records. Each record carries an `external_product_id`, a `source_url`, a
`title`, an optional description, an optional `{amount, currency}` price, optional
availability/category text, a merchant object, media references, and `raw` — the source's
own record, unchanged. Prices are decimal strings with an ISO-4217 code; URL fields must
be `http(s)`; nothing is defaulted, converted or repaired. A record that names no external
product id is refused, because inventing an identity is how a pipeline starts duplicating
records. Pipeline, review, normalization and canonical fields are refused **by name**:
`pipeline_status`, `review_status`, `affiliate_url`, `normalized_brand`, `gtin`,
`published_deal_id` and the rest (see `lib/contract.js`), each with the reason it is
refused. Full rules: `docs/17c-a-ingest-architecture.md` §3.2, §3.3, §4.1–§4.4.

## Normalization (17C-F)

Between an adapter and the contract sits one pass, `lib/normalize.js`, whose only job is the
canonical **form** of a record — so that two adapters reading two different merchant APIs
produce the same shape for the same facts, and the contract judges values rather than
formats. What it normalizes:

| Part | Rule | What it does | What it never does |
| ---- | ---- | ------------ | ------------------ |
| strings | `text-trim` | trims a present string (`title`, `description`, `availability_text`, `category_text`, the merchant's own text) | collapse inner whitespace, change case, turn a non-string into a string, turn an absent value into `''` |
| references | `url-canonical` | lower-cases the scheme and host and drops a default port (`:443`, `:80`), for `source_url`, `merchant.website_url`, `media[].url` and `media[].fallback_url` | alter the path, query, fragment, userinfo or scheme (http stays http), add a path a source did not write, or touch a value the contract would refuse — an address this pass cannot canonicalise reaches validation exactly as it was |
| price shape | `price-shape` | an object with `amount` and `currency`, both trimmed; a finite numeric amount becomes its decimal string | guess a currency, strip a symbol or separator, round, convert, re-scale, or add a missing key |
| media shape | `media-shape` | an array of references: a bare string becomes `{url}`, and an ordering is recorded from the array only when no entry states one | assume a `media_type`, truncate an over-long array, download or inspect anything, or drop an unknown key |
| identity | `external-identity` | `external_product_id` as a string: a numeric id becomes its decimal digits, whitespace is trimmed | derive an identity, change its case, or fill in a blank one (a blank identity is still refused — decision D3) |

Three properties are the reason it is safe to put a pass here:

* **pure** — one input, one output. No clock, no randomness, no state, no I/O, no environment;
* **deterministic and idempotent** — the same input produces a byte-identical record every
  time, and normalizing an already-normalized record reports no changes at all;
* **additive, not corrective** — it canonicalises representation and nothing else. A blank
  title stays blank, a lower-case currency stays lower-case, a non-http(s) address stays as
  written, and `raw` and every unknown or refused key are passed through untouched: those are
  validation's to refuse by name, and a pass that silently repaired them would hide a bad
  source instead of reporting it.

The one honest consequence: a record whose *shape* was wrong in a way the contract refuses —
a numeric identity, a numeric amount, a media reference written as a bare string — is
accepted after the pass, because the shape is exactly what this boundary exists to fix. Data
problems are untouched by it: they are still refused, with the same sentence and the same
field, as the malformed fixtures show.

A run reports what the pass changed: in the totals block as
`normalized N record(s) adjusted before validation · <rule> <count>`, and in `--json` under
`context.normalization`. Every fixture in this repository is already canonical, so the line
does not appear for them — which is the point of a boundary that adds nothing.

**This is not the database's normalization stage.** The pipeline stage that will write
`normalization_status`, `normalized_brand` or `normalized_category_id` is a later migration
working on stored records; this pass runs before anything is stored, claims no pipeline
column (the contract refuses those keys by name), does no categorization, ranking,
deduplication or affiliate work, and invents no data. Merchant-specific transformations
belong in that merchant's adapter, which is the module that knows the shape it is reading.

## Identity (17C-G)

`lib/identity.js` answers one question deterministically: *does this record represent the same
external item?* It is a foundation, not a matcher — it decides keys and reports collisions, and
it never merges, renames, ranks or reorders anything.

**Inputs, in priority order** (`identity.PRIORITY`, which is a promise rather than a comment):

| Order | Rule | Strength | What it is | Can it be an identity? |
| ----- | ---- | -------- | ---------- | ---------------------- |
| 1 | `source-external-id` | authoritative | the source's own product identifier, scoped to the source | **yes** — this is *the* key |
| 2 | `source-url` | supporting | the normalized address of the item's own page | no: it corroborates, and it detects contradictions |
| 3 | `merchant-ref` / `merchant-website` | context | the merchant the payload declared | no: context for a person, and a contradiction detector |
| 4 | `none` | — | the record states no identifier | no: the identity is **unknown**, and nothing invents one |

**The key** is `<source_id>|<external_product_id>` — byte-for-byte the key
`contract.identityKey` produces, `0005`'s partial unique index enforces and `0011` relies on.
There is exactly one key format in this codebase. Because the source id is part of it, two
merchants can never collide, however similar their catalogues look.

**What is never an identifier:** `title`, `description`, `category_text`,
`availability_text`, prices, and any field inside `raw`. Two merchants selling "USB-C Cable"
are two different items until something deterministic says otherwise; matching on a label is
how a catalogue starts collapsing unrelated products, and re-parsing `raw` would put one
merchant's field layout into the core layer. A source's SKU is already the adapter's choice of
`external_product_id`, which is where identity reads it.

**Collision handling** — every case is reported, none is resolved by similarity:

| Case | What it is | What happens |
| ---- | ---------- | ------------ |
| one key, stated twice in one payload | `duplicate-identity` | `merge: true` — the boundary keeps one row per identity and refreshes it (0005/0011); the run reports the positions and exits 1 |
| two identifiers, one page, one source | `same-page-different-ids` | `merge: false` — both identities stand; a person is told one may be stale |
| one identifier, two merchant references | `merchant-conflict` | `merge: false` — the identity is the source's own id; the contradiction is surfaced |
| one value under two different sources | `cross-source-candidate` | `merge: false`, always — evidence for a person, never a merge |

The last row is the point of the whole layer: a run reads one source, but the analysis is pure
and takes a list, so it can be handed several. When two sources share a candidate value the
records stay two identities and the shared value is reported as a question. No similarity, no
fuzzy matching, no semantic distance, no AI: those are out of scope by decision (17C-A §11 and
N1 — uncertainty goes to a person, and no stage auto-archives or auto-rejects).

**What the run reports:** in `--json`, `runs[i].identity` carries `summary` (records,
identified, unidentified, distinct, duplicates, same-page conflicts, merchant conflicts,
cross-source candidates), `collisions` (kind, key, `merge`, note, positions) and `keys` (the
key and certainty of each record); `context.identity` carries the run totals. The printed
report gains one line only when there is something to resolve —
`identity    2 record(s) identified · 1 duplicate key(s)` — plus a warning per collision. A
source with nothing to resolve prints nothing about identity, and **no record, payload or
boundary call changes because of this layer**: the ingest boundary still owns the row.

## Adapters

An adapter knows two things and nothing else:

| Part | What it does | What it must not do |
| ---- | ------------ | ------------------- |
| `fetchRaw(context)` | obtain the source's records (through the injected transport), return `{rawRecords, meta}` | map, validate, decide, write, cache |
| `toRecord(raw, context)` | map one source record onto the contract shape | fetch, keep state, invent values, add keys the contract does not define |

Adding a source shape is one new module with those two functions; adding a way to reach a
source is one transport. `lib/adapters/index.js` is the registry; the source's
`config.adapter` names which adapter to use, and its manifest's `transport` names which
transport. Nothing else in the runner changes.

Three adapters are in this build:

| Adapter | Source shape | Credential |
| ------- | ------------ | ---------- |
| `store-json` | JSON pages of products with minor-unit prices (the fixture shape) | none |
| `product-csv` | one CSV product file | none |
| `woo-store-api` | a WooCommerce store's own Store API: `/wp-json/wc/store/v1/products`, a bare array per page | none for a public catalogue, by convention when the manifest asks for one |

There is no browser automation anywhere in this design, no scraping, and no dependency: the
transport is the platform `fetch` with the policy above wrapped around it.

## Reading a real source (17C-D)

A remote source is a **manifest** — the same fields a `deal_sources` row carries, kept on the
operator's machine (never in this repository, which holds no credentials and no live
endpoints):

```jsonc
{
  "id": "…uuid, the same id as the deal_sources row…",
  "name": "My Store",
  "provider_name": "my-store",
  "source_type": "merchant-product-feed",
  "market_country": "KE",
  "status": "active",                       // the boundary refuses anything but active
  "transport": "http",                      // omit it, or say "file", for a fixture source
  "endpoint_url": "https://mystore.example/wp-json/wc/store/v1/products",
  "config": {
    "adapter": "woo-store-api",
    "per_page": 100,                        // the Store API caps a page at 100
    "max_pages": 20,                        // a run is bounded even if the store never ends
    "timeout_ms": 10000,                    // per request, on top of the run's own timeout
    "max_response_bytes": 2097152,          // per response, enforced while it streams
    "allowed_hosts": ["mystore.example"],   // required: there is no default and no wildcard
    "allow_private_hosts": false,           // stand-in only; never widens the allowlist
    "allow_insecure_http": false            // stand-in only; https is otherwise the only scheme
  },
  "requires_credential": false              // true => the credential below is required
}
```

What the transport refuses, before a request is made: a scheme that is not `https`, a host
that is not in `allowed_hosts`, a loopback/private/link-local address, an endpoint URL that
carries a username or password, and any redirect that lands on one of those. What it bounds:
the bytes of one response, the seconds of one request, the redirect hops, the pages per run
(the adapter's `max_pages`) and the records per batch (the contract's 500). What it reports
in the run output: the host, the policy it read under, the pages, the requests and the bytes.

The credential, when a source needs one, is read from the environment under
`PV_SOURCE_<first 12 hex of the source id>_TOKEN` and sent as `Authorization: Bearer …`. It
is read in `run.js`, named by `preflight.js`, handed to the transport, and never printed —
and when it was sent, the body of a failed response is not repeated into the error message,
so a source cannot echo it into a log.

Two honest notes. The saved fixture in `fixtures/woocommerce-store/` is modelled on the
documented Store API response shape with example data — it is not a copy of any real store's
catalogue. And the real source has been exercised end to end against a stand-in store on
`127.0.0.1` (see the tests), never against a live merchant.

## What a run reports (17C-E)

A report answers five questions, in the same order whether it is read by a person or parsed
as JSON (`--json` carries the same facts under `context`):

| Part | What it says |
| ---- | ------------ |
| run metadata | the run's id, status, mode, scenario, pass count, the Node version, when it started and finished, and how long it took |
| transport counters | pages read, requests made and bytes received — counted by the transport, reported as `n/a` where a fixture read makes no requests rather than as an invented zero |
| record counters | fetched, batches, valid, imported, updated, unchanged, duplicate and rejected, per pass and totalled across passes |
| warnings | the source returned no records; the adapter's page ceiling stopped the read; a credential was sent over a scheme the manifest had to allow. A warning is a fact, not a failure, and the same warning is recorded once |
| errors | every refusal with its phase, batch and position, identity, field, reason and — when the database refused it — its SQLSTATE, plus any disagreement between the local contract and the boundary |

A failure prints the same context instead of a bare message: run id, phase (`source`,
`transport`, `map`, `validate`, `job-start`, `boundary`, `job-finish`, `report`), mode,
source, scenario, the transport policy it was reading under, how long it ran, the error's
own detail (an HTTP status, for instance) and what had been counted when it stopped —
followed, as before, by an honest statement of what the database was and was not asked to
do.

What this deliberately is not: nothing is written to a database, a file or a queue, there is
no history to query, no dashboard that draws it, no retry that acts on it and no schedule
that starts it. The context is one object per execution, and it exists only while the
execution does.

## Scenarios (what each one proves)

| Scenario | Proves |
| -------- | ------ |
| `ok` | mapping, pagination that stops on a short page, evidence kept intact |
| `duplicates` | one product listed twice in one payload is reported, not silently merged |
| `malformed-records` | per-record refusal with the field and the reason (missing identity, blank title, bad URL, lower-case currency, `javascript:` media URL, a hostile `pipeline_status` field that stays in `raw`) |
| `malformed-json` | a truncated response fails the run by name |
| `malformed-response` | a changed response shape (`items` instead of `products`) fails the run by name |
| `timeout` | the runner's real timeout path, using the source's configured `timeout_ms` |
| `http-500` | an upstream error status is reported with the status and body |

A scenario may carry a `scenario.json` with `simulate` (a failure to inject) and `config`
(overrides merged over the source's configuration). Fixtures use `.example` hosts and
say "Fixture" everywhere: they are not real merchants and not real listings.

## Secrets

`--check-env` reports readiness and never prints a secret — only the variable, whether it
is present, the role a key claims and its length.

* `SUPABASE_URL` must be an `https` URL; the project reference is masked in the report.
* `SUPABASE_SERVICE_ROLE_KEY` must be a Supabase JWT whose role is `service_role`. The
  anon key is refused with the reason it cannot write.
* A **source's own credential** is found by convention:
  `PV_SOURCE_<first 12 hex of the source id>_TOKEN`. That is why no credential — and no
  credential-shaped key — ever has to be stored in a `deal_sources` row or a config file.
* A secret is read from the environment only, never from the command line (an argument
  appears in a process list), and never from the repository.
* A dry run of a **fixture** source needs no environment at all: it runs offline, which is
  what makes the tests deterministic. A **remote** source needs its credential in either
  mode, because reading it needs one — and the refusal happens before anything is fetched.

## What the simulation does and does not prove

`lib/simulate.js` reports `imported`, `updated`, `unchanged` and `duplicate` in the same
vocabulary the boundary uses, entirely in memory. It proves: the payload is stable across
runs, identity and change detection behave, and a duplicate inside one payload is visible
before it reaches the database. It does **not** prove: concurrent runs, transactions,
row locking, the real `raw_hash` comparison, or the database's own constraints — those are
the boundary's, and they are verified by the 79-check specification that lives outside this
repository (see *Where the database side is written down*).

A `--commit` run reports the boundary's outcomes instead of the simulation, and compares
the two: a record the local contract accepts while the boundary refuses it (or the other
way round) is printed as a **boundary disagreement**, because it means the two have
drifted apart. That check is not decorative — it is how this step caught 0011 being
stricter than the contract about control characters in a description.

## Tests

```bash
node --test 'connectors/test/*.test.js'
```

177 tests, no dependency: the contract rule by rule; all three adapters; the
normalization boundary (determinism, idempotence, each normalized field, and the rule that
it repairs nothing); the identity foundation (determinism, the key format, title-is-not-an-
identifier, missing identifiers, URL and SKU rules, every collision kind, and cross-source
non-merging); the HTTP
transport's policy (scheme, allowlist, private addresses, credentials in a URL, redirect
containment, size cap, timeout) against a real server on `127.0.0.1` and against an
injected `fetch`; the CLI end to end (every failure path and exit code); the commit path's
client, its orchestration and its cancellation handlers; the preflight/secret rules; and a
boundary suite that reads the connector's own source and refuses SQL, a connection string,
a disk write, a non-builtin `require`, a third network file, any printing from either
network file (so a key or a credential cannot be echoed), and — since 17C-G.1 — the **import
graph itself**: every module is classified into a layer and may depend on exactly the layers
it is allowed to (`LAYERS` / `ALLOWED_DEPENDENCIES` in that file), so a new edge fails the
suite instead of waiting for a review, and only `run.js` may open a transport or the write
path. A bare directory argument
(`node --test connectors/test`) is treated as a module path by this Node version — use the
glob form. `test/normalize.test.js` and `test/identity.test.js` are the 17C-F and 17C-G
boundaries' own suites, and `test/report.test.js` is the 17C-E layer's own suite: a successful run's
metadata and counters, the counters of a real paginated read over a stand-in store, a
re-import's totals, refused records with their batch and field, an HTTP failure and a real
connection failure, an empty source, and the rule that a context copies only the fields it
names.

## What is not built yet

The stages after `imported` — validation, normalization, deterministic deduplication and the
gated promotion that puts a record in front of a reviewer — are a later migration, not this
step. 17C-G is the *foundation* for that deduplication stage and nothing more: it produces the
keys and the collision report a matcher will need, and it makes no match. Not built: any
matching or merging across sources, any auto-archive or auto-reject on a collision, and any
similarity measure — all of which would be decisions, not foundations. A record this runner
stores stays at `pipeline_status = 'imported'`, and `0010` refuses it until those stages have
run (it is not `pending-review`). Also not built: a
scheduler or worker, run history (17C-E reports a run and stores nothing about it; there is
no run table, no dashboard, no queue and no retry), publication and affiliate links (not
17C), and any second real merchant.

Nothing in this directory runs by itself. A person starts the run, and the runner is the
only thing that calls the boundary.

## Where the database side is written down

Migration `db/migrations/0011_import_engine_ingest.sql` is the ingest boundary: the two
observation columns, the four indexes, the three RPC functions, and the internal
validators. Its verification suite is a 79-check specification kept **outside** this
repository — this step's rule is that no SQL lives outside `db/migrations` — and it runs
against a disposable PostgreSQL that has just had migrations `0001`–`0011` applied, so the
migration and its tests never drift apart in the tree. The runner's `--commit` mode is a
client of those three functions and of nothing else.
