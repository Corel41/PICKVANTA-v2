'use strict';

/**
 * The run context — Step 17C-E.
 *
 * One connector execution, described by itself: which run this is, when it
 * started, how it was read, what it counted, and what it warned about or got
 * wrong. It is deliberately small and deliberately local:
 *
 *   • nothing is persisted — a context lives in the process, is printed with the
 *     report, and is gone when the process is. There is no run table, no queue,
 *     no dashboard and no retry state anywhere in this design;
 *   • it has no clock of its own beyond `Date.now()` and an ISO timestamp, so a
 *     test can read it without freezing anything;
 *   • it never holds a credential, an endpoint with userinfo, or a response
 *     body: the fields it can carry are named in `describe()` and nothing else
 *     is copied into it;
 *   • it is written to fail safe. A caller that passes no context (the tests
 *     drive `commitRun` with a plain tracker object) gets no context, and the
 *     runner keeps working exactly as it did before this step.
 *
 * The report and the `--json` result both read `snapshot()`, so a person and a
 * machine see the same facts — the machine one with the details the person's
 * formatter compresses into one line.
 */

const crypto = require('node:crypto');

/**
 * The transport counters a run accumulates: pages read, requests made, bytes
 * received. A fixture transport reports no requests and no bytes, so those two
 * start (and can stay) `null` — "not reported" is a different fact from "zero",
 * and the report says `n/a` rather than inventing a number.
 */
function emptyTransportCounters() {
  return { pages: 0, requests: null, bytes: null };
}

/** The record counters a run accumulates, in the boundary's own vocabulary. */
function emptyRecordCounters() {
  return {
    fetched: 0, batches: 0, valid: 0, imported: 0, updated: 0,
    unchanged: 0, skipped: 0, duplicate: 0, rejected: 0
  };
}

function create(options) {
  const settings = options || {};
  return {
    id: crypto.randomUUID(),
    mode: settings.mode === 'commit' ? 'commit' : 'dry-run',
    scenario: settings.scenario === undefined ? null : settings.scenario,
    repeat: settings.repeat === undefined ? 1 : settings.repeat,
    node: process.version,
    started_at: new Date().toISOString(),
    started_ms: Date.now(),
    finished_at: null,
    duration_ms: null,
    status: 'running',
    phase: 'source',
    passes: 0,
    source: null,
    adapter: null,
    transport: null,
    /* The cancellation handlers and the failure report both read these two, so a
       context can stand in for the tracker they were written against. */
    jobId: null,
    jobClosed: false,
    job: null,
    counters: { transport: emptyTransportCounters(), records: emptyRecordCounters() },
    normalization: { records: 0, rules: {} },
    identity: { records: 0, identified: 0, unidentified: 0, duplicates: 0, uncertain: 0 },
    warnings: [],
    errors: []
  };
}

/**
 * The facts about the run that are known before it reads anything. Only these
 * fields are copied, so a manifest cannot smuggle an unlisted value into the
 * report, and a credential (which is never a field of a source row) cannot
 * arrive here at all.
 */
function describe(context, patch) {
  if (!context || !patch) return context;
  if (patch.source) {
    const source = patch.source;
    context.source = {
      id: source.id,
      name: source.name || '',
      provider_name: source.provider_name || '',
      source_type: source.source_type || '',
      status: source.status || '',
      market_country: source.market_country || ''
    };
  }
  if (patch.adapter) {
    context.adapter = {
      name: patch.adapter.name,
      version: patch.adapter.version,
      method: patch.adapter.method
    };
  }
  if (patch.transport) {
    const entry = patch.transport;
    context.transport = {
      kind: entry.kind || 'file',
      scheme: entry.scheme || null,
      host: entry.host || null,
      port: entry.port || '',
      path: entry.path || null,
      allowed_hosts: Array.isArray(entry.allowed_hosts) ? entry.allowed_hosts.slice() : null,
      allow_private_hosts: entry.allow_private_hosts === true,
      allow_insecure_http: entry.allow_insecure_http === true,
      credential_sent: entry.credential_sent === true
    };
    /* A credential over a scheme the transport had to be told to allow is worth
       saying out loud: it is the one combination an operator did not intend. */
    if (context.transport.credential_sent && (context.transport.scheme === 'http'
      || context.transport.allow_insecure_http)) {
      warn(context, 'credential-over-http',
        'the source credential was sent over an insecure scheme, because this manifest allows one');
    }
  }
  if (patch.scenario !== undefined) context.scenario = patch.scenario;
  if (patch.phase) context.phase = patch.phase;
  return context;
}

