'use strict';

/**
 * The normalization boundary — Step 17C-F.
 *
 * Where it sits, in the pipeline the connector runs:
 *
 *   source payload
 *        ↓
 *   adapter            interprets one merchant's shape (mapping, markup, minor units)
 *        ↓
 *   normalization      **this module** — the canonical form of a record, whatever produced it
 *        ↓
 *   contract           the 17C-A rules, unchanged: a value this pass declined to
 *        ↓             repair is refused here, by name
 *   ingest boundary    migration 0011 (three RPC endpoints; nothing else)
 *
 * What it is:
 *   • pure — one input, one output: no clock, no randomness, no state, no I/O;
 *   • deterministic — the same input always produces a byte-identical result, and
 *     normalizing an already-normalized record changes nothing (idempotent);
 *   • adapter-independent — no merchant, host, currency or catalogue is named
 *     here, and no source shape is assumed beyond the 17C-A record fields
 *     themselves. A merchant-specific transformation belongs in that merchant's
 *     adapter, which is the module that knows the shape it is reading.
 *
 * What it is not:
 *   • it repairs nothing. A blank identity stays blank, a lower-case currency
 *     stays lower-case, a non-http(s) address stays as the source wrote it, a
 *     price that is not decimal digits stays that way. Those are the contract's
 *     to refuse with a sentence a person can act on, and a normalizer that
 *     quietly fixed them would hide a bad source instead of reporting it;
 *   • it invents nothing. No identity is derived, no currency is guessed, no
 *     media type is assumed, no price is converted, rounded, symbol-stripped or
 *     re-scaled;
 *   • it does no categorization, ranking, deduplication or affiliate work, and
 *     it claims no pipeline position: `normalization_status` belongs to the
 *     database's own later normalization stage, not to this boundary;
 *   • it touches no resource. A media reference is a string that is preserved,
 *     never fetched; nothing remote is inspected;
 *   • it does not touch evidence or shape. `raw` is passed through untouched,
 *     and an unknown or refused key is left exactly where the source put it for
 *     validation to name — removing it would hide what was sent, and would turn
 *     a refusal into an acceptance.
 */

const contract = require('./contract');

/** The name of each rule, as it appears in a run report. */
const RULES = {
  TEXT: 'text-trim',
  IDENTITY: 'external-identity',
  URL: 'url-canonical',
  PRICE: 'price-shape',
  MEDIA: 'media-shape'
};

/* ---------------------------------------------------------------- values -- */

/** A present string, trimmed. Anything that is not a string is left to validation. */
function text(value) {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * The external identity of a record, in the one form the contract accepts as a
 * string: a source that gives a numeric id is preserved as its decimal digits,
 * and surrounding whitespace is removed so that " SKU-1 " and "SKU-1" are the
 * same identity. Case is never changed, nothing is derived, and an empty
 * identity stays empty.
 */
function identity(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

/**
 * A reference to a resource, canonicalised without being reinterpreted.
 *
 * Only a value that already satisfies the contract's URL rule is canonicalised,
 * so this pass can never rescue an address the contract would refuse: the
 * scheme and host are lower-cased and a default port is dropped, while the
 * path, query, fragment, userinfo and the scheme itself (http stays http) are
 * preserved exactly as the source wrote them. A value that is not a usable
 * http(s) address is returned as it was, for validation to refuse by name.
 */
function url(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '' || !contract.PATTERNS.url.test(trimmed)) return trimmed;
  let parsed = null;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    return trimmed;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return trimmed;
  /* A source that wrote "https://host" with no path keeps its own form: an
     implicit empty path is not a difference worth reporting, and the value is
     already canonical as far as anything downstream is concerned. */
  if (parsed.href === trimmed + '/' && parsed.pathname === '/' && parsed.search === '' && parsed.hash === '') {
    return trimmed;
  }
  return parsed.href;
}

/** A decimal amount: a finite number becomes its decimal string, a string is trimmed. */
function amount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

/**
 * A price in the canonical shape: an object carrying `amount` and `currency`.
 * Both are trimmed, a numeric amount becomes a decimal string, and every other
 * key — including one the contract refuses — is kept as it was. A value that is
 * not an object (a bare string, a number, an array) is returned unchanged: this
 * pass does not guess which part of it was the money or which was the currency.
 */
function price(value) {
  if (!contract.isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value)) {
    if (key === 'amount') out.amount = amount(value.amount);
    else if (key === 'currency') out.currency = text(value.currency);
    else out[key] = value[key];
  }
  return out;
}

/**
 * Media references in a predictable shape: an array whose entries are objects
 * carrying at least a `url`, and nothing downloaded or inspected.
 *
 * A bare string entry is understood as a reference and becomes `{url}` — the
 * string is the source's own reference, preserved. A `sort_order` is recorded
 * from the array's own order only when no entry states one, so this pass cannot
 * invent a duplicate ordering; when the source states an order, it is left
 * exactly as stated, gaps and all. `media_type` is never assumed, unknown keys
 * stay, and an array longer than the contract allows is not truncated — the
 * contract refuses it, and hiding the extra references would not be honest.
 */
