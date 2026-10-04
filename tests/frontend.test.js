'use strict';

/**
 * Frontend regression tests — Controlled Fix 1 (compare tray empty state +
 * detail-page Save wiring).
 *
 * Honest scope: these tests run the REAL js/core.js in Node inside a minimal
 * browser shim (localStorage, document, window) and exercise the browser-local
 * stores' actual behaviour — persistence across a simulated page load, the
 * empty state, URL-parameter round-trips, max-three, pruning, and the
 * favorites contract. What they cannot do without a DOM is execute the page
 * controllers (js/compare.js, js/detail.js run against a real document), so
 * the page-level wiring is asserted at source level — the same tripwire style
 * connectors/test/boundary.test.js uses. A real-browser click-through remains
 * outstanding live verification.
 *
 * No framework, no new dependencies: node:test + node:vm only.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const COMPARE_KEY = 'pickvanta.compare.v1';
const FAVORITES_KEY = 'pickvanta.favorites.v1';

/* ------------------------------------------------------- browser shim -- */

function makeElement() {
  const classes = new Set();
  return {
    className: '', id: '', innerHTML: '', textContent: '', hidden: false,
    style: {}, children: [],
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : force;
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
      contains: (name) => classes.has(name)
    },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild(child) { this.children.push(child); return child; },
    prepend() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, closest() { return null; },
    outerHTML: ''
  };
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear()
  };
}

/** One "browser": storage survives between loadCore() calls, like a real profile. */
function makeBrowser() {
  const storage = fakeStorage();
  const document = {
    readyState: 'complete',
    body: makeElement(),
    documentElement: makeElement(),
    createElement: () => makeElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {}
  };
  const location = { search: '', pathname: '/compare.html', origin: 'http://pickvanta.test', href: 'http://pickvanta.test/compare.html' };
  const historyOps = [];
  const window = {
    PV: {
      store: {
        /* Enough of the data layer for the stores under test: records resolve
           to just their ids; a test can override `hydrate` to simulate a
           catalogue that has forgotten some of them. */
        item: () => null,
        items: () => [],
        hydrate: (ids) => Promise.resolve(ids.map((id) => ({ id }))),
        catalogue: () => ({ live: false })
      }
    },
    localStorage: storage,
    sessionStorage: fakeStorage(),
    location: location,
    history: { replaceState: (...args) => historyOps.push(args) },
    historyOps: historyOps,
    navigator: {},
    document: document,
    scrollY: 0,
    addEventListener() {}, removeEventListener() {}
  };
  window.window = window;
  return { window, document, location, storage, historyOps };
}

function loadCore(browser) {
  const source = fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8');
  vm.runInNewContext(source, {
    window: browser.window,
    document: browser.document,
    PV: browser.window.PV,
    navigator: browser.window.navigator,
    URLSearchParams, Promise, console, setTimeout, clearTimeout,
    Object, Array, JSON, Map, Set, String, Number, Boolean, Date, RegExp,
    Error, Math, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent
  });
  return browser.window.PV;
}

const readSource = (name) => fs.readFileSync(path.join(ROOT, 'js', name), 'utf8');

/* ------------------------------------------------- the compare store -- */

test('the comparison store never seeds itself: an empty browser starts empty and stays empty', () => {
  const browser = makeBrowser();
  let PV = loadCore(browser);
  assert.equal(PV.compare.count(), 0);
  PV = loadCore(browser); // a later page load, same browser profile
  assert.equal(PV.compare.count(), 0, 'no defaults may appear on a revisit');
  assert.deepEqual(JSON.parse(browser.storage.getItem(COMPARE_KEY) || '[]'), []);
});

test('a cleared selection stays cleared across page loads (the reported bug, at store level)', () => {
  const browser = makeBrowser();
  let PV = loadCore(browser);
  PV.compare.add('a', 'A');
  PV.compare.add('b', 'B');
  assert.equal(PV.compare.count(), 2);
  PV.compare.clear();
  PV = loadCore(browser);
  assert.equal(PV.compare.count(), 0, 'clearing must survive reload and navigation');
  PV = loadCore(browser);
  assert.equal(PV.compare.count(), 0, 'and must not be re-seeded by a later visit');
});

test('an explicit share link (?ids=a,b,c) restores exactly that selection across page loads', () => {
  const browser = makeBrowser();
  let PV = loadCore(browser);
  PV.compare.set(['headphones-quietmax-700', 'headphones-basswave-700', 'headphones-airflow-studio-pro']);
  PV = loadCore(browser);
  assert.deepEqual(PV.compare.ids(),
    ['headphones-quietmax-700', 'headphones-basswave-700', 'headphones-airflow-studio-pro']);
});

