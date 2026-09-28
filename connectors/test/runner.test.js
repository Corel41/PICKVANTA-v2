'use strict';

/**
 * The runner end to end, through its command line: one exit code and one
 * sentence per outcome, because that is what an operator actually sees.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { runCli, fixture, fakeJwt, REPO_ROOT } = require('./_helpers');
const runner = require('../run');
const report = require('../lib/report');
const { createIngestClient, RPC_ENDPOINTS } = require('../lib/db/client');

const ALPHA = fixture('merchant-alpha');
const BETA = fixture('merchant-beta');
const ALPHA_SOURCE = path.join(REPO_ROOT, ALPHA);

const JOB_ID = '99999999-9999-4999-8999-999999999999';
const RECORD_ID = '88888888-8888-4888-8888-888888888888';

/**
 * A stand-in for the write path's client, so the orchestration can be exercised
 * without a socket: it records what it was asked to do and answers in the shape
 * migration 0011 answers in.
 */
function fakeClient(behaviour) {
  const settings = behaviour || {};
  const calls = { start: [], ingest: [], finish: [] };
  const answerFor = (batch) => {
    const plan = settings.outcomes || [];
    const results = batch.records.map((record, index) => {
      const outcome = plan[index] || 'imported';
      return {
        index: index,
        external_product_id: record.external_product_id,
        outcome: outcome,
        imported_deal_id: outcome === 'rejected' ? null : RECORD_ID,
        event_id: outcome === 'unchanged' || outcome === 'rejected' ? null : RECORD_ID,
        raw_hash: 'a'.repeat(32),
        errors: outcome === 'rejected'
          ? [{ field: 'record', reason: 'the database refused this record', sqlstate: '23514' }]
          : []
      };
    });
    const count = (outcome) => results.filter((entry) => entry.outcome === outcome).length;
    return {
      batch_version: 1,
      source_id: batch.source_id,
      job_id: batch.job_id,
      received: results.length,
      imported: count('imported'),
      updated: count('updated'),
      unchanged: count('unchanged'),
      skipped: count('skipped'),
      rejected: count('rejected'),
      results: results
    };
  };

  return {
    calls: calls,
    jobStart: async (sourceId, detail) => {
      calls.start.push({ sourceId: sourceId, detail: detail });
      if (settings.fail === 'start') throw new Error('the boundary refused the job');
      return { job_id: JOB_ID, status: 'running', job_type: 'feed-import', source_id: sourceId };
    },
    ingest: async (batch) => {
      calls.ingest.push(batch);
      if (settings.fail === 'ingest') throw new Error('the boundary did not answer');
      return answerFor(batch);
    },
    jobFinish: async (jobId, status, stats, error, progress) => {
      calls.finish.push({ jobId: jobId, status: status, stats: stats, error: error, progress: progress });
      if (settings.fail === 'finish') throw new Error('the job could not be closed');
      return { job_id: jobId, status: status, progress: status === 'succeeded' ? 100 : 0 };
    }
  };
}

function commit(options, client) {
  const source = runner.loadSource(ALPHA_SOURCE);
  const tracker = { mode: 'commit', jobId: null, jobClosed: false };
  return runner.commitRun(ALPHA_SOURCE, source,
    Object.assign({ scenario: 'ok', repeat: 1 }, options || {}), { client: client }, tracker)
    .then((model) => ({ model: model, tracker: tracker }));
}

/* -------------------------------------------------------- commit: writing -- */

test('commit: one job is opened, every batch is sent to it, and it is closed with the boundary\'s counts', async () => {
  const client = fakeClient();
  const { model, tracker } = await commit({}, client);

  assert.equal(client.calls.start.length, 1);
  assert.equal(client.calls.start[0].sourceId, runner.loadSource(ALPHA_SOURCE).id);
  assert.match(client.calls.start[0].detail, /store-json@0\.1\.0/);

  assert.equal(client.calls.ingest.length, 1);
  assert.equal(client.calls.ingest[0].job_id, JOB_ID, 'the batch carries the job the boundary opened');
  assert.equal(client.calls.ingest[0].records.length, 3);
  assert.equal(client.calls.ingest[0].records[0].external_product_id, 'FX-A-1001');

  assert.equal(client.calls.finish.length, 1);
  assert.equal(client.calls.finish[0].status, 'succeeded');
  assert.equal(client.calls.finish[0].stats.received, 3);
  assert.equal(client.calls.finish[0].stats.imported, 3);
  assert.equal(client.calls.finish[0].stats.passes, 1);

  assert.equal(model.mode, 'commit');
  assert.equal(model.job.simulated, false);
  assert.equal(model.job.id, JOB_ID);
  assert.equal(model.job.status, 'succeeded');
  assert.equal(model.job.progress, 100);
  assert.equal(model.runs[0].summary.imported, 3);
  assert.equal(model.runs[0].records[0].outcome, 'imported');
  assert.equal(model.runs[0].records[0].imported_deal_id, RECORD_ID);
  assert.deepEqual(model.boundary.disagreements, []);
  assert.equal(tracker.jobClosed, true);
});

