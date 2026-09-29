'use strict';

/**
 * The identity foundation — Step 17C-G.
 *
 * Identity is the one decision that, made wrongly, corrupts everything after it: two records
 * merged by guesswork cannot be un-merged by review. So these tests are mostly about what the
 * layer refuses to conclude — that a title is not an identifier, that a URL is evidence
 * rather than an identity, that a record with no identifier has no identity, and that two
 * sources sharing a value is a question for a person rather than a merge.
 *
 * They are also about the things it must get exactly right: one key format (the same one
 * `0005`'s unique index enforces), the same answer every time, and collisions reported with
 * the positions they happened at.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runCli, fixture, REPO_ROOT, validRecord, validBatch } = require('./_helpers');
const identity = require('../lib/identity');
const contract = require('../lib/contract');

const ALPHA = fixture('merchant-alpha');
const SOURCE_A = { id: '11111111-1111-4111-8111-111111111111', name: 'Fixture Alpha' };
const SOURCE_B = { id: '55555555-5555-4555-8555-555555555555', name: 'Fixture Beta' };

/** A record shaped like a mapped+normalized one, with the fields identity reads. */
function record(overrides) {
  return validRecord(Object.assign({
    external_product_id: 'SKU-1',
    source_url: 'https://store.example/p/sku-1',
    title: 'A Fixture Product',
    merchant: {
      name: 'Fixture Merchant',
      merchant_ref: 'fixture',
      website_url: 'https://store.example',
      country: 'GB'
    }
  }, overrides || {}));
}

/** Writes a source directory outside the repository, laid out like a fixture. */
function tempSource(manifest, products) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-identity-'));
  fs.writeFileSync(path.join(directory, 'source.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.mkdirSync(path.join(directory, 'scenarios', 'ok'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'scenarios', 'ok', 'page-1.json'), JSON.stringify({
    store: { name: 'Fixture Merchant Alpha', ref: 'fixture-alpha', website_url: 'https://fixture-alpha.example' },
    page: 1,
    per_page: 2,
    total_pages: 1,
    products: products
  }, null, 2) + '\n');
  return directory;
}

/* ------------------------------------------------------------ determinism -- */

test('identity: the same normalized input always produces the same identity, byte for byte', () => {
  const input = record();
  const first = identity.identify(input, { source: SOURCE_A });
  const second = identity.identify(input, { source: SOURCE_A });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));

  const analysisA = identity.analyse([{ record: input, ok: true, batch: 1, index: 0 }], { source: SOURCE_A });
  const analysisB = identity.analyse([{ record: input, ok: true, batch: 1, index: 0 }], { source: SOURCE_A });
  assert.equal(JSON.stringify(analysisA), JSON.stringify(analysisB));

  const before = JSON.parse(JSON.stringify(input));
  identity.identify(input, { source: SOURCE_A });
  identity.analyse([{ record: input, ok: true, batch: 1, index: 0 }], { source: SOURCE_A });
  assert.deepEqual(input, before, 'identity reads a record and never rewrites it');
});

