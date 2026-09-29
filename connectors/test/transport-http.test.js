'use strict';

/**
 * The HTTP transport: the policy that keeps a run pointed at its source, and the
 * mechanics that keep it bounded.
 *
 * Two kinds of evidence here, deliberately:
 *   • the policy is checked with no socket at all — the refusals must happen
 *     before anything is fetched, and a fetch implementation that records its
 *     calls proves that they do;
 *   • the mechanics are checked against a real HTTP server on 127.0.0.1, because
 *     a mocked response would prove nothing about chunking, aborts or headers.
 *     The stand-in is allowed there only because the source's own configuration
 *     says so (`allow_private_hosts`, `allow_insecure_http`); the same request
 *     without those flags is refused, and that is asserted too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const transport = require('../lib/transport');
const httpTransport = require('../lib/transport/http');

/* ------------------------------------------------------------- helpers -- */

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    port: address.port,
    origin: 'http://127.0.0.1:' + address.port,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

/** A stand-in store's manifest: private and insecure on purpose, allowlisted explicitly. */
const DEFAULT_CONFIG = {
  adapter: 'woo-store-api',
  per_page: 2,
  max_pages: 3,
  timeout_ms: 2000,
  allowed_hosts: ['127.0.0.1'],
  allow_private_hosts: true,
  allow_insecure_http: true
};

function sourceFor(origin, overrides) {
  const settings = overrides || {};
  return Object.assign({
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Stand-in Store',
    provider_name: 'stand-in',
    source_type: 'merchant-product-feed',
    market_country: 'KE',
    status: 'active',
    transport: 'http',
    endpoint_url: origin + '/wp-json/wc/store/v1/products'
  }, settings, {
    config: Object.assign({}, DEFAULT_CONFIG, settings.config || {})
  });
}

function jsonPage(products) {
  return JSON.stringify(products);
}

/* ------------------------------------------------------- the host policy -- */

test('policy: a remote source must name the hosts it may read', () => {
  assert.throws(() => httpTransport.buildPolicy({}, { allowed_hosts: [] }), (error) => {
    assert.equal(error.kind, 'host-policy-missing');
    assert.match(error.message, /allowed_hosts/);
    return true;
  });
  assert.throws(() => httpTransport.buildPolicy({}, {}), /allowed_hosts/);
});

test('policy: an entry that is not a plain host name is refused', () => {
  for (const entry of ['https://store.example', 'store.example/path', 'store.example:443', 'user@store.example']) {
    assert.throws(() => httpTransport.buildPolicy({}, { allowed_hosts: [entry] }), (error) => {
      assert.equal(error.kind, 'host-policy-invalid');
      return true;
    }, 'expected ' + entry + ' to be refused');
  }
});

test('policy: a host that is not on the list is refused, whatever the scheme', () => {
  const policy = httpTransport.buildPolicy({}, { allowed_hosts: ['store.example'] });
  assert.throws(() => httpTransport.checkUrl('https://other.example/products', policy, null), (error) => {
    assert.equal(error.kind, 'host-not-allowed');
    assert.match(error.message, /other\.example/);
    assert.match(error.message, /store\.example/);
    return true;
  });
});

test('policy: there are no wildcards — a pattern matches nothing', () => {
  const policy = httpTransport.buildPolicy({}, { allowed_hosts: ['*.example'] });
  assert.throws(() => httpTransport.checkUrl('https://store.example/x', policy, null), /host-not-allowed|not in the allowed_hosts/);
});

test('policy: only https is read, unless the stand-in flag says otherwise', () => {
  const policy = httpTransport.buildPolicy({}, { allowed_hosts: ['store.example'] });
  assert.throws(() => httpTransport.checkUrl('http://store.example/x', policy, null), (error) => {
    assert.equal(error.kind, 'insecure-scheme');
    return true;
  });
  const allowed = httpTransport.buildPolicy({}, { allowed_hosts: ['store.example'], allow_insecure_http: true });
  assert.equal(httpTransport.checkUrl('http://store.example/x', allowed, null).protocol, 'http:');
});

