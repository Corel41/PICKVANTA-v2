'use strict';

/**
 * The ingest contract, tested rule by rule. Each case names the rule it holds
 * from docs/17c-a-ingest-architecture.md §3.2, §3.3 and §4.1–§4.4.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require('../lib/contract');
const { validBatch, validRecord, fieldsOf } = require('./_helpers');

function recordErrors(record) {
  return contract.validateRecord(record, 0).errors;
}

test('a record that satisfies the contract passes', () => {
  const result = contract.validateRecord(validRecord(), 0);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.external_product_id, 'SKU-1');
});

test('a batch that satisfies the contract passes', () => {
  const result = contract.validateBatch(validBatch());
  assert.equal(result.ok, true);
  assert.equal(result.envelope.ok, true);
  assert.equal(result.records.length, 1);
});

/* ------------------------------------------------------------- envelope -- */

test('envelope: an unknown key is refused', () => {
  const batch = validBatch();
  batch.extra = 'nope';
  const result = contract.validateBatch(batch);
  assert.equal(result.envelope.ok, false);
  assert.deepEqual(fieldsOf(result.envelope.errors), ['extra']);
});

test('envelope: batch_version must be the current version', () => {
  const result = contract.validateBatch(validBatch({ batch_version: 2 }));
  assert.equal(result.envelope.ok, false);
  assert.ok(fieldsOf(result.envelope.errors).includes('batch_version'));
});

test('envelope: source_id and job_id must be uuids', () => {
  const result = contract.validateBatch(validBatch({ source_id: 'not-a-uuid', job_id: '' }));
  assert.equal(result.envelope.ok, false);
  assert.ok(fieldsOf(result.envelope.errors).includes('source_id'));
  assert.ok(fieldsOf(result.envelope.errors).includes('job_id'));
});

test('envelope: the connector must name itself and a known method', () => {
  const result = contract.validateBatch(validBatch({ connector: { name: '', version: '1', method: 'telepathy' } }));
  assert.equal(result.envelope.ok, false);
  const fields = fieldsOf(result.envelope.errors);
  assert.ok(fields.includes('connector.name'));
  assert.ok(fields.includes('connector.method'));
});

test('envelope: fetched_at must be an ISO 8601 timestamp with an offset', () => {
  const result = contract.validateBatch(validBatch({ fetched_at: '26 September 2026' }));
  assert.equal(result.envelope.ok, false);
  assert.ok(fieldsOf(result.envelope.errors).includes('fetched_at'));
});

test('envelope: records must be a non-empty array within the batch limit', () => {
  assert.equal(contract.validateBatch(validBatch({ records: [] })).envelope.ok, false);
  const tooMany = [];
  for (let index = 0; index <= contract.LIMITS.recordsPerBatch; index += 1) {
    tooMany.push(validRecord({ external_product_id: 'SKU-' + index }));
  }
  const result = contract.validateBatch(validBatch({ records: tooMany }));
  assert.equal(result.envelope.ok, false);
  assert.ok(fieldsOf(result.envelope.errors).includes('records'));
});

/* ------------------------------------------------------- forbidden keys -- */

test('forbidden: every pipeline and review key is refused by name', () => {
  const forbidden = ['pipeline_status', 'validation_status', 'normalization_status', 'deduplication_status',
    'dedup_match_class', 'dedup_matched_deal_id', 'review_status', 'review_note', 'reviewed_by',
    'published_deal_id', 'affiliate_url', 'external_merchant_id', 'normalized_brand', 'gtin',
    'model_number', 'last_seen_at', 'raw_hash'];
  for (const key of forbidden) {
    const record = validRecord();
    record[key] = 'anything';
    const errors = recordErrors(record);
    assert.equal(errors.length, 1, key + ' must be refused');
    assert.equal(errors[0].field, key);
    assert.match(errors[0].reason, /^refused: /, key + ' must be refused with a reason');
    assert.ok(contract.FORBIDDEN_RECORD_KEYS.has(key), key + ' must be in the forbidden list');
  }
});

