'use strict';

/**
 * The write path — Step 17C-C.
 *
 * This is the connector's only network capability, and it is deliberately one
 * small thing: three PostgREST RPC calls, by name, from a frozen allowlist.
 *
 * What is deliberately absent:
 *   • no SQL client and no connection string — nothing here speaks to PostgreSQL;
 *   • no table endpoint — every URL this module can build is `/rest/v1/rpc/<one
 *     of three names>`, so a record can never be inserted, updated or deleted
 *     directly, and no policy is bypassed by a clever path;
 *   • no generic "send this somewhere" method — `call()` refuses any name that is
 *     not one of the three, by name, before a URL is built;
 *   • no retry loop — one batch is one RPC call, so a timeout is a visible
 *     failure rather than a quiet second import;
 *   • no printing — this module never writes to stdout, stderr or a file, so the
 *     service key it carries cannot be echoed by it.
 *
 * The three endpoints are the ingest boundary of migration 0011, and the
 * boundary — not this module — is what validates and writes:
 *
 *   import_job_start(job_type, source_id, detail)   opens one run
 *   import_ingest(batch)                            one batch, one transaction
 *   import_job_finish(job_id, status, stats, error, progress)  closes it
 *
 * The key comes from the environment (read in run.js, never here) and is passed
 * in: it is used as a request header and nowhere else.
 */

const { ConnectorError, EnvironmentError } = require('../errors');

/** The whole vocabulary of endpoints. Nothing outside this object is callable. */
const RPC_ENDPOINTS = Object.freeze({
  jobStart: 'import_job_start',
  ingest: 'import_ingest',
  jobFinish: 'import_job_finish'
});

const RPC_PREFIX = '/rest/v1/rpc/';

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_JOB_TYPE = 'feed-import';

function endpointPath(name) {
  const allowed = Object.keys(RPC_ENDPOINTS).map((key) => RPC_ENDPOINTS[key]);
  if (!allowed.includes(name)) {
    throw new ConnectorError('endpoint-refused',
      'this connector may call exactly three endpoints (' + allowed.join(', ')
      + '); "' + name + '" is not one of them');
  }
  return RPC_PREFIX + name;
}

/** A stable, secret-free description of where a call went: the path, never the host. */
function endpointLabel(name) {
  return name;
}

/**
 * The URL is checked once, when the client is built, and again nowhere: a run
 * that cannot be made safely must fail before the first call rather than at the
 * third batch. What comes back is an origin and a path — no query, no fragment,
 * nothing a caller could smuggle into a request.
 */
