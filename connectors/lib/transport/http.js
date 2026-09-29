'use strict';

/**
 * The HTTP transport — the network, and the rules that keep it pointed at the
 * source and nowhere else.
 *
 * This is the same interface the fixture transport implements
 * (`readTextPage(page)` -> text | null, `readTextFile(name)`), so an adapter
 * cannot tell which one it is reading through: the difference between a fixture
 * and a merchant's store is where the text came from, not how a product is
 * mapped. It is the second and last file in this connector that may touch the
 * network — the first is `lib/db/client.js`, which may only call the three
 * ingest RPCs (`connectors/test/boundary.test.js` enforces both halves).
 *
 * What it refuses (17C-A §6.3, the SSRF row):
 *   • a scheme that is not https — unless the source's own configuration says
 *     `allow_insecure_http`, which exists for a stand-in source on the
 *     operator's machine and is printed in the run report when it is on;
 *   • a host that is not in the source's `allowed_hosts` — there is no default
 *     list and no wildcard: a remote source has to name what it reads;
 *   • a host that is loopback, private, link-local or otherwise not public —
 *     unless the same configuration says `allow_private_hosts`, which exists for
 *     the same stand-in reason and never widens the allowlist;
 *   • a redirect to any of the above: every hop is checked again, and hops are
 *     capped;
 *   • an endpoint URL that carries a username or a password: a credential
 *     belongs in the environment, never in a source row or a URL;
 *   • a body larger than the cap, checked while the body streams, so a source
 *     cannot exhaust memory by declaring nothing;
 *   • a request that outlives its timeout, per request, on top of the run's own
 *     overall timeout.
 *
 * What it does with secrets: it is handed a credential (the runner reads it, and
 * `lib/preflight.js` is the only place that names it) and sends it as an
 * `Authorization: Bearer` header. It never logs, never prints, and never reads
 * the environment itself. When a credential was sent, the body of a failed
 * response is not repeated into the error message at all — a source that echoes
 * what it was given must not be able to write it into a log line.
 */

const { TransportError, SourceError } = require('../errors');

const USER_AGENT = 'PickVanta-Connector/0.1 (server-side import runner)';
const ACCEPT = 'application/json, text/csv;q=0.9, */*;q=0.1';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const HARD_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_PER_PAGE = 100;
const ERROR_BODY_SNIPPET = 200;

/* Names that are not public addresses even though they are names, not literals. */
const PRIVATE_HOST_NAMES = [/(^|\.)localhost$/i, /\.local$/i, /\.internal$/i, /\.home\.arpa$/i];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

/** `[::1]` -> `::1`, `Example.COM.` -> `example.com`. */
function hostOf(url) {
  const text = String(url.hostname || '').toLowerCase();
  const unbracketed = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  return unbracketed.endsWith('.') ? unbracketed.slice(0, -1) : unbracketed;
}

function isIpv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isIpv6(host) {
  return host.includes(':');
}

function ipv4IsPrivate(host) {
  const octets = host.split('.').map((part) => Number(part));
  if (octets.some((value) => value > 255)) return true; /* not a real address: refuse rather than guess */
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;                  /* this network, private, loopback */
  if (a === 169 && b === 254) return true;                            /* link-local (cloud metadata) */
  if (a === 172 && b >= 16 && b <= 31) return true;                   /* private */
  if (a === 192 && b === 168) return true;                            /* private */
  if (a === 100 && b >= 64 && b <= 127) return true;                  /* carrier-grade NAT */
  if (a === 198 && (b === 18 || b === 19)) return true;               /* benchmarking */
  if (a >= 224) return true;                                          /* multicast, reserved, broadcast */
  return false;
}

function ipv6IsPrivate(host) {
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return ipv4IsPrivate(mapped[1]);
  const first = host.split(':')[0].toLowerCase();
  if (host === '::' || host === '::1') return true;                   /* unspecified, loopback */
  if (/^f[cd][0-9a-f]{2}$/.test(first)) return true;                  /* unique local fc00::/7 */
  if (/^fe[89ab][0-9a-f]$/.test(first)) return true;                  /* link-local fe80::/10 */
  if (host.startsWith('ff')) return true;                             /* multicast */
  return false;
}

function isPrivateHost(host) {
  if (isIpv4(host)) return ipv4IsPrivate(host);
  if (isIpv6(host)) return ipv6IsPrivate(host);
  return PRIVATE_HOST_NAMES.some((pattern) => pattern.test(host));
}

/**
 * One allowlist entry as a host name, or null when the entry is not one.
 *
 * An entry that carries a port is refused rather than silently never matching:
 * the port comes from the endpoint URL, and `store.example:443` in a list would
 * look like a policy while matching nothing. An IPv6 literal is a host name, so
 * it is kept (without its brackets, which is how a URL reports it).
 */