test('identity: identity analysis mutates nothing, and leaves the batch payload byte-identical', () => {
  /* Evidence, once read, is evidence. Identity is an observation: it may look at a
     record and at a payload, and it may not change either — not a field, not a key
     order, not an array's order. A pass that quietly rewrote the payload would make
     the boundary's own record of what a source said untrue. */
  const record = validRecord({
    external_product_id: 'SKU-1',
    source_url: 'HTTPS://Store.Example:443/p/1',
    title: '  A Fixture Product  ',
    price: { amount: '19.99', currency: 'GBP' },
    merchant: { name: ' M ', merchant_ref: ' fixture ', website_url: 'https://Store.Example', country: 'GB' },
    media: [
      { url: 'HTTPS://Store.Example/a.jpg', media_type: 'image', sort_order: 0, attribution: '', fallback_url: '' }
    ],
    raw: { id: 1, name: '  raw stays raw  ', nested: { list: ['  a  '] } }
  });

  const recordBefore = JSON.stringify(record);
  identity.identify(record, { source: SOURCE_A });
  identity.candidates(record, { source: SOURCE_A });
  assert.equal(JSON.stringify(record), recordBefore, 'identify() left the record exactly as it found it');

  const batch = validBatch({
    source_id: SOURCE_A.id,
    records: [record, validRecord({ external_product_id: 'SKU-2', title: 'A second product' })]
  });
  const batchBefore = JSON.stringify(batch);
  const recordReferences = batch.records.slice();

  const analysis = identity.analyse(batch.records.map((entry, index) => ({
    record: entry, source: SOURCE_A, ok: true, batch: 1, index: index
  })), { source: SOURCE_A });

  assert.equal(JSON.stringify(batch), batchBefore, 'the batch payload is byte-identical after analysis');
  assert.deepEqual(batch.records, recordReferences, 'and the records are the same objects, in the same order');
  assert.equal(batch.records[0], record, 'not copies: the very objects that were handed in');

  /* The analysis returns its own views, so a caller cannot corrupt the payload
     by editing what it was given back. */
  analysis.entries[0].signals.push('tampered');
  analysis.entries[0].uncertainty.push('tampered');
  assert.equal(JSON.stringify(batch), batchBefore, 'the returned entries are copies, not windows into the payload');
  assert.notEqual(analysis.entries[0].signals, identity.identify(record, { source: SOURCE_A }).signals.map((signal) => signal.rule));
});

test('identity: the key is exactly the one the boundary enforces, and it is source-scoped', () => {
  const input = record({ external_product_id: 'SKU-1' });
  const identified = identity.identify(input, { source: SOURCE_A });

  assert.equal(identified.key, '11111111-1111-4111-8111-111111111111|SKU-1');
  assert.equal(identified.key, contract.identityKey(SOURCE_A.id, 'SKU-1'),
    'one key format exists in this codebase, and identity produces that one');
  assert.equal(identified.certain, true);
  assert.equal(identified.strength, identity.STRENGTH.AUTHORITATIVE);
  assert.deepEqual(identified.uncertainty, []);

  const other = identity.identify(input, { source: SOURCE_B });
  assert.equal(other.key, '55555555-5555-4555-8555-555555555555|SKU-1');
  assert.notEqual(other.key, identified.key, 'the same identifier from two sources is two identities');
});

test('identity: a source is required for an authoritative identity, and none is invented without one', () => {
  const noSource = identity.identify(record(), {});
  assert.equal(noSource.key, null);
  assert.equal(noSource.certain, false);
  assert.deepEqual(noSource.uncertainty, [identity.UNCERTAINTY.NO_EXTERNAL_IDENTIFIER]);
  assert.match(noSource.explanations[0], /fallback would be a guess/);
});

/* ----------------------------------------------------- what is not identity -- */

test('identity: a title is never an identifier, so two merchants with the same title do not merge', () => {
  const left = record({ title: 'USB-C Cable', external_product_id: 'ALPHA-1', source_url: 'https://alpha.example/p/1' });
  const right = record({ title: 'USB-C Cable', external_product_id: 'BETA-1', source_url: 'https://beta.example/p/9' });

  const analysis = identity.analyse([
    { record: left, source: SOURCE_A, ok: true, batch: 1, index: 0 },
    { record: right, source: SOURCE_B, ok: true, batch: 1, index: 1 }
  ], { source: SOURCE_A });

  assert.equal(analysis.summary.distinct, 2, 'two identities, and no merge');
  assert.equal(analysis.summary.duplicates, 0);
  assert.deepEqual(analysis.collisions, [], 'identical titles are not a collision of any kind');

  /* The rule is structural, not incidental: no identity rule names a label field. */
  const rules = Object.values(identity.RULES);
  for (const field of ['title', 'description', 'category_text', 'availability_text']) {
    assert.equal(rules.some((rule) => rule.includes(field)), false, field + ' must not be an identity rule');
  }
  assert.deepEqual(identity.PRIORITY,
    ['source-external-id', 'source-url', 'merchant-ref', 'none'], 'the priority order is a promise, not a comment');
});

