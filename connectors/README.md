# The connector runner (Step 17C-B)

A server-side runner that reads a **source**, maps what it finds onto the Step 17C-A
**ingest contract**, validates that contract, and reports exactly what the ingest
boundary would accept and refuse.

**This build writes nothing.** There is no database client in it, no HTTP client, no
file writing, no dependency and no migration. `--commit` is refused by name, because a
command that appears to import and does not would be worse than one that says no.
The write path is Step 17C-C.

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

# is this environment able to run a write (17C-C) later?
node connectors/run.js --check-env

# every test
node --test 'connectors/test/*.test.js'
```

Modes: `--dry-run` (available), `--commit` (refused until 17C-C), `--check-env`.
Options: `--source <dir>`, `--scenario <name>`, `--repeat <n>`, `--timeout-ms <n>`,
`--json`, `--help`.

Exit codes: **0** every record valid · **1** the run completed but some records were
rejected or a payload listed the same product twice · **2** the run could not complete
(usage, source, transport, response, environment) or asked for something this build
refuses.

## Layout

```
connectors/
  run.js                     the CLI: gates, orchestration, reporting, exit codes
  lib/contract.js            the 17C-A ingest contract as a strict validator
  lib/simulate.js            the offline stand-in for what 0011 will do in 17C-C
  lib/preflight.js           environment readiness and the secret rules
  lib/report.js              the human report and the JSON result
  lib/transport/file.js      the fixture transport (pages of text; simulates failures)
  lib/adapters/store-json.js one source shape: JSON pages of store products
  lib/adapters/product-csv.js one source shape: a CSV product feed
  lib/adapters/index.js      the registry: name -> adapter
  fixtures/merchant-alpha/   fixture source, one directory per scenario
  fixtures/merchant-beta/    a second shape, to prove the boundary is not shaped
                             around one source
  test/                      71 tests, node:test only, no dependency
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

## Adapters

An adapter knows two things and nothing else:

| Part | What it does | What it must not do |
| ---- | ------------ | ------------------- |
| `fetchRaw(context)` | obtain the source's records (through the injected transport), return `{rawRecords, meta}` | map, validate, decide, write, cache |
| `toRecord(raw, context)` | map one source record onto the contract shape | fetch, keep state, invent values, add keys the contract does not define |

Adding a real merchant source in 17C-D is one new module with those two functions, plus
a transport that speaks HTTP. `lib/adapters/index.js` is the registry; the source's
`config.adapter` names which one to use. Nothing else in the runner changes.

**The HTTP transport is deliberately not built here.** When it is (17C-D), it must honour
the transport interface (`readTextPage(pageNumber)` -> text or `null`), the request
signal and the source timeout, and it must add an SSRF allowlist (no private, loopback or
link-local addresses; no redirect that leaves the allowlist), a response-size cap and an
honest User-Agent. There is no browser automation anywhere in this design.

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
* A dry run needs no environment at all: it runs offline, which is what makes the tests
  deterministic.

## What the simulation does and does not prove

`lib/simulate.js` reports `imported`, `updated`, `unchanged` and `duplicate` in the same
vocabulary 0011 will use, entirely in memory. It proves: the payload is stable across
runs, identity and change detection behave, and a duplicate inside one payload is visible
before it reaches the database. It does **not** prove: concurrent runs, transactions,
row locking, the real `raw_hash` comparison, or the database's own constraints. Those
are 17C-C, and they are tested there against a real PostgreSQL instance.

## Tests

```bash
node --test 'connectors/test/*.test.js'
```

71 tests: the contract rule by rule, both adapters, the CLI end to end (including every
failure path and exit code), the preflight/secret rules, and a boundary suite that reads
the connector's own source and refuses a network client, a database client, a disk write
and any non-builtin `require`. A bare directory argument (`node --test connectors/test`)
is treated as a module path by this Node version — use the glob form.

## What 17C-C adds, and what changes here

17C-C adds the database side (`import_job_start`, `import_ingest`, `import_job_finish`)
and turns `--commit` into a real mode: the runner will create the job row, send each batch
to the ingest function, and write the outcome back to the job. The adapter, the contract,
the fixtures and the reporting stay as they are; the new code is the transport to the
database and the job lifecycle around it. Until that exists, nothing in this directory
writes anywhere but stdout.
