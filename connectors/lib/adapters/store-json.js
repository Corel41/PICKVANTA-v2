'use strict';

/**
 * The `store-json` adapter — a store product API that answers with JSON pages.
 *
 * This is the adapter the fixture source uses, and it is written the way the
 * real one will be: `fetchRaw` knows the source's transport (pages of JSON),
 * `toRecord` is a pure mapping from one source product to one contract record.
 * A real merchant API in 17C-D replaces `fetchRaw`'s transport with HTTP and
 * keeps this mapping shape; the runner and the contract validator stay exactly
 * as they are.
 *
 * The mapped fields and the untouched evidence are deliberately kept apart:
 * `raw` carries the source's own product object, keys and all (including any
 * field a hostile source might hope would leak into our columns).
 */

const { AdapterError } = require('../errors');
const { LIMITS } = require('../contract');
const { htmlToText, textOf, firstText, decimalFromMinorUnits } = require('./shared');

function mapPrice(prices) {
  if (prices === null || prices === undefined) return null;
  if (typeof prices !== 'object' || Array.isArray(prices)) {
    throw new AdapterError('malformed-response', 'prices must be an object when it is present');
  }
  const raw = textOf(prices.price);
  if (raw === '') return null;
  const amount = decimalFromMinorUnits(raw, prices.currency_minor_unit);
  if (amount === null) {
    throw new AdapterError(
      'malformed-response',
      'prices.price "' + raw + '" is not a minor-unit amount with a usable currency_minor_unit'
    );
  }
  const currency = textOf(prices.currency_code);
  if (currency === '') {
    throw new AdapterError('malformed-response', 'prices.currency_code is missing beside a price');
  }
  return { amount: amount, currency: currency };
}

module.exports = {
  name: 'store-json',
  version: '0.1.0',
  method: 'json-api',
  description: 'A store product API that returns JSON pages of products with minor-unit prices.',
  transport: 'pages of JSON (the transport supplies the text; the adapter parses it)',

  /**
   * @returns {{rawRecords: object[], meta: object}}
   */
  async fetchRaw(context) {
    const transport = context.transport;
    const source = context.source;
    const perPage = Number(source.config.per_page) > 0 ? Number(source.config.per_page) : 2;
    const maxPages = Number(source.config.max_pages) > 0 ? Number(source.config.max_pages) : 10;

    const rawRecords = [];
    const pages = [];
    let merchant = null;
    let page = 1;

    for (; page <= maxPages; page += 1) {
      const text = await transport.readTextPage(page);
      if (text === null) break;

      let body;
      try {
        body = JSON.parse(text);
      } catch (error) {
        throw new AdapterError('malformed-response', 'page ' + page + ' is not valid JSON: ' + error.message);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.products)) {
        throw new AdapterError('malformed-response', 'page ' + page + ' has no "products" array');
      }
      if (!merchant && body.store && typeof body.store === 'object') merchant = body.store;

      pages.push({ page: page, products: body.products.length });
      for (const product of body.products) rawRecords.push(product);
      if (body.products.length < perPage) break;
    }

    if (pages.length === 0) {
      throw new AdapterError('empty-source', 'no page was found for this scenario');
    }

    return {
      rawRecords: rawRecords,
      meta: {
        pages: pages.length,
        page_detail: pages,
        per_page: perPage,
        /* The page-level merchant object, handed to toRecord so the mapper stays pure. */
        merchant: merchant,
        truncated: pages.length === maxPages
      }
    };
  },

  /** One source product -> one contract record. Pure: no clock, no state, no I/O. */
  toRecord(raw, context) {
    const source = context.source;
    const merchant = context.merchant || {};

    const media = Array.isArray(raw.images)
      ? raw.images.slice(0, LIMITS.mediaPerRecord).map((image, index) => ({
        url: textOf(image && image.src),
        media_type: 'image',
        sort_order: index,
        attribution: textOf(image && image.attribution),
        fallback_url: ''
      }))
      : [];

    const categories = Array.isArray(raw.categories)
      ? raw.categories.map((entry) => textOf(entry && entry.name)).filter((name) => name !== '')
      : [];

    return {
      external_product_id: firstText(raw.sku, raw.id),
      source_url: textOf(raw.permalink),
      title: textOf(raw.name),
      description: htmlToText(raw.description),
      price: mapPrice(raw.prices),
      availability_text: textOf(raw.stock_availability && raw.stock_availability.text),
      category_text: categories.join(' > '),
      merchant: {
        name: firstText(merchant.name, source.provider_name, source.name),
        merchant_ref: firstText(merchant.ref, source.provider_name),
        website_url: textOf(merchant.website_url),
        country: textOf(merchant.country)
      },
      media: media,
      raw: raw
    };
  }
};
