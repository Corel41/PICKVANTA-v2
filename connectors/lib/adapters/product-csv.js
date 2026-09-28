'use strict';

/**
 * The `product-csv` adapter — a merchant product feed as one CSV file.
 *
 * The second adapter exists to prove the point the architecture claims: the
 * runner, the contract and the reporting do not change when the source's shape
 * does. Only `fetchRaw` (where the bytes come from) and `toRecord` (how a row
 * maps) are adapter work; everything after them is shared.
 *
 * Limits of this parser, stated rather than discovered: it supports quoted
 * fields, escaped quotes ("") and CRLF line endings; it does not support a
 * newline inside a quoted field. A feed that needs that is a 17C-D finding.
 */

const { AdapterError } = require('../errors');
const { LIMITS } = require('../contract');
const { htmlToText, textOf, firstText } = require('./shared');

/** RFC 4180 subset: quoted fields, escaped quotes, comma separated, CRLF or LF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (character === '\r') {
      index += 1;
      continue;
    }
    if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (quoted) throw new AdapterError('malformed-response', 'the CSV feed ends inside a quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
}

module.exports = {
  name: 'product-csv',
  version: '0.1.0',
  method: 'csv',
  description: 'A merchant product feed published as one CSV file.',
  transport: 'one CSV document (the transport supplies the text; the adapter parses it)',

  async fetchRaw(context) {
    const text = await context.transport.readTextFile('feed.csv');
    if (text === null) throw new AdapterError('empty-source', 'no feed.csv was found for this scenario');

    const rows = parseCsv(text);
    if (rows.length < 2) throw new AdapterError('empty-source', 'the feed has a header and no products');

    const header = rows[0].map((name) => name.trim());
    const rawRecords = [];
    for (let index = 1; index < rows.length; index += 1) {
      const values = rows[index];
      if (values.length !== header.length) {
        throw new AdapterError(
          'malformed-response',
          'row ' + (index + 1) + ' has ' + values.length + ' fields but the header has ' + header.length
        );
      }
      const record = {};
      header.forEach((name, position) => {
        record[name] = values[position];
      });
      rawRecords.push(record);
    }

    return {
      rawRecords: rawRecords,
      meta: { pages: 1, columns: header.slice(), truncated: false }
    };
  },

  toRecord(raw) {
    const image = textOf(raw.image_url);
    return {
      external_product_id: firstText(raw.item_id),
      source_url: textOf(raw.item_url),
      title: textOf(raw.item_name),
      description: htmlToText(raw.item_description),
      price: textOf(raw.price) === '' ? null : { amount: textOf(raw.price), currency: textOf(raw.currency) },
      availability_text: textOf(raw.stock),
      category_text: textOf(raw.category),
      merchant: {
        name: firstText(raw.merchant_name),
        merchant_ref: firstText(raw.merchant_ref),
        website_url: textOf(raw.merchant_website),
        country: textOf(raw.merchant_country)
      },
      media: image === '' ? [] : [{
        url: image,
        media_type: 'image',
        sort_order: 0,
        attribution: '',
        fallback_url: ''
      }].slice(0, LIMITS.mediaPerRecord),
      raw: raw
    };
  }
};