function normaliseAllowedHost(entry) {
  const text = String(entry === null || entry === undefined ? '' : entry).trim().toLowerCase();
  if (text === '') return null;
  if (/[/@\s]/.test(text) || text.includes('://')) return null;       /* a host, not a URL or a pattern */
  const unbracketed = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  const colons = (unbracketed.match(/:/g) || []).length;
  if (colons === 1) return null;                                      /* host:port, not a host name */
  if (colons > 1 && !/^[0-9a-f:]+$/i.test(unbracketed)) return null;  /* neither a host nor an IPv6 literal */
  return unbracketed.endsWith('.') ? unbracketed.slice(0, -1) : unbracketed;
}

/**
 * The policy the source asked for. It is built once, and every URL — the
 * endpoint and every redirect hop — is checked against it.
 */
function buildPolicy(source, config) {
  const entries = Array.isArray(config.allowed_hosts) ? config.allowed_hosts : [];
  const allowed = entries.map(normaliseAllowedHost).filter((entry) => entry !== null);
  if (entries.length > 0 && allowed.length !== entries.length) {
    throw new SourceError('host-policy-invalid',
      'config.allowed_hosts may contain host names only — no scheme, path, port or pattern');
  }
  if (allowed.length === 0) {
    throw new SourceError('host-policy-missing',
      'a remote source must name the hosts it may read: set config.allowed_hosts to one or more host names '
      + '(this build has no default allowlist, and a wildcard would be the same thing as no policy)');
  }
  const policy = {
    allowed: allowed,
    allowPrivate: config.allow_private_hosts === true,
    allowInsecure: config.allow_insecure_http === true
  };
  return policy;
}

/**
 * Checks one URL against the policy. `hop` is null for the endpoint itself (a
 * configuration problem) and the redirect count for a hop (a source problem),
 * so the failure is reported against the right thing.
 */
function checkUrl(rawUrl, policy, hop) {
  const redirect = hop !== null && hop !== undefined;
  const Fail = redirect ? TransportError : SourceError;
  const where = redirect ? 'a redirect' : 'the source endpoint';
  const prefix = redirect ? 'a redirect: ' : '';

  let url;
  try {
    url = new URL(String(rawUrl));
  } catch (error) {
    throw new Fail('bad-url', prefix + where + ' is not a URL: ' + String(rawUrl).slice(0, 120));
  }

  if (url.username !== '' || url.password !== '') {
    throw new Fail('url-credentials',
      prefix + where + ' carries a username or password; a credential belongs in the runner environment, never in a URL');
  }
  const secure = url.protocol === 'https:';
  if (!secure && !(policy.allowInsecure && url.protocol === 'http:')) {
    throw new Fail('insecure-scheme',
      prefix + where + ' uses ' + url.protocol.replace(':', '') + '://; only https is read from a source'
      + ' (a stand-in source on the same machine may set config.allow_insecure_http)');
  }
  const host = hostOf(url);
  if (host === '') throw new Fail('bad-url', prefix + where + ' has no host');
  if (!policy.allowed.includes(host)) {
    throw new Fail('host-not-allowed',
      prefix + '"' + host + '" is not in the allowed_hosts of this source (' + policy.allowed.join(', ') + ')');
  }
  if (!policy.allowPrivate && isPrivateHost(host)) {
    throw new Fail('private-host',
      prefix + '"' + host + '" is a private, loopback or link-local address, and config.allow_private_hosts is not set');
  }
  return url;
}

/**
 * Reads a response body with a byte cap enforced while it streams. A source that
 * declares a huge body is refused before it is read; one that declares nothing
 * is refused as soon as the cap is passed, and the stream is cancelled.
 */
async function readCapped(response, maxBytes, meta) {
  const declared = number(response.headers && response.headers.get ? response.headers.get('content-length') : null);
  if (declared !== null && declared > maxBytes) {
    throw new TransportError('response-too-large',
      'the source answered with ' + declared + ' bytes, over the ' + maxBytes + '-byte cap for one response');
  }

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text();
    const size = Buffer.byteLength(text, 'utf8');
    if (size > maxBytes) {
      throw new TransportError('response-too-large',
        'the source answered with ' + size + ' bytes, over the ' + maxBytes + '-byte cap for one response');
    }
    meta.bytes += size;
    return text;
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    const chunk = step.value;
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new TransportError('response-too-large',
        'the source sent more than the ' + maxBytes + '-byte cap for one response; the rest was not read');
    }
    chunks.push(Buffer.from(chunk));
  }
  meta.bytes += total;
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {object} options
 * @param {object} options.source     the manifest (endpoint_url, config, ...)
 * @param {object} options.config     the effective configuration (scenario overrides applied)
 * @param {AbortSignal} [options.signal]  the run's overall timeout
 * @param {function} [options.fetchImpl]  the platform fetch; tests pass their own
 * @param {string} [options.credential]   the source's own credential, already read from the environment
 * @returns {Promise<{kind: string, meta: object, readTextPage: function, readTextFile: function}>}
 */
