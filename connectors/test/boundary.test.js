'use strict';

/**
 * The boundary, enforced by inspection rather than by promise.
 *
 * Step 17C-B may not reach the network, touch a database, write a file or add a
 * dependency. These tests read the connector's own source and refuse those
 * capabilities, so the claim is checkable in one command instead of by trust.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { REPO_ROOT } = require('./_helpers');

const CONNECTORS = path.join(REPO_ROOT, 'connectors');
const TEST_DIR = path.join(CONNECTORS, 'test');

function collectFiles(directory, extension, accumulator) {
  const files = accumulator || [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (full === TEST_DIR) continue;
      collectFiles(full, extension, files);
    } else if (entry.name.endsWith(extension)) {
      files.push(full);
    }
  }
  return files;
}

const SOURCE_FILES = collectFiles(CONNECTORS, '.js');
const FIXTURE_FILES = collectFiles(CONNECTORS, '.json').concat(collectFiles(CONNECTORS, '.csv'));

const FORBIDDEN = [
  { pattern: /\bfetch\s*\(/, why: 'this build makes no network request' },
  { pattern: /require\(\s*['"](node:)?(http|https|net|dns|tls|dgram)['"]\s*\)/, why: 'no network client may be imported' },
  { pattern: /@supabase/, why: 'no database client may be imported' },
  { pattern: /rest\/v1/, why: 'no PostgREST call may be built' },
  { pattern: /\bimport_ingest\b/, why: 'the ingest boundary arrives in 17C-C, not here' },
  { pattern: /insert\s+into/i, why: 'no SQL belongs in the connector' },
  { pattern: /postgres(ql)?:\/\//i, why: 'no database connection string' },
  { pattern: /createClient\s*\(/, why: 'no database client factory' },
  { pattern: /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync)\b/, why: 'a run writes nothing to disk' }
];

test('boundary: the connector source has no network, database or disk-write capability', () => {
  assert.ok(SOURCE_FILES.length >= 8, 'expected to find the connector source files');
  for (const file of SOURCE_FILES) {
    const text = fs.readFileSync(file, 'utf8');
    for (const entry of FORBIDDEN) {
      assert.equal(entry.pattern.test(text), false,
        path.relative(REPO_ROOT, file) + ' must not match ' + entry.pattern + ' (' + entry.why + ')');
    }
  }
});

test('boundary: every module the connector imports is a built-in or a relative file', () => {
  const requires = [];
  for (const file of SOURCE_FILES) {
    const text = fs.readFileSync(file, 'utf8');
    const pattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match = pattern.exec(text);
    while (match) {
      requires.push({ file: path.relative(REPO_ROOT, file), module: match[1] });
      match = pattern.exec(text);
    }
  }
  assert.ok(requires.length > 0, 'expected the connector to require something');
  for (const entry of requires) {
    const builtin = entry.module.startsWith('node:');
    const relative = entry.module.startsWith('.') || entry.module.startsWith('/');
    assert.ok(builtin || relative, entry.file + ' requires "' + entry.module + '", which is neither a node: built-in nor a local file');
  }
});

test('boundary: the connector brings no dependency manifest of its own', () => {
  for (const name of ['package.json', 'package-lock.json', 'node_modules']) {
    assert.equal(fs.existsSync(path.join(CONNECTORS, name)), false, 'connectors/' + name + ' must not exist');
  }
});

test('boundary: the repository still has no dependency manifest at its root', () => {
  for (const name of ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, name)), false, name + ' must not exist: this project ships no dependencies');
  }
});

/* ------------------------------------------------------------- secrets -- */

const SECRET_KEY = /[a-z0-9_-]*(secret|token|password|passwd|credential|credentials|api[_-]?key|apikey|bearer|private[_-]?key|client[_-]?secret|access[_-]?key)[a-z0-9_-]*/i;
const SECRET_VALUE = [
  /(^|[^a-z0-9])(password|passwd|secret|token|api[_-]?key|apikey|client[_-]?secret|private[_-]?key|access[_-]?key)[\s]*[:=][\s]*[^\s]/i,
  /^(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}$/,
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,
  /^-----begin [a-z ]*private key-----/i,
  /^bearer\s+\S+$/i,
  /^[a-z][a-z0-9+.-]*:\/\/[^/\s:]+:[^/@\s]+@/
];

test('secrets: no fixture carries a credential-shaped key or value', () => {
  const manifests = FIXTURE_FILES.filter((file) => file.endsWith('source.json'));
  assert.ok(manifests.length >= 3, 'expected the fixture source manifests');

  for (const file of manifests) {
    const source = JSON.parse(fs.readFileSync(file, 'utf8'));
    const config = source.config || {};
    for (const key of Object.keys(config)) {
      assert.equal(SECRET_KEY.test(key), false,
        path.relative(REPO_ROOT, file) + ' config key "' + key + '" is credential-shaped; a credential lives in the runner environment');
    }
    for (const value of Object.values(config)) {
      const text = typeof value === 'string' ? value.trim() : '';
      for (const pattern of SECRET_VALUE) {
        assert.equal(pattern.test(text), false,
          path.relative(REPO_ROOT, file) + ' config value looks like a credential');
      }
    }
  }
});

test('secrets: no fixture file contains anything shaped like a real key', () => {
  for (const file of FIXTURE_FILES) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of SECRET_VALUE) {
      assert.equal(pattern.test(text), false, path.relative(REPO_ROOT, file) + ' must not contain a secret');
    }
  }
});
