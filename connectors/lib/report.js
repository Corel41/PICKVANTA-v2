'use strict';

/**
 * Human-readable and machine-readable reporting.
 *
 * A run report states what was fetched, what was mapped, what the contract
 * accepted or refused, and what the ingest boundary did about it. A dry run says
 * "simulated" and "nothing was written" wherever that distinction matters; a
 * commit run reports the boundary's own counts and names the job that carries
 * them, so a reader can never mistake one mode for the other.
 */

const { listAdapters } = require('./adapters');

function pad(value, width) {
  const text = String(value === null || value === undefined ? '' : value);
  if (text.length >= width) return text.slice(0, Math.max(1, width - 1)) + '…';
  return text + ' '.repeat(width - text.length);
}

function rule() {
  return '-'.repeat(72);
}

function formatUsage() {
  const lines = [];
  lines.push('PickVanta connector runner — Steps 17C-C and 17C-D (dry run and commit)');
  lines.push('');
  lines.push('Usage:');
  lines.push('  node connectors/run.js --source <dir> --dry-run [options]');
  lines.push('  node connectors/run.js --source <dir> --commit [options]');
  lines.push('  node connectors/run.js --check-env [--source <dir>]');
  lines.push('');
  lines.push('Modes:');
  lines.push('  --dry-run            fetch, map, validate and report. Nothing is stored and the database is never');
  lines.push('                       contacted; a fixture source is read from disk, a remote one over the network.');
  lines.push('  --commit             the same, then ask the ingest boundary to store it: one job, one call per');
  lines.push('                       batch. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  lines.push('  --check-env          report environment readiness (secrets) and exit.');
  lines.push('');
  lines.push('A source is read the way its manifest says:');
  lines.push('  "transport": "file"  (or absent) — the source directory holds scenarios/ of saved responses.');
  lines.push('  "transport": "http"  — the endpoint_url is read over the network, under the host policy in the');
  lines.push('                         manifest\'s config (allowed_hosts is required; https unless the manifest');
  lines.push('                         says allow_insecure_http). A source that declares requires_credential');
  lines.push('                         is read with the credential in its environment variable, by convention.');
  lines.push('');
  lines.push('Options:');
  lines.push('  --source <dir>       the source directory: source.json, and scenarios/ for a fixture source.');
  lines.push('  --scenario <name>    which scenario to read (default: ok).');
  lines.push('  --repeat <n>         run the same source n times (1..5) to simulate a re-import. Default 1.');
  lines.push('  --timeout-ms <n>     override the source\'s request timeout (50..60000).');
  lines.push('  --json               print the machine-readable result instead of the report.');
  lines.push('  --help               this text.');
  lines.push('');
  lines.push('Adapters in this build:');
  for (const adapter of listAdapters()) {
    lines.push('  ' + pad(adapter.name, 14) + adapter.method + '  ' + adapter.description);
  }
  lines.push('');
  lines.push('Exit codes: 0 = every record valid · 1 = completed with rejected or duplicate records · 2 = the run failed.');
  lines.push('');
  return lines.join('\n');
}

function formatCheckEnv(preflight) {
  const lines = [];
  lines.push('Runner environment');
  lines.push(rule());
  lines.push('  ' + pad(preflight.url.variable, 30) + (preflight.url.present ? 'present  ' + preflight.url.value : 'MISSING'));
  lines.push('  ' + pad(preflight.key.variable, 30)
    + (preflight.key.present ? 'present  role=' + preflight.key.role + '  length=' + preflight.key.length : 'MISSING'));
  if (preflight.credential) {
    lines.push('  ' + pad(preflight.credential.variable, 30)
      + (preflight.credential.present ? 'present' : 'MISSING') + '  (source credential, by convention)');
  }
  lines.push('');
  if (preflight.ready) {
    lines.push('ready: a commit run could start with this environment.');
  } else {
    lines.push('not ready:');
    for (const problem of preflight.problems) lines.push('  - ' + problem);
  }
  lines.push('');
  lines.push('No secret is printed by this command: a variable is named, and whether it is set.');
  lines.push('');
  return lines.join('\n');
}

function outcomeLine(record, showBatch) {
  const title = record.title === '' ? '(no title)' : record.title;
  const price = record.price ? record.price.amount + ' ' + record.price.currency : '';
  const position = showBatch ? record.batch + '.' + record.index : String(record.index);
  return ('  ' + pad(position, 7) + pad(record.external_product_id || '(none)', 16)
    + pad(record.outcome, 11) + pad(price, 14) + pad(title, 40)).trimEnd();
}

/** How the source was read, and the policy the run was allowed to use while reading it. */
function transportLine(transport, scenario) {
  const entry = transport || {};
  if (entry.kind !== 'http') return 'file · scenario "' + scenario + '"';
  const parts = [(entry.scheme || 'https') + '://' + (entry.host || '?') + (entry.port ? ':' + entry.port : '') + (entry.path || '')];
  if (Array.isArray(entry.allowed_hosts)) parts.push('allowed hosts: ' + entry.allowed_hosts.join(', '));
  if (entry.allow_private_hosts) parts.push('private hosts allowed (stand-in)');
  if (entry.allow_insecure_http) parts.push('http allowed (stand-in)');
  if (entry.credential_sent) parts.push('credential sent');
  return 'http · ' + parts.join('  ·  ');
}

/** The run's own identity: which execution this report describes, and how long it took. */
function runMetadataLines(context) {
  if (!context || !context.id) return [];
  const lines = [];
  lines.push('  ' + pad('run id', 14) + context.id + '  [' + context.status + ']');
  lines.push('  ' + pad('started', 14) + context.started_at
    + (context.duration_ms === null || context.duration_ms === undefined
      ? '' : '  ·  ' + context.duration_ms + ' ms')
    + '  ·  node ' + context.node
    + '  ·  ' + (context.repeat === 1 ? '1 pass' : context.repeat + ' passes'));
  return lines;
}

/** The counters this execution accumulated, in the two groups a reader needs them in. */
function totalsLines(context) {
  if (!context || !context.counters) return [];
  const count = (value) => (value === null || value === undefined ? 'n/a' : String(value));
  const transport = context.counters.transport || {};
  const records = context.counters.records || {};
  const lines = [];
  lines.push(context.passes > 1 ? 'totals across ' + context.passes + ' passes' : 'totals');
  lines.push('  ' + pad('transport', 12) + 'pages ' + count(transport.pages)
    + ' · requests ' + count(transport.requests) + ' · bytes ' + count(transport.bytes));
  lines.push('  ' + pad('records', 12) + 'fetched ' + count(records.fetched)
    + ' · batches ' + count(records.batches) + ' · valid ' + count(records.valid)
    + ' · imported ' + count(records.imported) + ' · updated ' + count(records.updated)
    + ' · unchanged ' + count(records.unchanged) + ' · duplicate ' + count(records.duplicate)
    + ' · rejected ' + count(records.rejected));
  return lines;
}

/**
 * What the normalization boundary (17C-F) adjusted before validation, and by
 * which rule. It is printed only when something was adjusted: a run over
 * already-canonical adapter output says nothing here, which is the point.
 */
function normalizationLines(context) {
  const entry = context && context.normalization;
  if (!entry || !entry.records) return [];
  const rules = Object.keys(entry.rules).sort()
    .map((rule) => rule + ' ' + entry.rules[rule]).join(' · ');
  return ['  ' + pad('normalized', 12) + entry.records + ' record(s) adjusted before validation'
    + (rules ? ' · ' + rules : '')];
}

/**
 * What the identity foundation (17C-G) found: how many records carry an identity,
 * how many carry none, and how many repeat one or leave something uncertain. It is
 * printed only when there is something to resolve — a source with nothing to say
 * about identity says nothing here.
 */
function identityLines(context) {
  const entry = context && context.identity;
  if (!entry || entry.duplicates + entry.uncertain === 0) return [];
  const parts = [entry.identified + ' record(s) identified'];
  if (entry.unidentified > 0) parts.push(entry.unidentified + ' unidentified');
  if (entry.duplicates > 0) parts.push(entry.duplicates + ' duplicate key(s)');
  if (entry.uncertain > 0) parts.push(entry.uncertain + ' uncertain');
  return ['  ' + pad('identity', 12) + parts.join(' · ')];
}

/** An empty source or a ceiling that stopped the read is a fact, not something to hide. */
function warningLines(context) {
  const warnings = (context && context.warnings) || [];
  if (warnings.length === 0) return [];
  const lines = ['warnings (' + warnings.length + ')'];
  for (const entry of warnings) lines.push('  ' + pad(entry.code, 20) + entry.message);
  return lines;
}

/** What was refused, where, by whom, and — when the database refused it — with which SQLSTATE. */
function errorLines(context) {
  const errors = (context && context.errors) || [];
  if (errors.length === 0) return [];
  const lines = ['errors (' + errors.length + ')'];
  for (const entry of errors) {
    const details = entry.details || {};
    const where = details.batch === undefined ? '' : details.batch + '.' + details.index;
    lines.push('  ' + pad(where, 7) + pad(entry.code, 22) + pad(details.external_product_id || '', 16)
      + entry.message + (details.sqlstate ? '  [sqlstate ' + details.sqlstate + ']' : ''));
  }
  return lines;
}

function formatRun(model) {
  const commit = model.mode === 'commit';
  const lines = [];
  lines.push('PickVanta connector runner — ' + (commit ? 'commit' : 'dry run'));
  lines.push(commit
    ? 'Every outcome below is the ingest boundary\'s own answer, carried by the job named here.'
    : 'No database is contacted and nothing is written by this command.');
  lines.push(rule());
  for (const line of runMetadataLines(model.context)) lines.push(line);
  lines.push('  ' + pad('source', 14) + model.source.name + '  (' + model.source.provider_name + ')');
  lines.push('  ' + pad('source id', 14) + model.source.id + '  [' + model.source.source_type + ', ' + model.source.status + ']');
  lines.push('  ' + pad('adapter', 14) + model.adapter.name + '@' + model.adapter.version + '  (' + model.adapter.method + ')');
  lines.push('  ' + pad('transport', 14) + transportLine(model.transport, model.scenario));
  lines.push('  ' + pad('job', 14) + model.job.id + (commit
    ? '  (created by import_job_start, closed by import_job_finish)'
    : '  (simulated locally; --commit creates the real row through import_job_start)'));
  lines.push(rule());

  for (const run of model.runs) {
    lines.push('run ' + run.run_number + (run.run_number > 1 ? ' (re-import)' : '')
      + ' — ' + run.summary.fetched + ' record(s) fetched from ' + run.transport.pages + ' page(s), '
      + run.ms + ' ms'
      + (run.transport.requests === null || run.transport.requests === undefined
        ? '' : ' · ' + run.transport.requests + ' request(s)')
      + (run.transport.bytes === null || run.transport.bytes === undefined
        ? '' : ' · ' + run.transport.bytes + ' bytes')
      + (run.transport.simulated ? '  [simulated ' + run.transport.simulated + ']' : ''));
    const showBatch = run.summary.batches > 1;
    lines.push(('  ' + pad('#', 7) + pad('external id', 16) + pad('outcome', 11) + pad('price', 14) + 'title').trimEnd());
    for (const record of run.records) lines.push(outcomeLine(record, showBatch));
    for (const record of run.records) {
      for (const error of record.errors) {
        const position = showBatch ? record.batch + '.' + record.index : String(record.index);
        lines.push('      ' + position + ' rejected: ' + error.field + ' — ' + error.reason);
      }
    }
    if (commit) {
      lines.push('  received    ' + run.summary.fetched + ' record(s) from the source');
      lines.push('  boundary    '
        + 'imported ' + run.summary.imported + ' · updated ' + run.summary.updated
        + ' · unchanged ' + run.summary.unchanged + ' · skipped ' + run.summary.skipped
        + ' · rejected ' + run.summary.rejected + '   (counts reported by import_ingest)');
      if (run.summary.duplicate > 0) {
        lines.push('  payload     the same product is listed more than once in this payload ('
          + run.summary.duplicate + '); the boundary stores one record per identity');
      }
    } else {
      lines.push('  simulated   '
        + 'imported ' + run.summary.imported + ' · updated ' + run.summary.updated
        + ' · unchanged ' + run.summary.unchanged + ' · duplicate ' + run.summary.duplicate
        + ' · rejected ' + run.summary.rejected);
    }
    lines.push('  validation  ' + run.summary.valid + ' of ' + run.summary.records
      + ' record(s) satisfy the 17C-A ingest contract');
    lines.push('');
  }

  if (model.runs.length > 1) {
    const last = model.runs[model.runs.length - 1];
    lines.push('re-import comparison');
    lines.push('  ' + pad('identities seen', 22) + model.runs[0].summary.fetched);
    lines.push('  ' + pad('unchanged', 22) + last.summary.unchanged);
    lines.push('  ' + pad('updated', 22) + last.summary.updated);
    lines.push('  ' + pad('imported again', 22) + last.summary.imported);
    lines.push('  ' + pad('duplicates in batch', 22) + last.summary.duplicate);
    lines.push('');
  }

  const totals = model.runs.reduce((accumulator, run) => {
    accumulator.rejected += run.summary.rejected;
    accumulator.duplicate += run.summary.duplicate;
    accumulator.valid += run.summary.valid;
    return accumulator;
  }, { rejected: 0, duplicate: 0, valid: 0 });

  const disagreements = commit ? model.boundary.disagreements : [];
  if (disagreements.length > 0) {
    lines.push('boundary disagreements — the local contract and the database decided differently, which means they have drifted apart');
    for (const entry of disagreements) {
      lines.push('  ' + pad(entry.batch + '.' + entry.index, 8) + pad(entry.external_product_id || '(none)', 16)
        + 'local ' + pad(entry.local, 10) + 'boundary ' + entry.boundary);
    }
    lines.push('');
  }

  const context = model.context || null;
  for (const line of totalsLines(context)) lines.push(line);
  for (const line of normalizationLines(context)) lines.push(line);
  for (const line of identityLines(context)) lines.push(line);
  lines.push('');
  const warningReport = warningLines(context);
  if (warningReport.length > 0) {
    for (const line of warningReport) lines.push(line);
    lines.push('');
  }
  const errorReport = errorLines(context);
  if (errorReport.length > 0) {
    for (const line of errorReport) lines.push(line);
    lines.push('');
  }

  if (totals.rejected === 0 && totals.duplicate === 0 && disagreements.length === 0) {
    lines.push('result   OK — ' + totals.valid + ' record(s) valid across ' + model.runs.length
      + ' run(s); nothing rejected, no duplicates');
  } else {
    lines.push('result   ATTENTION — ' + totals.valid + ' record(s) valid · ' + totals.rejected
      + ' rejected · ' + totals.duplicate + ' duplicate(s) in a payload'
      + (disagreements.length > 0 ? ' · ' + disagreements.length + ' disagreement(s)' : '')
      + '; see the lines above');
  }

  if (commit) {
    lines.push('written    job ' + model.job.id + ' closed as "' + model.job.status + '"'
      + ' · progress ' + model.job.progress + '/100 · accepted records are in imported_deals');
  } else {
    lines.push('nothing was written: this was a dry run, and the database was never contacted');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * A failure has to be as honest about the database as a success is.
 *
 *   dry run            nothing was contacted, so nothing can have been written;
 *   commit, no job     the boundary was never asked to write;
 *   commit, job open   some records may already be stored, and the job row says
 *                      what happened — including when it could not be closed,
 *                      which is the one case a person has to finish by hand.
 */
function formatFailure(error, context) {
  const state = context || { mode: 'dry-run', jobId: null, jobClosed: false };
  const lines = [];
  lines.push('run failed — ' + error.name + ' (' + (error.kind || 'unknown') + ')');
  lines.push('  ' + error.message);
  if (error.detail && error.detail.status) lines.push('  http status: ' + error.detail.status);
  lines.push('');
  if (state.mode !== 'commit') {
    lines.push('nothing was written: this was a dry run, and the database was never contacted');
  } else if (!state.jobId) {
    lines.push('nothing was written: no job was started, so the database was never asked to write');
  } else if (state.jobClosed) {
    lines.push('the run had started: job ' + state.jobId + ' was closed as "failed".'
      + ' Records the boundary accepted before that are in imported_deals and are not removed by this failure.');
  } else {
    lines.push('the run had started: job ' + state.jobId + ' is still listed as running, because closing it failed too.'
      + ' Check that job before starting another run for this source.');
  }

  /* The debugging context: which execution failed, in which phase, reading what,
     and what the process already counted when it stopped. A failure should be
     diagnosable from the output alone. */
  if (state.id) {
    const debug = [];
    debug.push('  ' + pad('run id', 12) + state.id + '  [' + state.status + ']');
    debug.push('  ' + pad('phase', 12) + state.phase);
    debug.push('  ' + pad('mode', 12) + (state.mode === 'commit' ? 'commit' : 'dry run'));
    if (state.source) {
      debug.push('  ' + pad('source', 12) + state.source.id + '  (' + state.source.name
        + (state.source.status ? ', ' + state.source.status : '') + ')');
    }
    if (state.scenario !== null && state.scenario !== undefined) {
      debug.push('  ' + pad('scenario', 12) + state.scenario);
    }
    if (state.transport && state.transport.kind === 'http') {
      debug.push('  ' + pad('transport', 12) + transportLine(state.transport, state.scenario));
    }
    if (state.started_ms) {
      debug.push('  ' + pad('elapsed', 12) + (Date.now() - state.started_ms) + ' ms');
    }
    if (error.detail) {
      const detail = Object.keys(error.detail)
        .map((key) => key + ': ' + JSON.stringify(error.detail[key])).join(' · ');
      if (detail) debug.push('  ' + pad('detail', 12) + detail);
    }
    if (state.counters) {
      const shown = (value) => (value === null || value === undefined ? 'n/a' : String(value));
      debug.push('  ' + pad('so far', 12) + 'pages ' + shown(state.counters.transport.pages)
        + ' · requests ' + shown(state.counters.transport.requests)
        + ' · records fetched ' + shown(state.counters.records.fetched)
        + ' · imported ' + shown(state.counters.records.imported)
        + ' · rejected ' + shown(state.counters.records.rejected));
    }
    lines.push('');
    lines.push('debug');
    for (const line of debug) lines.push(line);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  formatUsage: formatUsage,
  formatCheckEnv: formatCheckEnv,
  formatRun: formatRun,
  formatFailure: formatFailure,
  pad: pad
};