/**
 * The normalization boundary's own tally (17C-F): how many records it adjusted
 * before validation, and which rule adjusted them. It counts the *canonical
 * form* work only — a record the boundary declined to repair is a validation
 * error, not a normalization result, and appears in `errors` instead.
 */
function noteNormalization(context, changeSets) {
  if (!context) return context;
  if (!context.normalization) context.normalization = { records: 0, rules: {} };
  for (const changes of changeSets || []) {
    if (!Array.isArray(changes) || changes.length === 0) continue;
    context.normalization.records += 1;
    for (const entry of changes) {
      const rule = entry && entry.rule ? entry.rule : 'unknown';
      context.normalization.rules[rule] = (context.normalization.rules[rule] || 0) + 1;
    }
  }
  return context;
}

/**
 * A warning is something a person should know but that does not make the run
 * wrong: an empty source, a page ceiling that stopped the read, a credential
 * sent in the clear. Identical warnings are recorded once, because a re-import
 * of an empty source is one problem, not three.
 */
function warn(context, code, message, details) {
  if (!context || !Array.isArray(context.warnings)) return null;
  const entry = { code: code, message: message };
  if (details) entry.details = details;
  const duplicate = context.warnings.some((existing) => existing.code === code && existing.message === message);
  if (!duplicate) context.warnings.push(entry);
  return entry;
}

/**
 * An error is a record the run refused, a disagreement between the local
 * contract and the boundary, or the failure that ended the run. It carries the
 * phase it happened in and whatever the source, the batch and the database said
 * about it, because that is what makes a failure debuggable from the output
 * alone instead of by re-running it under a debugger.
 */
function error(context, phase, code, message, details) {
  if (!context || !Array.isArray(context.errors)) return null;
  const entry = { phase: phase, code: code, message: message };
  if (details) entry.details = details;
  context.errors.push(entry);
  return entry;
}

/**
 * Folds one pass into the context, and raises the warnings and errors that pass
 * implies. This is the only place that counts anything, so the counters can
 * never disagree with the per-pass numbers the report prints next to them.
 */
function observe(context, run) {
  if (!context || !run) return context;

  const where = 'run ' + run.run_number;

  const transport = run.transport || {};
  const summary = run.summary || {};
  if (!context.counters) context.counters = { transport: emptyTransportCounters(), records: emptyRecordCounters() };
  const counters = context.counters;

  counters.transport.pages += Number(transport.pages) || 0;
  if (typeof transport.requests === 'number') {
    counters.transport.requests = (counters.transport.requests || 0) + transport.requests;
  }
  if (typeof transport.bytes === 'number') {
    counters.transport.bytes = (counters.transport.bytes || 0) + transport.bytes;
  }

  const records = counters.records;
  for (const key of Object.keys(records)) {
    records[key] += Number(summary[key]) || 0;
  }
  context.passes = (Number(context.passes) || 0) + 1;

  /* The identity foundation's facts (17C-G): what it identified, and every
     collision or uncertainty it found. Uncertainty is the point — a person has to
     see it before anything is reviewed, and nothing here merges anything. */
  const identityReport = run.identity || {};
  const identitySummary = identityReport.summary || null;
  if (identitySummary) {
    if (!context.identity) context.identity = { records: 0, identified: 0, unidentified: 0, duplicates: 0, uncertain: 0 };
    context.identity.records += Number(identitySummary.records) || 0;
    context.identity.identified += Number(identitySummary.identified) || 0;
    context.identity.unidentified += Number(identitySummary.unidentified) || 0;
    context.identity.duplicates += Number(identitySummary.duplicates) || 0;
    context.identity.uncertain += (Number(identitySummary.same_page_conflicts) || 0)
      + (Number(identitySummary.merchant_conflicts) || 0)
      + (Number(identitySummary.cross_source_candidates) || 0);
  }
  for (const collision of identityReport.collisions || []) {
    const positions = (collision.records || []).slice(0, 6)
      .map((entry) => entry.batch + '.' + entry.index).join(', ');
    if (collision.kind === 'duplicate-identity') {
      warn(context, 'duplicate-identity',
        where + ': ' + (collision.records || []).length + ' record(s) state one identity (' + (collision.key || '')
        + '); the boundary keeps one row per identity and refreshes it — positions ' + positions);
    } else if (collision.kind === 'same-page-different-ids') {
      warn(context, 'same-page-different-ids',
        where + ': two identifiers point at one page (' + (collision.key || '') + ') — positions ' + positions);
    } else if (collision.kind === 'merchant-conflict') {
      warn(context, 'merchant-conflict',
        where + ': one identity appears under ' + (collision.merchant_refs || []).length
        + ' merchant references (' + (collision.merchant_refs || []).join(', ') + ') — positions ' + positions);
    } else if (collision.kind === 'cross-source-candidate') {
      warn(context, 'cross-source-candidate',
        where + ': ' + (collision.sources || []).length + ' sources share the same ' + (collision.candidate || 'value')
        + ' (' + (collision.key || '') + '); this is a question for a person, not a merge — positions ' + positions);
    }
  }

  if (records.fetched === 0) {
    warn(context, 'empty-source',
      where + ': the source returned no records, so this run has nothing to map', { run: run.run_number });
  }
  if (run.source_meta && run.source_meta.truncated) {
    warn(context, 'page-ceiling',
      where + ': the read stopped at the adapter\'s page ceiling, so the source may hold more records',
      { run: run.run_number, per_page: run.source_meta.per_page });
  }

  /* A refused record is an error with context: which pass, which batch, which
     position, which identity, which field, and — when the database was the one
     that refused it — the SQLSTATE it refused with. A refusal with no SQLSTATE
     came from the contract, applied either here (a dry run) or by the boundary
     (a commit run). */
  for (const record of run.records || []) {
    for (const refusal of record.errors || []) {
      error(context, 'records', refusal.sqlstate ? 'boundary-refused' : 'contract-refused',
        refusal.field + ' — ' + refusal.reason, {
          run: run.run_number,
          batch: record.batch,
          index: record.index,
          external_product_id: record.external_product_id || '',
          field: refusal.field,
          reason: refusal.reason,
          sqlstate: refusal.sqlstate || null
        });
    }
  }
  return context;
}