test('commit: the reported outcome is the boundary\'s, including skipped, unchanged and rejected', async () => {
  const client = fakeClient({ outcomes: ['skipped', 'unchanged', 'rejected'] });
  const { model } = await commit({}, client);

  assert.equal(model.runs[0].summary.skipped, 1);
  assert.equal(model.runs[0].summary.unchanged, 1);
  assert.equal(model.runs[0].summary.rejected, 1);
  assert.equal(model.runs[0].summary.imported, 0);
  assert.deepEqual(model.runs[0].records.map((entry) => entry.outcome), ['skipped', 'unchanged', 'rejected']);
  assert.equal(model.runs[0].records[2].errors[0].sqlstate, '23514',
    'the database\'s own refusal is carried into the report');

  /* The local contract accepted the record the boundary refused, which is a
     disagreement, not something to hide: it means the two boundaries differ. */
  assert.deepEqual(model.boundary.disagreements, [{
    batch: 1, index: 2, external_product_id: 'FX-A-1003', local: 'accepted', boundary: 'rejected'
  }]);
});

test('commit: a second pass is sent to the same job, and the boundary decides what changed', async () => {
  const client = fakeClient({ outcomes: ['unchanged', 'unchanged', 'unchanged'] });
  const { model } = await commit({ repeat: 2 }, client);

  assert.equal(client.calls.ingest.length, 2, 'one call per batch per pass');
  assert.equal(client.calls.ingest[1].job_id, JOB_ID);
  assert.equal(model.runs.length, 2);
  assert.equal(model.runs[1].summary.unchanged, 3);
  assert.equal(client.calls.finish[0].stats.passes, 2);
  assert.equal(client.calls.finish[0].stats.received, 6, 'the closing stats cover the whole run, both passes');
  assert.equal(client.calls.finish[0].stats.unchanged, 6, 'and they are the boundary\'s counts, summed over its answers');
});

test('commit: a failure after the job was opened closes it as failed with the reason', async () => {
  const client = fakeClient({ fail: 'ingest' });
  const source = runner.loadSource(ALPHA_SOURCE);
  const tracker = { mode: 'commit', jobId: null, jobClosed: false };

  await assert.rejects(
    () => runner.commitRun(ALPHA_SOURCE, source, { scenario: 'ok', repeat: 1 }, { client: client }, tracker),
    (error) => {
      assert.match(error.message, /did not answer/);
      return true;
    });

  assert.equal(tracker.jobId, JOB_ID);
  assert.equal(tracker.jobClosed, true);
  assert.equal(client.calls.finish.length, 1);
  assert.equal(client.calls.finish[0].status, 'failed');
  assert.match(client.calls.finish[0].error, /did not answer/);
});

test('commit: if the job cannot be closed either, the error says so rather than looking tidy', async () => {
  const client = fakeClient({ fail: 'ingest' });
  client.jobFinish = async () => { throw new Error('permission denied for function import_job_finish'); };
  const source = runner.loadSource(ALPHA_SOURCE);
  const tracker = { mode: 'commit', jobId: null, jobClosed: false };

  await assert.rejects(
    () => runner.commitRun(ALPHA_SOURCE, source, { scenario: 'ok', repeat: 1 }, { client: client }, tracker),
    (error) => {
      assert.match(error.message, /could not be closed either/);
      assert.match(error.message, /permission denied for function import_job_finish/);
      return true;
    });

  assert.equal(tracker.jobClosed, false);
  const printed = report.formatFailure(new Error('x'), tracker);
  assert.match(printed, /still listed as running/);
  assert.match(printed, /Check that job before starting another run/);
});

