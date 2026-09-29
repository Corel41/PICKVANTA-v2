'use strict';

/**
 * The normalization boundary — Step 17C-F.
 *
 * The pass sits between an adapter's mapping and the contract's validation, so
 * these tests are about three promises that make it safe to put anything there:
 *
 *   1. it is pure and deterministic — one input, one output, no mutation, the
 *      same result every time, and normalizing twice is normalizing once;
 *   2. it canonicalises *form* only — strings, references, price shape, media
 *      shape and identity — and never repairs meaning, invents a value or hides
 *      evidence, so the contract's verdict on a value it declined to touch is
 *      exactly what it was before this pass existed;
 *   3. the records an adapter already produced (every fixture in this
 *      repository) pass through it unchanged, so the import behaviour that
 *      17C-B/C/D proved is the behaviour that still runs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runCli, fixture, REPO_ROOT, validRecord } = require('./_helpers');
const normalize = require('../lib/normalize');
const contract = require('../lib/contract');
const storeJson = require('../lib/adapters/store-json');

const ALPHA = fixture('merchant-alpha');

/** Normalizes and returns only the record, for the tests that do not read changes. */
function canonical(value) {
  return normalize.record(value).record;
}

/** The rules a set of changes used, sorted, with duplicates removed. */
function rulesOf(changes) {
  return [...new Set(changes.map((entry) => entry.rule))].sort();
}

/** Writes a source directory outside the repository, laid out like a fixture. */
function tempSource(manifest, pages) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-normalize-'));
  fs.writeFileSync(path.join(directory, 'source.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.mkdirSync(path.join(directory, 'scenarios', 'ok'), { recursive: true });
  pages.forEach((page, index) => {
    fs.writeFileSync(path.join(directory, 'scenarios', 'ok', 'page-' + (index + 1) + '.json'),
      JSON.stringify(page, null, 2) + '\n');
  });
  return directory;
}

/* ------------------------------------------------- purity and determinism -- */

test('normalize: the same input always produces the same output, and the pass is idempotent', () => {
  const input = validRecord({
    external_product_id: 1202,
    source_url: 'HTTPS://Store.Example:443/p/1?x=1#frag',
    title: '  A title  ',
    description: '   ',
    price: { amount: 19.9, currency: ' KES ' },
    merchant: { name: ' M ', merchant_ref: ' r ', website_url: 'https://Store.Example', country: 'ke' },
    media: ['HTTPS://Store.Example/a.jpg', { url: ' https://Store.Example/b.jpg ', media_type: ' image ' }]
  });

  const first = normalize.record(input);
  const second = normalize.record(input);
  assert.deepEqual(first, second, 'two calls, one answer');
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'byte-identical, key order included');

  const again = normalize.record(first.record);
  assert.deepEqual(again.record, first.record, 'normalizing a normalized record is a no-op');
  assert.deepEqual(again.changes, [], 'and reports no changes at all');
});

test('normalize: it never mutates the record it is given', () => {
  const input = validRecord({
    external_product_id: 1202,
    title: '  Spaced  ',
    price: { amount: ' 19.99 ', currency: ' KES ' },
    media: ['https://store.example/a.jpg'],
    raw: { id: 1, nested: { keep: '   me   ' } }
  });
  const before = JSON.parse(JSON.stringify(input));
  normalize.record(input);
  assert.deepEqual(input, before, 'the input is evidence and is left exactly as it was');
});

/* ---------------------------------------------------------------- strings -- */

test('normalize: strings are trimmed, and a value that is not a string is left to validation', () => {
  const result = normalize.record(validRecord({
    title: '   Fixture Title   ',
    description: '  line one\nline two  ',
    availability_text: '\tIn stock\n',
    category_text: '  Audio > Mics  ',
    merchant: { name: '  Fixture Merchant  ', merchant_ref: ' fixture ', website_url: 'https://fixture.example', country: 'GB' }
  }));

  assert.equal(result.record.title, 'Fixture Title');
  assert.equal(result.record.description, 'line one\nline two', 'only the ends are trimmed; the text keeps its shape');
  assert.equal(result.record.availability_text, 'In stock');
  assert.equal(result.record.category_text, 'Audio > Mics');
  assert.equal(result.record.merchant.name, 'Fixture Merchant');
  assert.equal(result.record.merchant.merchant_ref, 'fixture');
  assert.deepEqual(rulesOf(result.changes), ['text-trim']);
  assert.deepEqual(result.changes.map((entry) => entry.field), [
    'title', 'description', 'availability_text', 'category_text',
    'merchant.name', 'merchant.merchant_ref'
  ], 'changes are reported in a fixed order, the same order for the same input');

  const untouched = canonical(validRecord({ title: 42, description: null, availability_text: ['a'] }));
  assert.equal(untouched.title, 42, 'a number is not a string and is not made into one');
  assert.equal(untouched.description, null, 'null stays null: absent is not an empty string');
  assert.deepEqual(untouched.availability_text, ['a']);
});

