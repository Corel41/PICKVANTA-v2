'use strict';

/**
 * The boundary, enforced by inspection rather than by promise.
 *
 * The connector has exactly two capabilities that leave this process, and each
 * lives in exactly one named file:
 *   • `lib/db/client.js` (17C-C) — the write path: three PostgREST RPC endpoints,
 *     no table path, no SQL, no printing, no environment;
 *   • `lib/transport/http.js` (17C-D) — the source side: the endpoint the source
 *     named, under the host policy the source declared, and nothing else.
 * Every other file may not reach the network, touch a database, write a file or
 * add a dependency. These tests read the connector's own source, so the claim is
 * checkable in one command instead of by trust.
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

const CLIENT_FILE = path.join(CONNECTORS, 'lib', 'db', 'client.js');
const HTTP_FILE = path.join(CONNECTORS, 'lib', 'transport', 'http.js');
/** The two files that may touch the network: one for the boundary, one for the source. */
const NETWORK_FILES = [CLIENT_FILE, HTTP_FILE];
/** Everything else, which may not reach the network at all. */
const NETWORK_FREE_FILES = SOURCE_FILES.filter((file) => !NETWORK_FILES.includes(file));

const ALLOWED_RPC = ['import_job_start', 'import_ingest', 'import_job_finish'];
const ALLOWED_RPC_PARAMETERS = ['p_batch', 'p_detail', 'p_error', 'p_job_id', 'p_job_type',
  'p_progress', 'p_source_id', 'p_stats', 'p_status'];

