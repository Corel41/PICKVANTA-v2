'use strict';

/**
 * The reporting layer — Step 17C-E.
 *
 * A connector run is only as useful as what it says about itself, so these tests
 * are about the five things a report has to get right: that a successful run
 * describes its own execution, that the counters come from the transport rather
 * than from guesswork, that refused records are named with enough context to fix
 * them, that a failure says where it happened, and that an empty source is
 * reported as a fact rather than as silence.
 *
 * Everything here is additive: the older structures (`runs`, `summary`,
 * `records`, `transport`) are asserted alongside the new `context`, because the
 * reporting layer extends them and must not replace them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { runCli, fixture, REPO_ROOT } = require('./_helpers');
const runner = require('../run');
const report = require('../lib/report');
const runContext = require('../lib/run-context');

const ALPHA = fixture('merchant-alpha');
const WOO = fixture('woocommerce-store');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** Closes a model's context exactly as the CLI does before it prints (null after a failure). */
function finish(model, context, status) {
  const snapshot = runContext.finish(context, status || 'completed', model);
  if (model) model.context = snapshot;
  return model || snapshot;
}

/** The options object a CLI run would have parsed, for an in-process run. */
function options(overrides) {
  return Object.assign({ scenario: 'ok', repeat: 1, timeoutMs: null }, overrides || {});
}

/** Writes a source directory outside the repository, the way a fixture is laid out. */
function tempSource(manifest, scenarioPages) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-report-'));
  fs.writeFileSync(path.join(directory, 'source.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const [scenario, pages] of Object.entries(scenarioPages || {})) {
    fs.mkdirSync(path.join(directory, 'scenarios', scenario), { recursive: true });
    pages.forEach((page, index) => {
      fs.writeFileSync(path.join(directory, 'scenarios', scenario, 'page-' + (index + 1) + '.json'),
        JSON.stringify(page, null, 2) + '\n');
    });
  }
  return directory;
}

/** A remote source manifest, pointing at a stand-in store on the loopback. */
function remoteManifest(port, overrides) {
  return Object.assign({
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Stand-in Store',
    provider_name: 'stand-in',
    source_type: 'merchant-product-feed',
    market_country: 'KE',
    status: 'active',
    transport: 'http',
    endpoint_url: 'http://127.0.0.1:' + port + '/wp-json/wc/store/v1/products',
    requires_credential: false,
    config: {
      adapter: 'woo-store-api',
      per_page: 2,
      max_pages: 5,
      timeout_ms: 5000,
      allowed_hosts: ['127.0.0.1'],
      allow_private_hosts: true,
      allow_insecure_http: true
    }
  }, overrides || {});
}

/** Serves the saved Store API pages, so the counters are counted from real responses. */
function standInStore() {
  const pages = [
    fs.readFileSync(path.join(REPO_ROOT, WOO, 'scenarios', 'ok', 'page-1.json'), 'utf8'),
    fs.readFileSync(path.join(REPO_ROOT, WOO, 'scenarios', 'ok', 'page-2.json'), 'utf8')
  ];
  const requests = [];
  const server = http.createServer((request, response) => {
    const target = new URL(request.url, 'http://127.0.0.1');
    requests.push({ page: target.searchParams.get('page'), per_page: target.searchParams.get('per_page') });
    const body = pages[Number(target.searchParams.get('page') || '1') - 1] || '[]';
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        requests: requests,
        stop: () => new Promise((done) => server.close(done))
      });
    });
  });
}

/* --------------------------------------------- a run that succeeds -- */

