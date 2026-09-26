'use strict';

/**
 * The adapter registry.
 *
 * Adding a source shape means adding one module here and naming it in the
 * source's configuration (`config.adapter`). Nothing else in the runner knows
 * which adapter is in play, which is what makes the boundary reusable: a real
 * merchant source in 17C-D is a new adapter plus a transport, not a new
 * pipeline.
 */

const { AdapterError } = require('../errors');
const storeJson = require('./store-json');
const productCsv = require('./product-csv');

const ADAPTERS = new Map([
  [storeJson.name, storeJson],
  [productCsv.name, productCsv]
]);

function getAdapter(name) {
  const adapter = ADAPTERS.get(String(name || ''));
  if (!adapter) {
    throw new AdapterError(
      'unknown-adapter',
      'no adapter named "' + String(name || '') + '"; this build has: ' + Array.from(ADAPTERS.keys()).join(', ')
    );
  }
  return adapter;
}

function listAdapters() {
  return Array.from(ADAPTERS.values()).map((adapter) => ({
    name: adapter.name,
    version: adapter.version,
    method: adapter.method,
    description: adapter.description
  }));
}

module.exports = { getAdapter: getAdapter, listAdapters: listAdapters };