/** A disagreement between the local contract and the boundary, which means the two have drifted. */
function disagree(context, entry) {
  return error(context, 'boundary', 'boundary-disagreement',
    (entry.external_product_id || '(none)') + ': the local contract said ' + entry.local
    + ', the boundary said ' + entry.boundary, entry);
}

/**
 * Closes the context: the clock stops, the job's own words are copied in, and
 * the run gets a status a reader can trust — `completed` only when the model was
 * built, `failed` when the run ended in a throw.
 */
function finish(context, status, model, failure) {
  if (!context) return null;
  context.finished_at = new Date().toISOString();
  context.duration_ms = Date.now() - context.started_ms;
  context.status = status || 'completed';
  if (model && model.job) {
    context.job = {
      id: model.job.id,
      simulated: model.job.simulated === true,
      status: model.job.status === undefined ? null : model.job.status,
      progress: model.job.progress === undefined ? null : model.job.progress
    };
  }
  if (failure) error(context, context.phase, failure.kind || 'unknown', failure.message || String(failure));
  return snapshot(context);
}

/** The plain, printable, serialisable form. Everything the report and the JSON result need. */
function snapshot(context) {
  if (!context) return null;
  return {
    id: context.id,
    mode: context.mode,
    scenario: context.scenario,
    repeat: context.repeat,
    node: context.node,
    started_at: context.started_at,
    finished_at: context.finished_at,
    duration_ms: context.duration_ms,
    status: context.status,
    phase: context.phase,
    passes: context.passes,
    source: context.source,
    adapter: context.adapter,
    transport: context.transport,
    job: context.job,
    counters: {
      transport: Object.assign({}, context.counters.transport),
      records: Object.assign({}, context.counters.records)
    },
    normalization: {
      records: context.normalization ? context.normalization.records : 0,
      rules: Object.assign({}, (context.normalization && context.normalization.rules) || {})
    },
    identity: Object.assign({ records: 0, identified: 0, unidentified: 0, duplicates: 0, uncertain: 0 },
      context.identity || {}),
    warnings: context.warnings.map((entry) => Object.assign({}, entry)),
    errors: context.errors.map((entry) => Object.assign({}, entry))
  };
}

module.exports = {
  create: create,
  describe: describe,
  warn: warn,
  error: error,
  observe: observe,
  noteNormalization: noteNormalization,
  disagree: disagree,
  finish: finish,
  snapshot: snapshot
};