test('report: a successful run states its own metadata, counters and result', () => {
  const result = runCli(['--source', ALPHA, '--dry-run']);
  assert.equal(result.status, 0);

  assert.match(result.stdout, new RegExp('run id +' + UUID.source + ' {2}\\[completed\\]'));
  assert.match(result.stdout, /started +\d{4}-\d\d-\d\dT[\d:.]+Z {2}· {2}\d+ ms {2}· {2}node v[\d.]+ {2}· {2}1 pass/);
  assert.match(result.stdout, /totals\n {2}transport {3}pages 2 · requests n\/a · bytes n\/a/);
  assert.match(result.stdout, / {2}records {5}fetched 3 · batches 1 · valid 3 · imported 3 · updated 0 · unchanged 0 · duplicate 0 · rejected 0/);
  assert.match(result.stdout, /result {3}OK/);
  assert.doesNotMatch(result.stdout, /warnings \(|errors \(/, 'a clean run has nothing to warn about');
});

test('report: the machine-readable result carries the same run context, and the old structures', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--json']);
  assert.equal(result.status, 0);
  const model = JSON.parse(result.stdout);

  const context = model.context;
  assert.match(context.id, new RegExp('^' + UUID.source + '$'));
  assert.equal(context.status, 'completed');
  assert.equal(context.phase, 'report');
  assert.equal(context.mode, 'dry-run');
  assert.equal(context.scenario, 'ok');
  assert.equal(context.repeat, 1);
  assert.equal(context.passes, 1);
  assert.equal(context.node, process.version);
  assert.ok(Number.isInteger(context.duration_ms) && context.duration_ms >= 0);
  assert.match(context.started_at, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  assert.match(context.finished_at, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  assert.equal(context.source.id, model.source.id);
  assert.equal(context.source.name, model.source.name);
  assert.equal(context.adapter.name, 'store-json');
  assert.equal(context.transport.kind, 'file');
  assert.deepEqual(context.warnings, []);
  assert.deepEqual(context.errors, []);

  /* The counters are the same numbers the per-pass structures already hold. */
  assert.equal(context.counters.transport.pages, model.runs[0].transport.pages);
  assert.equal(context.counters.records.fetched, model.runs[0].summary.fetched);
  assert.equal(context.counters.records.valid, model.runs[0].summary.valid);
  assert.equal(context.counters.records.batches, model.runs[0].summary.batches);

  /* Extending, not redesigning: the 17C-B/C/D structures are all still there. */
  assert.equal(model.runs.length, 1);
  assert.equal(model.runs[0].summary.imported, 3);
  assert.equal(model.runs[0].records[0].outcome, 'imported');
  assert.equal(model.transport.kind, 'file');
  assert.equal(model.job.simulated, true);
});

test('counters: pages, requests and bytes are counted from the transport, not guessed', async () => {
  const store = await standInStore();
  const directory = tempSource(remoteManifest(store.port), {});
  const context = runContext.create({ mode: 'dry-run', scenario: 'ok', repeat: 1 });

  try {
    const source = runner.loadSource(directory);
    const model = finish(await runner.dryRun(directory, source, options(), context), context);

    assert.equal(model.runs[0].summary.imported, 3, 'two full pages and a short one: three products');
    assert.equal(model.runs[0].transport.pages, 2);
    assert.equal(model.runs[0].transport.requests, 2);
    assert.ok(model.runs[0].transport.bytes > 0, 'the bytes received are counted');

    assert.equal(context.counters.transport.pages, 2);
    assert.equal(context.counters.transport.requests, 2);
    assert.equal(context.counters.transport.bytes, model.runs[0].transport.bytes);
    assert.equal(context.transport.kind, 'http');
    assert.equal(context.transport.host, '127.0.0.1');
    assert.equal(context.transport.scheme, 'http');
    assert.deepEqual(context.transport.allowed_hosts, ['127.0.0.1']);
    assert.equal(context.transport.credential_sent, false);

    const printed = report.formatRun(model);
    assert.match(printed, /run 1 — 3 record\(s\) fetched from 2 page\(s\)/);
    assert.match(printed, /· 2 request\(s\) · \d+ bytes/);
    assert.match(printed, /transport {3}pages 2 · requests 2 · bytes \d+/);
    assert.deepEqual(store.requests.map((entry) => entry.page), ['1', '2']);
  } finally {
    await store.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('counters: a re-import totals every pass and says so', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--repeat', '2']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /totals across 2 passes/);
  assert.match(result.stdout, /records {5}fetched 6 · batches 2 · valid 6 · imported 3 · updated 0 · unchanged 3/);

  const model = JSON.parse(runCli(['--source', ALPHA, '--dry-run', '--repeat', '2', '--json']).stdout);
  assert.equal(model.context.passes, 2);
  assert.equal(model.context.counters.records.fetched, 6);
  assert.equal(model.context.counters.transport.pages, 4);
  assert.deepEqual(model.context.warnings, [], 'a re-import is not a warning');
});

/* ------------------------------------------------- refusals and failures -- */

test('report: refused records are errors with batch, identity, field and reason', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'malformed-records']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /errors \(5\)/, 'four refused records, five named refusals');
  assert.match(result.stdout, /1\.0 +contract-refused +external_product_id — must not be blank/);
  assert.match(result.stdout, /1\.2 +contract-refused +FX-B-2003 +price\.currency/);

  const model = JSON.parse(runCli(['--source', ALPHA, '--dry-run', '--scenario', 'malformed-records', '--json']).stdout);
  const errors = model.context.errors;
  assert.equal(errors.length, 5);
  for (const entry of errors) {
    assert.equal(entry.phase, 'records');
    assert.equal(entry.code, 'contract-refused', 'a dry run refuses through the contract, so there is no SQLSTATE');
    assert.equal(entry.details.sqlstate, null);
    assert.equal(entry.details.run, 1);
    assert.equal(entry.details.batch, 1, 'one batch, so every refusal names batch 1');
    assert.ok(Number.isInteger(entry.details.index));
    assert.ok(entry.details.field && entry.details.reason);
  }
  assert.deepEqual(errors.map((entry) => entry.details.field),
    ['external_product_id', 'title', 'source_url', 'price.currency', 'media[0].url']);
  assert.deepEqual(errors.map((entry) => entry.details.index), [0, 0, 1, 2, 3],
    'the first record is refused twice, for two different fields');
  assert.equal(model.context.counters.records.rejected, 4, 'four records refused, five refusals');
  assert.equal(model.context.counters.records.imported, 0);
  assert.deepEqual(model.context.warnings, []);
});

test('report: an HTTP failure says which phase failed, and with what detail', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'http-500']);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '', 'a failed run prints no report and no JSON result');

  assert.match(result.stderr, /run failed — TransportError \(http-status\)/);
  assert.match(result.stderr, /http status: 503/);
  assert.match(result.stderr, /debug/);
  assert.match(result.stderr, new RegExp('run id +' + UUID.source + ' {2}\\[failed\\]'));
  assert.match(result.stderr, /phase +transport/);
  assert.match(result.stderr, /mode +dry run/);
  assert.match(result.stderr, /scenario +http-500/);
  assert.match(result.stderr, /elapsed +\d+ ms/);
  assert.match(result.stderr, /detail +status: 503/);
});

