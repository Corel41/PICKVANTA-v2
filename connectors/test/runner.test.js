'use strict';

/**
 * The runner end to end, through its command line: one exit code and one
 * sentence per outcome, because that is what an operator actually sees.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { runCli, fixture, fakeJwt } = require('./_helpers');

const ALPHA = fixture('merchant-alpha');
const BETA = fixture('merchant-beta');

/* -------------------------------------------------------------- dry run -- */

test('dry run: the fixture source ingests cleanly and reports the contract outcome', () => {
  const result = runCli(['--source', ALPHA, '--dry-run']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /imported 3/);
  assert.match(result.stdout, /3 of 3 record\(s\) satisfy the 17C-A ingest contract/);
  assert.match(result.stdout, /FX-A-1001/);
  assert.match(result.stdout, /129\.50 USD/);
  assert.match(result.stdout, /nothing was written/);
  assert.equal(result.stderr, '');
});

test('dry run: a second adapter and a second source shape need no change to the runner', () => {
  const result = runCli(['--source', BETA, '--dry-run']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /product-csv@0\.1\.0/);
  assert.match(result.stdout, /FB-2001/);
  assert.match(result.stdout, /19\.99 GBP/);
  assert.match(result.stdout, /imported 3/);
});

test('dry run: re-importing the same source changes nothing', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--repeat', '2']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /run 1 — 3 record\(s\) fetched/);
  assert.match(result.stdout, /run 2 \(re-import\)/);
  assert.match(result.stdout, /unchanged 3/);
  assert.match(result.stdout, /imported again +0/);
});

test('dry run: machine-readable output carries the same facts', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--json']);
  assert.equal(result.status, 0);
  const model = JSON.parse(result.stdout);
  assert.equal(model.mode, 'dry-run');
  assert.equal(model.job.simulated, true);
  assert.equal(model.adapter.name, 'store-json');
  assert.equal(model.runs.length, 1);
  assert.equal(model.runs[0].summary.imported, 3);
  assert.equal(model.runs[0].summary.rejected, 0);
  assert.equal(model.runs[0].records[0].outcome, 'imported');
  assert.equal(model.runs[0].records[0].external_product_id, 'FX-A-1001');
});

/* ----------------------------------------------------------- data problems -- */

test('data problem: a duplicate identity in one payload is reported, not silently merged', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'duplicates']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /duplicate 1/);
  assert.match(result.stdout, /ATTENTION/);
});

test('data problem: malformed records are refused one by one, with the field and the reason', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'malformed-records']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /rejected: external_product_id — must not be blank/);
  assert.match(result.stdout, /rejected: title — must not be blank/);
  assert.match(result.stdout, /rejected: source_url — must be an http\(s\) address/);
  assert.match(result.stdout, /rejected: price\.currency/);
  assert.match(result.stdout, /rejected: media\[0\]\.url/);
  assert.match(result.stdout, /rejected 4/);
  assert.match(result.stdout, /imported 0/);
});

test('data problem: a broken CSV row is refused, and a good CSV row is not', () => {
  const result = runCli(['--source', BETA, '--dry-run', '--scenario', 'malformed-records']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /rejected 4/);
  assert.match(result.stdout, /1,299\.00 GBP/);
});

/* --------------------------------------------------------- run failures -- */

test('failure: a page that is not JSON fails the run by name', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'malformed-json']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /malformed-response/);
  assert.match(result.stderr, /not valid JSON/);
  assert.match(result.stderr, /nothing was written/);
});

test('failure: a changed response shape fails the run by name', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'malformed-response']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /has no "products" array/);
});

test('failure: a hanging source hits the source timeout', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'timeout']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /TransportError \(timeout\)/);
  assert.match(result.stderr, /no answer from the source within 150 ms/);
});

test('failure: an HTTP error status is reported with the status', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'http-500']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /HTTP 503/);
  assert.match(result.stderr, /upstream unavailable/);
  assert.match(result.stderr, /http status: 503/);
});

test('failure: a timeout can be tightened from the command line', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'timeout', '--timeout-ms', '50']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /within 50 ms/);
});

