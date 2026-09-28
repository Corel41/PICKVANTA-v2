#!/usr/bin/env node
'use strict';

/**
 * The connector runner — Step 17C-B.
 *
 * Two modes, one set of gates:
 *
 *   --dry-run   reads a source through an adapter, maps it onto the Step 17C-A
 *               ingest contract, validates it, and reports what the ingest
 *               boundary *would* accept and refuse. Fully offline: no client is
 *               created, no socket is opened, nothing is written.
 *   --commit    does the same reading and mapping, and then asks the ingest
 *               boundary (migration 0011) to store it: one job opened, one call
 *               per batch, one closing call. The boundary decides every
 *               outcome; this runner reports what it said.
 *
 * What it never does:
 *   • it never writes to the database except through the three RPC endpoints in
 *     lib/db/client.js — no table endpoint, no SQL, no generic write;
 *   • it never writes to a file (a run's output is its stdout);
 *   • it has no dependencies (node built-ins only);
 *   • it never prints a secret.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const contract = require('./lib/contract');
const simulate = require('./lib/simulate');
const fileTransport = require('./lib/transport/file');
const transports = require('./lib/transport');
const adapters = require('./lib/adapters');
const preflight = require('./lib/preflight');
const report = require('./lib/report');
const normalize = require('./lib/normalize');
const identity = require('./lib/identity');
const runContext = require('./lib/run-context');
const db = require('./lib/db/client');

const {
  ConnectorError,
  UsageError,
  EnvironmentError,
  SourceError,
  TransportError,
  EXIT_OK,
  EXIT_DATA,
  EXIT_FAILED
} = require('./lib/errors');

const SOURCE_TYPES = ['marketplace-feed', 'affiliate-network-feed', 'merchant-api',
  'merchant-product-feed', 'permitted-url-source'];
const SOURCE_STATUS = ['active', 'paused', 'disabled', 'archived'];
const VALUE_FLAGS = new Set(['--source', '--scenario', '--repeat', '--timeout-ms']);
const BOOL_FLAGS = new Set(['--dry-run', '--commit', '--check-env', '--json', '--help']);

/* ------------------------------------------------------------- arguments -- */

function parseArgs(argv) {
  const options = {
    source: null, scenario: 'ok', repeat: 1, timeoutMs: null,
    dryRun: false, commit: false, checkEnv: false, json: false, help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError('missing-value', token + ' needs a value');
      }
      index += 1;
      if (token === '--source') options.source = value;
      else if (token === '--scenario') options.scenario = value;
      else if (token === '--repeat') options.repeat = Number(value);
      else if (token === '--timeout-ms') options.timeoutMs = Number(value);
      continue;
    }
    if (BOOL_FLAGS.has(token)) {
      if (token === '--dry-run') options.dryRun = true;
      else if (token === '--commit') options.commit = true;
      else if (token === '--check-env') options.checkEnv = true;
      else if (token === '--json') options.json = true;
      else options.help = true;
      continue;
    }
    throw new UsageError('unknown-argument', 'unknown argument "' + token + '" — run with --help');
  }

  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 5) {
    throw new UsageError('bad-repeat', '--repeat must be an integer from 1 to 5');
  }
  if (options.timeoutMs !== null
    && (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 50 || options.timeoutMs > 60000)) {
    throw new UsageError('bad-timeout', '--timeout-ms must be between 50 and 60000');
  }
  return options;
}

/* ---------------------------------------------------------------- source -- */

/**
 * Reads and checks a source manifest. A fixture manifest carries the same
 * fields a `deal_sources` row carries, so the gates here are the gates
 * `import_job_start` applies: a uuid, a known type, a known status, and an
 * adapter named in a non-secret config.
 */