test('forbidden: an unknown key is refused as outside the contract', () => {
  const record = validRecord();
  record.whatever = 1;
  const errors = recordErrors(record);
  assert.deepEqual(fieldsOf(errors), ['whatever']);
  assert.equal(errors[0].reason, 'not part of the ingest contract');
});

/* ------------------------------------------------------------- identity -- */

test('identity: an external product id is required, non-blank and printable', () => {
  assert.ok(fieldsOf(recordErrors(validRecord({ external_product_id: '' }))).includes('external_product_id'));
  assert.ok(fieldsOf(recordErrors(validRecord({ external_product_id: '   ' }))).includes('external_product_id'));
  assert.ok(fieldsOf(recordErrors(validRecord({ external_product_id: 'a\u0000b' }))).includes('external_product_id'));
  const long = validRecord({ external_product_id: 'x'.repeat(contract.LIMITS.externalProductIdMax + 1) });
  assert.ok(fieldsOf(recordErrors(long)).includes('external_product_id'));
});

/* ------------------------------------------------------------ provenance -- */

test('provenance: source_url is required and must be http(s)', () => {
  assert.ok(fieldsOf(recordErrors(validRecord({ source_url: '' }))).includes('source_url'));
  assert.ok(fieldsOf(recordErrors(validRecord({ source_url: 'ftp://fixture.example/x' }))).includes('source_url'));
  assert.ok(fieldsOf(recordErrors(validRecord({ source_url: 'javascript:alert(1)' }))).includes('source_url'));
});

test('text: title is required, description is bounded', () => {
  assert.ok(fieldsOf(recordErrors(validRecord({ title: '  ' }))).includes('title'));
  assert.ok(fieldsOf(recordErrors(validRecord({ title: 'x'.repeat(contract.LIMITS.titleMax + 1) }))).includes('title'));
  assert.ok(fieldsOf(recordErrors(validRecord({ description: 'x'.repeat(contract.LIMITS.descriptionMax + 1) }))).includes('description'));
  assert.equal(contract.validateRecord(validRecord({ description: '' }), 0).ok, true);
});

/* ----------------------------------------------------------------- price -- */

test('price: null means no price, and is allowed', () => {
  assert.equal(contract.validateRecord(validRecord({ price: null }), 0).ok, true);
});

test('price: an object needs both an amount and a currency', () => {
  assert.ok(fieldsOf(recordErrors(validRecord({ price: {} }))).includes('price.amount'));
  assert.ok(fieldsOf(recordErrors(validRecord({ price: { amount: '10.00' } }))).includes('price.currency'));
  assert.ok(fieldsOf(recordErrors(validRecord({ price: { currency: 'GBP' } }))).includes('price.amount'));
});

test('price: symbols, separators, negatives and extra decimals are refused, not repaired', () => {
  for (const amount of ['£10.00', '1,299.00', '-5.00', '19.999', '10,5', '1e3', '']) {
    const errors = recordErrors(validRecord({ price: { amount: amount, currency: 'GBP' } }));
    assert.ok(fieldsOf(errors).includes('price.amount'), 'amount ' + JSON.stringify(amount) + ' must be refused');
  }
  assert.equal(contract.validateRecord(validRecord({ price: { amount: '0', currency: 'GBP' } }), 0).ok, true);
  assert.equal(contract.validateRecord(validRecord({ price: { amount: '129.50', currency: 'KES' } }), 0).ok, true);
});

test('price: the currency is a three-letter upper-case code, never defaulted or converted', () => {
  assert.ok(fieldsOf(recordErrors(validRecord({ price: { amount: '10.00', currency: 'gbp' } }))).includes('price.currency'));
  assert.ok(fieldsOf(recordErrors(validRecord({ price: { amount: '10.00', currency: 'GB' } }))).includes('price.currency'));
  assert.ok(fieldsOf(recordErrors(validRecord({ price: { amount: '10.00', currency: '' } }))).includes('price.currency'));
});