test('policy: loopback, private and link-local hosts are refused without the stand-in flag', () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]', '10.0.0.5', '192.168.1.10', '172.20.3.4',
    '169.254.169.254', '100.100.100.200', '0.0.0.0', 'store.local', 'metadata.internal']) {
    const policy = httpTransport.buildPolicy({}, { allowed_hosts: [host.replace(/^\[|\]$/g, '')] });
    assert.throws(() => httpTransport.checkUrl('https://' + host + '/x', policy, null), (error) => {
      assert.equal(error.kind, 'private-host', 'expected ' + host + ' to be refused as private, got ' + error.kind);
      return true;
    }, 'expected ' + host + ' to be refused');
  }
  /* A public name that merely looks like one is not refused. */
  const publicPolicy = httpTransport.buildPolicy({}, { allowed_hosts: ['localhost.example.com'] });
  assert.equal(httpTransport.checkUrl('https://localhost.example.com/x', publicPolicy, null).hostname, 'localhost.example.com');
});

test('policy: an endpoint URL carrying a username or password is refused', () => {
  const policy = httpTransport.buildPolicy({}, { allowed_hosts: ['store.example'] });
  assert.throws(() => httpTransport.checkUrl('https://user:secret@store.example/x', policy, null), (error) => {
    assert.equal(error.kind, 'url-credentials');
    assert.match(error.message, /environment/);
    return true;
  });
});

test('policy: a refusal happens before any request is made', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response('[]', { status: 200 }); };
  await assert.rejects(
    httpTransport.openHttpTransport({
      source: sourceFor('http://127.0.0.1:9', { config: { allowed_hosts: [] } }),
      config: { allowed_hosts: [] },
      fetchImpl: fetchImpl
    }),
    (error) => {
      assert.equal(error.kind, 'host-policy-missing');
      return true;
    });
  await assert.rejects(
    httpTransport.openHttpTransport({
      source: sourceFor('https://169.254.169.254/latest/meta-data', { config: { allowed_hosts: ['169.254.169.254'] } }),
      config: { allowed_hosts: ['169.254.169.254'] },
      fetchImpl: fetchImpl
    }),
    (error) => {
      assert.equal(error.kind, 'private-host');
      return true;
    });
  assert.equal(calls, 0, 'no fetch may happen for a refused source');
});

