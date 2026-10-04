'use strict';

/**
 * Phase 1 compliance tests — CONTRACT RECONSTRUCTION — NOT HISTORICAL
 * BYTE-EXACT SOURCE.
 *
 * The original tests/compliance.test.js (345 lines, 14 tests, all green,
 * part of the historical 200-test battery) was lost with the destroyed
 * Phase 1 clone. This file reconstructs its attested 14-point contract
 * matrix against the current recovery tree, adapted where the current tree
 * differs from history. Nothing here claims to be the historical bytes.
 *
 * Honest scope, and the one structural adaptation forced by this
 * environment: points 1–10, 13 and 14 are static inspections (of the
 * committed migration, the runtime modules and the page wiring); points
 * 7–12 are additionally exercised behaviourally where the tree allows it —
 * through the REAL js/store.js live path and the REAL js/detail.js renderer
 * inside a minimal browser shim against a fake PostgREST that refuses
 * unexpected tables. The historical suite could read the database; this one
 * must not, so database-side points are asserted at source level (the same
 * tripwire style as the reconstructed transport suite). No framework, no
 * new dependencies, no network: node:test + node:vm only.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MIGRATION = read('db/migrations/0018_merchant_offer_compliance.sql');
const STORE = read('js/store.js');
const DETAIL = read('js/detail.js');
const DOMAIN = read('js/domain.js');
const CORE = read('js/core.js');
const COMPLIANCE_SRC = read('js/compliance.js');
const HTML = read('detail.html');
const FRONTEND_TEST = read('tests/frontend.test.js');

const TRANSPORT_KEYS = [
  'pathway_mode', 'telemetry_blocking', 'price_display', 'availability_display',
  'content_refresh', 'image_handling', 'disclosure', 'disclaimers',
  'api_data_only', 'link_health', 'prohibited'
];
const DEFAULT_PROFILE = {
  pathwayMode: 'tracked-redirect', telemetryBlocking: true, priceDisplay: 'source',
  availabilityDisplay: 'source', contentRefresh: 'none', imageHandling: 'none',
  disclosure: 'none', disclaimers: [], apiDataOnly: [], linkHealth: 'none', prohibited: []
};

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
  const els = {};
  const document = {
    readyState: 'complete', body: makeElement(), documentElement: makeElement(),
    createElement: () => makeElement(),
    querySelector(sel) { if (!els[sel]) els[sel] = makeElement(sel); return els[sel]; },
    querySelectorAll: () => [],
    getElementById: () => null, addEventListener() {}, removeEventListener() {}
  };
  const window = {
    PV: {}, PV_CONFIG: config, localStorage: makeStorage(), sessionStorage: makeStorage(),
    location: { search: '?id=test-product', pathname: '/detail.html', origin: 'http://pickvanta.test' },
    history: { replaceState() {} }, navigator: {}, document, scrollY: 0,
    addEventListener() {}, removeEventListener() {}
  };
  if (fetchImpl) window.fetch = fetchImpl;
  window.window = window;
  return { window, document, els };
}

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

const MODULES = ['js/data.js', 'js/compliance.js', 'js/domain.js', 'js/store.js'];

function apiStack(fetchImpl) {
  const browser = makeBrowser({
    mode: 'api',
    supabase: { url: 'https://fixtureproject.supabase.co', anonKey: 'fake-anon-key' },
    onFailure: 'error'
  }, fetchImpl);
  MODULES.forEach((f, i) => runIn(browser, read(f), f));
  return browser.window.PV;
}

function detailStack(detailSource) {
  const browser = makeBrowser({});
  MODULES.concat(['js/core.js']).forEach((f) => runIn(browser, read(f), f));
  runIn(browser, detailSource, 'detail-under-test.js');
  return { PV: browser.window.PV, els: browser.els };
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
  merchant_offer_media: [],
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

const complianceModule = () => {
  const window = {};
  vm.runInNewContext(COMPLIANCE_SRC, { window }, { filename: 'compliance.js' });
  return window.PV.compliance;
};

/* ===================================================================== */
/* Point 1 — SQL migration 0018 exists with the required signature.      */
/* ===================================================================== */

