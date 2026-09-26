'use strict';

/**
 * Shared helpers for the connector tests. Not a test file itself.
 * Run everything with: node --test connectors/test/
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'connectors', 'run.js');

/** A clean environment: no Supabase variables, unless a test supplies them. */
function cleanEnv(extra) {
  const env = Object.assign({}, process.env);
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env.PV_SOURCE_111111111111_TOKEN;
  return Object.assign(env, extra || {});
}

/** Runs the CLI exactly as a person would, and returns what it printed. */
function runCli(args, options) {
  const settings = options || {};
  const result = spawnSync(process.execPath, [RUNNER].concat(args), {
    cwd: REPO_ROOT,
    env: cleanEnv(settings.env),
    encoding: 'utf8'
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    all: (result.stdout || '') + (result.stderr || '')
  };
}

function fixture(name) {
  return path.join('connectors', 'fixtures', name);
}

/** A JWT-shaped string with the given role claim (unsigned: it is only a local guard). */
function fakeJwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: role, iss: 'fixture' })).toString('base64url');
  return header + '.' + payload + '.not-a-real-signature';
}

/** One record that satisfies the contract, with any field overridable. */
function validRecord(overrides) {
  const record = {
    external_product_id: 'SKU-1',
    source_url: 'https://fixture.example/p/sku-1',
    title: 'Fixture Product 1',
    description: 'A fixture record.',
    price: { amount: '19.99', currency: 'GBP' },
    availability_text: 'In stock',
    category_text: 'Fixture > Things',
    merchant: {
      name: 'Fixture Merchant',
      merchant_ref: 'fixture',
      website_url: 'https://fixture.example',
      country: 'GB'
    },
    media: [{ url: 'https://fixture.example/media/1.jpg', media_type: 'image', sort_order: 0, attribution: '', fallback_url: '' }],
    raw: { id: 1, name: 'Fixture Product 1' }
  };
  return Object.assign(record, overrides || {});
}

function validBatch(overrides) {
  const batch = {
    batch_version: 1,
    source_id: '11111111-1111-4111-8111-111111111111',
    job_id: '99999999-9999-4999-8999-999999999999',
    connector: { name: 'store-json', version: '0.1.0', method: 'json-api' },
    fetched_at: '2026-09-26T10:00:00Z',
    records: [validRecord()]
  };
  return Object.assign(batch, overrides || {});
}

function fieldsOf(errors) {
  return errors.map((entry) => entry.field);
}

module.exports = {
  REPO_ROOT: REPO_ROOT,
  RUNNER: RUNNER,
  runCli: runCli,
  cleanEnv: cleanEnv,
  fixture: fixture,
  fakeJwt: fakeJwt,
  validRecord: validRecord,
  validBatch: validBatch,
  fieldsOf: fieldsOf
};