test('policy: a redirect is checked again, and one that leaves the allowlist is refused', async () => {
  const server = await startServer((request, response) => {
    response.writeHead(302, { location: 'https://elsewhere.example/products' });
    response.end();
  });
  try {
    const source = sourceFor(server.origin);
    const opened = await httpTransport.openHttpTransport({ source: source, config: source.config });
    await assert.rejects(opened.readTextPage(1), (error) => {
      assert.equal(error.kind, 'host-not-allowed');
      assert.match(error.message, /redirect/);
      assert.match(error.message, /elsewhere\.example/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test('policy: a redirect is followed inside the allowlist, and the hop count is capped', async () => {
  const server = await startServer((request, response) => {
    if (request.url.startsWith('/wp-json')) {
      response.writeHead(302, { location: '/moved/products?x=1' });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(jsonPage([]));
  });
  try {
    const source = sourceFor(server.origin);
    const opened = await httpTransport.openHttpTransport({ source: source, config: source.config });
    assert.equal(await opened.readTextPage(1), '[]');
    assert.equal(opened.meta.redirects, 1);
    assert.equal(opened.meta.requests, 2, 'the hop counts as a request');
  } finally {
    await server.close();
  }

  const loop = await startServer((request, response) => {
    response.writeHead(302, { location: '/wp-json/wc/store/v1/products' });
    response.end();
  });
  try {
    const source = sourceFor(loop.origin, { config: { max_redirects: 1 } });
    const opened = await httpTransport.openHttpTransport({ source: source, config: source.config });
    await assert.rejects(opened.readTextPage(1), (error) => {
      assert.equal(error.kind, 'too-many-redirects');
      return true;
    });
  } finally {
    await loop.close();
  }
});

/* ---------------------------------------------------------- the reading -- */

test('http: a page is read with the page and per_page the source configured', async () => {
  const seen = [];
  const server = await startServer((request, response) => {
    seen.push({ url: request.url, ua: request.headers['user-agent'], accept: request.headers.accept });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(jsonPage([{ id: 1 }]));
  });
  try {
    const source = sourceFor(server.origin);
    const opened = await httpTransport.openHttpTransport({ source: source, config: source.config });
    const text = await opened.readTextPage(2);

    assert.equal(text, jsonPage([{ id: 1 }]));
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /^\/wp-json\/wc\/store\/v1\/products\?/);
    assert.match(seen[0].url, /page=2/);
    assert.match(seen[0].url, /per_page=2/);
    assert.equal(seen[0].ua, httpTransport.USER_AGENT);
    assert.match(seen[0].accept, /application\/json/);
    assert.equal(opened.meta.pages, 1);
    assert.equal(opened.meta.requests, 1);
    assert.equal(opened.meta.bytes, Buffer.byteLength(text, 'utf8'));
    assert.equal(opened.meta.host, '127.0.0.1');
    assert.equal(opened.meta.scheme, 'http');
  } finally {
    await server.close();
  }
});

test('http: the configured per_page replaces one already in the endpoint URL', async () => {
  let seenUrl = '';
  const server = await startServer((request, response) => {
    seenUrl = request.url;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  try {
    const source = sourceFor(server.origin + '/wp-json/wc/store/v1/products?per_page=99&orderby=id');
    const opened = await httpTransport.openHttpTransport({ source: source, config: source.config });
    await opened.readTextPage(1);
    assert.match(seenUrl, /per_page=2/);
    assert.doesNotMatch(seenUrl, /per_page=99/);
    assert.match(seenUrl, /orderby=id/, 'other query parameters are left alone');
  } finally {
    await server.close();
  }
});

test('http: a single-file source is read without page parameters', async () => {
  let seenUrl = '';
  const server = await startServer((request, response) => {
    seenUrl = request.url;
    response.writeHead(200, { 'content-type': 'text/csv' });
    response.end('item_id,item_name\n');
  });
  try {
    const source = sourceFor(server.origin, {
      endpoint_url: server.origin + '/feed.csv',
      config: { adapter: 'product-csv' }
    });
    const opened = await httpTransport.openHttpTransport({ source: source, config: source.config });
    await opened.readTextFile('feed.csv');
    assert.equal(seenUrl, '/feed.csv');
  } finally {
    await server.close();
  }
});

test('http: a non-2xx answer is a named failure that carries the status', async () => {
  const server = await startServer((request, response) => {
    response.writeHead(503, { 'content-type': 'text/plain' });
    response.end('upstream is having a bad day');
  });
  try {
    const source = sourceFor(server.origin);
    const opened = await httpTransport.openHttpTransport({ source: source, config: source.config });
    await assert.rejects(opened.readTextPage(1), (error) => {
      assert.equal(error.kind, 'http-status');
      assert.equal(error.detail.status, 503);
      assert.match(error.message, /HTTP 503/);
      assert.match(error.message, /bad day/, 'without a credential, the body is a useful clue');
      return true;
    });
  } finally {
    await server.close();
  }
});

test('http: when a credential was sent, an error body is not repeated into the message', async () => {
  const server = await startServer((request, response) => {
    response.writeHead(401, { 'content-type': 'text/plain' });
    response.end('token ' + request.headers.authorization + ' is not valid');
  });
  try {
    const source = sourceFor(server.origin, { requires_credential: true });
    const opened = await httpTransport.openHttpTransport({
      source: source, config: source.config, credential: 'super-secret-token'
    });
    await assert.rejects(opened.readTextPage(1), (error) => {
      assert.equal(error.kind, 'http-status');
      assert.doesNotMatch(error.message, /super-secret-token/, 'a source must not be able to echo the credential into a log');
      assert.doesNotMatch(error.message, /is not valid/);
      assert.match(error.message, /HTTP 401/);
      return true;
    });
    assert.equal(opened.meta.credential_sent, true);
  } finally {
    await server.close();
  }
});

test('http: the credential is sent as a bearer header when the source has one', async () => {
  let authorization = null;
  const server = await startServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  try {
    const source = sourceFor(server.origin, { requires_credential: true });
    const opened = await httpTransport.openHttpTransport({
      source: source, config: source.config, credential: 'token-value'
    });
    await opened.readTextPage(1);
    assert.equal(authorization, 'Bearer token-value');
  } finally {
    await server.close();
  }
});

test('http: a body over the cap is refused while it streams', async () => {
  const big = 'x'.repeat(4096);
  const server = await startServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(big);
  });
  try {
    const source = sourceFor(server.origin, { config: { max_response_bytes: 1024 } });
    const opened = await httpTransport.openHttpTransport({ source: source, config: source.config });
    await assert.rejects(opened.readTextPage(1), (error) => {
      assert.equal(error.kind, 'response-too-large');
      assert.match(error.message, /1024/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test('http: a declared length over the cap is refused before the body is read', async () => {
  const opened = await httpTransport.openHttpTransport({
    source: sourceFor('http://127.0.0.1:9'),
    config: sourceFor('http://127.0.0.1:9').config,
    fetchImpl: async () => new Response(null, { status: 200, headers: { 'content-length': '99999999' } })
  });
  await assert.rejects(opened.readTextPage(1), (error) => {
    assert.equal(error.kind, 'response-too-large');
    return true;
  });
});

test('http: a source that does not answer within the timeout is a named failure', async () => {
  const server = await startServer((request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('[]');
    }, 1500);
  });
  try {
    const source = sourceFor(server.origin, { config: { timeout_ms: 100 } });
    const opened = await httpTransport.openHttpTransport({ source: source, config: source.config });
    await assert.rejects(opened.readTextPage(1), (error) => {
      assert.equal(error.kind, 'timeout');
      assert.match(error.message, /100 ms/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test('http: the abort signal of the run stops the request, and its reason is what is reported', async () => {
  const controller = new AbortController();
  const server = await startServer(() => { /* never answers */ });
  try {
    const source = sourceFor(server.origin);
    const opened = await httpTransport.openHttpTransport({
      source: source, config: source.config, signal: controller.signal
    });
    const failure = new Error('the run gave up');
    failure.kind = 'timeout';
    const pending = opened.readTextPage(1);
    controller.abort(failure);
    await assert.rejects(pending, (error) => {
      assert.equal(error.message, 'the run gave up', 'the reason the run gave is the one reported');
      return true;
    });
  } finally {
    await server.close();
  }
});

/* ------------------------------------------------------------ selection -- */

test('selection: a source is read through the transport its manifest names', async () => {
  assert.equal(transport.transportKindOf({}), 'file');
  assert.equal(transport.transportKindOf({ transport: 'file' }), 'file');
  assert.equal(transport.transportKindOf({ transport: 'HTTP' }), 'http');
  assert.throws(() => transport.transportKindOf({ transport: 'sql' }), (error) => {
    assert.equal(error.kind, 'unknown-transport');
    return true;
  });

  const fileLike = await transport.openTransport({ source: {}, sourceDir: '/nowhere', scenario: 'ok', config: {} });
  assert.equal(fileLike.kind, 'file', 'a fixture source keeps the file transport exactly as it was');
});

test('selection: the transport requirements of a manifest are reported as problems', () => {
  assert.deepEqual(transport.sourceProblems({}), []);
  assert.deepEqual(transport.sourceProblems({ transport: 'file' }), []);
  assert.match(transport.sourceProblems({ transport: 'sql' })[0], /transport must be one of file, http/);
  assert.match(transport.sourceProblems({ transport: 'http' })[0], /endpoint_url is required/);
  assert.match(transport.sourceProblems({
    transport: 'http', endpoint_url: 'not a url', config: { allowed_hosts: ['store.example'] }
  })[0], /not a URL/);
  assert.match(transport.sourceProblems({
    transport: 'http', endpoint_url: 'https://store.example/x', config: {}
  })[0], /allowed_hosts/);
  assert.deepEqual(transport.sourceProblems({
    transport: 'http', endpoint_url: 'https://store.example/x', config: { allowed_hosts: ['store.example'] }
  }), []);
});