test('0018 exists with the required function signature', () => {
  assert.ok(MIGRATION.length > 0, 'the migration file exists and is non-empty');
  assert.ok(MIGRATION.includes('create or replace function public.merchant_offer_compliance('),
    'the function is created by name');
  assert.ok(MIGRATION.includes('p_product_id  uuid'), 'single uuid parameter p_product_id');
  assert.ok(MIGRATION.includes('returns jsonb'), 'returns jsonb');
  assert.ok(/returns jsonb\nlanguage plpgsql/.test(MIGRATION), 'plpgsql function');
  assert.ok(MIGRATION.includes('from public.merchant_offers o')
    && MIGRATION.includes('join public.deal_sources s on s.id = o.source_id')
    && MIGRATION.includes('where o.product_id = p_product_id'),
    'product-scoped merchant_offers joined to deal_sources');
});

/* ===================================================================== */
/* Point 2 — SECURITY DEFINER with the pinned search_path (and STABLE).  */
/* ===================================================================== */

test('the function is STABLE, SECURITY DEFINER, with search_path pinned to public, pg_temp', () => {
  assert.ok(/returns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public, pg_temp\n/.test(MIGRATION),
    'the exact security header, in order');
  assert.ok(MIGRATION.includes("raise exception 'merchant_offer_compliance must be SECURITY DEFINER.'"),
    'the self-check enforces definer at apply time');
  assert.ok(MIGRATION.includes("raise exception 'merchant_offer_compliance must pin search_path = public, pg_temp.'"),
    'the self-check enforces the pinned search_path at apply time');
});

/* ===================================================================== */
/* Point 3 — Execute grants are correct.                                 */
/* ===================================================================== */

test('execute grants are exactly revoke-all then grant-execute to anon and authenticated', () => {
  const revokeAt = MIGRATION.indexOf('revoke all on function public.merchant_offer_compliance(uuid) from public, anon, authenticated;');
  const grantAt = MIGRATION.indexOf('grant execute on function public.merchant_offer_compliance(uuid) to anon, authenticated;');
  assert.ok(revokeAt !== -1 && grantAt !== -1, 'both statements present');
  assert.ok(revokeAt < grantAt, 'the revoke precedes the grant');
  assert.ok(!/grant (select|insert|update|delete|all) on (table )?public\./i.test(MIGRATION),
    'no table grant of any kind exists in the migration');
  const selfCheck = MIGRATION.slice(MIGRATION.indexOf('do $$'));
  assert.ok(selfCheck.includes("has_function_privilege('anon', 'public.merchant_offer_compliance(uuid)', 'execute')")
    && selfCheck.includes("has_function_privilege('authenticated', 'public.merchant_offer_compliance(uuid)', 'execute')"),
    'the self-check verifies both roles at apply time');
});

/* ===================================================================== */
/* Point 4 — deal_sources is not publicly readable.                      */
/* ===================================================================== */

