'use strict';

/**
 * Phase 1 compliance-transport tests — CONTRACT RECONSTRUCTION — NOT
 * HISTORICAL BYTE-EXACT SOURCE.
 *
 * The original tests/compliance-transport.test.js (284 lines, 9 tests, all
 * green) was lost with the destroyed Phase 1 clone and is not recoverable
 * byte-for-byte. This file reconstructs its CONTRACT against the current
 * seven-file recovery tree: the same nine-test shape (5 SQL-contract,
 * 1 round-trip, 3 behavioural), the same surviving fragments where they
 * still fit (the 11-key resolved-shape round-trip assertion, the vm `fetch:`
 * shim line, the CATALOGUE scaffold with categories/catalogue_settings, the
 * scaffoldRpcs routing block, the supabaseAdapter-anchored demo-slice
 * tripwire, the init()-before-getProduct sequence), adapted where the
 * current implementation differs from history. Nothing here claims to be
 * the historical bytes.
 *
 * Honest scope: SQL contracts are asserted by static inspection of the
 * committed migration; the round-trip runs the REAL js/compliance.js; the
 * behavioural tests drive the REAL js/store.js live path inside a minimal
 * browser shim against a fake PostgREST that refuses unexpected tables (so
 * an accidental second network path fails loudly). No framework, no new
 * dependencies, no network: node:test + node:vm only.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MIGRATION = read('db/migrations/0018_merchant_offer_compliance.sql');
const STORE = read('js/store.js');
const COMPLIANCE_SRC = read('js/compliance.js');

const TRANSPORT_KEYS = [
  'pathway_mode', 'telemetry_blocking', 'price_display', 'availability_display',
  'content_refresh', 'image_handling', 'disclosure', 'disclaimers',
  'api_data_only', 'link_health', 'prohibited'
];

/* ------------------------------------------------------- browser shim -- */

function makeElement() {
  return {
    className: '', id: '', innerHTML: '', textContent: '', hidden: false,
    style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild(c) { this.children.push(c); return c; }, prepend() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, closest() { return null; }, outerHTML: ''
  };
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear()
  };
}

function makeBrowser(config, fetchImpl) {
  const document = {
    readyState: 'complete', body: makeElement(), documentElement: makeElement(),
    createElement: () => makeElement(), querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, addEventListener() {}, removeEventListener() {}
  };
  const window = {
    PV: {}, PV_CONFIG: config, localStorage: makeStorage(), sessionStorage: makeStorage(),
    location: { search: '', pathname: '/', origin: 'http://pickvanta.test' },
    history: { replaceState() {} }, navigator: {}, document, scrollY: 0,
    addEventListener() {}, removeEventListener() {}
  };
  if (fetchImpl) window.fetch = fetchImpl;
  window.window = window;
  return { window, document };
}

/* The full module boot, in the detail page's real script order minus the
   page controllers. The `fetch:` line exposes the transport to store.js's
   context-global lookup — the shim lesson from the historical file. */
function runIn(browser, source, filename) {
  vm.runInNewContext(source, {
    window: browser.window, document: browser.document, PV: browser.window.PV,
    navigator: browser.window.navigator,
    fetch: browser.window.fetch, URLSearchParams, Promise, console, setTimeout, clearTimeout,
    Object, Array, JSON, Map, Set, String, Number, Boolean, Date, RegExp,
    Error, Math, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent
  }, { filename: filename || 'module.js' });
  return browser.window.PV;
}

function apiStack(fetchImpl) {
  const browser = makeBrowser({
    mode: 'api',
    supabase: { url: 'https://fixtureproject.supabase.co', anonKey: 'fake-anon-key' },
    onFailure: 'error'
  }, fetchImpl);
  runIn(browser, read('js/data.js'), 'data.js');
  runIn(browser, COMPLIANCE_SRC, 'compliance.js');
  runIn(browser, read('js/domain.js'), 'domain.js');
  runIn(browser, STORE, 'store.js');
  return browser.window.PV;
}

/* ------------------------------------------------- fake PostgREST ------ */

const PRODUCT_ID = 'p0000000-0000-4000-8000-00000000000p';

const CATALOGUE = {
  products: [{ id: PRODUCT_ID, slug: 'tcl-55', name: 'TCL 55', brand: 'TCL', status: 'active' }],
  product_variants: [],
  merchant_offers: [
    { id: 'a-1', product_id: PRODUCT_ID, merchant_id: 'm-1', status: 'active' },
    { id: 'a-2', product_id: PRODUCT_ID, merchant_id: 'm-1', status: 'unavailable' }
  ],
  external_merchants: [{ id: 'm-1', name: 'Merchant A' }],
  merchant_offer_media: [
    { merchant_offer_id: 'a-1', source_media_url: 'https://cdn.test/i.jpg', media_type: 'image', attribution: '', sort_order: 0 }
  ],
  /* the api adapter's bootstrap reads (init() must succeed before getProduct) */
  categories: [],
  catalogue_settings: []
};