test('commit: a run that never opened a job says the database was never asked to write', () => {
  const tracker = { mode: 'commit', jobId: null, jobClosed: false };
  const printed = report.formatFailure(new Error('x'), tracker);
  assert.match(printed, /nothing was written: no job was started/);
  assert.doesNotMatch(printed, /still listed as running/);
});

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

/* --------------------------------------------------------- commit: gates -- */

test('commit: without a runner environment the run stops before any job is started', () => {
  const result = runCli(['--source', ALPHA, '--commit']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /EnvironmentError \(environment-not-ready\)/);
  assert.match(result.stderr, /SUPABASE_URL is not set/);
  assert.match(result.stderr, /SUPABASE_SERVICE_ROLE_KEY is not set/);
  assert.match(result.stderr, /nothing was written: no job was started/);
  assert.doesNotMatch(result.stdout, /run 1 —/);
});

test('commit: an anon key is refused, and the key is never printed', () => {
  const anonKey = fakeJwt('anon');
  const result = runCli(['--source', ALPHA, '--commit'], {
    env: { SUPABASE_URL: 'https://fixtureproject.supabase.co', SUPABASE_SERVICE_ROLE_KEY: anonKey }
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /belongs to role "anon"/);
  assert.match(result.stderr, /cannot write/);
  assert.equal(result.all.includes(anonKey), false, 'the key must never be printed');
  assert.match(result.stderr, /nothing was written: no job was started/);
});

test('commit: a paused source is refused by the same gate a dry run applies', () => {
  const serviceKey = fakeJwt('service_role');
  const result = runCli(['--source', fixture('paused-source'), '--commit'], {
    env: { SUPABASE_URL: 'https://fixtureproject.supabase.co', SUPABASE_SERVICE_ROLE_KEY: serviceKey }
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /source-not-active/);
  assert.match(result.stderr, /nothing was written: no job was started/);
});

test('refusal: no mode is an error rather than a silent default', () => {
  const result = runCli(['--source', ALPHA]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /choose a mode/);
  assert.match(result.stderr, /--dry-run/);
});

test('refusal: asking for both modes at once is refused', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--commit']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /choose one mode/);
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

/* ------------------------------------------- the write path's client -- *
 *
 * The client is exercised with an injected fetch: what it sends, what it
 * refuses and what it says when the database is not what answered. No test here
 * opens a socket, so the request the client would have made is asserted exactly
 * — path, method, headers, body — and the key never leaves the headers.
 */

const CLIENT_URL = 'https://fixtureproject.supabase.co';
const CLIENT_KEY = fakeJwt('service_role');
const CLIENT_JOB_ID = '99999999-9999-4999-8999-999999999999';
const CLIENT_SOURCE_ID = '11111111-1111-4111-8111-111111111111';

/** A fetch that records its call and answers with the given status and body. */
function recorder(status, body) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url: url, options: options });
    return {
      ok: status >= 200 && status < 300,
      status: status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    };
  };
  impl.calls = calls;
  return impl;
}

function clientWith(fetchImpl, overrides) {
  return createIngestClient(Object.assign({
    url: CLIENT_URL,
    serviceKey: CLIENT_KEY,
    fetchImpl: fetchImpl
  }, overrides || {}));
}

function rpcBatch(recordCount) {
  const records = [];
  for (let index = 0; index < recordCount; index += 1) {
    records.push({ external_product_id: 'SKU-' + index });
  }
  return { batch_version: 1, source_id: CLIENT_SOURCE_ID, job_id: CLIENT_JOB_ID, records: records };
}

function ingestAnswer(overrides) {
  return Object.assign({
    batch_version: 1,
    source_id: CLIENT_SOURCE_ID,
    job_id: CLIENT_JOB_ID,
    received: 1,
    imported: 1,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    rejected: 0,
    results: [{ index: 0, external_product_id: 'SKU-0', outcome: 'imported', imported_deal_id: CLIENT_JOB_ID, event_id: CLIENT_JOB_ID, raw_hash: 'a'.repeat(32), errors: [] }]
  }, overrides || {});
}

/* ------------------------------------------------------------ what it sends -- */