test('deal_sources is not PUBLICLY readable: anon is never granted it, authenticated only via the admin policy, and 0018 enforces that', () => {
  const migrations = fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql'));
  assert.ok(migrations.some((f) => f.indexOf('0018') === 0), '0018 is among the migrations');
  for (const file of migrations) {
    const text = read(path.join('db', 'migrations', file))
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    /* whole DDL statements only: split on ';' and keep chunks that BEGIN
       with the grant keyword, so privilege-audit SELECTs (information_schema
       role_*_grants checks) can never be mistaken for grant statements */
    for (const statement of text.split(';')) {
      if (!/^\s*grant\b/i.test(statement)) continue;
      if (!/public\.deal_sources(?![a-z_])/i.test(statement)) continue;
      assert.ok(!/\banon\b/i.test(statement), file + ': no grant statement on deal_sources names anon');
      if (/grant\s+select/i.test(statement)) {
        /* an authenticated grant is allowed only with the admin gate beside it */
        assert.ok(text.includes('create policy deal_sources_select_admin on public.deal_sources')
          && text.includes('using (public.is_admin());'),
          file + ': authenticated select on deal_sources is gated by the is_admin policy');
      }
    }
    /* no PUBLIC policy and no anon-facing policy may exist on the table */
    assert.ok(!/create policy[\s\S]{0,120}?on\s+public\.deal_sources[\s\S]{0,120}?\bto\s+anon\b/i.test(text),
      file + ': no anon policy on deal_sources');
  }
  /* 0005 established the shape; verify it explicitly (the historical
     "admin-only" line this whole contract rests on) */
  const f5 = read('db/migrations/0005_deal_engine_foundation.sql');
  assert.ok(f5.includes('revoke all on public.deal_sources'), '0005 revokes deal_sources from anon/authenticated');
  assert.ok(f5.includes('create policy deal_sources_select_admin on public.deal_sources')
    && f5.includes('using (public.is_admin());'), '0005 read access is admin-gated, not public');
  /* 0018 enforces the anon side inside its own self-check */
  assert.ok(MIGRATION.includes("if has_table_privilege('anon', 'public.deal_sources', 'select') then")
    && MIGRATION.includes("raise exception 'anon must not be able to select from deal_sources.'"),
    '0018 fails loudly if anon could read deal_sources');
  assert.ok(MIGRATION.includes('select relrowsecurity from pg_class'),
    '0018 asserts deal_sources keeps row level security enabled');
  /* and 0015's documented stance is untouched */
  const pub = read('db/migrations/0015_canonical_public_read.sql');
  assert.ok(pub.includes("using (status in ('active', 'unavailable'))"), '0015 offers policy verbatim');
  assert.ok(!pub.includes('grant select on public.deal_sources'), '0015 grants nothing on deal_sources');
});

/* ===================================================================== */
/* Point 5 — the compliance vocabulary is whitelist-only.                */
/* ===================================================================== */

test('the compliance vocabulary is whitelist-only, identically on both sides of the boundary', () => {
  for (const key of TRANSPORT_KEYS) {
    assert.ok(MIGRATION.includes("'" + key + "',"), 'sql whitelists: ' + key);
  }
  const jsKeys = Object.keys(JSON.parse(JSON.stringify((() => {
    const C = complianceModule();
    return C.normalize(null);
  })())));
  assert.deepStrictEqual(jsKeys.sort(), Object.keys(DEFAULT_PROFILE).sort(),
    'the resolved profile has exactly the 11 camelCase fields');
  /* every enum value in the migration appears in the module, and vice versa */
  const enumValues = ['tracked-redirect', 'direct-link', 'source', 'never', 'api-only',
    'none', 'api-24h', 'api-links-refreshed', 'associates', 'api-backed'];
  for (const value of enumValues) {
    assert.ok(MIGRATION.includes("'" + value + "'"), 'sql vocabulary value: ' + value);
    assert.ok(COMPLIANCE_SRC.includes("'" + value + "'"), 'module vocabulary value: ' + value);
  }
});

/* ===================================================================== */
/* Point 6 — unknown keys cannot escape through the projection.          */
/* ===================================================================== */

