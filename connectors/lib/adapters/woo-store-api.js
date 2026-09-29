'use strict';

/**
 * The `woo-store-api` adapter — a WooCommerce store's own Store API
 * (`/wp-json/wc/store/v1/products`), the first real source this pipeline reads.
 *
 * It is the same product shape the fixture adapter reads, on purpose: 17C-A §10
 * ranks "a merchant's own structured product feed or API" first, and the
 * WooCommerce Store API is that source for a store the operator controls — a
 * documented public read, no anti-bot gate, no browser automation, no
 * credential for a public catalogue. What changes between a fixture and a real
 * store is the **transport** (saved pages versus HTTPS with a host policy), not
 * the mapping, so the mapping is shared with `store-json` rather than copied:
 * two copies of a price rule would be two chances to disagree about money.
 *
 * What this adapter owns:
 *   • the documented response shape — `/wp-json/wc/store/v1/products` answers
 *     with a **bare JSON array** of products (a store behind a proxy sometimes
 *     wraps it as `{"products": [...]}`, so both are read, and anything else is a
 *     named response error rather than an empty run);
 *   • the real source's defaults — a Store API page is 100 products unless the
 *     source says otherwise, and a run reads at most 20 pages;
 *   • the "last page" rule — the Store API answers a short page (and then an
 *     empty one) rather than a 404, so the loop stops on a page shorter than
 *     `per_page`. It never depends on the `X-WP-TotalPages` header: a header is
 *     not part of the documented payload, and the transport hands back text;
 *   • a guard against an endpoint that answers with no page at all, because a
 *     store with no products and a wrong endpoint should not look the same.
 *
 * What it never does: invent an identifier (D3 — a product with no SKU and no id
 * is refused by the boundary, not given a hash), clean the source's own record
 * (`raw` is the product object verbatim), or claim a pipeline position.
 */

const { AdapterError } = require('../errors');
const storeJson = require('./store-json');

const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 20;

/**
 * The products in one page's body: the documented bare array, or the wrapper a
 * proxy may add. Anything else is a response error with the shape named.
 */
function productsOf(body, page) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && Array.isArray(body.products)) return body.products;
  throw new AdapterError('malformed-response',
    'page ' + page + ' is neither a JSON array of products nor {"products": [...]};'
    + ' the Store API answers with a bare array');
}

module.exports = {
  name: 'woo-store-api',
  version: '0.1.0',
  method: 'json-api',
  description: 'A WooCommerce store\'s own Store API (/wp-json/wc/store/v1/products), read as documented public product data.',
  transport: 'HTTPS GET of the store\'s products endpoint, one page per request',

  /**
   * Reads the store's pages until one comes back short. `per_page` and
   * `max_pages` come from the source's non-secret config; the transport sets the
   * `page`/`per_page` query parameters.
   *
   * @returns {{rawRecords: object[], meta: object}}
   */
  async fetchRaw(context) {
    const source = context.source;
    const transport = context.transport;
    const configuredPerPage = Number(source.config.per_page);
    const perPage = configuredPerPage > 0 ? configuredPerPage : DEFAULT_PER_PAGE;
    const configuredMaxPages = Number(source.config.max_pages);
    const maxPages = configuredMaxPages > 0 ? configuredMaxPages : DEFAULT_MAX_PAGES;

    const rawRecords = [];
    const pages = [];
    let merchant = null;

    for (let page = 1; page <= maxPages; page += 1) {
      const text = await transport.readTextPage(page);
      if (text === null) break;

      let body;
      try {
        body = JSON.parse(text);
      } catch (error) {
        throw new AdapterError('malformed-response', 'page ' + page + ' is not valid JSON: ' + error.message);
      }
      const products = productsOf(body, page);
      if (!merchant && body && !Array.isArray(body) && body.store && typeof body.store === 'object') {
        merchant = body.store;
      }

      pages.push({ page: page, products: products.length });
      for (const product of products) rawRecords.push(product);

      /* The Store API's own end-of-catalogue signal: a page with fewer products
         than were asked for. An empty page ends it too. */
      if (products.length < perPage) break;
    }

    if (pages.length === 0) {
      throw new AdapterError('empty-source', 'the endpoint answered with no page at all');
    }

    return {
      rawRecords: rawRecords,
      meta: {
        pages: pages.length,
        page_detail: pages,
        per_page: perPage,
        merchant: merchant,
        truncated: pages.length === maxPages
      }
    };
  },

  /**
   * One Store API product -> one contract record. The mapping is `store-json`'s,
   * deliberately shared: the Store API's product object is the shape it reads
   * (minor-unit prices, `stock_availability.text`, categories, images, permalink,
   * SKU), and `raw` stays the source's own object, keys and all.
   */
  toRecord(raw, context) {
    return storeJson.toRecord(raw, context);
  },

  /* Exported so the tests can assert the defaults a real source gets. */
  DEFAULT_PER_PAGE: DEFAULT_PER_PAGE,
  DEFAULT_MAX_PAGES: DEFAULT_MAX_PAGES,
  productsOf: productsOf
};