function resolveBase(baseUrl) {
  let parsed;
  try {
    parsed = new URL(String(baseUrl).trim());
  } catch (error) {
    throw new EnvironmentError('bad-url', 'the runner URL is not a URL: ' + String(baseUrl).slice(0, 40));
  }
  if (parsed.protocol !== 'https:') {
    throw new EnvironmentError('bad-url',
      'the runner URL must be https: this process carries a service-role key and will not send it in clear text');
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new EnvironmentError('bad-url', 'the runner URL must not carry a query or a fragment');
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

/**
 * A PostgREST failure carries the database's own message, code and hint. Taking
 * them from the body (and never from the request) is what lets a refusal be
 * reported as `permission denied for function import_ingest` rather than as a
 * bare status code.
 */
function failureFromBody(body) {
  if (body === null || typeof body !== 'object') return null;
  const parts = [];
  for (const key of ['message', 'details', 'hint']) {
    if (typeof body[key] === 'string' && body[key].trim() !== '') parts.push(body[key].trim());
  }
  const text = parts.join(' — ');
  return {
    text: text === '' ? null : text,
    code: typeof body.code === 'string' ? body.code : null
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function countOf(container, key) {
  const value = container[key];
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * @param {object} options
 * @param {string} options.url         the project URL (environment only)
 * @param {string} options.serviceKey  the service-role key (environment only)
 * @param {function} [options.fetchImpl] injectable for tests; defaults to global fetch
 * @param {number} [options.timeoutMs] per-call budget
 */
function createIngestClient(options) {
  const settings = options || {};
  const url = String(settings.url || '').trim();
  const serviceKey = String(settings.serviceKey || '').trim();
  const fetchImpl = settings.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
  const timeoutMs = Number.isFinite(settings.timeoutMs) && settings.timeoutMs >= 50
    ? Math.floor(settings.timeoutMs)
    : DEFAULT_TIMEOUT_MS;

  if (url === '') throw new EnvironmentError('missing-url', 'the runner URL is not set; a write run is refused rather than attempted blind');
  if (serviceKey === '') throw new EnvironmentError('missing-key', 'the service-role key is not set; a write run is refused rather than attempted unauthenticated');
  if (fetchImpl === null) throw new EnvironmentError('no-fetch', 'this Node build has no global fetch, and the connector brings no HTTP dependency of its own');
  const base = resolveBase(url);

  async function call(name, payload) {
    const target = base + endpointPath(name);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new ConnectorError('rpc-timeout',
        'no answer from the database within ' + timeoutMs + ' ms while calling ' + endpointLabel(name)));
    }, timeoutMs);

    try {
      let response;
      try {
        response = await fetchImpl(target, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            apikey: serviceKey,
            authorization: 'Bearer ' + serviceKey
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ConnectorError('rpc-timeout',
            'no answer from the database within ' + timeoutMs + ' ms while calling ' + endpointLabel(name));
        }
        throw new ConnectorError('rpc-unreachable',
          'the database could not be reached while calling ' + endpointLabel(name) + ': '
            + (error && error.message ? error.message : String(error)));
      }

      let text;
      try {
        text = await response.text();
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ConnectorError('rpc-timeout',
            'the answer to ' + endpointLabel(name) + ' did not arrive within ' + timeoutMs + ' ms');
        }
        throw new ConnectorError('rpc-unreadable',
          'the answer to ' + endpointLabel(name) + ' could not be read: '
            + (error && error.message ? error.message : String(error)));
      }

      let body = null;
      if (text.trim() !== '') {
        try {
          body = JSON.parse(text);
        } catch (error) {
          body = null;
        }
      }

      if (!response.ok) {
        const failure = failureFromBody(body);
        throw new ConnectorError('rpc-refused',
          'the database refused ' + endpointLabel(name) + ' (HTTP ' + response.status + ')'
            + (failure && failure.text ? ': ' + failure.text : ''),
          { status: response.status, code: failure ? failure.code : null });
      }

      if (body === null) {
        throw new ConnectorError('rpc-unreadable',
          'the answer to ' + endpointLabel(name) + ' was not JSON; nothing was assumed from it');
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Opens one run. The boundary decides: an unknown type, a missing source, a paused source or a second running run all fail here. */
  async function jobStart(sourceId, detail) {
    const answer = await call(RPC_ENDPOINTS.jobStart, {
      p_job_type: settings.jobType || DEFAULT_JOB_TYPE,
      p_source_id: sourceId,
      p_detail: typeof detail === 'string' ? detail : ''
    });
    if (!isPlainObject(answer) || typeof answer.job_id !== 'string' || answer.job_id === '') {
      throw new ConnectorError('rpc-shape', 'import_job_start answered without a job_id, so there is no run to attach records to');
    }
    if (answer.status !== 'running') {
      throw new ConnectorError('rpc-shape',
        'import_job_start answered with status "' + String(answer.status) + '"; a new run must be "running"');
    }
    return answer;
  }

  /**
   * Sends one batch. The answer is checked against the batch that was sent: a
   * result list of the wrong length, or an answer about a different job, is a
   * shape this connector will not report as if it were a real outcome.
   */
  async function ingest(batch) {
    const answer = await call(RPC_ENDPOINTS.ingest, { p_batch: batch });
    const sent = Array.isArray(batch && batch.records) ? batch.records.length : null;
    const problems = [];
    if (!isPlainObject(answer)) problems.push('the answer is not an object');
    else {
      if (!Array.isArray(answer.results)) problems.push('it has no results array');
      else if (sent !== null && answer.results.length !== sent) {
        problems.push('it reports ' + answer.results.length + ' result(s) for ' + sent + ' record(s)');
      }
      if (typeof answer.job_id !== 'string' || answer.job_id !== batch.job_id) {
        problems.push('it is about job ' + String(answer.job_id) + ', not the job this batch was sent to');
      }
      for (const key of ['received', 'imported', 'updated', 'unchanged', 'skipped', 'rejected']) {
        if (countOf(answer, key) === null) problems.push('it has no usable ' + key + ' count');
      }
    }
    if (problems.length > 0) {
      throw new ConnectorError('rpc-shape',
        'the ingest boundary answered in a shape this connector does not recognise: ' + problems.join('; ')
        + '. The records may still have been stored, so the job must be closed by hand.');
    }
    return answer;
  }

  /** Closes the run. A finished run is not rewritten, so this is called once. */
  async function jobFinish(jobId, status, stats, error, progress) {
    const answer = await call(RPC_ENDPOINTS.jobFinish, {
      p_job_id: jobId,
      p_status: status,
      p_stats: stats === undefined || stats === null ? {} : stats,
      p_error: typeof error === 'string' ? error : '',
      p_progress: progress === undefined || progress === null ? null : progress
    });
    if (!isPlainObject(answer) || answer.status !== status) {
      throw new ConnectorError('rpc-shape',
        'import_job_finish answered with status "' + String(answer && answer.status)
        + '" while "' + status + '" was requested');
    }
    return answer;
  }

  return {
    jobStart: jobStart,
    ingest: ingest,
    jobFinish: jobFinish,
    call: call,
    endpoints: RPC_ENDPOINTS,
    timeoutMs: timeoutMs
  };
}

module.exports = {
  RPC_ENDPOINTS: RPC_ENDPOINTS,
  RPC_PREFIX: RPC_PREFIX,
  DEFAULT_JOB_TYPE: DEFAULT_JOB_TYPE,
  createIngestClient: createIngestClient
};