function media(value) {
  if (!Array.isArray(value)) return value;
  const statesOrder = value.some((entry) => contract.isPlainObject(entry) && Number.isInteger(entry.sort_order));
  return value.map((entry, index) => {
    if (typeof entry === 'string') {
      const reference = { url: url(entry) };
      if (!statesOrder) reference.sort_order = index;
      return reference;
    }
    if (!contract.isPlainObject(entry)) return entry;
    const out = Object.assign({}, entry);
    if (Object.prototype.hasOwnProperty.call(out, 'url')) out.url = url(out.url);
    if (Object.prototype.hasOwnProperty.call(out, 'fallback_url')) out.fallback_url = url(out.fallback_url);
    if (Object.prototype.hasOwnProperty.call(out, 'media_type')) out.media_type = text(out.media_type);
    if (Object.prototype.hasOwnProperty.call(out, 'attribution')) out.attribution = text(out.attribution);
    if (!Object.prototype.hasOwnProperty.call(out, 'sort_order') && !statesOrder) out.sort_order = index;
    return out;
  });
}

/* ------------------------------------------------------- the record pass -- */

const TEXT_FIELDS = ['title', 'description', 'availability_text', 'category_text'];
const MERCHANT_TEXT_FIELDS = ['name', 'merchant_ref', 'country'];
const MEDIA_FIELDS = ['url', 'fallback_url', 'media_type', 'attribution', 'sort_order'];

function has(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
}

/** Whether a transform actually changed a value (objects and arrays compared by value). */
function differs(before, after) {
  if (before === after) return false;
  try {
    return JSON.stringify(before) !== JSON.stringify(after);
  } catch (error) {
    return true;
  }
}

/** Applies one transform in place and records the field it changed, if it changed. */
function applyField(out, source, field, transform, rule, changes, prefix) {
  if (!has(source, field)) return;
  const before = source[field];
  const after = transform(before);
  out[field] = after;
  if (differs(before, after)) changes.push({ field: (prefix || '') + field, rule: rule });
}

/** The fields inside a normalized price that actually changed. */
function priceChanges(before, after, changes) {
  for (const key of ['amount', 'currency']) {
    if (differs(before[key], after[key])) changes.push({ field: 'price.' + key, rule: RULES.PRICE });
  }
}

/**
 * The fields inside a normalized media array that actually changed, by index.
 * A reference that was canonicalised is reported as a URL change — the rule
 * names what was done — while everything else about the entry is a media-shape
 * decision (an entry that became an object, an ordering that was recorded).
 */
function mediaChanges(before, after, changes) {
  for (let index = 0; index < after.length; index += 1) {
    const entry = after[index];
    const original = before[index];
    const prefix = 'media[' + index + ']';
    if (!contract.isPlainObject(original)) {
      if (differs(original, entry)) changes.push({ field: prefix, rule: RULES.MEDIA });
      continue;
    }
    if (!differs(original, entry)) continue;
    let noted = false;
    for (const field of MEDIA_FIELDS) {
      if (differs(original[field], entry[field])) {
        changes.push({ field: prefix + '.' + field, rule: field === 'url' || field === 'fallback_url' ? RULES.URL : RULES.MEDIA });
        noted = true;
      }
    }
    if (!noted) changes.push({ field: prefix, rule: RULES.MEDIA });
  }
}

/**
 * Normalizes one mapped record and reports what it changed.
 *
 * @param {*} value the record an adapter produced
 * @returns {{record: *, changes: Array<{field: string, rule: string}>}}
 *          the canonical record and the fields this pass touched, in a fixed
 *          order — the same order for the same input, always
 */
function record(value) {
  if (!contract.isPlainObject(value)) return { record: value, changes: [] };
  const changes = [];
  const out = Object.assign({}, value);

  applyField(out, value, 'external_product_id', identity, RULES.IDENTITY, changes);
  applyField(out, value, 'source_url', url, RULES.URL, changes);
  for (const field of TEXT_FIELDS) applyField(out, value, field, text, RULES.TEXT, changes);

  if (has(value, 'price')) {
    const normalized = price(value.price);
    out.price = normalized;
    if (differs(value.price, normalized)) priceChanges(value.price, normalized, changes);
  }

  if (has(value, 'merchant') && contract.isPlainObject(value.merchant)) {
    const merchant = Object.assign({}, value.merchant);
    for (const field of MERCHANT_TEXT_FIELDS) {
      applyField(merchant, value.merchant, field, text, RULES.TEXT, changes, 'merchant.');
    }
    applyField(merchant, value.merchant, 'website_url', url, RULES.URL, changes, 'merchant.');
    out.merchant = merchant;
  }

  if (Array.isArray(value.media)) {
    const normalized = media(value.media);
    out.media = normalized;
    mediaChanges(value.media, normalized, changes);
  }

  return { record: out, changes: changes };
}

module.exports = {
  RULES: RULES,
  text: text,
  identity: identity,
  url: url,
  price: price,
  media: media,
  record: record
};