/* -------------------------------------------------------------- merchant -- */

test('merchant: a name is required, and the other fields are optional but shaped', () => {
  assert.ok(fieldsOf(recordErrors(validRecord({ merchant: { name: '' } }))).includes('merchant.name'));
  assert.ok(fieldsOf(recordErrors(validRecord({ merchant: null }))).includes('merchant'));
  assert.ok(fieldsOf(recordErrors(validRecord({ merchant: { name: 'X', country: 'ke' } }))).includes('merchant.country'));
  assert.ok(fieldsOf(recordErrors(validRecord({ merchant: { name: 'X', website_url: 'ftp://x' } }))).includes('merchant.website_url'));
  assert.equal(contract.validateRecord(validRecord({ merchant: { name: 'X' } }), 0).ok, true);
  assert.equal(contract.validateRecord(validRecord({ merchant: { name: 'X', country: '' } }), 0).ok, true);
});

/* ----------------------------------------------------------------- media -- */

test('media: references only, ordered, bounded, http(s)', () => {
  const tooMany = [];
  for (let index = 0; index <= contract.LIMITS.mediaPerRecord; index += 1) {
    tooMany.push({ url: 'https://fixture.example/' + index + '.jpg', sort_order: index });
  }
  assert.ok(fieldsOf(recordErrors(validRecord({ media: tooMany }))).includes('media'));
  assert.ok(fieldsOf(recordErrors(validRecord({ media: [{ url: 'javascript:alert(1)' }] }))).includes('media[0].url'));
  assert.ok(fieldsOf(recordErrors(validRecord({ media: [{ url: 'https://x/1.jpg', sort_order: 0 }, { url: 'https://x/2.jpg', sort_order: 0 }] })))
    .includes('media[1].sort_order'));
  assert.ok(fieldsOf(recordErrors(validRecord({ media: [{ url: 'https://x/1.jpg', media_type: 'audio' }] }))).includes('media[0].media_type'));
  assert.ok(fieldsOf(recordErrors(validRecord({ media: [{ url: 'https://x/1.jpg', caption: 'x' }] }))).includes('media[0].caption'));
  assert.equal(contract.validateRecord(validRecord({ media: [] }), 0).ok, true);
});

/* ------------------------------------------------------------------- raw -- */

test('raw: the source record must be a JSON object within the size limit', () => {
  assert.ok(fieldsOf(recordErrors(validRecord({ raw: null }))).includes('raw'));
  assert.ok(fieldsOf(recordErrors(validRecord({ raw: [1, 2, 3] }))).includes('raw'));
  const big = { blob: 'x'.repeat(contract.LIMITS.rawBytes + 1) };
  const errors = recordErrors(validRecord({ raw: big }));
  assert.ok(fieldsOf(errors).includes('raw'));
  assert.match(errors[0].reason, /bytes of JSON/);
});

/* ----------------------------------------------------------------- hash -- */

test('hash: the same evidence in a different key order hashes the same', () => {
  const first = { a: 1, b: { c: [1, 2], d: 'x' } };
  const second = { b: { d: 'x', c: [1, 2] }, a: 1 };
  assert.equal(contract.hashRaw(first), contract.hashRaw(second));
  assert.notEqual(contract.hashRaw(first), contract.hashRaw(Object.assign({}, first, { a: 2 })));
  assert.equal(contract.hashRaw(first).length, 32);
});

test('identity: the key is the source and the external product id together', () => {
  assert.equal(contract.identityKey('src', 'SKU-1'), 'src|SKU-1');
});

test('bytes: the raw size is measured in bytes, not characters', () => {
  assert.equal(contract.byteLength('é'), 2);
});

test('summary: counts valid and rejected records', () => {
  const summary = contract.summarise([
    { ok: true, errors: [] },
    { ok: false, errors: [] },
    { ok: true, errors: [] }
  ]);
  assert.deepEqual(summary, { records: 3, valid: 2, rejected: 1 });
});
