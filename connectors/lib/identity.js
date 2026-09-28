'use strict';

/**
 * The identity foundation — Step 17C-G.
 *
 * Where it sits, in the pipeline the connector runs:
 *
 *   source payload → adapter → normalization → contract → **identity** → ingest boundary
 *
 * and what it is for: deciding what "the same external item" means *deterministically*,
 * before any human ever reviews a record. It is a foundation, not a matcher:
 *
 *   • pure — one input, one output. No clock, no randomness, no state, no I/O, no network;
 *   • deterministic — the same input always produces the same result, byte for byte;
 *   • conservative — it prefers "uncertain" over a guess, every time. Uncertainty is
 *     reported for a person to resolve; nothing here merges, renames, ranks or reorders
 *     anything, and no merge decision is ever made by similarity;
 *   • adapter-independent — it reads the 17C-A record fields and nothing else. It does not
 *     re-parse `raw`, because which field a merchant puts a SKU in is that merchant's
 *     adapter's business.
 *
 * The rules, in priority order (`PRIORITY`):
 *
 *   1. `source-external-id` — the source's own product identifier, scoped to the source.
 *      This is the authoritative identity, and it is the *same* key `0005`'s partial unique
 *      index enforces and `0011` relies on: `<source_id>|<external_product_id>`. Two
 *      different sources can never collide here, because the source id is part of the key.
 *   2. `source-url` — the normalized address of the item's own page. Within one source it
 *      corroborates identity and reveals a contradiction (two different external ids
 *      claiming one page); it never becomes an identity by itself.
 *   3. `merchant-ref` / `merchant-website` — the merchant the payload declared. Context for
 *      identity, and a contradiction detector (one external id, two merchant refs).
 *   4. `none` — no identifier at all. The identity is then *unknown*, which is reported and
 *      never invented: a content hash, a title or a URL fallback would be a guess, and a
 *      pipeline that guesses identity duplicates records (17C-A §8.4, decision D3).
 *
 * What is deliberately **not** an identity input: `title`, `description`, `category_text`,
 * `availability_text` and prices. Two sources selling "USB-C Cable" are two different items
 * until something deterministic says otherwise; a title is a label, not an identifier, and
 * matching on one is how a catalogue starts collapsing unrelated products.
 *
 * Cross-source behaviour. A run reads one source, but the layer is pure and takes a list, so
 * it can be handed records from several. When two *different* sources share a candidate
 * value (the same external identifier string, or the same page address), that is reported as
 * `cross-source-candidate` with `merge: false`: it is evidence worth a person's attention and
 * nothing more. Merging records across sources is not a decision this foundation takes,
 * because the only signals available here cannot prove two merchants mean the same thing.
 */

const contract = require('./contract');
const normalize = require('./normalize');

/** The identity rules, strongest first. This order *is* the priority order. */
const PRIORITY = ['source-external-id', 'source-url', 'merchant-ref', 'none'];

const RULES = {
  SOURCE_EXTERNAL_ID: 'source-external-id',
  SOURCE_URL: 'source-url',
  MERCHANT_REF: 'merchant-ref',
  MERCHANT_WEBSITE: 'merchant-website',
  NONE: 'none'
};

/** The strengths a signal can carry. `context` never becomes an identity on its own. */
const STRENGTH = {
  AUTHORITATIVE: 'authoritative',
  SUPPORTING: 'supporting',
  CONTEXT: 'context'
};

/** Why an identity is uncertain, in one sentence each. */
const UNCERTAINTY = {
  NO_EXTERNAL_IDENTIFIER: 'no-external-identifier',
  SAME_PAGE_DIFFERENT_IDS: 'same-page-different-ids',
  MERCHANT_CONFLICT: 'merchant-conflict',
  CROSS_SOURCE_CANDIDATE: 'cross-source-candidate'
};

const EXPLANATION = {};
EXPLANATION[UNCERTAINTY.NO_EXTERNAL_IDENTIFIER] =
  'the record states no external product identifier, so its identity is unknown; a fallback would be a guess (decision D3)';
EXPLANATION[UNCERTAINTY.SAME_PAGE_DIFFERENT_IDS] =
  'two different external identifiers from one source point at the same page; one of them may be stale or duplicated by the source';
EXPLANATION[UNCERTAINTY.MERCHANT_CONFLICT] =
  'one external identifier appears with two different merchant references in one payload';
EXPLANATION[UNCERTAINTY.CROSS_SOURCE_CANDIDATE] =
  'two different sources carry the same value; that is evidence for a person to review, never a merge';

/* ---------------------------------------------------------------- values -- */

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The authoritative identity key: `<source_id>|<external_product_id>`.
 * Exactly one format exists in this codebase, and this is it — the same one
 * `contract.identityKey` produces and `0005` enforces.
 */
function key(sourceId, externalProductId) {
  return contract.identityKey(sourceId, externalProductId);
}