test('identity: identity is read from contract fields, never re-parsed from raw evidence', () => {
  const hidden = record({ external_product_id: '', raw: { sku: 'SKU-IN-RAW', id: 77, permalink: 'https://store.example/p/77' } });
  const identified = identity.identify(hidden, { source: SOURCE_A });

  assert.equal(identified.key, null, 'a merchant field inside raw is that merchant adapter\'s business');
  assert.deepEqual(identified.uncertainty, [identity.UNCERTAINTY.NO_EXTERNAL_IDENTIFIER]);
});

/* ------------------------------------------------------- missing identifiers -- */

test('identity: a missing identifier is handled safely — no key, no merge, and validation still refuses it', () => {
  for (const missing of ['', '   ', null, undefined]) {
    const identified = identity.identify(record({ external_product_id: missing }), { source: SOURCE_A });
    assert.equal(identified.key, null, JSON.stringify(missing) + ' claims no identity');
    assert.equal(identified.certain, false);
    assert.deepEqual(identified.uncertainty, [identity.UNCERTAINTY.NO_EXTERNAL_IDENTIFIER]);
  }

  const blank = record({ external_product_id: '', source_url: 'https://store.example/p/no-id' });
  const analysis = identity.analyse([
    { record: blank, ok: false, batch: 1, index: 0 },
    { record: blank, ok: false, batch: 1, index: 1 }
  ], { source: SOURCE_A });

  assert.equal(analysis.summary.unidentified, 2);
  assert.equal(analysis.summary.duplicates, 0, 'two unidentified records are not a duplicate identity');
  assert.deepEqual(analysis.collisions, []);

  const verdict = contract.validateRecord(blank, 0);
  assert.equal(verdict.ok, false, 'the boundary still refuses a record with no identity (decision D3)');
  assert.deepEqual(verdict.errors.map((entry) => entry.field), ['external_product_id']);
});

/* ------------------------------------------------------------ URL and SKU -- */

test('identity: the URL rule is deterministic and never becomes an identity by itself', () => {
  const canonical = record({ source_url: 'https://store.example/p/1' });
  const shouty = record({ source_url: 'HTTPS://Store.Example:443/p/1' });
  assert.equal(identity.identify(canonical, { source: SOURCE_A }).signals[1].value,
    identity.identify(shouty, { source: SOURCE_A }).signals[1].value,
    'the same address written two ways is one address');
  assert.equal(identity.identify(canonical, { source: SOURCE_A }).signals[1].identity, false,
    'the signal says out loud that it is evidence, not an identity');

  const urlOnly = identity.identify(record({ external_product_id: '', source_url: 'https://store.example/p/1' }), { source: SOURCE_A });
  assert.equal(urlOnly.key, null, 'a URL does not rescue a record with no identifier');

  const broken = identity.identify(record({ source_url: 'not-a-url' }), { source: SOURCE_A });
  assert.equal(broken.signals.some((signal) => signal.rule === identity.RULES.SOURCE_URL), false,
    'a value that is not an http(s) address is not a page signal at all');
});

test('identity: two identifiers from one source claiming one page is reported, never merged', () => {
  const analysis = identity.analyse([
    { record: record({ external_product_id: 'SKU-1', source_url: 'https://store.example/p/shared' }), ok: true, batch: 1, index: 0 },
    { record: record({ external_product_id: 'SKU-2', source_url: 'https://store.example/p/shared' }), ok: true, batch: 1, index: 1 }
  ], { source: SOURCE_A });

  assert.equal(analysis.summary.distinct, 2, 'two identifiers stay two identities');
  assert.equal(analysis.summary.same_page_conflicts, 1);
  const conflict = analysis.collisions.find((entry) => entry.kind === identity.UNCERTAINTY.SAME_PAGE_DIFFERENT_IDS);
  assert.ok(conflict, 'the shared page is reported');
  assert.equal(conflict.merge, false);
  assert.match(conflict.note, /may be stale or duplicated/);
  assert.deepEqual(conflict.records, [{ batch: 1, index: 0 }, { batch: 1, index: 1 }]);
});