test('report: a real connection failure keeps its context, with nothing already written', async () => {
  /* A port that was open a moment ago and is now closed: the transport fails the
     way it would against a store that is down. */
  const probe = await standInStore();
  const port = probe.port;
  await probe.stop();

  const directory = tempSource(remoteManifest(port), {});
  const context = runContext.create({ mode: 'dry-run', scenario: 'ok', repeat: 1 });
  let failure = null;
  try {
    const source = runner.loadSource(directory);
    await runner.dryRun(directory, source, options(), context);
  } catch (error) {
    failure = error;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  assert.ok(failure, 'a store that is not there must fail the run');
  finish(null, context, 'failed');
  runContext.error(context, context.phase, failure.kind, failure.message);

  assert.equal(context.phase, 'transport');
  assert.equal(context.counters.records.fetched, 0);

  const printed = report.formatFailure(failure, context);
  assert.match(printed, /run failed — TransportError \(network\)/);
  assert.match(printed, /phase +transport/);
  assert.match(printed, new RegExp('run id +' + context.id));
  assert.match(printed, /nothing was written: this was a dry run/);
});

/* ------------------------------------------------------------ an empty source -- */

test('report: an empty source is reported as a warning, not as a silent success', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ALPHA, 'source.json'), 'utf8'));
  manifest.name = 'Empty Fixture Source';
  const directory = tempSource(manifest, { ok: [{ products: [], total_pages: 0, per_page: 2, page: 1 }] });

  try {
    const result = runCli(['--source', directory, '--dry-run']);
    assert.equal(result.status, 0, 'an empty source is not a data problem: nothing was refused');
    assert.match(result.stdout, /run 1 — 0 record\(s\) fetched/);
    assert.match(result.stdout, /warnings \(1\)/);
    assert.match(result.stdout, /empty-source +run 1: the source returned no records/);
    assert.match(result.stdout, /records {5}fetched 0 · batches 0 · valid 0 · imported 0 · updated 0 · unchanged 0 · duplicate 0 · rejected 0/);

    const model = JSON.parse(runCli(['--source', directory, '--dry-run', '--json']).stdout);
    assert.equal(model.context.status, 'completed');
    assert.equal(model.context.counters.records.fetched, 0);
    assert.equal(model.context.counters.transport.pages, 1, 'the page was read; it held nothing');
    assert.deepEqual(model.context.warnings.map((entry) => entry.code), ['empty-source']);
    assert.equal(model.context.warnings[0].details.run, 1);
    assert.deepEqual(model.context.errors, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/* --------------------------------------------------------------- the context itself -- */

test('context: only named fields are copied, and a credential over http is warned about', () => {
  const context = runContext.create({ mode: 'dry-run', scenario: 'ok', repeat: 1 });
  runContext.describe(context, {
    source: {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Source',
      provider_name: 'provider',
      source_type: 'merchant-product-feed',
      status: 'active',
      market_country: 'KE',
      credential: 'must-not-be-copied',
      token: 'must-not-be-copied'
    },
    adapter: { name: 'store-json', version: '0.1.0', method: 'json-api', secret: 'must-not-be-copied' },
    transport: {
      kind: 'http',
      scheme: 'http',
      host: 'store.example',
      allowed_hosts: ['store.example'],
      allow_insecure_http: true,
      credential_sent: true,
      authorization: 'Bearer must-not-be-copied'
    }
  });

  const snapshot = runContext.snapshot(context);
  assert.deepEqual(Object.keys(snapshot.source).sort(),
    ['id', 'market_country', 'name', 'provider_name', 'source_type', 'status']);
  assert.deepEqual(Object.keys(snapshot.adapter).sort(), ['method', 'name', 'version']);
  assert.deepEqual(Object.keys(snapshot.transport).sort(),
    ['allow_insecure_http', 'allow_private_hosts', 'allowed_hosts', 'credential_sent', 'host', 'kind', 'path', 'port', 'scheme']);
  assert.doesNotMatch(JSON.stringify(snapshot), /must-not-be-copied/);
  assert.deepEqual(snapshot.warnings.map((entry) => entry.code), ['credential-over-http']);

  /* The same warning twice is one warning: a re-import of an empty source is one problem. */
  runContext.warn(context, 'empty-source', 'run 1: the source returned no records');
  runContext.warn(context, 'empty-source', 'run 1: the source returned no records');
  assert.equal(context.warnings.filter((entry) => entry.code === 'empty-source').length, 1);
});