test('normalize: an empty string stays empty rather than being repaired into meaning', () => {
  const result = normalize.record(validRecord({ title: '   ', description: '', availability_text: ' \n ' }));
  assert.equal(result.record.title, '', 'a blank title is still blank, so the contract refuses it');
  assert.equal(result.record.description, '');
  assert.equal(result.record.availability_text, '');

  const verdict = contract.validateRecord(result.record, 0);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.errors.map((entry) => entry.field), ['title']);
  assert.match(verdict.errors[0].reason, /must not be blank/);
});

/* ------------------------------------------------------------------- URLs -- */

test('normalize: URL formatting is canonicalised without reinterpreting the address', () => {
  assert.equal(normalize.url('HTTPS://Store.Example/p/1'), 'https://store.example/p/1', 'scheme and host are lower-cased');
  assert.equal(normalize.url('https://store.example:443/p/1'), 'https://store.example/p/1', 'a default port is dropped');
  assert.equal(normalize.url('http://store.example:80/p/1'), 'http://store.example/p/1');
  assert.equal(normalize.url('https://store.example'), 'https://store.example', 'an implicit empty path is left as written');
  assert.equal(normalize.url('https://store.example/p/1?x=1&y=2#frag'), 'https://store.example/p/1?x=1&y=2#frag',
    'path, query and fragment are preserved byte for byte');
  assert.equal(normalize.url('https://store.example/p/A-B_c?q=%2F'), 'https://store.example/p/A-B_c?q=%2F',
    'case and escaping inside the path are not touched');
  assert.equal(normalize.url('http://Store.Example:8080/p'), 'http://store.example:8080/p',
    'the scheme is preserved (http is not upgraded) and a real port is kept');
  assert.equal(normalize.url('https://user:pass@Store.Example/p'), 'https://user:pass@store.example/p',
    'userinfo is preserved, not stripped: it is the source address, not this pass\'s decision');
});

test('normalize: an address the contract would refuse is left exactly as it was', () => {
  for (const value of ['not-a-url', '/relative/path', 'javascript:alert(1)', 'ftp://store.example/p', '', '   ']) {
    assert.equal(normalize.url(value), typeof value === 'string' ? value.trim() : value,
      JSON.stringify(value) + ' must reach the contract unchanged');
  }
  assert.equal(normalize.url(42), 42, 'a non-string is left for validation to name');
  assert.equal(normalize.url(null), null);

  const verdict = contract.validateRecord(validRecord({ source_url: 'not-a-url' }), 0);
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors[0].reason, /must be an http\(s\) address/);
});

/* ------------------------------------------------------------------ price -- */

test('normalize: a price is shaped, never converted', () => {
  const result = normalize.record(validRecord({ price: { amount: 19.9, currency: ' KES ' } }));
  assert.deepEqual(result.record.price, { amount: '19.9', currency: 'KES' });
  assert.deepEqual(result.changes.map((entry) => entry.field), ['price.amount', 'price.currency']);

  assert.deepEqual(canonical(validRecord({ price: { amount: ' 19.99 ', currency: 'GBP' } })).price,
    { amount: '19.99', currency: 'GBP' }, 'a decimal string is trimmed and otherwise left alone');
  assert.equal(canonical(validRecord({ price: null })).price, null, 'no price stays no price');
  assert.equal(canonical(validRecord({ price: '19.99 KES' })).price, '19.99 KES',
    'a bare string is not parsed: this pass does not guess which part was money');
  assert.equal(canonical(validRecord({ price: { amount: '19.99' } })).price.currency, undefined,
    'a missing currency is not invented');
  assert.deepEqual(canonical(validRecord({ price: { amount: '1.00', currency: 'KES', converted: '0.10 USD' } })).price,
    { amount: '1.00', currency: 'KES', converted: '0.10 USD' },
    'a key the contract refuses is kept where it was, for validation to name');
  assert.deepEqual(canonical(validRecord({ price: { amount: '19.999', currency: 'KES' } })).price,
    { amount: '19.999', currency: 'KES' }, 'no rounding: three decimals are still three decimals');
});

test('normalize: a lower-case currency is not repaired, so the contract still refuses it', () => {
  const result = normalize.record(validRecord({ price: { amount: '19.99', currency: 'usd' } }));
  assert.equal(result.record.price.currency, 'usd', 'case is a vendor\'s statement, not this pass\'s to change');
  assert.deepEqual(result.changes.map((entry) => entry.field), [], 'and nothing was trimmed, so nothing is reported');

  const verdict = contract.validateRecord(result.record, 0);
  assert.equal(verdict.ok, false, 'the refusal 17C-B/C/D proved is still a refusal');
  assert.deepEqual(verdict.errors.map((entry) => entry.field), ['price.currency']);
  assert.match(verdict.errors[0].reason, /ISO 4217 code in upper case/);
});