function loadSource(sourceDir) {
  const file = path.join(sourceDir, 'source.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new SourceError('source-not-found', 'no readable source.json in ' + sourceDir + ' (' + error.message + ')');
  }

  let source;
  try {
    source = JSON.parse(text);
  } catch (error) {
    throw new SourceError('bad-source', file + ' is not valid JSON: ' + error.message);
  }

  const problems = [];
  if (!contract.isPlainObject(source)) {
    throw new SourceError('bad-source', file + ' must contain a JSON object');
  }
  if (typeof source.id !== 'string' || !contract.PATTERNS.uuid.test(source.id)) {
    problems.push('id must be a uuid (the fixture id stands in for the deal_sources row id)');
  }
  if (contract.isBlank(source.name)) problems.push('name is required');
  if (!SOURCE_TYPES.includes(source.source_type)) {
    problems.push('source_type must be one of ' + SOURCE_TYPES.join(', '));
  }
  if (!SOURCE_STATUS.includes(source.status)) {
    problems.push('status must be one of ' + SOURCE_STATUS.join(', '));
  }
  if (!contract.isPlainObject(source.config)) problems.push('config must be an object');
  if (contract.isPlainObject(source.config) && contract.isBlank(source.config.adapter)) {
    problems.push('config.adapter is required');
  }
  /* A remote source brings rules a fixture source does not need: which hosts it
     may read, and whether a credential is required. They are checked here, with
     the other source problems, so a misconfigured source fails before a job is
     opened rather than halfway through a run. */
  for (const problem of transports.sourceProblems(source)) problems.push(problem);
  if (problems.length > 0) {
    throw new SourceError('source-invalid', file + ' is not a usable source: ' + problems.join('; '));
  }
  return source;
}

/* ------------------------------------------------------------------- run -- */

/**
 * The half both modes share: read the source through its adapter, map what came
 * back onto batch envelopes, and check each envelope against the contract. This
 * touches nothing but the fixture transport and the local validator.
 *
 * Between the adapter and the contract sits the normalization boundary (17C-F):
 * every mapped record is canonicalised by a pure, adapter-independent pass, and
 * what that pass changed is counted for the report. The pass repairs nothing —
 * a value it declines to touch reaches the contract exactly as the adapter
 * produced it, and is refused there with a sentence a person can act on.
 *
 * An envelope the contract refuses is a bug in this runner rather than a data
 * problem, so it fails the run before any batch is sent anywhere.
 */