test('client: job start posts the three parameters of import_job_start, and nothing else', async () => {
  const fetchImpl = recorder(200, { job_id: CLIENT_JOB_ID, job_type: 'feed-import', source_id: CLIENT_SOURCE_ID, status: 'running' });
  const client = clientWith(fetchImpl);

  const answer = await client.jobStart(CLIENT_SOURCE_ID, 'connector store-json@0.1.0');

  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, CLIENT_URL + '/rest/v1/rpc/import_job_start');
  assert.equal(fetchImpl.calls[0].options.method, 'POST');
  assert.equal(fetchImpl.calls[0].options.headers.apikey, CLIENT_KEY);
  assert.equal(fetchImpl.calls[0].options.headers.authorization, 'Bearer ' + CLIENT_KEY);
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), {
    p_job_type: 'feed-import',
    p_source_id: CLIENT_SOURCE_ID,
    p_detail: 'connector store-json@0.1.0'
  });
  assert.equal(answer.job_id, CLIENT_JOB_ID);
});

test('client: a batch is sent whole, as p_batch, to import_ingest', async () => {
  const fetchImpl = recorder(200, ingestAnswer());
  const client = clientWith(fetchImpl);
  const payload = rpcBatch(1);

  const answer = await client.ingest(payload);

  assert.equal(fetchImpl.calls[0].url, CLIENT_URL + '/rest/v1/rpc/import_ingest');
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { p_batch: payload });
  assert.equal(answer.imported, 1);
});

test('client: finishing a job posts the five parameters of import_job_finish', async () => {
  const fetchImpl = recorder(200, { job_id: CLIENT_JOB_ID, status: 'succeeded', progress: 100 });
  const client = clientWith(fetchImpl);

  const answer = await client.jobFinish(CLIENT_JOB_ID, 'succeeded', { received: 3 }, '', null);

  assert.equal(fetchImpl.calls[0].url, CLIENT_URL + '/rest/v1/rpc/import_job_finish');
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), {
    p_job_id: CLIENT_JOB_ID,
    p_status: 'succeeded',
    p_stats: { received: 3 },
    p_error: '',
    p_progress: null
  });
  assert.equal(answer.status, 'succeeded');
});

/* ------------------------------------------------------------- what it refuses -- */

test('client: the endpoint allowlist refuses anything that is not one of the three', async () => {
  const fetchImpl = recorder(200, {});
  const client = clientWith(fetchImpl);

  await assert.rejects(() => client.call('imported_deal_convert', {}), (error) => {
    assert.equal(error.kind, 'endpoint-refused');
    assert.match(error.message, /import_job_start, import_ingest, import_job_finish/);
    return true;
  });
  await assert.rejects(() => client.call('imported_deals', {}), (error) => error.kind === 'endpoint-refused');
  assert.equal(fetchImpl.calls.length, 0, 'a refused endpoint must not reach fetch');
});

test('client: an answer about a different job, or of the wrong length, is refused as a shape problem', async () => {
  const otherJob = recorder(200, ingestAnswer({ job_id: '88888888-8888-4888-8888-888888888888' }));
  await assert.rejects(() => clientWith(otherJob).ingest(rpcBatch(1)), (error) => {
    assert.equal(error.kind, 'rpc-shape');
    assert.match(error.message, /not the job this batch was sent to/);
    return true;
  });

  const shortAnswer = recorder(200, ingestAnswer({ received: 2, results: [] }));
  await assert.rejects(() => clientWith(shortAnswer).ingest(rpcBatch(2)), (error) => {
    assert.equal(error.kind, 'rpc-shape');
    assert.match(error.message, /reports 0 result\(s\) for 2 record\(s\)/);
    return true;
  });

  const noCounts = recorder(200, { job_id: CLIENT_JOB_ID, results: [] });
  await assert.rejects(() => clientWith(noCounts).ingest(rpcBatch(0)), (error) => {
    assert.equal(error.kind, 'rpc-shape');
    assert.match(error.message, /no usable imported count/);
    return true;
  });
});

test('client: a job start without a job id, or a finish that answers another status, is refused', async () => {
  await assert.rejects(() => clientWith(recorder(200, { status: 'running' })).jobStart(CLIENT_SOURCE_ID, ''), (error) => {
    assert.equal(error.kind, 'rpc-shape');
    assert.match(error.message, /without a job_id/);
    return true;
  });

  const wrongStatus = recorder(200, { job_id: CLIENT_JOB_ID, status: 'failed', progress: 0 });
  await assert.rejects(() => clientWith(wrongStatus).jobFinish(CLIENT_JOB_ID, 'succeeded', {}, '', null), (error) => {
    assert.equal(error.kind, 'rpc-shape');
    assert.match(error.message, /answered with status "failed" while "succeeded" was requested/);
    return true;
  });
});