/* ------------------------------------------------------------------ media -- */

test('normalize: media references become a predictable array, and nothing is downloaded', () => {
  const result = normalize.record(validRecord({
    media: ['https://store.example/a.jpg', ' HTTPS://Store.Example:443/b.jpg ', { url: ' https://store.example/c.jpg ', attribution: '  A person  ' }]
  }));

  assert.deepEqual(result.record.media, [
    { url: 'https://store.example/a.jpg', sort_order: 0 },
    { url: 'https://store.example/b.jpg', sort_order: 1 },
    { url: 'https://store.example/c.jpg', attribution: 'A person', sort_order: 2 }
  ], 'every entry is an object with a reference; the order is recorded from the array itself');
  assert.deepEqual(result.changes.map((entry) => entry.field),
    ['media[0]', 'media[1]', 'media[2].url', 'media[2].attribution', 'media[2].sort_order']);

  const verdict = contract.validateRecord(result.record, 0);
  assert.equal(verdict.ok, true, 'the canonical array is what the contract expects');

  /* The contract used to refuse a bare reference; the pass is what makes the
     shape right, and it is a shape decision rather than a repair of data. */
  const before = contract.validateRecord(validRecord({ media: ['https://store.example/a.jpg'] }), 0);
  assert.equal(before.ok, false);
  assert.equal(before.errors[0].field, 'media[0]');
});

test('normalize: a stated media ordering is preserved, and one is never invented over it', () => {
  const stated = canonical(validRecord({
    media: [{ url: 'https://store.example/a.jpg', sort_order: 5 }, { url: 'https://store.example/b.jpg' }]
  }));
  assert.deepEqual(stated.media.map((entry) => entry.sort_order), [5, undefined],
    'the source stated an order, so no index is added beside it (which could have collided with it)');

  const statedAgain = normalize.record(validRecord({
    media: [{ url: 'https://store.example/a.jpg', sort_order: 5 }, { url: 'https://store.example/b.jpg' }]
  }));
  assert.deepEqual(statedAgain.changes.map((entry) => entry.field), []);

  assert.deepEqual(canonical(validRecord({ media: 'https://store.example/a.jpg' })).media,
    'https://store.example/a.jpg', 'a value that is not an array is left for validation to refuse');

  const many = Array.from({ length: contract.LIMITS.mediaPerRecord + 2 },
    (entry, index) => ({ url: 'https://store.example/' + index + '.jpg' }));
  assert.equal(canonical(validRecord({ media: many })).media.length, contract.LIMITS.mediaPerRecord + 2,
    'an over-long array is not truncated: the contract refuses it, and hiding references would lie');
  assert.equal(contract.validateRecord(validRecord({ media: many }), 0).ok, false);

  const unknown = canonical(validRecord({ media: [{ url: 'https://store.example/a.jpg', width: 800 }] }));
  assert.equal(unknown.media[0].width, 800, 'an unknown key stays where the source put it');
});

/* --------------------------------------------------------------- identity -- */

test('normalize: identity is preserved as a stable string, and a blank identity stays blank', () => {
  assert.equal(canonical(validRecord({ external_product_id: 1202 })).external_product_id, '1202',
    'a numeric id is preserved as its decimal digits');
  assert.equal(canonical(validRecord({ external_product_id: ' SKU-1 ' })).external_product_id, 'SKU-1');
  assert.equal(canonical(validRecord({ external_product_id: 'sku-1' })).external_product_id, 'sku-1',
    'case is preserved: identity is compared as the source states it');
  assert.equal(canonical(validRecord({ external_product_id: '   ' })).external_product_id, '',
    'a blank identity is still blank, so the boundary refuses it (decision D3)');
  assert.equal(canonical(validRecord({ external_product_id: null })).external_product_id, null,
    'absent stays absent');

  const changes = normalize.record(validRecord({ external_product_id: 1202 })).changes;
  assert.deepEqual(changes.map((entry) => entry.field), ['external_product_id']);
  assert.equal(changes[0].rule, 'external-identity');
});

/* ------------------------------------------------------- evidence and keys -- */

