'use strict';

/**
 * Adapter behaviour: two source shapes, one contract, one runner.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adapters = require('../lib/adapters');
const storeJson = require('../lib/adapters/store-json');
const productCsv = require('../lib/adapters/product-csv');
const contract = require('../lib/contract');
const { REPO_ROOT } = require('./_helpers');

const ALPHA = path.join(REPO_ROOT, 'connectors', 'fixtures', 'merchant-alpha');
const BETA = path.join(REPO_ROOT, 'connectors', 'fixtures', 'merchant-beta');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function alphaContext(pageFile) {
  const page = readJson(path.join(ALPHA, 'scenarios', pageFile));
  return {
    source: { id: '11111111-1111-4111-8111-111111111111', name: 'Fixture Merchant Alpha', provider_name: 'fixture-alpha' },
    merchant: page.store
  };
}

/* ------------------------------------------------------------- registry -- */

test('registry: adapters are found by name and an unknown name is refused by name', () => {
  assert.equal(adapters.getAdapter('store-json').name, 'store-json');
  assert.equal(adapters.getAdapter('product-csv').name, 'product-csv');
  assert.throws(() => adapters.getAdapter('store-json-v2'), (error) => {
    assert.equal(error.kind, 'unknown-adapter');
    assert.match(error.message, /store-json-v2/);
    assert.match(error.message, /store-json, product-csv, woo-store-api/);
    return true;
  });
  const listed = adapters.listAdapters();
  assert.deepEqual(listed.map((entry) => entry.name), ['store-json', 'product-csv', 'woo-store-api']);
  assert.deepEqual(listed.map((entry) => entry.method), ['json-api', 'csv', 'json-api']);
});

/* ------------------------------------------------------- store-json map -- */

test('store-json: a source product maps onto the contract shape', () => {
  const context = alphaContext('ok/page-1.json');
  const raw = readJson(path.join(ALPHA, 'scenarios', 'ok', 'page-1.json')).products[0];
  const mapped = storeJson.toRecord(raw, context);

  assert.equal(mapped.external_product_id, 'FX-A-1001');
  assert.equal(mapped.source_url, 'https://fixture-alpha.example/p/fx-a-1001');
  assert.equal(mapped.title, 'Fixture Wireless Headphones 1001');
  assert.deepEqual(mapped.price, { amount: '129.50', currency: 'USD' });
  assert.equal(mapped.availability_text, 'In stock');
  assert.equal(mapped.category_text, 'Audio > Headphones');
  assert.deepEqual(mapped.merchant, {
    name: 'Fixture Merchant Alpha',
    merchant_ref: 'fixture-alpha',
    website_url: 'https://fixture-alpha.example',
    country: 'KE'
  });
  assert.equal(mapped.media.length, 1);
  assert.equal(mapped.media[0].url, 'https://fixture-alpha.example/media/fx-a-1001-1.jpg');
  assert.equal(mapped.media[0].media_type, 'image');
  assert.equal(mapped.media[0].sort_order, 0);
  assert.equal(mapped.raw, raw, 'raw must be the source product itself, unchanged');
  assert.equal(contract.validateRecord(mapped, 0).ok, true);
});

test('store-json: markup is stripped from the mapped description and kept in raw', () => {
  const context = alphaContext('ok/page-1.json');
  const raw = readJson(path.join(ALPHA, 'scenarios', 'ok', 'page-1.json')).products[0];
  const mapped = storeJson.toRecord(raw, context);
  assert.equal(mapped.description.includes('<'), false);
  assert.match(mapped.description, /& it is not a real listing/);
  assert.match(mapped.raw.description, /<strong>/, 'the original markup stays in the evidence');
});

test('store-json: media keep their order and the minor-unit price keeps its currency', () => {
  const context = alphaContext('ok/page-1.json');
  const raw = readJson(path.join(ALPHA, 'scenarios', 'ok', 'page-1.json')).products[1];
  const mapped = storeJson.toRecord(raw, context);
  assert.deepEqual(mapped.media.map((entry) => entry.sort_order), [0, 1]);
  assert.deepEqual(mapped.price, { amount: '45.00', currency: 'KES' });
  assert.equal(mapped.availability_text, 'Out of stock');
});

