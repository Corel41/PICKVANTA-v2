'use strict';

/**
 * Human-readable and machine-readable reporting.
 *
 * A run report states what was fetched, what was mapped, what the contract
 * accepted or refused, and what the ingest boundary *would* have done — with the
 * words "simulated" and "no database" wherever that distinction matters, so a
 * reader never mistakes a dry run for a write.
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
  lines.push('PickVanta connector runner — Step 17C-B (dry run only)');
  lines.push('');
  lines.push('Usage:');
  lines.push('  node connectors/run.js --source <dir> --dry-run [options]');
  lines.push('  node connectors/run.js --check-env');
  lines.push('');
  lines.push('Modes:');
  lines.push('  --dry-run            fetch, map, validate and report. Nothing is written.');
  lines.push('  --commit             refused in this build: the database write path arrives in 17C-C.');
  lines.push('  --check-env          report environment readiness (secrets) and exit.');
  lines.push('');
  lines.push('Options:');
  lines.push('  --source <dir>       the fixture source directory (contains source.json and scenarios/).');
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
    lines.push('ready: a 17C-C write run could start with this environment.');
  } else {
    lines.push('not ready:');
    for (const problem of preflight.problems) lines.push('  - ' + problem);
  }
  lines.push('');
  lines.push('No secret is printed by this command, and 17C-B never uses one.');
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

function formatRun(model) {
  const lines = [];
  lines.push('PickVanta connector runner — 17C-B dry run');
  lines.push('No database is contacted and nothing is written by this command.');
  lines.push(rule());
  lines.push('  ' + pad('source', 14) + model.source.name + '  (' + model.source.provider_name + ')');
  lines.push('  ' + pad('source id', 14) + model.source.id + '  [' + model.source.source_type + ', ' + model.source.status + ']');
  lines.push('  ' + pad('adapter', 14) + model.adapter.name + '@' + model.adapter.version + '  (' + model.adapter.method + ')');
  lines.push('  ' + pad('transport', 14) + 'file · scenario "' + model.scenario + '"');
  lines.push('  ' + pad('job', 14) + model.job.id + '  (simulated locally; import_job_start creates the real row in 17C-C)');
  lines.push(rule());

  for (const run of model.runs) {
    lines.push('run ' + run.run_number + (run.run_number > 1 ? ' (re-import)' : '')
      + ' — ' + run.summary.fetched + ' record(s) fetched from ' + run.transport.pages + ' page(s), '
      + run.ms + ' ms' + (run.transport.simulated ? '  [simulated ' + run.transport.simulated + ']' : ''));
    const showBatch = run.summary.batches > 1;
    lines.push(('  ' + pad('#', 7) + pad('external id', 16) + pad('outcome', 11) + pad('price', 14) + 'title').trimEnd());
    for (const record of run.records) lines.push(outcomeLine(record, showBatch));
    for (const record of run.records) {
      for (const error of record.errors) {
        const position = showBatch ? record.batch + '.' + record.index : String(record.index);
        lines.push('      ' + position + ' rejected: ' + error.field + ' — ' + error.reason);
      }
    }
    lines.push('  simulated   '
      + 'imported ' + run.summary.imported + ' · updated ' + run.summary.updated
      + ' · unchanged ' + run.summary.unchanged + ' · duplicate ' + run.summary.duplicate
      + ' · rejected ' + run.summary.rejected);
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

  if (totals.rejected === 0 && totals.duplicate === 0) {
    lines.push('result   OK — ' + totals.valid + ' record(s) valid across ' + model.runs.length
      + ' run(s); nothing rejected, no duplicates');
  } else {
    lines.push('result   ATTENTION — ' + totals.valid + ' record(s) valid · ' + totals.rejected
      + ' rejected · ' + totals.duplicate + ' duplicate(s); see the lines above');
  }
  lines.push('nothing was written: this build has no database code path');
  lines.push('');
  return lines.join('\n');
}

function formatFailure(error) {
  const lines = [];
  lines.push('run failed — ' + error.name + ' (' + (error.kind || 'unknown') + ')');
  lines.push('  ' + error.message);
  if (error.detail && error.detail.status) lines.push('  http status: ' + error.detail.status);
  lines.push('');
  lines.push('nothing was written: this build has no database code path');
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