test('identity: one identifier under two merchant references is a conflict, not a merge', () => {
  const analysis = identity.analyse([
    { record: record({ external_product_id: 'SKU-1', merchant: { name: 'A', merchant_ref: 'alpha', website_url: 'https://a.example', country: 'GB' } }), ok: true, batch: 1, index: 0 },
    { record: record({ external_product_id: 'SKU-1', merchant: { name: 'B', merchant_ref: 'beta', website_url: 'https://b.example', country: 'GB' } }), ok: true, batch: 1, index: 1 }
  ], { source: SOURCE_A });

  assert.equal(analysis.summary.distinct, 1, 'the identity is the source\'s own identifier, and the source stated one');
  assert.equal(analysis.summary.merchant_conflicts, 1);
  const conflict = analysis.collisions.find((entry) => entry.kind === identity.UNCERTAINTY.MERCHANT_CONFLICT);
  assert.equal(conflict.merge, false);
  assert.deepEqual(conflict.merchant_refs, ['alpha', 'beta']);
  assert.deepEqual(conflict.records, [{ batch: 1, index: 0 }, { batch: 1, index: 1 }]);
});

/* -------------------------------------------------------------- collisions -- */

test('identity: a key stated twice in one payload is a duplicate, reported with its positions', () => {
  const analysis = identity.analyse([
    { record: record({ external_product_id: 'SKU-1' }), ok: true, batch: 1, index: 0 },
    { record: record({ external_product_id: 'SKU-2' }), ok: true, batch: 1, index: 1 },
    { record: record({ external_product_id: 'SKU-1' }), ok: true, batch: 2, index: 0 }
  ], { source: SOURCE_A });

  assert.equal(analysis.summary.distinct, 2);
  assert.equal(analysis.summary.duplicates, 1);
  const duplicate = analysis.collisions.find((entry) => entry.kind === 'duplicate-identity');
  assert.equal(duplicate.merge, true, 'the boundary does resolve this one: one row per identity, refreshed');
  assert.equal(duplicate.records.length, 2);
  assert.deepEqual(duplicate.records, [{ batch: 1, index: 0 }, { batch: 2, index: 0 }], 'positional, in payload order');
  assert.match(duplicate.note, /refreshes it/);
});

test('identity: a refused record collides with nothing, because it reaches no row', () => {
  const analysis = identity.analyse([
    { record: record({ external_product_id: 'SKU-1' }), ok: true, batch: 1, index: 0 },
    { record: record({ external_product_id: 'SKU-1', title: '' }), ok: false, batch: 1, index: 1 }
  ], { source: SOURCE_A });

  assert.equal(analysis.summary.identified, 2, 'both records state an identifier, and identity reports it');
  assert.equal(analysis.summary.duplicates, 0, 'but the refused one is stored nowhere, so it duplicates nothing');
  assert.deepEqual(analysis.collisions, []);
});

test('identity: two sources sharing a value is a candidate for review, with merge explicitly false', () => {
  const analysis = identity.analyse([
    { record: record({ external_product_id: 'SHARED-1', source_url: 'https://alpha.example/p/1' }), source: SOURCE_A, ok: true, batch: 1, index: 0 },
    { record: record({ external_product_id: 'SHARED-1', source_url: 'https://beta.example/p/9' }), source: SOURCE_B, ok: true, batch: 1, index: 1 }
  ], {});

  assert.equal(analysis.summary.distinct, 2, 'no cross-source collapse, ever');
  assert.equal(analysis.summary.duplicates, 0);
  assert.equal(analysis.summary.cross_source_candidates, 1);

  const candidate = analysis.collisions.find((entry) => entry.kind === identity.UNCERTAINTY.CROSS_SOURCE_CANDIDATE);
  assert.equal(candidate.merge, false);
  assert.equal(candidate.candidate, 'external-id');
  assert.deepEqual(candidate.sources, [SOURCE_A.id, SOURCE_B.id]);
  assert.match(candidate.note, /never a merge/);
});