test('store-json: an id is used as the identity when the source has no sku', () => {
  const context = alphaContext('ok/page-1.json');
  const mapped = storeJson.toRecord({ id: 777, name: 'No sku', permalink: 'https://x.example/p/777', prices: null }, context);
  assert.equal(mapped.external_product_id, '777');
  assert.equal(mapped.price, null);
});

test('store-json: a hostile source field stays in raw and never becomes a record field', () => {
  const context = alphaContext('malformed-records/page-1.json');
  const raw = readJson(path.join(ALPHA, 'scenarios', 'malformed-records', 'page-1.json')).products[3];
  const mapped = storeJson.toRecord(raw, context);
  assert.equal(mapped.pipeline_status, undefined);
  assert.equal(mapped.affiliate_url, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(mapped, 'pipeline_status'), false);
  assert.equal(mapped.raw.pipeline_status, 'approved');
  assert.equal(mapped.raw.affiliate_url, 'https://tracking.example/aff?id=2004');
  assert.equal(mapped.media[0].url, 'javascript:alert(1)', 'the mapped value is faithful; the contract is what refuses it');
  assert.equal(contract.validateRecord(mapped, 0).ok, false);
});

test('store-json: a response shape the adapter cannot read is an adapter error, not a rejected record', () => {
  const context = alphaContext('ok/page-1.json');
  assert.throws(
    () => storeJson.toRecord({ sku: 'X', name: 'X', permalink: 'https://x.example/p/x', prices: { price: '1999' } }, context),
    (error) => error.kind === 'malformed-response' && /currency_minor_unit/.test(error.message)
  );
  assert.throws(
    () => storeJson.toRecord({ sku: 'X', name: 'X', permalink: 'https://x.example/p/x', prices: { price: '1999', currency_minor_unit: 2 } }, context),
    (error) => error.kind === 'malformed-response' && /currency_code/.test(error.message)
  );
});

test('store-json: pagination stops on a short page, and bad pages fail by name', async () => {
  const pageOne = readJson(path.join(ALPHA, 'scenarios', 'ok', 'page-1.json'));
  const pageTwo = readJson(path.join(ALPHA, 'scenarios', 'ok', 'page-2.json'));
  const good = {
    readTextPage: async (page) => (page === 1 ? JSON.stringify(pageOne) : page === 2 ? JSON.stringify(pageTwo) : null)
  };
  const fetched = await storeJson.fetchRaw({
    transport: good,
    source: { config: { per_page: 2, max_pages: 5 } }
  });
  assert.equal(fetched.rawRecords.length, 3);
  assert.equal(fetched.meta.pages, 2);
  assert.equal(fetched.meta.truncated, false);

  await assert.rejects(
    storeJson.fetchRaw({ transport: { readTextPage: async () => '{ not json' }, source: { config: {} } }),
    (error) => error.kind === 'malformed-response' && /not valid JSON/.test(error.message)
  );
  await assert.rejects(
    storeJson.fetchRaw({ transport: { readTextPage: async () => JSON.stringify({ items: [] }) }, source: { config: {} } }),
    (error) => error.kind === 'malformed-response' && /products/.test(error.message)
  );
  await assert.rejects(
    storeJson.fetchRaw({ transport: { readTextPage: async () => null }, source: { config: {} } }),
    (error) => error.kind === 'empty-source'
  );
});

/* -------------------------------------------------------- product-csv -- */

function csvTransport(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { readTextFile: async () => text };
}

test('product-csv: a feed row maps onto the contract shape', async () => {
  const fetched = await productCsv.fetchRaw({ transport: csvTransport(path.join(BETA, 'scenarios', 'ok', 'feed.csv')) });
  assert.equal(fetched.rawRecords.length, 3);
  const mapped = productCsv.toRecord(fetched.rawRecords[0], {});
  assert.equal(mapped.external_product_id, 'FB-2001');
  assert.equal(mapped.source_url, 'https://fixture-beta.example/p/fb-2001');
  assert.deepEqual(mapped.price, { amount: '19.99', currency: 'GBP' });
  assert.equal(mapped.availability_text, 'In stock');
  assert.equal(mapped.category_text, 'Bags > Totes');
  assert.equal(mapped.merchant.name, 'Fixture Merchant Beta');
  assert.equal(mapped.media.length, 1);
  assert.equal(mapped.raw.item_id, 'FB-2001', 'raw keeps the source column names');
  assert.equal(contract.validateRecord(mapped, 0).ok, true);
});