test('max three, manual add/remove and toggling are unchanged', () => {
  const browser = makeBrowser();
  const PV = loadCore(browser);
  assert.equal(PV.compare.add('a', 'A'), true);
  assert.equal(PV.compare.add('b', 'B'), true);
  assert.equal(PV.compare.add('c', 'C'), true);
  assert.equal(PV.compare.add('d', 'D'), false, 'a fourth option is refused');
  assert.equal(PV.compare.count(), 3);
  PV.compare.remove('b');
  assert.deepEqual(PV.compare.ids(), ['a', 'c']);
  assert.equal(PV.compare.has('d'), false);
  PV.compare.toggle('d', 'D');
  assert.equal(PV.compare.has('d'), true);
  PV.compare.toggle('d', 'D');
  assert.equal(PV.compare.has('d'), false, 'toggle removes what it added');
});

test('ids the catalogue no longer has are pruned after the data layer answers', async () => {
  const browser = makeBrowser();
  const PV = loadCore(browser);
  browser.window.PV.store.hydrate = (ids) => Promise.resolve(
    ids.filter((id) => id !== 'ghost').map((id) => ({ id })));
  PV.compare.set(['a', 'ghost']);
  const records = await PV.compare.hydrate();
  assert.deepEqual(records.map((r) => r.id), ['a']);
  assert.deepEqual(PV.compare.ids(), ['a']);
  assert.deepEqual(JSON.parse(browser.storage.getItem(COMPARE_KEY)), ['a'], 'pruning persists');
});

/* ------------------------------------------------------ URL sharing -- */

test('non-empty selections are written to the URL; clearing removes the parameter (existing URL behaviour preserved)', () => {
  const browser = makeBrowser();
  const PV = loadCore(browser);
  PV.util.updateUrl({ ids: PV.compare.ids().join(',') || '' }); // the empty-selection write compare.js performs
  assert.equal(browser.historyOps.length, 1);
  let url = browser.historyOps[0][2]; // replaceState(state, unused, url) — the URL is the third argument
  assert.ok(!url.includes('ids='), 'an empty selection clears the share parameter, as before');

  PV.compare.set(['a', 'b']);
  PV.util.updateUrl({ ids: PV.compare.ids().join(',') });
  url = browser.historyOps[1][2];
  assert.ok(url.includes('ids=a%2Cb') || url.includes('ids=a,b'), 'a non-empty selection is shareable');
});

/* ---------------------------------------------------- the favorites -- */

test('the favorites store toggles, persists across page loads, and toggles back off', () => {
  const browser = makeBrowser();
  let PV = loadCore(browser);
  assert.equal(PV.favorites.has('detail-record-1'), false);
  assert.equal(PV.favorites.toggle('detail-record-1'), true);
  assert.equal(PV.favorites.has('detail-record-1'), true);
  assert.equal(PV.favorites.count(), 1);
  PV = loadCore(browser);
  assert.equal(PV.favorites.has('detail-record-1'), true, 'a save survives reload and navigation');
  assert.deepEqual(JSON.parse(browser.storage.getItem(FAVORITES_KEY)), ['detail-record-1']);
  PV = loadCore(browser);
  assert.equal(PV.favorites.toggle('detail-record-1'), false, 'toggling again unsaves');
  assert.equal(PV.favorites.count(), 0);
  PV = loadCore(browser);
  assert.equal(PV.favorites.count(), 0, 'an unsaved item stays unsaved');
});

/* --------------------------- page wiring (source-contract tripwires) -- */

test('compare.js no longer auto-seeds defaults, and still restores share-link ids', () => {
  const source = readSource('compare.js');
  assert.ok(!source.includes('defaultCompareIds'),
    'the compare page must not reference default compare ids any more');
  assert.ok(!/PV\.compare\.set\(\s*PV\.store\./.test(source),
    'the compare page must never set the selection from a store-provided default');
  assert.ok(source.includes('PV.compare.set(linkIds)'),
    'explicit share links must still restore their ids');
  assert.ok(source.includes('PV.compare.set([])'),
    'a link whose ids are all gone must still clear the selection');
});

test('detail.js wires its Save button to the favorites contract with the record identity', () => {
  const source = readSource('detail.js');
  assert.ok(source.includes('data-favorite-toggle="\' + U.esc(record.id) + \'"'),
    'the Save button must carry the record id through data-favorite-toggle');
  assert.ok(source.includes('class="small-btn fav-btn"'),
    'the Save button must use the same control the listing cards use');
  assert.ok(!source.includes('data-later="Saving items"'),
    'the placeholder Save button must be gone');
  assert.ok(!source.includes('Save and Contact seller are placeholders'),
    'the actions note must stop describing Save as a placeholder');
  assert.ok(source.includes('no account-synced or cross-device saved list yet'),
    'the copy must stay honest about what Save does and does not do');
});