test('unknown keys cannot escape: the sql builds literals only and the module outputs a literal shape', () => {
  const buildSites = MIGRATION.match(/jsonb_build_object\(/g) || [];
  assert.strictEqual(buildSites.length, 2, 'one result build, one per-offer build — nothing else');
  const afterDerivation = MIGRATION.slice(MIGRATION.indexOf('if v_comp is null'), MIGRATION.indexOf('end loop;'));
  assert.ok(!afterDerivation.includes('v_row.config'),
    'raw config never reaches the answer after the v_comp derivation');
  const C = complianceModule();
  const hostile = { evil: 'x', credentials: 'y', api_key: 'z', config: { nested: true },
    pathway_mode: 'direct-link' };
  const out = C.normalize(hostile);
  assert.strictEqual(Object.keys(JSON.parse(JSON.stringify(out))).length, 11,
    'the resolved output carries exactly 11 keys no matter what went in');
  assert.ok(!JSON.stringify(out).includes('evil'), 'unknown keys are dropped');
});

/* ===================================================================== */
/* Points 7 + 8 — status predicate: inactive excluded, public included.  */
/* ===================================================================== */

test('inactive/draft/archived offers are excluded: nothing outside the public pair is admitted', () => {
  assert.ok(MIGRATION.includes("and o.status in ('active', 'unavailable')"),
    'the predicate restated character for character');
  /* nothing else may sneak into the admitted set */
  const predicate = MIGRATION.match(/and o\.status in \(([^)]*)\)/)[1];
  const admitted = predicate.replace(/'/g, '').split(',').map((s) => s.trim()).sort();
  assert.deepStrictEqual(admitted, ['active', 'unavailable'],
    'exactly two statuses, no draft/pending/archived/expired');
  for (const hidden of ['draft', 'pending', 'archived', 'expired']) {
    assert.ok(!admitted.includes(hidden), hidden + ' offers are unreachable through the transport');
  }
});

test('active and unavailable offers are both included — the same rule the public offers table itself uses', () => {
  const predicate = MIGRATION.match(/and o\.status in \(([^)]*)\)/)[1];
  const admitted = predicate.replace(/'/g, '').split(',').map((s) => s.trim()).sort();
  assert.ok(admitted.includes('active') && admitted.includes('unavailable'),
    'both public statuses are admitted');
  const pub = read('db/migrations/0015_canonical_public_read.sql');
  assert.ok(pub.includes("using (status in ('active', 'unavailable'))"),
    '0015 public policy is the identical visibility rule');
});

/* ===================================================================== */
/* Point 9 — multiple sources remain independent.                        */
/* ===================================================================== */

test('multiple sources remain independent, per offer, through the real store attach', async () => {
  let calls = 0;
  const pv = apiStack(async (url, options) => {
    if (String(url).indexOf('/rest/v1/rpc/merchant_offer_compliance') !== -1) {
      calls += 1;
      /* two different sources' profiles answered in one keyed map */
      return body200({
        'a-1': { pathway_mode: 'direct-link', disclosure: 'associates' },
        'a-2': { pathway_mode: 'tracked-redirect', price_display: 'never' }
      });
    }
    return serveTables(String(url));
  });
  await pv.store.init();
  const model = await pv.store.getProduct('tcl-55');
  const a1 = model.offers.find((o) => o.id === 'a-1');
  const a2 = model.offers.find((o) => o.id === 'a-2');
  assert.strictEqual(calls, 1, 'one rpc for the whole product');
  assert.ok(a1.compliance.pathway_mode === 'direct-link' && a1.compliance.disclosure === 'associates',
    'offer a-1 wears only its own profile');
  assert.ok(a2.compliance.pathway_mode === 'tracked-redirect' && a2.compliance.price_display === 'never',
    'offer a-2 wears only its own profile');
  assert.ok(!('price_display' in a1.compliance) && !('disclosure' in a2.compliance),
    'no profile bleeds into the other offer');
  /* and the engine keeps them independent on the resolved layer too */
  const C = complianceModule();
  assert.strictEqual(JSON.parse(JSON.stringify(C.forOffer(a1))).disclosure, 'associates');
  assert.strictEqual(JSON.parse(JSON.stringify(C.forOffer(a2))).priceDisplay, 'never');
});

/* ===================================================================== */
/* Point 10 — malformed/absent compliance safely produces no profile.    */
/* ===================================================================== */

test('malformed or absent compliance safely falls back: no entry server-side, default client-side, never a throw', () => {
  assert.ok(MIGRATION.includes('if v_comp is null or jsonb_typeof(v_comp) <> \'object\' then'),
    'the sql skips malformed and absent objects');
  assert.ok(MIGRATION.includes('continue;'), 'by continuing, not raising');
  const C = complianceModule();
  for (const bad of [null, undefined, 'text', 42, [], {}, { pathway_mode: { deep: null } }]) {
    const resolved = JSON.parse(JSON.stringify(C.normalize(bad)));
    assert.deepStrictEqual(resolved, DEFAULT_PROFILE,
      'malformed input ' + JSON.stringify(bad) + ' resolves to the historical default');
  }
  const partial = JSON.parse(JSON.stringify(C.normalize({ pathway_mode: 'direct-link', disclosure: 'nonsense' })));
  assert.strictEqual(partial.pathwayMode, 'direct-link', 'valid fields survive');
  assert.strictEqual(partial.disclosure, 'none', 'invalid fields default individually');
  assert.strictEqual(JSON.parse(JSON.stringify(C.forOffer(null))).pathwayMode, 'tracked-redirect',
    'a compliance-less offer is the historical case, not an error');
});

/* ===================================================================== */
/* Point 11 — RPC failure preserves product loading.                     */
/* ===================================================================== */

test('a failing compliance RPC preserves product loading and degrades to the legacy model', async () => {
  const failing = apiStack(async (url) => {
    if (String(url).indexOf('/rest/v1/rpc/merchant_offer_compliance') !== -1) {
      return { ok: false, status: 503, headers: { get: () => null }, text: async () => 'unavailable' };
    }
    return serveTables(String(url));
  });
  await failing.store.init();
  const model = await failing.store.getProduct('tcl-55');
  assert.strictEqual(model.product.slug, 'tcl-55', 'the product loads through the rpc failure');
  assert.ok(model.offers.every((o) => o.compliance === null), 'every offer degrades to null');
  assert.ok(model.offers.every((o) => o.merchant !== undefined), 'the merchant join still completed');
  for (const weird of [null, 'text', 7, ['x']]) {
    const pv = apiStack(async (url) => {
      if (String(url).indexOf('/rest/v1/rpc/merchant_offer_compliance') !== -1) return body200(weird);
      return serveTables(String(url));
    });
    await pv.store.init();
    const m = await pv.store.getProduct('tcl-55');
    assert.ok(m.offers.every((o) => o.compliance === null),
      'non-object answer ' + JSON.stringify(weird) + ' is absorbed');
  }
});

/* ===================================================================== */
/* Point 12 — Jumia/default tracked flow remains unchanged.              */
/* (Adaptation, documented: no Jumia-specific code exists anywhere by    */
/* design; the historical point means the DEFAULT tracked pathway such   */
/* offers ride is unchanged. Asserted behaviourally + at source level.)  */
/* ===================================================================== */

test('the default tracked pathway is unchanged: compliance-less offers keep the legacy tracked anchor and recording', async () => {
  const page = detailStack(DETAIL);
  const pv = page.PV;
  pv.store.getListing = () => Promise.resolve(null);
  pv.store.getProduct = () => Promise.resolve({
    product: { id: 'prod-1', slug: 'test-product', name: 'T', categoryId: '', status: 'active', currency: 'KES', specifications: [] },
    variants: [],
    offers: [
      { id: 'off-1', status: 'active', priceAmount: 1299, currency: 'KES', affiliateUrl: 'https://merchant.example/tracked?x=1', merchant: { id: 'm1', name: 'Merchant One' }, media: [] }
    ]
  });
  pv.store.affiliateClick = (offer) => Promise.resolve({ tracked: true, destination: 'https://tracked.example/go' });
  await new Promise((r) => setTimeout(r, 20));
  const html = page.els['#detail'] ? page.els['#detail'].innerHTML : (function () { throw new Error('page did not render'); }());
  assert.ok(html.includes('data-offer-link="affiliate"'), 'the tracked selector is rendered for a compliance-less offer');
  assert.ok(html.includes('rel="noopener noreferrer nofollow"'), 'the legacy rel tokens are preserved');
  assert.ok(html.includes('href="https://merchant.example/tracked?x=1"'), 'the affiliate URL is untouched');
  assert.ok(!html.includes('affiliate-direct'), 'no direct-link pathway for an unprofiled offer');
  assert.ok(!html.includes('Amazon Associate'), 'no disclosure for an unprofiled offer');
  /* the tracked recording contract is byte-preserved in the store */
  assert.ok(STORE.includes("postRpc('rpc/affiliate_click_track', { p_offer_id: offerId })"),
    'the tracked click still uses the same rpc and payload');
});

/* ===================================================================== */
/* Point 13 — the compliance layer is self-consistent across its whole   */
/* vocabulary (the suite-level self-check the historical point 13        */
/* guaranteed by the suite passing as a whole).                          */
/* ===================================================================== */

test('the compliance engine honours every vocabulary value and defaults every invalid one, field by field', () => {
  const C = complianceModule();
  const sweep = {
    pathwayMode: ['tracked-redirect', 'direct-link'],
    priceDisplay: ['source', 'never', 'api-only'],
    availabilityDisplay: ['source', 'never', 'api-only'],
    contentRefresh: ['none', 'api-24h'],
    imageHandling: ['none', 'api-links-refreshed'],
    disclosure: ['none', 'associates'],
    linkHealth: ['none', 'api-backed']
  };
  for (const [field, values] of Object.entries(sweep)) {
    for (const value of values) {
      const out = JSON.parse(JSON.stringify(C.normalize({ [field]: value })));
      assert.strictEqual(out[field], value, field + ' accepts ' + value);
      /* and nothing else moved */
      const others = Object.keys(DEFAULT_PROFILE).filter((k) => k !== field);
      assert.ok(others.every((k) => JSON.stringify(out[k]) === JSON.stringify(DEFAULT_PROFILE[k])),
        field + '=' + value + ' leaves every other field at default');
    }
    const bad = JSON.parse(JSON.stringify(C.normalize({ [field]: 'not-a-vocabulary-value' })));
    assert.strictEqual(bad[field], DEFAULT_PROFILE[field], field + ' rejects out-of-vocabulary values');
  }
  const boolean = JSON.parse(JSON.stringify(C.normalize({ telemetry_blocking: false })));
  assert.strictEqual(boolean.telemetryBlocking, false, 'telemetry_blocking accepts a real boolean');
  assert.strictEqual(JSON.parse(JSON.stringify(C.normalize({ telemetryBlocking: 'false' }))).telemetryBlocking, true,
    'telemetry_blocking rejects strings');
  const lists = JSON.parse(JSON.stringify(C.normalize({ disclaimers: ['  keep ', '', 42, null], prohibited: ['x'] })));
  assert.deepStrictEqual(lists.disclaimers, ['keep'], 'string lists keep trimmed strings only');
  assert.deepStrictEqual(lists.prohibited, ['x'], 'each list is independent');
});

/* ===================================================================== */
/* Point 14 — the broader frontend baseline remains in place.            */
/* (Adaptation, documented: the historical point ran the whole frontend  */
/* + connector battery from within the suite; this reconstruction asserts*/
/* the baseline's structural preconditions and leaves the run to the     */
/* repository's own suites, which this file's commit is validated by.)   */
/* ===================================================================== */

test('the frontend baseline is intact: boot order, the pre-existing suite, and the boundary files are untouched', () => {
  /* the page loads the module before its two consumers, exactly once */
  const order = (HTML.match(/<script src="(js\/[a-z0-9.-]+\.js)"/g) || [])
    .map((t) => t.replace('<script src="', '').replace(/"$/, ''));
  const ci = order.indexOf('js/compliance.js');
  assert.ok(order.indexOf('js/compliance.js') === order.lastIndexOf('js/compliance.js'), 'loaded exactly once');
  assert.ok(ci !== -1 && ci < order.indexOf('js/domain.js') && ci < order.indexOf('js/detail.js'),
    'compliance.js loads before domain.js and detail.js');
  /* both consumers enforce the order loudly rather than silently degrading */
  assert.ok(DOMAIN.includes('load js/compliance.js before js/domain.js.'), 'domain guard present');
  assert.ok(DETAIL.includes('requires js/compliance.js'), 'detail guard present');
  /* the pre-existing frontend suite is still present and unmodified from base */
  assert.ok(FRONTEND_TEST.includes('Frontend regression tests'), 'frontend.test.js is present');
  const base = execFileSync('git', ['show', 'c1e38d3:tests/frontend.test.js'],
    { cwd: ROOT, maxBuffer: 1e7 }).toString();
  assert.strictEqual(FRONTEND_TEST, base, 'frontend.test.js is byte-identical to the base it regresses');
  /* the boundary files the transport must never have touched */
  assert.ok(!STORE.includes('amazon'), 'store.js gained no merchant-specific code');
  assert.ok(!CORE.includes('postRpc'), 'core.js gained no network path');
  assert.ok(read('connectors/lib/db/client.js').includes("jobStart: 'import_job_start'"),
    'the connector boundary file is untouched');
});