test('product-csv: quoting, embedded commas and escaped quotes survive parsing', async () => {
  const fetched = await productCsv.fetchRaw({ transport: csvTransport(path.join(BETA, 'scenarios', 'ok', 'feed.csv')) });
  assert.match(productCsv.toRecord(fetched.rawRecords[0], {}).description, /quoted because the description contains a comma/);
  assert.equal(productCsv.toRecord(fetched.rawRecords[2], {}).description, 'A quoted description with "escaped quotes" inside it.');
});

test('product-csv: a blank price is no price, not a zero', async () => {
  const fetched = await productCsv.fetchRaw({ transport: csvTransport(path.join(BETA, 'scenarios', 'ok', 'feed.csv')) });
  const mapped = productCsv.toRecord(fetched.rawRecords[2], {});
  assert.equal(mapped.price, null);
  assert.equal(contract.validateRecord(mapped, 0).ok, true);
});

test('product-csv: every valid feed row satisfies the contract, and the broken ones are refused by name', async () => {
  const good = await productCsv.fetchRaw({ transport: csvTransport(path.join(BETA, 'scenarios', 'ok', 'feed.csv')) });
  for (const row of good.rawRecords) {
    assert.equal(contract.validateRecord(productCsv.toRecord(row, {}), 0).ok, true);
  }

  const bad = await productCsv.fetchRaw({ transport: csvTransport(path.join(BETA, 'scenarios', 'malformed-records', 'feed.csv')) });
  const refused = bad.rawRecords.map((row) => contract.validateRecord(productCsv.toRecord(row, {}), 0));
  assert.deepEqual(refused.map((entry) => entry.ok), [false, false, false, false]);
  assert.deepEqual(refused.map((entry) => entry.errors[0].field),
    ['external_product_id', 'title', 'price.amount', 'price.amount']);
});

test('product-csv: a row with the wrong number of fields is a response error, not a silent mangle', async () => {
  const text = 'item_id,item_name\nFB-1,Name,extra\n';
  await assert.rejects(
    productCsv.fetchRaw({ transport: { readTextFile: async () => text } }),
    (error) => error.kind === 'malformed-response' && /3 fields but the header has 2/.test(error.message)
  );
  await assert.rejects(
    productCsv.fetchRaw({ transport: { readTextFile: async () => null } }),
    (error) => error.kind === 'empty-source'
  );
  await assert.rejects(
    productCsv.fetchRaw({ transport: { readTextFile: async () => 'item_id,item_name\n' } }),
    (error) => error.kind === 'empty-source'
  );
});
/* ------------------------------------------------------ woo-store-api -- */

const wooStoreApi = require('../lib/adapters/woo-store-api');

const STORE = path.join(REPO_ROOT, 'connectors', 'fixtures', 'woocommerce-store');

function storeContext() {
  const manifest = readJson(path.join(STORE, 'source.json'));
  return { source: manifest };
}

function pagesTransport(pages) {
  return {
    kind: 'http',
    meta: { requests: pages.length, pages: pages.length, bytes: 0 },
    readTextPage: async (pageNumber) => (pageNumber <= pages.length ? pages[pageNumber - 1] : null)
  };
}

test('woo-store-api: a saved Store API page maps onto the contract shape', () => {
  const page = readJson(path.join(STORE, 'scenarios', 'ok', 'page-1.json'));
  assert.ok(Array.isArray(page), 'the documented Store API answer is a bare array of products');

  const mapped = wooStoreApi.toRecord(page[0], storeContext());
  assert.equal(mapped.external_product_id, 'STORE-1201');
  assert.equal(mapped.source_url, 'https://store.example/product/studio-monitor-headphones');
  assert.equal(mapped.title, 'Studio Monitor Headphones');
  assert.deepEqual(mapped.price, { amount: '8990.00', currency: 'KES' });
  assert.equal(mapped.availability_text, 'In stock');
  assert.equal(mapped.category_text, 'Audio > Headphones');
  assert.equal(mapped.media.length, 2);
  assert.deepEqual(mapped.raw, page[0], 'the source record is kept verbatim as the evidence');
  assert.match(mapped.description, /Closed-back monitoring headphones/);
  assert.doesNotMatch(mapped.description, /<p>/, 'the mapped description is plain text');
});

