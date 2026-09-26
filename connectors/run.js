#!/usr/bin/env node
'use strict';

/**
 * The connector runner — Step 17C-B.
 *
 * What it does: reads a source, obtains its records through an adapter, maps
 * them to the Step 17C-A ingest contract, validates that contract, and reports
 * what the ingest boundary would have done — including what it would have
 * refused and why.
 *
 * What it does not do, on purpose:
 *   • it never writes to the database (this build has no database client);
 *   • it never writes to a file (a run's output is its stdout);
 *   • it makes no network request (the only transport is the fixture one);
 *   • it has no dependencies (node built-ins only).
 *
 * The write path is 17C-C. `--commit` is refused by name rather than accepted
 * and quietly ignored, because a command that appears to import and does not is
 * worse than one that says no.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const contract = require('./lib/contract');
const simulate = require('./lib/simulate');
const fileTransport = require('./lib/transport/file');
const adapters = require('./lib/adapters');
const preflight = require('./lib/preflight');
const report = require('./lib/report');

const {
  ConnectorError,
  UsageError,
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
 * `import_job_start` will apply in 17C-C: a uuid, a known type, a known
 * status, and an adapter named in a non-secret config.
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
  if (problems.length > 0) {
    throw new SourceError('source-invalid', file + ' is not a usable source: ' + problems.join('; '));
  }
  return source;
}

/* ------------------------------------------------------------------- run -- */

async function runOnce(context) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new TransportError('timeout', 'no answer from the source within ' + context.timeoutMs + ' ms'));
  }, context.timeoutMs);

  try {
    const transport = await fileTransport.openFileTransport({
      sourceDir: context.sourceDir,
      scenario: context.scenario,
      config: context.config,
      signal: controller.signal,
      manifest: context.manifest
    });

    const fetched = await context.adapter.fetchRaw({
      transport: transport,
      source: context.source,
      signal: controller.signal
    });

    const observedAt = new Date().toISOString();
    const mapped = fetched.rawRecords.map((raw) => context.adapter.toRecord(raw, {
      source: context.source,
      merchant: fetched.meta.merchant,
      observedAt: observedAt
    }));

    const batches = [];
    for (let index = 0; index < mapped.length; index += contract.LIMITS.recordsPerBatch) {
      batches.push(mapped.slice(index, index + contract.LIMITS.recordsPerBatch));
    }

    const records = [];
    const summary = {
      fetched: fetched.rawRecords.length,
      records: mapped.length,
      batches: batches.length,
      imported: 0, updated: 0, unchanged: 0, duplicate: 0, rejected: 0, valid: 0
    };

    batches.forEach((batchRecords, batchIndex) => {
      const batch = {
        batch_version: contract.BATCH_VERSION,
        source_id: context.source.id,
        job_id: context.jobId,
        connector: {
          name: context.adapter.name,
          version: context.adapter.version,
          method: context.adapter.method
        },
        fetched_at: observedAt,
        records: batchRecords
      };

      const validation = contract.validateBatch(batch);
      if (!validation.envelope.ok) {
        throw new ConnectorError(
          'envelope-invalid',
          'the runner built an envelope the contract refuses: '
            + validation.envelope.errors.map((entry) => entry.field + ' — ' + entry.reason).join('; ')
        );
      }

      const simulated = simulate.simulateBatch(batch, { run_id: context.runId }, validation.records, context.state);

      simulated.outcomes.forEach((outcome, position) => {
        const record = batchRecords[position];
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
      run_number: context.runNumber,
      run_id: context.runId,
      ms: Date.now() - started,
      transport: {
        kind: transport.kind,
        scenario: context.scenario,
        pages: fetched.meta.pages,
        simulated: transport.meta.simulated
      },
      source_meta: {
        per_page: fetched.meta.per_page === undefined ? null : fetched.meta.per_page,
        truncated: Boolean(fetched.meta.truncated)
      },
      records: records,
      summary: summary
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dryRun(sourceDir, source, options) {
  const manifest = await fileTransport.readScenarioManifest(sourceDir, options.scenario);
  const config = Object.assign({}, source.config, (manifest && manifest.config) || {});
  const configuredTimeout = Number(config.timeout_ms);
  const timeoutMs = options.timeoutMs
    || (Number.isFinite(configuredTimeout) && configuredTimeout >= 50 ? configuredTimeout : 10000);

  const adapter = adapters.getAdapter(config.adapter);
  const state = simulate.newState();
  const jobId = crypto.randomUUID();
  const runs = [];

  for (let pass = 1; pass <= options.repeat; pass += 1) {
    runs.push(await runOnce({
      sourceDir: sourceDir,
      source: source,
      adapter: adapter,
      config: config,
      scenario: options.scenario,
      timeoutMs: timeoutMs,
      manifest: manifest,
      jobId: jobId,
      runId: crypto.randomUUID(),
      state: state,
      runNumber: pass
    }));
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
    adapter: { name: adapter.name, version: adapter.version, method: adapter.method },
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

  try {
    if (options.checkEnv) {
      const source = options.source ? loadSource(options.source) : null;
      const readiness = preflight.inspectEnvironment(process.env, source);
      process.stdout.write(report.formatCheckEnv(readiness));
      return readiness.ready ? EXIT_OK : EXIT_FAILED;
    }

    if (!options.dryRun && !options.commit) {
      throw new UsageError('mode-required', 'choose a mode: --dry-run (available) or --commit (refused until 17C-C)');
    }
    if (options.commit) {
      throw new ConnectorError(
        'write-path-not-in-this-build',
        'the database write path arrives in 17C-C. This build refuses --commit rather than appearing to succeed.'
      );
    }
    if (!options.source) {
      throw new UsageError('source-required', '--source <dir> is required for a dry run');
    }

    const sourceDir = path.resolve(options.source);
    const source = loadSource(sourceDir);
    if (source.status !== 'active') {
      throw new SourceError('source-not-active', 'the source status is "' + source.status
        + '"; only an active source may be read (the same gate import_job_start applies in 17C-C)');
    }

    const model = await dryRun(sourceDir, source, options);
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

    return (totals.rejected > 0 || totals.duplicate > 0) ? EXIT_DATA : EXIT_OK;
  } catch (error) {
    if (error instanceof ConnectorError) {
      process.stderr.write(report.formatFailure(error));
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

module.exports = { main: main, dryRun: dryRun, loadSource: loadSource, parseArgs: parseArgs };
