/* ==========================================================================
   PickVanta — merchant compliance profiles (js/compliance.js)
   --------------------------------------------------------------------------
   Phase 1 of the merchant-compliance design: the browser side of the
   compliance transport. A merchant source may record, for each offer it
   feeds, HOW that offer's buyer pathway must behave — whether its link may
   open directly, whether a program disclosure is required, whether price and
   availability may be shown at all — and those rules reach the page through
   one sanitized read-only RPC (merchant_offer_compliance). This module is
   the single place that turns whatever arrived into a complete, safe,
   resolved profile.

   The contract, in one sentence: an offer either carries a compliance
   object the page can honour, or it behaves exactly as PickVanta has always
   behaved (DEFAULT). Nothing here invents merchant behaviour, prices,
   availability or identities; it validates vocabulary, applies defaults,
   and drops everything it does not understand.

   Rules this module enforces:
     • normalize() ALWAYS returns the complete resolved camelCase shape —
       every field present, no unknown key carried through.
     • Vocabulary is closed. A value outside its allowed set never survives;
       the field falls back to DEFAULT instead.
     • Malformed input never throws: null, strings, arrays, partial objects
       and hostile shapes all resolve to a valid profile.
     • String lists (disclaimers, apiDataOnly, prohibited) keep strings only,
       trimmed, with empty entries removed — values are never transformed.
     • Keys are read in BOTH spellings: camelCase (a JS producer's natural
       form) and the database transport's snake_case. The database layer is
       the stricter gate; this one is deliberately the more forgiving twin,
       so a profile that survived the RPC is honoured verbatim here.

   This module is merchant-agnostic by design: no merchant name, marketplace,
   ASIN, affiliate URL or product data appears in it. Which rules apply to
   which offer is data, decided by the configured source — never code.
   ========================================================================== */

window.PV = window.PV || {};

window.PV.compliance = (function () {
  'use strict';

  /* The closed vocabularies. Anything else a source records for these
     fields is unusable by the page and is replaced by the default. */
  const VOCABULARY = {
    pathwayMode: ['tracked-redirect', 'direct-link'],
    priceDisplay: ['source', 'never', 'api-only'],
    availabilityDisplay: ['source', 'never', 'api-only'],
    contentRefresh: ['none', 'api-24h'],
    imageHandling: ['none', 'api-links-refreshed'],
    disclosure: ['none', 'associates'],
    linkHealth: ['none', 'api-backed']
  };

  /* The resolved profile every offer effectively wears. Historical PickVanta
     behaviour IS these values: a tracked redirect, telemetry allowed, the
     source's own price and availability displayable, no program disclosure,
     no API freshness obligations. Frozen: callers get fresh objects from
     normalize(), never a shared mutable default. */
  const DEFAULT = Object.freeze({
    pathwayMode: 'tracked-redirect',
    telemetryBlocking: true,
    priceDisplay: 'source',
    availabilityDisplay: 'source',
    contentRefresh: 'none',
    imageHandling: 'none',
    disclosure: 'none',
    disclaimers: [],
    apiDataOnly: [],
    linkHealth: 'none',
    prohibited: []
  });

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /* Read a field under either spelling — the producer's camelCase or the
     transport's snake_case — preferring whichever is present and usable. */
  function readField(profile, camelKey, snakeKey) {
    if (profile[camelKey] !== undefined) return profile[camelKey];
    if (snakeKey !== undefined && profile[snakeKey] !== undefined) return profile[snakeKey];
    return undefined;
  }

  function oneOf(value, allowed, fallback) {
    return typeof value === 'string' && allowed.indexOf(value) !== -1 ? value : fallback;
  }

  function booleanOf(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  /* Strings only, trimmed, empties dropped — never invented, never rewritten. */
  function stringList(value) {
    if (!Array.isArray(value)) return [];
    const kept = [];
    for (let i = 0; i < value.length; i += 1) {
      const entry = value[i];
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (trimmed !== '') kept.push(trimmed);
    }
    return kept;
  }

  /* The whole module in one function: anything in, the complete resolved
     camelCase shape out. Partial profiles keep their valid fields; every
     missing or malformed field lands on its default; unknown keys vanish. */
  function normalize(profile) {
    const source = isPlainObject(profile) ? profile : {};
    return {
      pathwayMode: oneOf(readField(source, 'pathwayMode', 'pathway_mode'),
        VOCABULARY.pathwayMode, DEFAULT.pathwayMode),
      telemetryBlocking: booleanOf(readField(source, 'telemetryBlocking', 'telemetry_blocking'),
        DEFAULT.telemetryBlocking),
      priceDisplay: oneOf(readField(source, 'priceDisplay', 'price_display'),
        VOCABULARY.priceDisplay, DEFAULT.priceDisplay),
      availabilityDisplay: oneOf(readField(source, 'availabilityDisplay', 'availability_display'),
        VOCABULARY.availabilityDisplay, DEFAULT.availabilityDisplay),
      contentRefresh: oneOf(readField(source, 'contentRefresh', 'content_refresh'),
        VOCABULARY.contentRefresh, DEFAULT.contentRefresh),
      imageHandling: oneOf(readField(source, 'imageHandling', 'image_handling'),
        VOCABULARY.imageHandling, DEFAULT.imageHandling),
      disclosure: oneOf(readField(source, 'disclosure'),
        VOCABULARY.disclosure, DEFAULT.disclosure),
      disclaimers: stringList(readField(source, 'disclaimers')),
      apiDataOnly: stringList(readField(source, 'apiDataOnly', 'api_data_only')),
      linkHealth: oneOf(readField(source, 'linkHealth', 'link_health'),
        VOCABULARY.linkHealth, DEFAULT.linkHealth),
      prohibited: stringList(readField(source, 'prohibited'))
    };
  }

  /* What the page asks for, per offer: the resolved profile governing this
     offer's pathway, or DEFAULT when the offer carries nothing usable.
     A null/undefined/non-object offer is ordinary — the historical case —
     and resolves to DEFAULT rather than throwing. */
  function forOffer(offer) {
    return normalize(isPlainObject(offer) ? offer.compliance : null);
  }

  return {
    DEFAULT: DEFAULT,
    normalize: normalize,
    forOffer: forOffer
  };
})();