/* -------------------------------------------------------------- what it reports -- */

test('client: a database refusal is reported with its own message, code and status — and never the key', async () => {
  const fetchImpl = recorder(403, {
    code: '42501',
    message: 'permission denied for function import_ingest',
    details: 'the role does not hold EXECUTE',
    hint: 'the grant belongs to service_role'
  });

  await assert.rejects(() => clientWith(fetchImpl).ingest(rpcBatch(1)), (error) => {
    assert.equal(error.kind, 'rpc-refused');
    assert.equal(error.exitCode, 2);
    assert.match(error.message, /HTTP 403/);
    assert.match(error.message, /permission denied for function import_ingest/);
    assert.match(error.message, /the grant belongs to service_role/);
    assert.equal(error.detail.status, 403);
    assert.equal(error.detail.code, '42501');
    assert.equal(error.message.includes(CLIENT_KEY), false, 'the key must never appear in an error');
    assert.equal(JSON.stringify(error.detail).includes(CLIENT_KEY), false, 'and never in the detail');
    return true;
  });
});

test('client: an answer that is not JSON, or a request that cannot be delivered, is named as such', async () => {
  await assert.rejects(() => clientWith(recorder(200, 'not json at all')).ingest(rpcBatch(1)), (error) => {
    assert.equal(error.kind, 'rpc-unreadable');
    assert.match(error.message, /was not JSON/);
    return true;
  });

  const unreachable = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:443'); };
  await assert.rejects(() => clientWith(unreachable).jobStart(CLIENT_SOURCE_ID, ''), (error) => {
    assert.equal(error.kind, 'rpc-unreachable');
    assert.match(error.message, /could not be reached/);
    assert.match(error.message, /ECONNREFUSED/);
    return true;
  });
});

test('client: a call that never answers times out and says how long it waited', async () => {
  const hanging = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const client = clientWith(hanging, { timeoutMs: 60 });

  await assert.rejects(() => client.ingest(rpcBatch(1)), (error) => {
    assert.equal(error.kind, 'rpc-timeout');
    assert.match(error.message, /within 60 ms while calling import_ingest/);
    return true;
  });
});

/* ------------------------------------------------------------- what it needs -- */

test('client: a missing or non-https environment is refused before any call', () => {
  assert.throws(() => createIngestClient({ url: '', serviceKey: CLIENT_KEY, fetchImpl: recorder(200, {}) }), (error) => {
    assert.equal(error.kind, 'missing-url');
    assert.match(error.message, /refused rather than attempted blind/);
    return true;
  });
  assert.throws(() => createIngestClient({ url: CLIENT_URL, serviceKey: '', fetchImpl: recorder(200, {}) }), (error) => {
    assert.equal(error.kind, 'missing-key');
    assert.match(error.message, /refused rather than attempted unauthenticated/);
    return true;
  });
  assert.throws(() => createIngestClient({ url: 'http://plain.example', serviceKey: CLIENT_KEY, fetchImpl: recorder(200, {}) }), (error) => {
    assert.equal(error.kind, 'bad-url');
    assert.match(error.message, /must be https/);
    return true;
  });
  /* `fetchImpl: null` means "use the platform fetch", which exists here. The
     no-fetch branch is the one case where the platform has none. */
  const savedFetch = globalThis.fetch;
  globalThis.fetch = undefined;
  try {
    assert.throws(() => createIngestClient({ url: CLIENT_URL, serviceKey: CLIENT_KEY }), (error) => {
      assert.equal(error.kind, 'no-fetch');
      assert.match(error.message, /brings no HTTP dependency of its own/);
      return true;
    });
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('client: the three endpoints are the only ones it knows, and its budget is reported', () => {
  const client = clientWith(recorder(200, {}), { timeoutMs: 1234 });
  assert.deepEqual(client.endpoints, RPC_ENDPOINTS);
  assert.deepEqual(Object.values(client.endpoints), ['import_job_start', 'import_ingest', 'import_job_finish']);
  assert.equal(client.timeoutMs, 1234);
  assert.equal(typeof client.call, 'function');
});

/* ------------------------------------------------ commit: cancellation -- */

/**
 * Runs a child process that installs the cancellation handlers for real, then
 * signals it. An injected exit would prove less than an actual exit code, and a
 * cancellation is exactly the case where the exit code is the contract.
 *
 * The child records each closing call in a file (its own stdout may be
 * truncated by exiting mid-write) and announces itself with READY, so the signal
 * is sent only once the handlers are installed.
 */
function cancellationChild(signal, evidencePath) {
  const script = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const root = process.argv[1];",
    "const evidence = process.argv[2];",
    "const runner = require(path.join(root, 'connectors', 'run.js'));",
    "const client = {",
    "  jobFinish: async (id, status, stats, error) => {",
    "    fs.appendFileSync(evidence, 'CLOSE|' + id + '|' + status + '|' + error + '||');",
    "    return { job_id: id, status: status, progress: 0 };",
    "  }",
    "};",
    "runner.installCancellation(client, { jobId: 'job-under-test', jobClosed: false },",
    "  () => ({ received: 3 }), null);",
    "fs.writeSync(1, 'READY');",
    "setInterval(() => {}, 1000);"
  ].join('\n');

  const child = spawn(process.execPath, ['-e', script, REPO_ROOT, evidencePath],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
      if (out.includes('READY')) child.kill(signal);
    });
    child.stderr.on('data', (chunk) => { err += chunk.toString(); });
    child.on('close', (code, signalName) => resolve({ code: code, signal: signalName, stdout: out, stderr: err }));
  });
}