const scaffoldRpcs = { catalogue_stats: {}, catalogue_tags: [], catalogue_facets: {} };

const body200 = (obj) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => obj });

const parseBody = (options) => {
  let body = options && options.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (err) { body = null; } }
  return body;
};

function serveTables(url) {
  const rpc = url.match(/\/rest\/v1\/rpc\/([a-z_]+)/);
  if (rpc) {
    if (rpc[1] in scaffoldRpcs) return body200(scaffoldRpcs[rpc[1]]);
    if (rpc[1] === 'merchant_offer_compliance') return body200({});
    if (rpc[1] === 'affiliate_click_track') return body200('https://dest.test/go');
    throw new Error('unexpected rpc: ' + rpc[1]);
  }
  const m = url.match(/\/rest\/v1\/([a-z_]+)\?/);
  const table = m ? m[1] : '';
  if (!(table in CATALOGUE)) throw new Error('unexpected table: ' + table);
  return body200(CATALOGUE[table]);
}

/* ==================================================================== */
/* A. SQL contract tests (static inspection of the committed migration) */
/* ==================================================================== */

test('0018 exists with the expected function signature and public-path scope', () => {
  assert.ok(MIGRATION.includes('create or replace function public.merchant_offer_compliance('),
    'the transport function is created');
  assert.ok(MIGRATION.includes('p_product_id  uuid'), 'single uuid product parameter');
  assert.ok(MIGRATION.includes('returns jsonb'), 'jsonb answer');
  /* the scope: product-filtered, source-joined, public statuses only —
     0015's offers policy restated character for character */
  assert.ok(MIGRATION.includes('from public.merchant_offers o'), 'merchant_offers is the driver');
  assert.ok(MIGRATION.includes('join public.deal_sources s on s.id = o.source_id'),
    'canonical source join (0008 foreign key)');
  assert.ok(MIGRATION.includes('where o.product_id = p_product_id'), 'product-scoped');
  assert.ok(MIGRATION.includes("and o.status in ('active', 'unavailable')"),
    'only publicly visible offer statuses are reachable');
  assert.ok(MIGRATION.includes("v_row.config -> 'compliance'"),
    'the configuration projection reads the compliance key only');
});

test('0018 is SECURITY DEFINER, STABLE, and pins search_path — in the function and its self-check', () => {
  assert.ok(MIGRATION.includes('language plpgsql'), 'plpgsql');
  assert.ok(/returns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public, pg_temp\n/.test(MIGRATION),
    'the exact security header order: stable, definer, pinned search_path');
  /* the migration proves its own claims at apply time (0017 pattern) */
  assert.ok(MIGRATION.includes("raise exception 'merchant_offer_compliance must be SECURITY DEFINER.'"),
    'self-check: definer');
  assert.ok(MIGRATION.includes("raise exception 'merchant_offer_compliance must pin search_path = public, pg_temp.'"),
    'self-check: pinned search_path');
});

test('0018 grants exactly execute to anon and authenticated — and nothing else', () => {
  const revokeAt = MIGRATION.indexOf('revoke all on function public.merchant_offer_compliance(uuid) from public, anon, authenticated;');
  const grantAt = MIGRATION.indexOf('grant execute on function public.merchant_offer_compliance(uuid) to anon, authenticated;');
  assert.ok(revokeAt !== -1, 'revoke-all precedes the grant');
  assert.ok(grantAt !== -1, 'grant execute to anon + authenticated');
  assert.ok(revokeAt < grantAt, 'the revoke comes first');
  /* no table grant of any kind may appear anywhere in the file */
  assert.ok(!/grant (select|insert|update|delete|all) on (table )?public\./i.test(MIGRATION),
    'zero table grants');
  const selfCheck = MIGRATION.slice(MIGRATION.indexOf('do $$'));
  assert.ok(selfCheck.includes("has_function_privilege('anon', 'public.merchant_offer_compliance(uuid)', 'execute')"),
    'self-check: anon execute');
  assert.ok(selfCheck.includes("has_function_privilege('authenticated', 'public.merchant_offer_compliance(uuid)', 'execute')"),
    'self-check: authenticated execute');
});