test('failure: a missing source, a paused source and an unknown adapter are each named', () => {
  const missing = runCli(['--source', 'connectors/fixtures/does-not-exist', '--dry-run']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no readable source\.json/);

  const paused = runCli(['--source', fixture('paused-source'), '--dry-run']);
  assert.equal(paused.status, 2);
  assert.match(paused.stderr, /source-not-active/);
  assert.match(paused.stderr, /only an active source may be read/);

  const unknown = runCli(['--source', fixture('unknown-adapter'), '--dry-run']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /no adapter named "store-json-v2"/);
});

/* ------------------------------------------------------------- refusals -- */

test('refusal: --commit is refused by name, and nothing is fetched for it', () => {
  const result = runCli(['--source', ALPHA, '--commit']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /write path arrives in 17C-C/);
  assert.doesNotMatch(result.stdout, /run 1 —/);
});

test('refusal: no mode is an error rather than a silent default', () => {
  const result = runCli(['--source', ALPHA]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /choose a mode/);
  assert.match(result.stderr, /--dry-run/);
});

test('refusal: an unknown argument is refused with the usage text', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--frobnicate']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument "--frobnicate"/);
  assert.match(result.stderr, /Usage:/);
});

test('refusal: --repeat and --timeout-ms validate their values', () => {
  assert.equal(runCli(['--source', ALPHA, '--dry-run', '--repeat', '9']).status, 2);
  assert.equal(runCli(['--source', ALPHA, '--dry-run', '--timeout-ms', '5']).status, 2);
  assert.equal(runCli(['--source', ALPHA, '--dry-run', '--timeout-ms', '60001']).status, 2);
});

test('help: --help prints the usage and exits cleanly', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--dry-run/);
  assert.match(result.stdout, /Exit codes/);
});

/* ------------------------------------------------------------- secrets -- */

test('secrets: without a runner key the environment check fails and names what is missing', () => {
  const result = runCli(['--check-env']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /SUPABASE_URL {18}MISSING/);
  assert.match(result.stdout, /SUPABASE_SERVICE_ROLE_KEY {5}MISSING/);
  assert.match(result.stdout, /not ready/);
});

test('secrets: a service-role key is ready; an anon key is refused, and neither is printed', () => {
  const url = 'https://fixtureproject.supabase.co';
  const serviceKey = fakeJwt('service_role');
  const anonKey = fakeJwt('anon');

  const ready = runCli(['--check-env'], { env: { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey } });
  assert.equal(ready.status, 0);
  assert.match(ready.stdout, /role=service_role/);
  assert.match(ready.stdout, /could start/);
  assert.equal(ready.stdout.includes(serviceKey), false, 'the key must never be printed');
  assert.equal(ready.stdout.includes('fixtureproject'), false, 'the project ref is masked');

  const anon = runCli(['--check-env'], { env: { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: anonKey } });
  assert.equal(anon.status, 2);
  assert.match(anon.stdout, /role "anon"/);
  assert.match(anon.stdout, /cannot write/);
  assert.equal(anon.stdout.includes(anonKey), false);

  const notAJwt = runCli(['--check-env'], { env: { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'not-a-jwt' } });
  assert.equal(notAJwt.status, 2);
  assert.match(notAJwt.stdout, /not a Supabase JWT/);

  const badUrl = runCli(['--check-env'], { env: { SUPABASE_URL: 'http://plain.example', SUPABASE_SERVICE_ROLE_KEY: serviceKey } });
  assert.equal(badUrl.status, 2);
  assert.match(badUrl.stdout, /must be an https URL/);
});

test('secrets: no source credential is asked for when the source does not declare one', () => {
  const serviceKey = fakeJwt('service_role');
  const result = runCli(['--check-env'], { env: { SUPABASE_URL: 'https://fixtureproject.supabase.co', SUPABASE_SERVICE_ROLE_KEY: serviceKey } });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /PV_SOURCE_/);
});

test('dry run: no environment is needed for a fixture run, and no secret is read', () => {
  const result = runCli(['--source', ALPHA, '--dry-run']);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /SUPABASE/);
});
