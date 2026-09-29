'use strict';

/**
 * Which transport a source is read through.
 *
 * A source declares it in its manifest:
 *   "transport": "file"  (or absent) — the fixture transport: scenarios under
 *                        the source directory, used by the tests and by a
 *                        rehearsal against saved responses;
 *   "transport": "http"  — the network: the source's `endpoint_url`, read under
 *                        the host policy in its `config` (see lib/transport/http.js).
 *
 * The choice is the manifest's, never the adapter's and never the data's: an
 * adapter maps whatever text it is handed, and nothing in a response can move a
 * run from one transport to the other. A fixture source in 17C-B/C that says
 * nothing keeps the file transport exactly as it was.
 */

const { SourceError } = require('../errors');
const fileTransport = require('./file');
const httpTransport = require('./http');

const TRANSPORTS = ['file', 'http'];

function transportKindOf(source) {
  const declared = source && source.transport !== undefined && source.transport !== null
    ? String(source.transport).trim().toLowerCase()
    : 'file';
  if (!TRANSPORTS.includes(declared)) {
    throw new SourceError('unknown-transport',
      'transport "' + declared + '" is not one this build has: ' + TRANSPORTS.join(', '));
  }
  return declared;
}

/**
 * The transport-side requirements of a source manifest, as a list of problems —
 * empty when the manifest is usable. The runner reports these the same way it
 * reports its other source problems: before anything is fetched, and before a
 * job is ever opened.
 *
 * A fixture source (the default) has none of them, so nothing about 17C-B/C
 * changes by this existing.
 */
function sourceProblems(source) {
  const problems = [];
  let declared = 'file';
  if (source && source.transport !== undefined && source.transport !== null) {
    declared = String(source.transport).trim().toLowerCase();
  }
  if (!TRANSPORTS.includes(declared)) {
    problems.push('transport must be one of ' + TRANSPORTS.join(', '));
    return problems;
  }
  if (declared === 'file') return problems;

  if (typeof source.endpoint_url !== 'string' || source.endpoint_url.trim() === '') {
    problems.push('endpoint_url is required for an http source');
    return problems;
  }
  try {
    const policy = httpTransport.buildPolicy(source, (source && source.config) || {});
    httpTransport.checkUrl(source.endpoint_url, policy, null);
  } catch (error) {
    problems.push(error.message);
  }
  return problems;
}

/**
 * @param {object} options
 * @param {object} options.source       the manifest
 * @param {string} options.sourceDir    the source directory (file transport)
 * @param {string} options.scenario     which scenario (file transport)
 * @param {object} options.config       the effective configuration
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.manifest]   the scenario manifest (file transport)
 * @param {string} [options.credential] the source's credential, already read from the environment
 * @param {function} [options.fetchImpl]
 */
async function openTransport(options) {
  const kind = transportKindOf(options.source);
  if (kind === 'http') {
    return httpTransport.openHttpTransport({
      source: options.source,
      config: options.config,
      signal: options.signal,
      credential: options.credential,
      fetchImpl: options.fetchImpl
    });
  }
  return fileTransport.openFileTransport({
    sourceDir: options.sourceDir,
    scenario: options.scenario,
    config: options.config,
    signal: options.signal,
    manifest: options.manifest
  });
}

module.exports = {
  TRANSPORTS: TRANSPORTS,
  transportKindOf: transportKindOf,
  sourceProblems: sourceProblems,
  openTransport: openTransport
};