async function openHttpTransport(options) {
  const source = options.source || {};
  const config = options.config || {};
  const policy = buildPolicy(source, config);

  const endpoint = checkUrl(source.endpoint_url, policy, null);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TransportError('no-fetch', 'this build has no fetch implementation to call');
  }

  const configuredTimeout = number(config.timeout_ms);
  const requestTimeoutMs = configuredTimeout !== null && configuredTimeout >= 50 ? configuredTimeout : DEFAULT_TIMEOUT_MS;
  const configuredMaxBytes = number(config.max_response_bytes);
  const maxBytes = clamp(configuredMaxBytes !== null && configuredMaxBytes > 0 ? configuredMaxBytes : DEFAULT_MAX_BYTES,
    1024, HARD_MAX_BYTES);
  const configuredRedirects = number(config.max_redirects);
  const maxRedirects = clamp(configuredRedirects !== null && configuredRedirects >= 0 ? configuredRedirects : DEFAULT_MAX_REDIRECTS,
    0, 5);
  const configuredPerPage = number(config.per_page);
  const perPage = clamp(configuredPerPage !== null && configuredPerPage > 0 ? configuredPerPage : DEFAULT_PER_PAGE, 1, 100);

  const credential = String(options.credential === null || options.credential === undefined ? '' : options.credential);
  const meta = {
    kind: 'http',
    host: hostOf(endpoint),
    port: endpoint.port || '',
    path: endpoint.pathname,
    scheme: endpoint.protocol.replace(':', ''),
    allowed_hosts: policy.allowed,
    allow_private_hosts: policy.allowPrivate,
    allow_insecure_http: policy.allowInsecure,
    per_page: perPage,
    requests: 0,
    pages: 0,
    bytes: 0,
    redirects: 0,
    credential_sent: credential !== ''
  };

  const hasSignal = options.signal && typeof options.signal.aborted === 'boolean';

  async function request(url, label) {
    const headers = { 'user-agent': USER_AGENT, accept: ACCEPT };
    if (credential !== '') headers.authorization = 'Bearer ' + credential;

    let current = url;
    let hop = 0;
    for (;;) {
      meta.requests += 1;
      const requestTimer = AbortSignal.timeout(requestTimeoutMs);
      const signal = hasSignal ? AbortSignal.any([options.signal, requestTimer]) : requestTimer;

      let response;
      try {
        response = await fetchImpl(current.toString(), {
          method: 'GET',
          headers: headers,
          redirect: 'manual',
          signal: signal
        });
      } catch (error) {
        if (hasSignal && options.signal.aborted) {
          const reason = options.signal.reason;
          throw reason instanceof Error ? reason : new TransportError('timeout', 'the run was aborted');
        }
        if (requestTimer.aborted) {
          throw new TransportError('timeout',
            label + ' did not answer within ' + requestTimeoutMs + ' ms (' + hostOf(current) + ')');
        }
        throw new TransportError('network',
          'could not reach ' + hostOf(current) + ': ' + String(error && error.message ? error.message : error));
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers && response.headers.get ? response.headers.get('location') : null;
        if (!location) {
          throw new TransportError('redirect-without-location',
            hostOf(current) + ' answered HTTP ' + response.status + ' without a Location header');
        }
        if (hop >= maxRedirects) {
          throw new TransportError('too-many-redirects',
            'more than ' + maxRedirects + ' redirect(s) from ' + hostOf(current) + '; a redirect chain is not followed further');
        }
        hop += 1;
        meta.redirects += 1;
        current = checkUrl(new URL(location, current).toString(), policy, hop);
        continue;
      }

      if (!response.ok) {
        let snippet = '';
        if (meta.credential_sent === false) {
          try {
            const text = await readCapped(response, ERROR_BODY_SNIPPET, { bytes: 0 });
            snippet = text.trim().replace(/\s+/g, ' ').slice(0, ERROR_BODY_SNIPPET);
          } catch (error) {
            snippet = '';
          }
        }
        throw new TransportError('http-status',
          label + ' answered HTTP ' + response.status
          + (response.statusText ? ' (' + response.statusText + ')' : '')
          + (snippet !== '' ? ': ' + snippet : ''),
          { status: response.status });
      }

      return await readCapped(response, maxBytes, meta);
    }
  }

  return {
    kind: 'http',
    meta: meta,

    /** One page's raw text. The transport sets `page` and `per_page`; the adapter parses. */
    async readTextPage(pageNumber) {
      const url = new URL(endpoint.toString());
      url.searchParams.set('page', String(pageNumber));
      url.searchParams.set('per_page', String(perPage));
      const text = await request(url, 'page ' + pageNumber);
      meta.pages += 1;
      return text;
    },

    /**
     * A single-file source (a CSV feed) over HTTP: one URL, no page parameters.
     * The name is the fixture transport's concept and is ignored here.
     */
    async readTextFile(name) {
      const text = await request(new URL(endpoint.toString()), String(name || 'the source'));
      meta.pages += 1;
      return text;
    }
  };
}

module.exports = {
  openHttpTransport: openHttpTransport,
  buildPolicy: buildPolicy,
  checkUrl: checkUrl,
  isPrivateHost: isPrivateHost,
  normaliseAllowedHost: normaliseAllowedHost,
  USER_AGENT: USER_AGENT,
  DEFAULT_MAX_BYTES: DEFAULT_MAX_BYTES,
  HARD_MAX_BYTES: HARD_MAX_BYTES,
  DEFAULT_PER_PAGE: DEFAULT_PER_PAGE
};