async function readAndMap(context) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new TransportError('timeout', 'no answer from the source within ' + context.timeoutMs + ' ms'));
  }, context.timeoutMs);

  const phases = context.runContext || null;

  try {
    if (phases) phases.phase = 'transport';
    const transport = await transports.openTransport({
      source: context.source,
      sourceDir: context.sourceDir,
      scenario: context.scenario,
      config: context.config,
      signal: controller.signal,
      manifest: context.manifest,
      credential: context.credential,
      fetchImpl: context.fetchImpl,
      runContext: context.runContext
    });

    const fetched = await context.adapter.fetchRaw({
      transport: transport,
      source: context.source,
      signal: controller.signal
    });

    if (phases) phases.phase = 'map';
    const observedAt = new Date().toISOString();
    const mapped = [];
    const adjustments = [];
    for (const raw of fetched.rawRecords) {
      const mappedRecord = context.adapter.toRecord(raw, {
        source: context.source,
        merchant: fetched.meta.merchant,
        observedAt: observedAt
      });
      const normalized = normalize.record(mappedRecord);
      mapped.push(normalized.record);
      if (normalized.changes.length > 0) adjustments.push(normalized.changes);
    }
    if (phases) phases.phase = 'normalize';
    runContext.noteNormalization(phases, adjustments);

    const envelopes = [];
    for (let index = 0; index < mapped.length; index += contract.LIMITS.recordsPerBatch) {
      envelopes.push({
        batch_version: contract.BATCH_VERSION,
        source_id: context.source.id,
        job_id: context.jobId,
        connector: {
          name: context.adapter.name,
          version: context.adapter.version,
          method: context.adapter.method
        },
        fetched_at: observedAt,
        records: mapped.slice(index, index + contract.LIMITS.recordsPerBatch)
      });
    }

    if (phases) phases.phase = 'validate';
    const validations = envelopes.map((batch) => {
      const validation = contract.validateBatch(batch);
      if (!validation.envelope.ok) {
        throw new ConnectorError(
          'envelope-invalid',
          'the runner built an envelope the contract refuses: '
            + validation.envelope.errors.map((entry) => entry.field + ' — ' + entry.reason).join('; ')
        );
      }
      return validation;
    });

    /* The identity foundation (17C-G) reads the mapped, normalized records and the
       contract's own verdict on each: which identity a record carries, which
       records carry none, and which identities this run states more than once. It
       decides nothing and sends nothing — the boundary still owns the row. */
    if (phases) phases.phase = 'identity';
    const identityEntries = [];
    envelopes.forEach((batch, batchIndex) => {
      batch.records.forEach((record, position) => {
        identityEntries.push({
          record: record,
          source: context.source,
          ok: validations[batchIndex].records[position].ok,
          batch: batchIndex + 1,
          index: position
        });
      });
    });
    const identityAnalysis = identity.analyse(identityEntries, { source: context.source });

    return {
      started: started,
      transport: transport,
      fetched: fetched,
      observedAt: observedAt,
      mapped: mapped,
      envelopes: envelopes,
      validations: validations,
      identity: identityAnalysis
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runOnce(context) {
  const reading = await readAndMap(context);

  const records = [];
  const summary = {
    fetched: reading.fetched.rawRecords.length,
    records: reading.mapped.length,
    batches: reading.envelopes.length,
    imported: 0, updated: 0, unchanged: 0, duplicate: 0, rejected: 0, valid: 0
  };

  reading.envelopes.forEach((batch, batchIndex) => {
    const validation = reading.validations[batchIndex];
    const simulated = simulate.simulateBatch(batch, { run_id: context.runId }, validation.records, context.state);

    simulated.outcomes.forEach((outcome, position) => {
      const record = batch.records[position];
      records.push({
        batch: batchIndex + 1,
        index: outcome.index,
        external_product_id: outcome.external_product_id,
        outcome: outcome.outcome,
        title: record && typeof record.title === 'string' ? record.title : '',
        price: record && record.price ? record.price : null,
        errors: outcome.errors
      });
    });

    summary.imported += simulated.summary.imported;
    summary.updated += simulated.summary.updated;
    summary.unchanged += simulated.summary.unchanged;
    summary.duplicate += simulated.summary.duplicate;
    summary.rejected += simulated.summary.rejected;
    summary.valid += validation.records.filter((entry) => entry.ok).length;
  });

  return {
    report: {
      run_number: context.runNumber,
      run_id: context.runId,
      ms: Date.now() - reading.started,
      transport: {
        kind: reading.transport.kind,
        scenario: reading.transport.kind === 'file' ? context.scenario : null,
        host: reading.transport.meta.host || null,
        pages: reading.fetched.meta.pages,
        requests: reading.transport.meta.requests === undefined ? null : reading.transport.meta.requests,
        bytes: reading.transport.meta.bytes === undefined ? null : reading.transport.meta.bytes,
        simulated: reading.transport.meta.simulated
      },
      source_meta: {
        per_page: reading.fetched.meta.per_page === undefined ? null : reading.fetched.meta.per_page,
        truncated: Boolean(reading.fetched.meta.truncated)
      },
      records: records,
      summary: summary,
      identity: identityReport(reading.identity)
    },
    reading: reading
  };
}

/**
 * What the report says about how the source was read. A fixture run reports the
 * scenario it read; a remote run reports the host and the policy it was read
 * under, so an operator can see from the output alone whether the run was
 * allowed anywhere it should not have been.
 */
function transportDescriptor(prepared, transport) {
  const meta = transport && transport.meta ? transport.meta : {};
  return {
    kind: prepared.transportKind,
    host: meta.host || null,
    port: meta.port || '',
    path: meta.path || null,
    scheme: meta.scheme || null,
    allowed_hosts: meta.allowed_hosts || null,
    allow_private_hosts: meta.allow_private_hosts === true,
    allow_insecure_http: meta.allow_insecure_http === true,
    per_page: meta.per_page === undefined ? null : meta.per_page,
    requests: meta.requests === undefined ? null : meta.requests,
    bytes: meta.bytes === undefined ? null : meta.bytes,
    redirects: meta.redirects === undefined ? null : meta.redirects,
    credential_sent: meta.credential_sent === true
  };
}

/**
 * What a job row says the run was. A fixture run names its scenario; a remote run
 * names the host it read, because that is what an operator needs when a source
 * changes shape at 03:00. Never a secret: the endpoint is checked for userinfo
 * before a job is opened.
 */
function jobDetail(prepared, source, options) {
  const connector = 'connector ' + prepared.adapter.name + '@' + prepared.adapter.version;
  if (prepared.transportKind !== 'http') return connector + ' · scenario ' + options.scenario;
  let host = 'unknown host';
  try {
    host = new URL(source.endpoint_url).host;
  } catch (error) {
    host = 'unknown host';
  }
  return connector + ' · source host ' + host;
}

/**
 * What a run reports about identity (17C-G): the counts, any collision, and the
 * key each record carries — compactly, because the printed report does not show
 * them and a machine consumer should not have to recompute them.
 */
function identityReport(analysis) {
  return {
    summary: analysis.summary,
    collisions: analysis.collisions,
    keys: analysis.entries.map((entry) => ({
      batch: entry.batch,
      index: entry.index,
      key: entry.key,
      certain: entry.certain,
      uncertainty: entry.uncertainty
    }))
  };
}

/**
 * The identities a payload lists more than once, as record indexes (the later
 * occurrence of each pair). A dry run gets this from lib/simulate.js, which
 * keeps the state a re-import needs; a commit run needs the same fact without
 * any state of its own, because the boundary — not this process — decides what
 * actually happens to the second occurrence.
 */
function payloadDuplicates(batch, validated) {
  const seen = new Map();
  const duplicates = [];
  validated.forEach((result, index) => {
    if (!result.ok) return;
    const record = batch.records[index];
    const key = contract.identityKey(batch.source_id, record.external_product_id);
    if (seen.has(key)) duplicates.push(index);
    else seen.set(key, index);
  });
  return duplicates;
}

/**
 * The two values both modes need from a source: its adapter and how long the
 * source may take to answer. A commit run must read its source with the same
 * gates a dry run does, or the dry run would not be a rehearsal of anything.
 */
async function prepareRun(sourceDir, source, options) {
  const manifest = await fileTransport.readScenarioManifest(sourceDir, options.scenario);
  const config = Object.assign({}, source.config, (manifest && manifest.config) || {});
  const configuredTimeout = Number(config.timeout_ms);
  const timeoutMs = options.timeoutMs
    || (Number.isFinite(configuredTimeout) && configuredTimeout >= 50 ? configuredTimeout : 10000);
  const adapter = adapters.getAdapter(config.adapter);

  /* A source that declares it needs a credential cannot be read without one, in
     either mode: the value comes from the environment, under a name derived from
     the source id (preflight), and this is the only place it is read for a run. */
  const credential = preflight.sourceCredential(process.env, source);
  if (credential.variable !== null && !credential.present) {
    throw new EnvironmentError('source-credential-missing',
      credential.variable + ' is not set, and this source declares that it needs a credential;'
      + ' the value belongs in the runner environment, never in a source row or a file');
  }

  return {
    manifest: manifest,
    config: config,
    timeoutMs: timeoutMs,
    adapter: adapter,
    transportKind: transports.transportKindOf(source),
    credential: credential.value
  };
}

/**
 * Cancellation.
 *
 * A commit run has a job row open, so an interrupted run has an obligation a
 * dry run does not: to say why it stopped. SIGINT and SIGTERM close that job as
 * "cancelled" with the reason, and the process leaves with the code the shell
 * uses for that signal — 130 for SIGINT, 143 for SIGTERM.
 *
 * A batch that was in flight when the signal arrived may already have been
 * stored by the boundary: the reason recorded on the job says so, because a
 * cancellation is not a rollback and must not be described as one.
 *
 * A dry run installs nothing: it holds no job, writes nothing, and Ctrl-C ends
 * it exactly as it ended it before this step.
 */
function installCancellation(client, tracker, stats, exit) {
  const leave = exit || ((code) => process.exit(code));
  const installed = [];

  const install = (signal, code) => {
    function handler() {
      if (handler.handled) return;
      handler.handled = true;
      process.stderr.write('cancelled — ' + signal + ': closing job '
        + (tracker.jobId === null || tracker.jobId === undefined ? '(none)' : tracker.jobId)
        + ' as "cancelled"\n');
      Promise.resolve()
        .then(async () => {
          if (tracker.jobId && !tracker.jobClosed) {
            await client.jobFinish(tracker.jobId, 'cancelled', stats(),
              'Cancelled by ' + signal + ' before the run completed; a batch that was in flight may already have been stored.');
            tracker.jobClosed = true;
          }
        })
        .catch((error) => {
          process.stderr.write('  the job could not be closed as cancelled: '
            + (error && error.message ? error.message : String(error)) + '\n');
        })
        .then(() => { leave(code); });
    }
    process.on(signal, handler);
    installed.push([signal, handler]);
  };

  install('SIGINT', 130);
  install('SIGTERM', 143);

  return function uninstall() {
    for (const entry of installed) process.off(entry[0], entry[1]);
  };
}

/**
 * Commit mode — the write path.
 *
 * The order is the point: the environment is checked (fail closed, before any
 * call), the source is read with the same gates as a dry run, one job is opened
 * by the boundary, each batch is sent as one RPC call, and the job is closed
 * with the boundary's own counts.
 *
 * Every outcome reported here is the boundary's answer. The local contract is
 * still applied first — a batch whose envelope the contract refuses is never
 * sent — and where the local verdict and the boundary's verdict differ, that is
 * reported rather than smoothed over, because it would mean the two boundaries
 * have drifted apart.
 *
 * If anything fails after the job was opened, the job is closed as "failed"
 * with the reason; if even that fails, the error says so, and the run is left
 * for a person to close rather than being reported as tidy.
 *
 * `deps.client` and `deps.exit` let the tests drive this orchestration with no
 * socket and no process to kill; the command line passes neither, so an operator
 * always gets the real client from lib/db/client.js and a real exit. `tracker` is the same idea for the failure report: it
 * records whether a job was opened and closed, so a failure can be described
 * accurately instead of guessed at.
 */
async function commitRun(sourceDir, source, options, deps, tracker) {
  const settings = deps || {};
  const run = tracker || {};
  let client = settings.client || null;

  if (!client) {
    const readiness = preflight.inspectEnvironment(process.env, source);
    if (!readiness.ready) {
      throw new EnvironmentError('environment-not-ready',
        'a write run needs a complete environment: ' + readiness.problems.join('; '));
    }
    client = db.createIngestClient({
      url: process.env[preflight.ENV_URL],
      serviceKey: process.env[preflight.ENV_SERVICE_KEY],
      fetchImpl: settings.fetchImpl,
      timeoutMs: settings.rpcTimeoutMs
    });
  }

  const prepared = await prepareRun(sourceDir, source, options);
  runContext.describe(run, { adapter: prepared.adapter, scenario: options.scenario, phase: 'job-start' });
  const job = await client.jobStart(source.id, jobDetail(prepared, source, options));
  run.jobId = job.job_id;
  run.jobClosed = false;

  const runs = [];
  const totals = {
    fetched: 0, records: 0, batches: 0,
    imported: 0, updated: 0, unchanged: 0, skipped: 0, rejected: 0, duplicate: 0, valid: 0
  };
  const disagreements = [];

  /* Transport facts are counted separately from the record totals, so the loop
     that sums a pass's outcomes can never meet an undefined key. Criterion 11 of
     17C-A §10.3 asks for the request count to be recorded in the job's stats. */
  const counters = { pages: 0, requests: 0, bytes: 0 };
  let lastTransport = null;

  const stats = () => ({
    received: totals.records,
    imported: totals.imported,
    updated: totals.updated,
    unchanged: totals.unchanged,
    skipped: totals.skipped,
    rejected: totals.rejected,
    batches: totals.batches,
    passes: runs.length,
    pages: counters.pages,
    requests: counters.requests
  });

  const uninstall = installCancellation(client, run, stats, settings.exit);

  try {
    for (let pass = 1; pass <= options.repeat; pass += 1) {
      const reading = await readAndMap({
        sourceDir: sourceDir,
        source: source,
        adapter: prepared.adapter,
        config: prepared.config,
        scenario: options.scenario,
        timeoutMs: prepared.timeoutMs,
        manifest: prepared.manifest,
        credential: prepared.credential,
        fetchImpl: settings.sourceFetchImpl,
        jobId: job.job_id,
        runId: crypto.randomUUID(),
        runNumber: pass,
        runContext: run
      });
      lastTransport = reading.transport;
      counters.pages += reading.transport.meta.pages || 0;
      counters.requests += reading.transport.meta.requests || 0;
      counters.bytes += reading.transport.meta.bytes || 0;

      const summary = {
        fetched: reading.fetched.rawRecords.length,
        records: reading.mapped.length,
        batches: reading.envelopes.length,
        imported: 0, updated: 0, unchanged: 0, skipped: 0, rejected: 0, duplicate: 0, valid: 0
      };
      const records = [];
      const duplicatesInPayload = new Set();

      for (let batchIndex = 0; batchIndex < reading.envelopes.length; batchIndex += 1) {
        const batch = reading.envelopes[batchIndex];
        const localRecords = reading.validations[batchIndex].records;
        summary.valid += localRecords.filter((entry) => entry.ok).length;
        for (const index of payloadDuplicates(batch, localRecords)) {
          duplicatesInPayload.add(batchIndex + ':' + index);
        }

        run.phase = 'boundary';
        const answer = await client.ingest(batch);
        summary.imported += answer.imported;
        summary.updated += answer.updated;
        summary.unchanged += answer.unchanged;
        summary.skipped += answer.skipped;
        summary.rejected += answer.rejected;

        answer.results.forEach((result, position) => {
          const local = localRecords[position];
          const localAccepted = Boolean(local && local.ok);
          if (localAccepted === (result.outcome === 'rejected')) {
            /* A disagreement is the strongest debug signal a commit run can
               produce — the local contract and the boundary decided differently —
               so it is both a reported disagreement and an error with context. */
            const disagreement = {
              batch: batchIndex + 1,
              index: result.index,
              external_product_id: result.external_product_id,
              local: localAccepted ? 'accepted' : 'refused',
              boundary: result.outcome
            };
            disagreements.push(disagreement);
            runContext.disagree(run, disagreement);
          }
          const record = batch.records[position];
          records.push({
            batch: batchIndex + 1,
            index: result.index,
            external_product_id: result.external_product_id,
            outcome: result.outcome,
            imported_deal_id: result.imported_deal_id || null,
            event_id: result.event_id || null,
            raw_hash: result.raw_hash || '',
            title: record && typeof record.title === 'string' ? record.title : '',
            price: record && record.price ? record.price : null,
            errors: Array.isArray(result.errors) ? result.errors : []
          });
        });
      }

      summary.duplicate = duplicatesInPayload.size;
      runContext.describe(run, {
        adapter: prepared.adapter,
        scenario: options.scenario,
        transport: transportDescriptor(prepared, reading.transport)
      });
      runs.push({
        run_number: pass,
        run_id: reading.observedAt,
        ms: Date.now() - reading.started,
        transport: {
          kind: reading.transport.kind,
          scenario: reading.transport.kind === 'file' ? options.scenario : null,
          host: reading.transport.meta.host || null,
          pages: reading.fetched.meta.pages,
          requests: reading.transport.meta.requests === undefined ? null : reading.transport.meta.requests,
          bytes: reading.transport.meta.bytes === undefined ? null : reading.transport.meta.bytes,
          simulated: reading.transport.meta.simulated
        },
        source_meta: {
          per_page: reading.fetched.meta.per_page === undefined ? null : reading.fetched.meta.per_page,
          truncated: Boolean(reading.fetched.meta.truncated)
        },
        records: records,
        summary: summary,
        identity: identityReport(reading.identity)
      });

      runContext.observe(run, runs[runs.length - 1]);
      for (const key of Object.keys(totals)) totals[key] += summary[key];
    }

    run.phase = 'job-finish';
    const finished = await client.jobFinish(job.job_id, 'succeeded', stats(), '', null);
    run.jobClosed = true;

    return {
      mode: 'commit',
      source: {
        id: source.id,
        name: source.name,
        provider_name: source.provider_name || '',
        source_type: source.source_type,
        status: source.status,
        endpoint_url: source.endpoint_url || '',
        market_country: source.market_country || ''
      },
      adapter: { name: prepared.adapter.name, version: prepared.adapter.version, method: prepared.adapter.method },
      transport: transportDescriptor(prepared, lastTransport),
      scenario: options.scenario,
      job: { id: job.job_id, simulated: false, status: finished.status, progress: finished.progress },
      boundary: { stats: stats(), disagreements: disagreements },
      runs: runs
    };
  } catch (error) {
    const reason = String(error && error.message ? error.message : error).slice(0, 2000);
    try {
      await client.jobFinish(job.job_id, 'failed', stats(), reason, null);
      run.jobClosed = true;
    } catch (closeError) {
      run.jobClosed = false;
      error.message = (error.message || String(error))
        + ' — and the job could not be closed either: ' + (closeError.message || String(closeError));
    }
    throw error;
  } finally {
    uninstall();
  }
}

async function dryRun(sourceDir, source, options, context) {
  const prepared = await prepareRun(sourceDir, source, options);
  runContext.describe(context, { adapter: prepared.adapter, scenario: options.scenario });
  const state = simulate.newState();
  const jobId = crypto.randomUUID();
  const runs = [];
  let lastTransport = null;

  for (let pass = 1; pass <= options.repeat; pass += 1) {
    const result = await runOnce({
      sourceDir: sourceDir,
      source: source,
      adapter: prepared.adapter,
      config: prepared.config,
      scenario: options.scenario,
      timeoutMs: prepared.timeoutMs,
      manifest: prepared.manifest,
      credential: prepared.credential,
      fetchImpl: options.sourceFetchImpl,
      jobId: jobId,
      runId: crypto.randomUUID(),
      state: state,
      runNumber: pass,
      runContext: context
    });
    lastTransport = result.reading.transport;
    runContext.describe(context, { transport: transportDescriptor(prepared, result.reading.transport) });
    runContext.observe(context, result.report);
    runs.push(result.report);
  }

  return {
    mode: 'dry-run',
    source: {
      id: source.id,
      name: source.name,
      provider_name: source.provider_name || '',
      source_type: source.source_type,
      status: source.status,
      endpoint_url: source.endpoint_url || '',
      market_country: source.market_country || ''
    },
    adapter: { name: prepared.adapter.name, version: prepared.adapter.version, method: prepared.adapter.method },
    transport: transportDescriptor(prepared, lastTransport),
    scenario: options.scenario,
    job: { id: jobId, simulated: true },
    runs: runs
  };
}

/* ------------------------------------------------------------------ main -- */

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(report.formatFailure(error));
    process.stderr.write(report.formatUsage());
    return error.exitCode;
  }

  if (options.help) {
    process.stdout.write(report.formatUsage());
    return EXIT_OK;
  }

  /* The run context: which execution this is, what it read, what it counted, and
     what went wrong. It doubles as the tracker the failure report reads, so a
     failure can say what the database was asked to do and what the run had
     already done when it stopped. */
  const context = runContext.create({
    mode: options.commit ? 'commit' : 'dry-run',
    scenario: options.scenario,
    repeat: options.repeat
  });

  try {
    if (options.checkEnv) {
      const source = options.source ? loadSource(options.source) : null;
      const readiness = preflight.inspectEnvironment(process.env, source);
      process.stdout.write(report.formatCheckEnv(readiness));
      return readiness.ready ? EXIT_OK : EXIT_FAILED;
    }

    if (options.dryRun && options.commit) {
      throw new UsageError('mode-conflict',
        'choose one mode: --dry-run reads and reports without writing; --commit writes through the ingest boundary');
    }
    if (!options.dryRun && !options.commit) {
      throw new UsageError('mode-required',
        'choose a mode: --dry-run (rehearsal, nothing written) or --commit (write through the ingest boundary)');
    }
    if (!options.source) {
      throw new UsageError('source-required', '--source <dir> is required for a run');
    }

    const sourceDir = path.resolve(options.source);
    const source = loadSource(sourceDir);
    if (source.status !== 'active') {
      throw new SourceError('source-not-active', 'the source status is "' + source.status
        + '"; only an active source may be read (the same gate import_job_start applies)');
    }

    runContext.describe(context, { source: source, scenario: options.scenario });

    const model = options.commit
      ? await commitRun(sourceDir, source, options, null, context)
      : await dryRun(sourceDir, source, options, context);
    context.phase = 'report';
    model.context = runContext.finish(context, 'completed', model);
    if (options.json) {
      process.stdout.write(JSON.stringify(model, null, 2) + '\n');
    } else {
      process.stdout.write(report.formatRun(model));
    }

    const totals = model.runs.reduce((accumulator, run) => {
      accumulator.rejected += run.summary.rejected;
      accumulator.duplicate += run.summary.duplicate;
      return accumulator;
    }, { rejected: 0, duplicate: 0 });

    /* In commit mode a disagreement between the local contract and the boundary
       means the two have drifted apart: the run completed, but it is not a clean
       one, so it exits like a data problem rather than like success. */
    if (model.mode === 'commit' && model.boundary.disagreements.length > 0) {
      return EXIT_DATA;
    }
    return (totals.rejected > 0 || totals.duplicate > 0) ? EXIT_DATA : EXIT_OK;
  } catch (error) {
    if (error instanceof ConnectorError) {
      runContext.finish(context, 'failed', null, error);
      process.stderr.write(report.formatFailure(error, context));
      return error.exitCode;
    }
    process.stderr.write('run failed — unexpected error\n  ' + (error && error.stack ? error.stack : String(error)) + '\n');
    return EXIT_FAILED;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write('run failed — unexpected error\n  ' + (error && error.stack ? error.stack : String(error)) + '\n');
    process.exitCode = EXIT_FAILED;
  });
}

module.exports = {
  main: main,
  dryRun: dryRun,
  commitRun: commitRun,
  installCancellation: installCancellation,
  prepareRun: prepareRun,
  loadSource: loadSource,
  parseArgs: parseArgs
};