/**
 * The identity a record carries, before any comparison with its neighbours.
 *
 * @param {object} record  a normalized 17C-A record
 * @param {object} options `{ source }` — the source the record was read from
 * @returns {{key: string|null, certain: boolean, strength: string, signals: object[],
 *            merchant_ref: string, uncertainty: string[], explanations: string[]}}
 */
function identify(record, options) {
  const source = (options && options.source) || {};
  const sourceId = source.id === undefined || source.id === null ? '' : String(source.id);
  const externalProductId = text(record && record.external_product_id);
  const sourceUrl = normalize.url((record && record.source_url) || '');
  const merchant = record && contract.isPlainObject(record.merchant) ? record.merchant : {};
  const merchantRef = text(merchant.merchant_ref);
  const merchantWebsite = normalize.url(merchant.website_url || '');

  const signals = [];
  const uncertainty = [];

  if (externalProductId !== '' && sourceId !== '') {
    signals.push({
      rule: RULES.SOURCE_EXTERNAL_ID,
      strength: STRENGTH.AUTHORITATIVE,
      source_id: sourceId,
      external_product_id: externalProductId,
      value: key(sourceId, externalProductId)
    });
  }
  /* A page address is an identity signal only when it is a usable http(s) address:
     a string that is not one is the contract's to refuse, and comparing it here
     would let two broken references look like a shared page. */
  if (sourceUrl !== '' && contract.PATTERNS.url.test(sourceUrl)) {
    signals.push({
      rule: RULES.SOURCE_URL,
      strength: STRENGTH.SUPPORTING,
      value: sourceUrl,
      /* A page address is evidence about identity, but it is not an identity: two
         records can legitimately share a listing page, and a URL is not unique. */
      identity: false
    });
  }
  if (merchantRef !== '') {
    signals.push({ rule: RULES.MERCHANT_REF, strength: STRENGTH.CONTEXT, value: merchantRef, identity: false });
  }
  if (merchantWebsite !== '' && contract.PATTERNS.url.test(merchantWebsite)) {
    signals.push({ rule: RULES.MERCHANT_WEBSITE, strength: STRENGTH.CONTEXT, value: merchantWebsite, identity: false });
  }

  const authoritative = signals.filter((entry) => entry.strength === STRENGTH.AUTHORITATIVE);
  if (authoritative.length === 0) uncertainty.push(UNCERTAINTY.NO_EXTERNAL_IDENTIFIER);

  return {
    key: authoritative.length > 0 ? authoritative[0].value : null,
    certain: authoritative.length > 0,
    strength: authoritative.length > 0 ? STRENGTH.AUTHORITATIVE : STRENGTH.CONTEXT,
    signals: signals,
    merchant_ref: merchantRef,
    uncertainty: uncertainty,
    explanations: uncertainty.map((code) => EXPLANATION[code])
  };
}

/**
 * The cross-source candidate values of a record: the strings another source would have to
 * carry for a person to have reason to look at both records together. Never a merge key.
 */
function candidates(record, options) {
  const identity = identify(record, options);
  const values = [];
  for (const signal of identity.signals) {
    if (signal.rule === RULES.SOURCE_EXTERNAL_ID) {
      values.push({ kind: 'external-id', value: signal.external_product_id });
    } else if (signal.rule === RULES.SOURCE_URL) {
      values.push({ kind: 'source-url', value: signal.value });
    }
  }
  return values;
}

/* --------------------------------------------------------------- a list -- */

function samePageKey(sourceId, url) {
  return sourceId + '|<' + url + '>';
}

/**
 * Analyses a list of records — one source's payload, or several sources' at once — for the
 * deterministic facts a person needs:
 *
 *   • which identities exist, and which records carry none;
 *   • a key stated twice in one payload (the boundary keeps one row and refreshes it);
 *   • one source's two different identifiers claiming one page;
 *   • one identifier under two different merchant references;
 *   • the same value under two different sources (`merge: false`).
 *
 * A refused record (`ok: false`) is counted for identity but never as a collision: it
 * reaches no row, so it can collide with nothing.
 *
 * Each entry may name its own source (`{record, source, ok, batch, index}`); when it does
 * not, the run's own source in `options.source` is used. That is what makes a list drawn
 * from two sources analysable without collapsing their identities into one.
 *
 * @param {object[]} entries `{record, source?, ok, batch, index}` in payload order
 * @param {object} options   `{ source }`
 */