test('deal_sources remains non-public: the self-check proves anon has no select and RLS stays on; 0015 is untouched', () => {
  assert.ok(MIGRATION.includes("if has_table_privilege('anon', 'public.deal_sources', 'select') then"),
    'self-check asserts anon must NOT select deal_sources');
  assert.ok(MIGRATION.includes("raise exception 'anon must not be able to select from deal_sources.'"),
    'and it fails loudly otherwise');
  assert.ok(MIGRATION.includes('select relrowsecurity from pg_class'),
    'self-check asserts deal_sources keeps row level security enabled');
  assert.ok(!/create policy/i.test(MIGRATION), 'no policy is created by 0018');
  assert.ok(!/alter table/i.test(MIGRATION), 'no table is altered by 0018');
  /* the boundary this transport deliberately narrows must still be the one
     0015 documented: public tables only, deal_sources gains nothing */
  const pub = read('db/migrations/0015_canonical_public_read.sql');
  assert.ok(pub.includes("grant select on public.merchant_offers"), '0015 still grants public offer reads');
  assert.ok(pub.includes("using (status in ('active', 'unavailable'))"),
    "0015's offers policy is still the verbatim visibility rule");
  assert.ok(!pub.includes('grant select on public.deal_sources'), '0015 still grants nothing on deal_sources');
});