const NO_NETWORK = [
  { pattern: /\bfetch\s*\(/, why: 'no file outside the two network files may make a network request' },
  { pattern: /globalThis\.fetch/, why: 'the platform fetch is taken by lib/db/client.js and lib/transport/http.js, and by nothing else' },
  { pattern: /require\(\s*['"](node:)?(http|https|net|dns|tls|dgram)['"]\s*\)/, why: 'no network client may be imported' },
  { pattern: /@supabase/, why: 'no database client may be imported' },
  { pattern: /rest\/v1/, why: 'no PostgREST call may be built outside the client' },
  /* run.js and report.js name the endpoints in operator-facing text — an error
     message and a report line ("counts reported by import_ingest"). Neither can
     call one: they may not match /fetch\(/ or /rest\/v1/, which the rules above
     enforce on every file but the client. */
  { pattern: /\bimport_(ingest|job_start|job_finish)\b/, why: 'the RPC names are called only by lib/db/client.js', except: ['report.js', 'run.js'] }
];

const FORBIDDEN_EVERYWHERE = [
  { pattern: /require\(\s*['"](node:)?(http|https|net|dns|tls|dgram)['"]\s*\)/, why: 'no network client may be imported; the platform fetch is enough' },
  { pattern: /@supabase/, why: 'no database client may be imported' },
  { pattern: /(^|[^:\w])postgres(ql)?:\/\//i, why: 'no database connection string' },
  { pattern: /\bcreateClient\s*\(/, why: 'no supabase-js client factory (the connector has its own named one)' },
  { pattern: /\bwriteFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync\b/, why: 'a run writes nothing to disk' }
];

const NO_SQL = [
  { pattern: /\binsert\s+into\b/i, why: 'the connector sends batches to an RPC, never SQL' },
  { pattern: /\bdelete\s+from\s+\w+/i, why: 'the connector deletes nothing' },
  { pattern: /\bupdate\s+(public\.)?\w+\s+set\b/i, why: 'the connector updates nothing directly' },
  { pattern: /\bfrom\s+(public\.)?imported_deals\b/i, why: 'no table of the deal engine may be named as a query target' },
  { pattern: /\bselect\s+[\s\S]{0,60}\bfrom\s+\w+\s*;/i, why: 'no SQL statement may be built' }
];

test('boundary: every connector file except the client has no network or database capability', () => {
  assert.ok(NETWORK_FREE_FILES.length >= 8, 'expected to find the connector source files');
  for (const file of NETWORK_FREE_FILES) {
    const text = fs.readFileSync(file, 'utf8');
    for (const entry of NO_NETWORK) {
      if (entry.except && entry.except.includes(path.basename(file))) continue;
      assert.equal(entry.pattern.test(text), false,
        path.relative(REPO_ROOT, file) + ' must not match ' + entry.pattern + ' (' + entry.why + ')');
    }
  }
});

test('boundary: no connector file speaks SQL, keeps a connection string or writes to disk', () => {
  for (const file of SOURCE_FILES) {
    const text = fs.readFileSync(file, 'utf8');
    for (const entry of FORBIDDEN_EVERYWHERE.concat(NO_SQL)) {
      assert.equal(entry.pattern.test(text), false,
        path.relative(REPO_ROOT, file) + ' must not match ' + entry.pattern + ' (' + entry.why + ')');
    }
  }
});

test('boundary: the write path is three RPC endpoints and nothing else', () => {
  assert.equal(fs.existsSync(CLIENT_FILE), true, 'expected connectors/lib/db/client.js to exist');

  const text = fs.readFileSync(CLIENT_FILE, 'utf8');
  const paths = text.match(/\/rest\/v1\/[a-z_/]*/g) || [];
  assert.deepEqual([...new Set(paths)], ['/rest/v1/rpc/'],
    'the only PostgREST path the client may contain is the rpc prefix; no table path may appear');

  const client = require(CLIENT_FILE);
  assert.deepEqual(Object.values(client.RPC_ENDPOINTS).sort(), ALLOWED_RPC.slice().sort(),
    'the endpoints the client knows must be exactly the three of migration 0011');
  assert.deepEqual(Object.keys(client).sort(),
    ['DEFAULT_JOB_TYPE', 'RPC_ENDPOINTS', 'RPC_PREFIX', 'createIngestClient'],
    'the client exposes one factory and its constants; no generic request or write helper');

  const parameters = [...new Set(text.match(/\bp_[a-z_]+\s*:/g) || [])].map((entry) => entry.replace(/\s*:$/, '')).sort();
  assert.deepEqual(parameters, ALLOWED_RPC_PARAMETERS,
    'the parameters the client sends must be the signatures of the three functions, and nothing else');
});

/** The rules that apply to the source-side network file, and only to it. */
const SOURCE_SIDE_RULES = [
  { pattern: /rest\/v1/, why: 'the source transport has nothing to do with the ingest boundary' },
  { pattern: /@supabase/, why: 'the source transport does not speak to the database' },
  { pattern: /\bimport_(ingest|job_start|job_finish)\b/, why: 'the source transport calls no ingest function' },
  { pattern: /\bp_[a-z_]+\s*:/, why: 'the source transport sends no RPC parameter' },
  { pattern: /process\.env/, why: 'the credential is handed to the transport by the runner; it never reads the environment itself' },
  { pattern: /console\.|process\.(stdout|stderr)/, why: 'the transport prints nothing: a response body or a credential must not reach a log' },
  { pattern: /require\(\s*['"](node:)?(fs|child_process)['"]\s*\)/, why: 'the transport reads the network and nothing else' }
];

test('boundary: exactly two files may reach the network, and the source side stays on the source side', () => {
  assert.equal(fs.existsSync(HTTP_FILE), true, 'expected connectors/lib/transport/http.js to exist');

  const fetchers = SOURCE_FILES
    .filter((file) => /globalThis\.fetch/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(REPO_ROOT, file))
    .sort();
  assert.deepEqual(fetchers,
    ['connectors/lib/db/client.js', 'connectors/lib/transport/http.js'],
    'the write path and the source path each have one file, and no third file may call fetch');

  const text = fs.readFileSync(HTTP_FILE, 'utf8');
  for (const entry of SOURCE_SIDE_RULES) {
    assert.equal(entry.pattern.test(text), false,
      'lib/transport/http.js must not match ' + entry.pattern + ' (' + entry.why + ')');
  }
});

/* ---------------------------------------------------------- architecture -- */

/**
 * The ownership contract, as edges rather than prose (17C-G.1).
 *
 * Each module is classified into a layer, and each layer's dependencies are an
 * exact set. Anything else — a new edge, or a module nobody classified — fails
 * here rather than being discovered in a review. The direction of this graph is
 * the architecture: bytes flow up, meaning is added one layer at a time, and the
 * write path stays in a single leaf that knows nothing about products.
 */
const LAYERS = {
  'lib/errors.js': 'errors',
  'lib/contract.js': 'contract',
  'lib/normalize.js': 'normalize',
  'lib/identity.js': 'identity',
  'lib/simulate.js': 'simulate',
  'lib/preflight.js': 'preflight',
  'lib/run-context.js': 'presentation',
  'lib/report.js': 'presentation',
  'lib/db/client.js': 'db',
  'lib/transport/file.js': 'transport',
  'lib/transport/http.js': 'transport',
  'lib/transport/index.js': 'transport',
  'lib/adapters/shared.js': 'adapter',
  'lib/adapters/store-json.js': 'adapter',
  'lib/adapters/product-csv.js': 'adapter',
  'lib/adapters/woo-store-api.js': 'adapter',
  'lib/adapters/index.js': 'adapter',
  'run.js': 'orchestration'
};

/**
 * The exact dependencies each module may have on *other* layers (intra-layer
 * edges, such as one transport using another, are not listed: they are the
 * layer's own business). Pinned per module rather than per layer, because the
 * registry and a mapping adapter genuinely depend on different things.
 */
const ALLOWED_DEPENDENCIES = {
  'lib/errors.js': [],
  'lib/contract.js': [],
  'lib/preflight.js': [],
  'lib/run-context.js': [],
  'lib/normalize.js': ['contract'],
  'lib/simulate.js': ['contract'],
  'lib/identity.js': ['contract', 'normalize'],
  'lib/report.js': ['adapter'],
  'lib/db/client.js': ['errors'],
  'lib/transport/file.js': ['errors'],
  'lib/transport/http.js': ['errors'],
  'lib/transport/index.js': ['errors'],
  'lib/adapters/shared.js': [],
  'lib/adapters/store-json.js': ['contract', 'errors'],
  'lib/adapters/product-csv.js': ['contract', 'errors'],
  'lib/adapters/woo-store-api.js': ['errors'],
  'lib/adapters/index.js': ['errors'],
  'run.js': ['adapter', 'contract', 'db', 'errors', 'identity', 'normalize',
    'presentation', 'preflight', 'simulate', 'transport']
};

/** The same rules as sentences, so a failure says why and not only what. */
const PROHIBITIONS = [
  ['transport', ['adapter', 'db', 'presentation'],
    'the transport moves bytes and knows nothing about products, databases or printing'],
  ['adapter', ['db', 'identity', 'normalize'],
    'an adapter interprets one merchant; canonical form and identity are core layers'],
  ['normalize', ['adapter', 'db', 'identity'],
    'canonical form is adapter-independent and claims no identity'],
  ['identity', ['adapter', 'db'],
    'identity reads contract fields and writes nothing'],
  ['db', ['adapter', 'identity', 'normalize'],
    'the boundary client sends what it was given, and nothing else'],
  ['presentation', ['db', 'identity', 'normalize', 'transport'],
    'the report prints a model; it contacts nothing and decides nothing'],
  ['contract', ['adapter', 'db', 'identity', 'normalize', 'presentation', 'transport'],
    'the contract is the shared vocabulary at the bottom of the graph'],
  ['errors', ['adapter', 'contract', 'db', 'identity', 'normalize', 'preflight', 'presentation', 'simulate', 'transport'],
    'the error types are the one leaf every layer may depend on'],
  ['simulate', ['adapter', 'db', 'identity', 'normalize', 'presentation', 'transport'],
    'the dry-run stand-in is contract-shaped arithmetic']
];

/** Resolves a relative require the way Node would, without executing anything. */
function resolveRequiredFile(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  if (fs.existsSync(base + '.js')) return base + '.js';
  if (fs.existsSync(path.join(base, 'index.js'))) return path.join(base, 'index.js');
  return base + '.js';
}

/** The literal files a module requires, in order. */
function requireTargets(file) {
  const text = fs.readFileSync(file, 'utf8');
  const pattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const targets = [];
  let match = pattern.exec(text);
  while (match) {
    const resolved = resolveRequiredFile(file, match[1]);
    if (resolved !== null) targets.push(path.relative(CONNECTORS, resolved).split(path.sep).join('/'));
    match = pattern.exec(text);
  }
  return targets;
}

/** `{ file, layer, requires: [layer, ...] }` for every connector module. */
function moduleGraph() {
  const modules = [];
  for (const file of SOURCE_FILES) {
    const relative = path.relative(CONNECTORS, file).split(path.sep).join('/');
    assert.ok(LAYERS[relative],
      'connectors/' + relative + ' is not classified into a layer; add it to LAYERS in this test'
      + ' — and to ALLOWED_DEPENDENCIES if it may depend on something');
    const requires = [];
    for (const target of requireTargets(file)) {
      assert.ok(LAYERS[target], 'connectors/' + relative + ' requires ' + target
        + ', which is not a classified connector module');
      requires.push(LAYERS[target]);
    }
    modules.push({ file: relative, layer: LAYERS[relative], requires: requires });
  }
  return modules;
}

test('architecture: every layer depends on exactly what it is allowed to depend on', () => {
  const modules = moduleGraph();
  assert.ok(modules.length >= 18, 'expected to find the connector modules');

  for (const module of modules) {
    const outside = [...new Set(module.requires.filter((layer) => layer !== module.layer))].sort();
    const allowed = ALLOWED_DEPENDENCIES[module.file].slice().sort();
    assert.deepEqual(outside, allowed,
      module.file + ' (a ' + module.layer + ' module) must depend on exactly: '
      + (allowed.join(', ') || 'nothing'));
  }

  for (const [layer, forbidden, why] of PROHIBITIONS) {
    for (const module of modules) {
      if (module.layer !== layer) continue;
      for (const target of forbidden) {
        assert.equal(module.requires.includes(target), false,
          module.file + ' must not depend on a ' + target + ' module: ' + why);
      }
    }
  }
});

test('architecture: composition belongs to the orchestrator, so exactly one file starts a run', () => {
  const modules = moduleGraph().map((module) => ({
    file: module.file,
    layer: module.layer,
    targets: requireTargets(path.join(CONNECTORS, module.file))
  }));

  const usersOf = (target) => modules.filter((module) => module.targets.includes(target))
    .map((module) => module.file).sort();

  assert.deepEqual(usersOf('lib/transport/index.js'), ['run.js'],
    'a source is read because a run asked for it, not because a module imported a transport');
  assert.deepEqual(usersOf('lib/db/client.js'), ['run.js'],
    'only the orchestrator opens the write path');
  assert.deepEqual(usersOf('lib/adapters/index.js'), ['lib/report.js', 'run.js'],
    'the registry is read by the orchestrator and listed by the report; it is not a source of records');

  const registry = modules.find((module) => module.file === 'lib/adapters/index.js');
  assert.deepEqual(registry.layer, 'adapter');
  assert.deepEqual(registry.targets.filter((target) => target !== 'lib/errors.js').sort(),
    ['lib/adapters/product-csv.js', 'lib/adapters/store-json.js', 'lib/adapters/woo-store-api.js'],
    'the registry holds adapters and nothing else');
});

test('boundary: the client never prints, so the key it carries cannot be echoed', () => {
  const text = fs.readFileSync(CLIENT_FILE, 'utf8');
  for (const pattern of [/console\./, /process\.(stdout|stderr)/, /process\.env/]) {
    assert.equal(pattern.test(text), false,
      'lib/db/client.js must not match ' + pattern + ': secrets are read in run.js and printing is report.js\'s job');
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