function analyse(entries, options) {
  const list = Array.isArray(entries) ? entries : [];
  const results = [];
  const byKey = new Map();
  const byPage = new Map();
  const byMerchant = new Map();
  const byCandidate = new Map();
  const summary = {
    records: list.length,
    identified: 0,
    unidentified: 0,
    distinct: 0,
    duplicates: 0,
    same_page_conflicts: 0,
    merchant_conflicts: 0,
    cross_source_candidates: 0
  };

  list.forEach((entry, position) => {
    const record = entry && entry.record ? entry.record : entry;
    const ok = !(entry && entry.ok === false);
    /* A record's own source wins over the run's: identity is scoped to the source that
       stated it, and no list can silently re-scope a record to another source. */
    const scoped = { source: (entry && entry.source) || (options && options.source) || {} };
    const identity = identify(record, scoped);
    const batch = entry && entry.batch !== undefined ? entry.batch : 1;
    const index = entry && entry.index !== undefined ? entry.index : position;

    results.push({
      batch: batch,
      index: index,
      ok: ok,
      key: identity.key,
      certain: identity.certain,
      strength: identity.strength,
      signals: identity.signals.map((signal) => signal.rule),
      merchant_ref: identity.merchant_ref,
      uncertainty: identity.uncertainty.slice()
    });

    if (identity.key === null) {
      summary.unidentified += 1;
    } else {
      summary.identified += 1;
      if (ok) {
        if (!byKey.has(identity.key)) byKey.set(identity.key, []);
        byKey.get(identity.key).push({ batch: batch, index: index });
      }
    }

    const sourceUrl = (identity.signals.find((signal) => signal.rule === RULES.SOURCE_URL) || {}).value || '';
    const sourceId = String((scoped.source && scoped.source.id) || '');
    if (ok && identity.key !== null && sourceUrl !== '') {
      const pageKey = samePageKey(sourceId, sourceUrl);
      if (!byPage.has(pageKey)) byPage.set(pageKey, { url: sourceUrl, keys: new Map() });
      byPage.get(pageKey).keys.set(identity.key, { batch: batch, index: index });

      if (identity.merchant_ref !== '' && !byMerchant.has(identity.key)) {
        byMerchant.set(identity.key, new Map());
      }
      if (identity.merchant_ref !== '') {
        byMerchant.get(identity.key).set(identity.merchant_ref, { batch: batch, index: index });
      }
    }

    if (ok) {
      for (const candidate of candidates(record, scoped)) {
        if (!byCandidate.has(candidate.value)) byCandidate.set(candidate.value, { kind: candidate.kind, sources: new Map() });
        byCandidate.get(candidate.value).sources.set(sourceId, { batch: batch, index: index });
      }
    }
  });

  summary.distinct = byKey.size;
  summary.duplicates = 0;
  for (const positions of byKey.values()) summary.duplicates += positions.length - 1;

  const collisions = [];
  for (const [identityKey, positions] of byKey.entries()) {
    if (positions.length < 2) continue;
    collisions.push({
      kind: 'duplicate-identity',
      key: identityKey,
      merge: true,
      note: 'the boundary stores one row per identity and refreshes it: the later record in the payload updates the earlier one',
      records: positions
    });
  }

  for (const page of byPage.values()) {
    if (page.keys.size < 2) continue;
    summary.same_page_conflicts += 1;
    collisions.push({
      kind: UNCERTAINTY.SAME_PAGE_DIFFERENT_IDS,
      key: page.url,
      merge: false,
      note: EXPLANATION[UNCERTAINTY.SAME_PAGE_DIFFERENT_IDS],
      records: [...page.keys.values()]
    });
  }

  for (const [identityKey, references] of byMerchant.entries()) {
    if (references.size < 2) continue;
    summary.merchant_conflicts += 1;
    collisions.push({
      kind: UNCERTAINTY.MERCHANT_CONFLICT,
      key: identityKey,
      merge: false,
      note: EXPLANATION[UNCERTAINTY.MERCHANT_CONFLICT],
      records: [...references.values()],
      merchant_refs: [...references.keys()]
    });
  }

  for (const [value, entry] of byCandidate.entries()) {
    if (entry.sources.size < 2) continue;
    summary.cross_source_candidates += 1;
    collisions.push({
      kind: UNCERTAINTY.CROSS_SOURCE_CANDIDATE,
      key: value,
      candidate: entry.kind,
      merge: false,
      note: EXPLANATION[UNCERTAINTY.CROSS_SOURCE_CANDIDATE],
      sources: [...entry.sources.keys()],
      records: [...entry.sources.values()]
    });
  }

  /* A stable order: duplicates first (they are a data problem), then the
     uncertainties by kind, each group in the order it was first seen. */
  const rank = (entry) => (entry.kind === 'duplicate-identity' ? 0 : 1);
  collisions.sort((left, right) => rank(left) - rank(right));

  return { entries: results, summary: summary, collisions: collisions };
}

module.exports = {
  PRIORITY: PRIORITY,
  RULES: RULES,
  STRENGTH: STRENGTH,
  UNCERTAINTY: UNCERTAINTY,
  EXPLANATION: EXPLANATION,
  key: key,
  identify: identify,
  candidates: candidates,
  analyse: analyse
};