test('woo-store-api: a product with no SKU is identified by its own id', () => {
  const page = readJson(path.join(STORE, 'scenarios', 'ok', 'page-1.json'));
  const withoutSku = wooStoreApi.toRecord(page[1], storeContext());
  assert.equal(withoutSku.external_product_id, '1202');

  const malformed = readJson(path.join(STORE, 'scenarios', 'malformed-records', 'page-1.json'));
  const withoutIdentity = wooStoreApi.toRecord(malformed[0], storeContext());
  assert.equal(withoutIdentity.external_product_id, '', 'no id and no SKU stays blank: the boundary refuses it');
  assert.equal(contract.validateRecord(withoutIdentity).ok, false);
  assert.deepEqual(contract.validateRecord(withoutIdentity).errors.map((entry) => entry.field), ['external_product_id']);
});

test('woo-store-api: both documented answers are read, and anything else is a named error', () => {
  assert.equal(wooStoreApi.productsOf([{ id: 1 }], 1).length, 1, 'a bare array');
  assert.equal(wooStoreApi.productsOf({ products: [{ id: 1 }, { id: 2 }] }, 1).length, 2, 'the wrapper a proxy may add');
  for (const body of [{ items: [] }, null, 'ok', 42]) {
    assert.throws(() => wooStoreApi.productsOf(body, 7), (error) => {
      assert.equal(error.kind, 'malformed-response');
      assert.match(error.message, /page 7/);
      return true;
    }, 'expected ' + JSON.stringify(body) + ' to be refused');
  }
});

test('woo-store-api: pages are read until one comes back short', async () => {
  const full = JSON.stringify([{ id: 1 }, { id: 2 }]);
  const short = JSON.stringify([{ id: 3 }]);
  const fetched = await wooStoreApi.fetchRaw({
    source: { config: { per_page: 2 } },
    transport: pagesTransport([full, full, short])
  });
  assert.equal(fetched.rawRecords.length, 5);
  assert.equal(fetched.meta.pages, 3);
  assert.equal(fetched.meta.truncated, false, 'a short page is the end of the catalogue, not a truncation');
});

test('woo-store-api: a store that never comes back short is bounded by max_pages', async () => {
  const full = JSON.stringify([{ id: 1 }, { id: 2 }]);
  const fetched = await wooStoreApi.fetchRaw({
    source: { config: { per_page: 2, max_pages: 3 } },
    transport: pagesTransport([full, full, full, full, full])
  });
  assert.equal(fetched.meta.pages, 3);
  assert.equal(fetched.meta.truncated, true, 'the run says it stopped at the ceiling rather than claiming the end');
});

test('woo-store-api: the defaults a real store gets are a hundred a page and twenty pages', async () => {
  assert.equal(wooStoreApi.DEFAULT_PER_PAGE, 100);
  assert.equal(wooStoreApi.DEFAULT_MAX_PAGES, 20);
  const fetched = await wooStoreApi.fetchRaw({
    source: { config: {} },
    transport: pagesTransport([JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }])])
  });
  assert.equal(fetched.meta.per_page, 100);
  assert.equal(fetched.meta.pages, 1, 'three products is a short page for a store with no configured page size');
});

test('woo-store-api: a page that is not JSON at all is refused with the page number', async () => {
  await assert.rejects(wooStoreApi.fetchRaw({
    source: { config: { per_page: 2 } },
    transport: pagesTransport(['<html>maintenance</html>'])
  }), (error) => {
    assert.equal(error.kind, 'malformed-response');
    assert.match(error.message, /page 1 is not valid JSON/);
    return true;
  });
});