test('the projection whitelists exactly the 11 transport keys and never merges raw config', () => {
  for (const key of TRANSPORT_KEYS) {
    assert.ok(MIGRATION.includes("'" + key + "',"), 'whitelisted key: ' + key);
  }
  /* the only way the answer grows is the per-offer build of literal keys */
  const buildSites = MIGRATION.match(/jsonb_build_object\(/g) || [];
  assert.strictEqual(buildSites.length, 2, 'one per-offer build inside one result build');
  const rawConfigReads = MIGRATION.match(/v_row\.config/g) || [];
  assert.strictEqual(rawConfigReads.length, 3,
    'v_row.config is touched only to derive v_comp (null check, typeof check, compliance extraction)');
  const afterDerivation = MIGRATION.slice(MIGRATION.indexOf('if v_comp is null'), MIGRATION.indexOf('end loop;'));
  assert.ok(!afterDerivation.includes('v_row.config'),
    'raw config never reaches the answer: the loop body after the derivation builds from v_comp only');
  assert.ok(MIGRATION.includes('v_result := v_result || jsonb_build_object('),
    'the result only ever accumulates built objects');
  assert.ok(MIGRATION.includes('continue;'),
    'malformed or absent compliance yields no entry rather than an exception');
  /* nothing credential-shaped or identity-shaped may cross */
  for (const forbidden of ['api_key', 'secret', 'password', 'token', 'affiliate_url', 'source_id']) {
    assert.ok(!MIGRATION.includes("'" + forbidden + "'"), 'no quoted output key: ' + forbidden);
  }
});

/* ============================================================ */
/* B. round-trip: the SQL transport shape through the real layer */
/* ============================================================ */

test('the 11 snake_case transport fields resolve through js/compliance.js to the exact camelCase profile', () => {
  const window = {};
  vm.runInNewContext(COMPLIANCE_SRC, { window }, { filename: 'compliance.js' });
  const C = window.PV.compliance;

  /* what the database function emits for a fully-configured source */
  const produced = {
    pathway_mode: 'direct-link',
    telemetry_blocking: false,
    price_display: 'never',
    availability_display: 'never',
    content_refresh: 'api-24h',
    image_handling: 'none',
    disclosure: 'associates',
    disclaimers: ['Prices are indicative'],
    api_data_only: ['price', 'availability'],
    link_health: 'none',
    prohibited: []
  };
  const resolved = C.normalize(produced);
  const expected = {
    pathwayMode: 'direct-link', telemetryBlocking: false,
    priceDisplay: 'never', availabilityDisplay: 'never',
    contentRefresh: 'api-24h', imageHandling: 'none', disclosure: 'associates',
    disclaimers: ['Prices are indicative'], apiDataOnly: ['price', 'availability'],
    linkHealth: 'none', prohibited: []
  };
  /* JSON comparison: the normalize() arrays come from the vm realm, whose
     Array prototype would fail a strict deep-equal on reference identity
     alone — the structure is what this contract is about. */
  assert.strictEqual(JSON.stringify(resolved), JSON.stringify(expected),
    'every field the SQL can emit is understood and kept verbatim by the browser');
  assert.strictEqual(JSON.stringify(C.forOffer({ id: 'x', compliance: produced })), JSON.stringify(expected),
    'forOffer resolves the same transport shape off a real offer');
  /* absent profile -> the historical default, exactly */
  assert.strictEqual(JSON.stringify(C.forOffer(null)), JSON.stringify({
    pathwayMode: 'tracked-redirect', telemetryBlocking: true, priceDisplay: 'source',
    availabilityDisplay: 'source', contentRefresh: 'none', imageHandling: 'none',
    disclosure: 'none', disclaimers: [], apiDataOnly: [], linkHealth: 'none', prohibited: []
  }), 'no profile behaves exactly as PickVanta always has');
});

/* ================================================= */
/* C. behavioural transport tests (real store path)  */
/* ================================================= */

test('a live product load calls the compliance RPC once, by exact name and parameter, and attaches profiles by offer id', async () => {
  const requests = [];
  const pv = apiStack(async (url, options) => {
    const u = String(url);
    requests.push({ url: u, method: (options && options.method) || 'GET', body: parseBody(options) });
    if (u.indexOf('/rest/v1/rpc/merchant_offer_compliance') !== -1) {
      return body200({ 'a-2': { pathway_mode: 'direct-link', price_display: 'never' } });
    }
    return serveTables(u);
  });
  await pv.store.init();                       /* init() BEFORE getProduct */
  const model = await pv.store.getProduct('tcl-55');

  const calls = requests.filter((r) => r.url.indexOf('/rest/v1/rpc/merchant_offer_compliance') !== -1);
  assert.strictEqual(calls.length, 1, 'exactly one compliance RPC per product load');
  assert.strictEqual(calls[0].method, 'POST', 'the rpc is a POST through postRpc');
  assert.deepStrictEqual(calls[0].body, { p_product_id: PRODUCT_ID },
    'the rpc carries exactly { p_product_id: <product id> }');

  const a1 = model.offers.find((o) => o.id === 'a-1');
  const a2 = model.offers.find((o) => o.id === 'a-2');
  assert.ok(a2.compliance && a2.compliance.pathway_mode === 'direct-link' && a2.compliance.price_display === 'never',
    'the profiled offer carries the server answer verbatim (the browser normalizer reads snake_case)');
  assert.strictEqual(a1.compliance, null, 'an offer without an entry wears null, not a default object');
  assert.ok(a1.merchant && a1.merchant.name === 'Merchant A' && a1.media.length === 1,
    'the existing merchant/media join is untouched by the transport');
  assert.strictEqual(model.product.slug, 'tcl-55', 'the product structure is unchanged');
});

test('a failing or malformed compliance answer must never fail the product load', async () => {
  const failing = apiStack(async (url) => {
    if (String(url).indexOf('/rest/v1/rpc/merchant_offer_compliance') !== -1) {
      return { ok: false, status: 500, headers: { get: () => null }, text: async () => 'rpc exploded' };
    }
    return serveTables(String(url));
  });
  await failing.store.init();
  const model = await failing.store.getProduct('tcl-55');
  assert.strictEqual(model.product.slug, 'tcl-55', 'the product still loads');
  assert.ok(model.offers.every((o) => o.compliance === null), 'every offer falls back to null');

  for (const weird of [null, 'nope', 42, [1, 2]]) {
    const pv = apiStack(async (url) => {
      if (String(url).indexOf('/rest/v1/rpc/merchant_offer_compliance') !== -1) return body200(weird);
      return serveTables(String(url));
    });
    await pv.store.init();
    const m = await pv.store.getProduct('tcl-55');
    assert.ok(m.offers.every((o) => o.compliance === null),
      'non-object answer ' + JSON.stringify(weird) + ' falls back to null without failing the load');
  }
});

test('scope tripwires: the demo adapter stays isolated, the transport stays on the supabase product path, and no second network path exists', () => {
  /* the demo slice, anchored at the real adapter boundary, must not know
     the transport exists */
  const demo = STORE.slice(STORE.indexOf('const demoAdapter ='), STORE.indexOf('const supabaseAdapter ='));
  assert.ok(demo.length > 1000, 'the demo slice is the real demo region');
  assert.ok(!demo.includes('merchant_offer_compliance'), 'the demo adapter never calls the compliance RPC');

  /* the transport lives exactly once, on the supabase-backed product path */
  assert.strictEqual(STORE.split('merchant_offer_compliance').length - 1, 1,
    'merchant_offer_compliance appears exactly once in store.js');
  const supabase = STORE.slice(STORE.indexOf('const supabaseAdapter ='));
  assert.ok(supabase.includes("postRpc('rpc/merchant_offer_compliance'"),
    'the rpc rides the existing postRpc abstraction');

  /* the api adapter owns the only outbound primitives — the two table
     request() helpers and postRpc, each with exactly one return-fetch —
     and the demo adapter owns none. A new transport anywhere would change
     these counts. */
  const fetchSites = STORE.match(/return fetch\(/g) || [];
  assert.strictEqual(fetchSites.length, 3,
    'exactly three fetch call sites store-wide (request x2 + postRpc)');
  const adapterAt = STORE.indexOf('const supabaseAdapter =');
  let probe = 0, site = 0;
  while ((site = STORE.indexOf('return fetch(', site)) !== -1) {
    assert.ok(site > adapterAt, 'every fetch site lives in the supabase adapter, never the demo path');
    probe += 1; site += 1;
  }
  assert.strictEqual(probe, 3, 'all three sites verified by position');
  assert.ok(!/XMLHttpRequest|EventSource|WebSocket|sendBeacon/.test(STORE),
    'no exotic second network path in store.js');
});