/** The child's closing records, as the fields it wrote. */
function closingRecords(evidencePath) {
  return fs.readFileSync(evidencePath, 'utf8').split('||').filter((entry) => entry !== '');
}

test('cancellation: a real SIGINT closes the open job as cancelled and exits 130', async () => {
  const evidence = path.join(os.tmpdir(), 'pv-17cc-sigint-' + process.pid + '.log');
  fs.rmSync(evidence, { force: true });
  try {
    const result = await cancellationChild('SIGINT', evidence);
    assert.equal(result.code, 130);
    assert.match(result.stderr, /cancelled — SIGINT: closing job job-under-test as "cancelled"/);
    const records = closingRecords(evidence);
    assert.equal(records.length, 1, 'one signal closes the job exactly once');
    assert.match(records[0], /^CLOSE\|job-under-test\|cancelled\|Cancelled by SIGINT before the run completed/);
    assert.match(records[0], /may already have been stored/,
      'a cancellation is not a rollback, and the reason says so');
  } finally {
    fs.rmSync(evidence, { force: true });
  }
});

test('cancellation: SIGTERM exits 143, and a repeated signal does not close the job twice', async () => {
  const evidence = path.join(os.tmpdir(), 'pv-17cc-sigterm-' + process.pid + '.log');
  fs.rmSync(evidence, { force: true });
  try {
    const result = await cancellationChild('SIGTERM', evidence);
    assert.equal(result.code, 143);
    assert.match(result.stderr, /cancelled — SIGTERM/);
    assert.match(closingRecords(evidence)[0], /^CLOSE\|job-under-test\|cancelled\|Cancelled by SIGTERM/);

    const again = await cancellationChild('SIGINT', evidence);
    assert.equal(again.code, 130);
    assert.equal(closingRecords(evidence).length, 2, 'each run closes its own job exactly once');
  } finally {
    fs.rmSync(evidence, { force: true });
  }
});

test('cancellation: a commit run installs the handlers only while it is writing', async () => {
  const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
  await commit({}, fakeClient());
  assert.equal(process.listenerCount('SIGINT'), before.int, 'SIGINT handler removed when the run ended');
  assert.equal(process.listenerCount('SIGTERM'), before.term, 'SIGTERM handler removed when the run ended');

  const dry = runCli(['--source', ALPHA, '--dry-run']);
  assert.equal(dry.status, 0);
  assert.equal(process.listenerCount('SIGINT'), before.int, 'a dry run installs nothing');
});

/* ------------------------------------------- a real source, over the wire -- */

/**
 * The remote-source path, through the command line, against a stand-in store
 * running in its own process: `spawnSync` (what runCli uses) blocks this
 * process, so the server has to live outside it to answer while the child runs.
 *
 * What these tests are for: the source gates (a missing credential, a host that
 * is not allowlisted, a private host without the stand-in flag) must refuse
 * before anything is fetched, and the happy path must read pages, map them and
 * report the policy it read them under — with a credential that reaches the
 * source and never reaches the output.
 */