test('normalize: evidence and shape are untouched, so nothing is hidden from validation', () => {
  const input = validRecord({
    title: '  Fixture  ',
    raw: { id: 1, name: '  Fixture  ', pipeline_status: 'hostile', nested: { list: ['  a  '] } },
    pipeline_status: 'hostile',
    gtin: '0123456789012',
    unknown_key: { keep: '  this  ' }
  });
  const result = normalize.record(input);

  assert.deepEqual(result.record.raw, input.raw, 'the source record is evidence and is never rewritten');
  assert.equal(result.record.pipeline_status, 'hostile', 'a refused key is left for validation to name');
  assert.equal(result.record.gtin, '0123456789012');
  assert.deepEqual(result.record.unknown_key, { keep: '  this  ' });

  const verdict = contract.validateRecord(result.record, 0);
  assert.equal(verdict.ok, false);
  const refused = verdict.errors.map((entry) => entry.field);
  assert.ok(refused.includes('pipeline_status'), 'the refused key is still refused');
  assert.ok(refused.includes('gtin'));
  assert.ok(refused.includes('unknown_key'));
});

/* ------------------------------------------------- the pass in the pipeline -- */

test('normalize: adapter output passes the contract after the pass, and the shapes it fixes are the shape-only ones', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ALPHA, 'scenarios', 'ok', 'page-1.json'), 'utf8')).products[0];
  const mapped = storeJson.toRecord(raw, { source: { name: 'Fixture', provider_name: 'fixture' }, merchant: { name: 'Fixture Merchant' }, observedAt: '2026-09-26T00:00:00Z' });

  assert.equal(contract.validateRecord(mapped, 0).ok, true, 'an adapter record already satisfies the contract');
  const normalized = normalize.record(mapped);
  assert.deepEqual(normalized.record, mapped, 'so the pass changes nothing about it');
  assert.deepEqual(normalized.changes, []);

  /* The same record with the two shapes an adapter may legitimately hand over
     differently: a numeric identity and a numeric amount. The contract refuses
     both as "must be a string"; the pass canonicalises the representation first,
     which is the whole point of having a normalization boundary. */
  const numeric = Object.assign({}, mapped, {
    external_product_id: 1001,
    price: { amount: 129.5, currency: 'USD' },
    media: ['https://fixture-alpha.example/media/fx-a-1001.jpg']
  });
  assert.equal(contract.validateRecord(numeric, 0).ok, false, 'raw shapes the contract refuses');
  const verdict = contract.validateRecord(canonical(numeric), 0);
  assert.equal(verdict.ok, true, 'canonical shapes it accepts');
  assert.deepEqual(verdict.errors, []);
});

test('normalize: the runner applies the pass between the adapter and the contract, and reports what it changed', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ALPHA, 'source.json'), 'utf8'));
  manifest.name = 'Messy Fixture Source';
  const page = {
    store: { name: 'Fixture Merchant Alpha', ref: 'fixture-alpha', website_url: 'https://fixture-alpha.example:443' },
    page: 1,
    per_page: 2,
    total_pages: 1,
    products: [{
      sku: 'FX-C-3001',
      id: 3001,
      name: 'Fixture Canonical 3001',
      description: '<p>A fixture product.</p>',
      permalink: 'HTTPS://FIXTURE-ALPHA.EXAMPLE:443/p/fx-c-3001',
      prices: { price: '1999', currency_code: 'KES', currency_minor_unit: 2 },
      images: [{ src: 'HTTPS://FIXTURE-ALPHA.EXAMPLE/media/fx-c-3001.jpg' }],
      categories: [{ name: 'Audio' }],
      stock_availability: { text: 'In stock' }
    }]
  };
  const directory = tempSource(manifest, [page]);

  try {
    const result = runCli(['--source', directory, '--dry-run', '--json']);
    assert.equal(result.status, 0);
    const model = JSON.parse(result.stdout);

    assert.equal(model.runs[0].summary.imported, 1, 'the record still imports: normalization did not change an outcome');
    assert.equal(model.runs[0].summary.rejected, 0);
    assert.equal(model.context.normalization.records, 1, 'one record was adjusted before validation');
    assert.deepEqual(Object.keys(model.context.normalization.rules).sort(), ['url-canonical']);
    assert.ok(model.context.normalization.rules['url-canonical'] >= 3,
      'the endpoint, the merchant address and the media reference were canonicalised');
    assert.deepEqual(model.context.errors, []);
    assert.deepEqual(model.context.warnings, []);

    const printed = runCli(['--source', directory, '--dry-run']);
    assert.equal(printed.status, 0);
    assert.match(printed.stdout, /normalized +1 record\(s\) adjusted before validation · url-canonical \d+/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('normalize: the committed fixtures need no normalization at all', () => {
  for (const name of ['merchant-alpha', 'merchant-beta', 'woocommerce-store']) {
    const result = runCli(['--source', fixture(name), '--dry-run', '--json']);
    assert.equal(result.status, 0, name + ' still runs');
    const model = JSON.parse(result.stdout);
    assert.equal(model.context.normalization.records, 0,
      name + ' is already canonical: the pass is a no-op on adapter output that is right');
    assert.deepEqual(model.context.normalization.rules, {});
  }
});
