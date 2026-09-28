'use strict';

/**
 * The file transport — the fixture source's stand-in for the network.
 *
 * A transport's whole job is to produce raw response text for a page number and
 * to fail honestly when it cannot. It knows nothing about products, mapping or
 * PickVanta: a real merchant source in 17C-D will use an HTTP transport with the
 * same interface (`readTextPage(pageNumber)` -> string | null, plus the request
 * signal and timeout the runner already applies here).
 *
 * Failure simulation, so the runner's error paths are exercised without a
 * network and without a dependency:
 *   scenarios/<name>/scenario.json
 *     { "simulate": { "failure": "timeout", "hang_ms": 400 },
 *       "config":   { "timeout_ms": 120 } }
 *     { "simulate": { "failure": "http", "status": 503, "body": "…" } }
 *
 * Nothing here writes, and there is no HTTP client in this build: the module
 * names it would need are not even imported (connectors/test/boundary.test.js
 * checks that).
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const { TransportError, SourceError } = require('../errors');

/** An abortable wait, so a simulated hang honours the runner's real timeout. */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(signal.reason || new TransportError('timeout', 'the request was aborted'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason || new TransportError('timeout', 'the request was aborted'));
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function readScenarioManifest(sourceDir, scenario) {
  return readManifest(path.join(sourceDir, 'scenarios', scenario));
}

async function readManifest(scenarioDir) {
  const file = path.join(scenarioDir, 'scenario.json');
  try {
    const text = await fs.readFile(file, 'utf8');
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new SourceError('bad-scenario', scenarioDir + '/scenario.json is not valid JSON: ' + error.message);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    if (error instanceof SourceError) throw error;
    throw new SourceError('unreadable-scenario', 'could not read ' + file + ': ' + error.message);
  }
}

/**
 * @param {object} options
 * @param {string} options.sourceDir  the fixture source directory
 * @param {string} options.scenario   which scenario directory to read
 * @param {object} options.config     the source configuration (after scenario overrides)
 * @param {AbortSignal} options.signal
 * @returns {{kind: string, readTextPage: function, meta: object}}
 */
async function openFileTransport(options) {
  const scenarioDir = path.join(options.sourceDir, 'scenarios', options.scenario);
  const manifest = await readManifest(scenarioDir);
  const simulate = (manifest && manifest.simulate) || null;
  const meta = { kind: 'file', scenario: options.scenario, directory: scenarioDir, simulated: simulate ? simulate.failure : null };
  let fired = false;

  async function applySimulation() {
    if (!simulate || fired) return;
    fired = true;
    if (simulate.failure === 'timeout') {
      await delay(Number(simulate.hang_ms) > 0 ? Number(simulate.hang_ms) : 5000, options.signal);
      throw new TransportError('timeout', 'the source did not answer within ' + options.config.timeout_ms + ' ms (simulated)');
    }
    if (simulate.failure === 'http') {
      const status = Number(simulate.status) || 500;
      throw new TransportError('http-status', 'the source answered HTTP ' + status + (simulate.body ? ': ' + simulate.body : ''), { status: status });
    }
    throw new TransportError('simulation-unknown', 'unknown simulated failure "' + simulate.failure + '"');
  }

  return {
    kind: 'file',
    meta: meta,
    /** The raw text of one page, or null when there is no such page. */
    async readTextPage(pageNumber) {
      await applySimulation();
      const file = path.join(scenarioDir, 'page-' + pageNumber + '.json');
      try {
        return await fs.readFile(file, 'utf8');
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw new TransportError('unreadable-page', 'could not read ' + file + ': ' + error.message);
      }
    },
    /** The raw text of a named fixture file (used by adapters whose source is one file). */
    async readTextFile(name) {
      await applySimulation();
      const file = path.join(scenarioDir, name);
      try {
        return await fs.readFile(file, 'utf8');
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw new TransportError('unreadable-file', 'could not read ' + file + ': ' + error.message);
      }
    }
  };
}

module.exports = {
  openFileTransport: openFileTransport,
  readScenarioManifest: readScenarioManifest,
  delay: delay
};