const STORE_FIXTURE = path.join(REPO_ROOT, 'connectors', 'fixtures', 'woocommerce-store');
const STORE_ID = '55555555-5555-4555-8555-555555555555';
const STORE_CREDENTIAL_VARIABLE = 'PV_SOURCE_555555555555_TOKEN';

/** A stand-in store in its own process. Records every request it answers. */
function startStandInStore(pages) {
  const script = [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    'const pages = ' + JSON.stringify(pages) + ';',
    "const requests = [];",
    "const server = http.createServer((request, response) => {",
    "  const url = new URL(request.url, 'http://127.0.0.1');",
    "  const page = Number(url.searchParams.get('page') || '1');",
    "  requests.push({ page: page, per_page: url.searchParams.get('per_page'),"
      + " authorization: request.headers.authorization || null });",
    "  const body = pages[page - 1];",
    "  if (body === undefined) { response.writeHead(404); response.end('no such page'); return; }",
    "  response.writeHead(200, { 'content-type': 'application/json' });",
    "  response.end(JSON.stringify(body));",
    "});",
    "server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));",
    "process.on('SIGTERM', () => { fs.writeSync(1, 'REQUESTS ' + JSON.stringify(requests) + '\\n');"
      + " server.close(() => process.exit(0)); });"
  ].join('\n');

  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('the stand-in store did not start')), 10000);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
      const match = out.match(/PORT (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve({
          origin: 'http://127.0.0.1:' + match[1],
          child: child,
          requests: () => {
            const seen = out.match(/REQUESTS (\[[\s\S]*?\])/);
            return seen ? JSON.parse(seen[1]) : [];
          },
          stop: () => new Promise((done) => {
            child.on('close', () => done());
            child.kill('SIGTERM');
            setTimeout(() => { child.kill('SIGKILL'); done(); }, 2000);
          })
        });
      }
    });
    child.on('error', reject);
  });
}

/** A manifest in the operating system's temp directory — never inside the repo. */
function writeManifest(source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-17cd-'));
  fs.writeFileSync(path.join(directory, 'source.json'), JSON.stringify(source, null, 2) + '\n');
  return directory;
}

function storeManifest(origin, overrides) {
  const config = Object.assign({
    adapter: 'woo-store-api',
    per_page: 2,
    max_pages: 5,
    timeout_ms: 3000,
    allowed_hosts: ['127.0.0.1'],
    allow_private_hosts: true,
    allow_insecure_http: true
  }, (overrides && overrides.config) || {});
  return Object.assign({
    id: STORE_ID,
    name: 'Stand-in Store',
    provider_name: 'stand-in',
    source_type: 'merchant-product-feed',
    market_country: 'KE',
    status: 'active',
    transport: 'http',
    endpoint_url: origin + '/wp-json/wc/store/v1/products',
    config: config,
    requires_credential: false
  }, overrides || {}, { config: config });
}

function storePage() {
  return JSON.parse(fs.readFileSync(path.join(STORE_FIXTURE, 'scenarios', 'ok', 'page-1.json'), 'utf8'));
}

function storePage2() {
  return JSON.parse(fs.readFileSync(path.join(STORE_FIXTURE, 'scenarios', 'ok', 'page-2.json'), 'utf8'));
}