test('identity: the candidate values a person would compare are stated, and they are not identifiers', () => {
  const candidates = identity.candidates(record({ external_product_id: 'SKU-1', source_url: 'HTTPS://Store.Example:443/p/1' }), { source: SOURCE_A });
  assert.deepEqual(candidates, [
    { kind: 'external-id', value: 'SKU-1' },
    { kind: 'source-url', value: 'https://store.example/p/1' }
  ]);
  assert.equal(candidates.some((entry) => entry.kind === 'title'), false);
});

/* --------------------------------------------------- the pass in the pipeline -- */

test('identity: the runner reports identity for a clean source without changing its outcome', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--json']);
  assert.equal(result.status, 0);
  const model = JSON.parse(result.stdout);

  const summary = model.runs[0].identity.summary;
  assert.equal(summary.records, 3);
  assert.equal(summary.identified, 3);
  assert.equal(summary.unidentified, 0);
  assert.equal(summary.distinct, 3, 'three products, three identities');
  assert.equal(summary.duplicates, 0);
  assert.deepEqual(model.runs[0].identity.collisions, []);
  assert.deepEqual(model.context.identity,
    { records: 3, identified: 3, unidentified: 0, duplicates: 0, uncertain: 0 });
  assert.deepEqual(model.context.warnings, []);

  const printed = runCli(['--source', ALPHA, '--dry-run']);
  assert.equal(printed.status, 0);
  assert.doesNotMatch(printed.stdout, /identity/, 'a source with nothing to resolve prints nothing about identity');
});

test('identity: a payload that states one identity twice is reported by the runner, and still exits 1', () => {
  const result = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'duplicates', '--json']);
  assert.equal(result.status, 1, 'the data problem is still a data problem');
  const model = JSON.parse(result.stdout);

  assert.equal(model.runs[0].identity.summary.duplicates, 1);
  assert.deepEqual(model.runs[0].identity.collisions.map((entry) => entry.kind), ['duplicate-identity']);
  assert.equal(model.context.identity.duplicates, 1);
  assert.ok(model.context.warnings.some((entry) => entry.code === 'duplicate-identity'),
    'the run says which identity was stated twice, not just that something was');

  const printed = runCli(['--source', ALPHA, '--dry-run', '--scenario', 'duplicates']);
  assert.match(printed.stdout, /duplicate-identity/);
  assert.match(printed.stdout, /identity +2 record\(s\) identified · 1 duplicate key\(s\)/);
});

test('identity: two sources reading the same product stay two identities, end to end', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ALPHA, 'source.json'), 'utf8'));
  const product = {
    sku: 'SHARED-SKU-1',
    id: 1,
    name: 'USB-C Cable',
    description: '<p>Same name, same SKU, different merchant.</p>',
    permalink: 'https://fixture-alpha.example/p/shared-1',
    prices: { price: '1999', currency_code: 'KES', currency_minor_unit: 2 },
    images: [],
    categories: [{ name: 'Audio' }],
    stock_availability: { text: 'In stock' }
  };
  const directory = tempSource(manifest, [product]);

  try {
    const result = runCli(['--source', directory, '--dry-run', '--json']);
    assert.equal(result.status, 0);
    const model = JSON.parse(result.stdout);
    const summary = model.runs[0].identity.summary;
    assert.equal(summary.identified, 1);
    assert.equal(summary.distinct, 1);

    /* The identity the runner reports is the same key the boundary would anchor the
       record by, and it names this source and this identifier, in that order. */
    const key = manifest.id + '|SHARED-SKU-1';
    assert.equal(model.runs[0].records[0].external_product_id, 'SHARED-SKU-1');
    assert.deepEqual(model.runs[0].identity.keys, [
      { batch: 1, index: 0, key: key, certain: true, uncertainty: [] }
    ], "the run states the key each record carries, and it is the boundary own key");
    assert.equal(identity.key(manifest.id, 'SHARED-SKU-1'), key);

    const other = identity.identify(record({ external_product_id: 'SHARED-SKU-1', title: 'USB-C Cable' }), { source: SOURCE_B });
    assert.notEqual(other.key, key, 'and a second merchant with the same SKU and title is a second identity');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