test('http source: pages are read over the network and the run reports the host policy', async () => {
  const store = await startStandInStore([storePage(), storePage2()]);
  const directory = writeManifest(storeManifest(store.origin));
  try {
    const result = runCli(['--source', directory, '--dry-run']);

    assert.equal(result.status, 0, result.all);
    assert.match(result.stdout, /http · http:\/\/127\.0\.0\.1:\d+\/wp-json\/wc\/store\/v1\/products/);
    assert.match(result.stdout, /allowed hosts: 127\.0\.0\.1/);
    assert.match(result.stdout, /private hosts allowed \(stand-in\)/);
    assert.match(result.stdout, /http allowed \(stand-in\)/);
    assert.match(result.stdout, /2 request\(s\)/);
    assert.match(result.stdout, /3 record\(s\) fetched from 2 page\(s\)/);
    assert.match(result.stdout, /STORE-1201/);
    assert.match(result.stdout, /STORE-1203/);
    assert.doesNotMatch(result.stdout, /\[simulated /, 'nothing about this run is a simulation');

    assert.equal(store.requests().length, 0, 'the log is published when the stand-in stops');

    await store.stop();
    const requests = store.requests();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((entry) => entry.page), [1, 2]);
    assert.deepEqual(requests.map((entry) => entry.per_page), ['2', '2']);
    assert.equal(requests[0].authorization, null, 'a public source is read without a credential');
  } finally {
    await store.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('http source: the credential reaches the source and never reaches the output', async () => {
  const secret = 'token-that-must-not-be-printed-9f2c';
  const store = await startStandInStore([storePage(), storePage2()]);
  const directory = writeManifest(storeManifest(store.origin, { requires_credential: true }));
  try {
    const missing = runCli(['--source', directory, '--dry-run']);
    assert.equal(missing.status, 2, 'a source that declares a credential is not read without one');
    assert.match(missing.stderr, new RegExp(STORE_CREDENTIAL_VARIABLE));
    assert.match(missing.stderr, /never in a source row or a file/);

    const result = runCli(['--source', directory, '--dry-run'],
      { env: { [STORE_CREDENTIAL_VARIABLE]: secret } });

    assert.equal(result.status, 0, result.all);
    assert.doesNotMatch(result.all, new RegExp(secret), 'the credential must not appear in any output');
    assert.match(result.stdout, /credential sent/);

    await store.stop();
    const requests = store.requests();
    assert.equal(requests.length, 2, 'one request per page, and nothing else');
    assert.equal(requests[0].authorization, 'Bearer ' + secret);
  } finally {
    await store.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('http source: a host that is not allowlisted is refused by the source gates', async () => {
  const directory = writeManifest(storeManifest('https://store.example', {
    config: { allowed_hosts: ['other.example'], allow_private_hosts: false, allow_insecure_http: false }
  }));
  try {
    const result = runCli(['--source', directory, '--dry-run']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /store\.example/);
    assert.match(result.stderr, /not in the allowed_hosts/);
    assert.match(result.stderr, /nothing was written/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('http source: a loopback host without the stand-in flag is refused', async () => {
  const directory = writeManifest(storeManifest('https://127.0.0.1', {
    config: { allow_private_hosts: false, allow_insecure_http: false }
  }));
  try {
    const result = runCli(['--source', directory, '--dry-run']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /private, loopback or link-local/);
    assert.match(result.stderr, /allow_private_hosts/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('http source: a manifest with no allowlist at all is refused before anything else', async () => {
  const directory = writeManifest(storeManifest('https://store.example', { config: { allowed_hosts: [] } }));
  try {
    const result = runCli(['--source', directory, '--dry-run']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /allowed_hosts/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('check-env: a source credential is named, and never printed', () => {
  const directory = writeManifest(storeManifest('https://store.example', {
    config: { allowed_hosts: ['store.example'], allow_private_hosts: false, allow_insecure_http: false },
    requires_credential: true
  }));
  try {
    const without = runCli(['--check-env', '--source', directory]);
    assert.equal(without.status, 2);
    assert.match(without.stdout, new RegExp(STORE_CREDENTIAL_VARIABLE + '\\s+MISSING'));
    assert.match(without.stdout, /source credential, by convention/);

    const secret = 'another-secret-value-1a2b';
    const withSecret = runCli(['--check-env', '--source', directory],
      { env: { [STORE_CREDENTIAL_VARIABLE]: secret } });
    assert.match(withSecret.stdout, new RegExp(STORE_CREDENTIAL_VARIABLE + '\\s+present'));
    assert.doesNotMatch(withSecret.all, new RegExp(secret));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('fixture sources are unchanged: still read from disk, still reported as a file transport', () => {
  const result = runCli(['--source', ALPHA, '--dry-run']);
  assert.equal(result.status, 0, result.all);
  assert.match(result.stdout, /transport\s+file · scenario "ok"/);
  assert.doesNotMatch(result.stdout, /allowed hosts/);

  const store = runCli(['--source', fixture('woocommerce-store'), '--dry-run']);
  assert.equal(store.status, 0, store.all);
  assert.match(store.stdout, /woo-store-api@0\.1\.0/);
  assert.match(store.stdout, /3 record\(s\) fetched from 2 page\(s\)/);
});
