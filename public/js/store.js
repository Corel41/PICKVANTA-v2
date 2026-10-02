/* ==========================================================================
   PickVanta — data access layer (js/store.js)
   --------------------------------------------------------------------------
   The single boundary between the interface and the catalogue. Pages and
   controllers never learn where a record came from; this module decides:

       page → controller → store.js → domain.js (model) → source
       source = js/data.js (demo adapter)  OR  Supabase/PostgreSQL (API adapter)

   ADAPTERS
     demoAdapter      the bundled demonstration catalogue, served locally.
     supabaseAdapter  the live catalogue read through the Supabase REST API
                      (PostgREST) with the public anon key. Read-only: the
                      database's Row Level Security policies expose published
                      rows to anonymous visitors and refuse every write.

   Only this file knows either of those things. Controllers, cards, search,
   filtering, comparison and every page keep calling the same store methods, so
   replacing the backend later is a new adapter, not a rewrite.

   RESPONSE SHAPES (one shape per family — no surprises between operations)
     • browsing              → the Step 6 envelope
       { ok, items, total, page, pageSize, hasNext, hasPrev, error, truncated }
     • single records        → the record, or null when the source says it does
                               not exist (a missing id is not an error)
     • collections           → an array of records
     • scaffolding           → synchronous after init() (taxonomy, price bands,
                               sort options, compare configuration, tag counts)
     • source failure        → the promise rejects with a StoreError whose
                               `message` is safe to show; the technical detail
                               stays in store.diagnostics()

   FAILURE POLICY (a production outage is never hidden)
     config.onFailure = 'error' (default) → surface the error state.
     config.onFailure = 'demo'            → an explicit development/preview
     choice: fall back to the bundled demonstration catalogue, set
     store.fallbackActive() to true and let the pages say so.
     The one exception to "the catalogue is read-only" is the seller/provider
     application surface (Step 11): a signed-in person may create and edit their
     own pending application. That is the only write this layer can make, it
     always carries the user's own token, and the database still decides what is
     allowed — see db/migrations/0003_seller_provider_profiles.sql.
   ========================================================================== */
window.PV = window.PV || {};

window.PV.store = (function () {
  'use strict';

  const Dm = window.PV.domain;
  if (!Dm) throw new Error('PickVanta: js/domain.js must load before js/store.js');

  /* ======================================================================
     Configuration
     ====================================================================== */
  const CONFIG_DEFAULTS = { mode: 'demo', supabase: { url: '', anonKey: '' }, onFailure: 'error', poolLimit: 60 };
  const DEFAULT_PAGE_SIZE = 24;
  /* Safety cap for a single request. Browsing pages ask for a page size; this
     only bounds a request that asks for "everything matching". */
  const MAX_ROWS = 200;

  function readConfig() {
    const raw = window.PV_CONFIG || {};
    const supabase = raw.supabase || {};
    return {
      mode: raw.mode === 'api' ? 'api' : 'demo',
      url: Dm.trim(supabase.url).replace(/\/+$/, ''),
      anonKey: Dm.trim(supabase.anonKey),
      onFailure: raw.onFailure === 'demo' ? 'demo' : 'error',
      poolLimit: Number(raw.poolLimit) > 0 ? Number(raw.poolLimit) : CONFIG_DEFAULTS.poolLimit
    };
  }

  const CONFIG = readConfig();
  let activeAdapter = null;
  let fallbackActive = false;

  /* ======================================================================
     Diagnostics
     ====================================================================== */
  let diagnostics = [];
  const note = (severity, code, message, ref) => {
    diagnostics.push({ severity: severity, code: code, message: message, ref: ref || null });
  };
  const collect = (ref, issues) => {
    Dm.asArray(issues).forEach((i) => note(i.severity, i.code, i.message, i.ref || ref || null));
  };

  function StoreError(message, code, technical) {
    const error = new Error(message);
    error.name = 'StoreError';
    error.code = code || 'catalogue-unavailable';
    error.technical = technical || '';
    return error;
  }
  const FRIENDLY = 'The catalogue could not be loaded just now. Please try again in a moment.';

  /**
   * A refused write comes back as JSON naming the database's own SQLSTATE and
   * the message the function raised. This reads that, and nothing else — it
   * decides nothing, translates nothing, and is asked for by exactly one caller
   * (the reviewed conversion, whose refusals 0010 writes as sentences for the
   * person doing the review). Returns null when the body is not that shape.
   */
  function postgrestRefusal(body) {
    if (typeof body !== 'string' || body.indexOf('{') === -1) return null;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const code = typeof parsed.code === 'string' ? parsed.code.trim() : '';
    const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!code) return null;
    return { code: code, message: message.slice(0, 500) };
  }

  /* ======================================================================
     Reading and normalising records — one place decides what a record means
     ====================================================================== */
  const context = { taxonomy: [], sellerIds: [] };

  function readSeller(raw) {
    if (!raw) return null;
    const seller = Dm.normalizeSeller(raw, { taxonomy: context.taxonomy });
    collect(seller.id, Dm.validateSeller(seller).issues);
    return seller;
  }

  function readListing(raw) {
    const result = Dm.normalizeListing(raw, { taxonomy: context.taxonomy, sellerIds: context.sellerIds });
    collect(raw && raw.id, result.issues);
    return result.listing || null;
  }

  function readListings(rows) {
    const seen = new Set();
    const out = [];
    Dm.asArray(rows).forEach((row) => {
      const listing = readListing(row);
      if (!listing) {
        note('error', 'listing-rejected', 'A listing was refused because it is not usable.', row && row.id ? row.id : null);
        return;
      }
      const validation = Dm.validateListing(listing);
      collect(listing.id, validation.issues);
      if (!validation.valid) {
        note('error', 'listing-rejected', 'Listing "' + listing.id + '" was refused (' + validation.issues
          .filter((i) => i.severity === 'error').map((i) => i.code).join(', ') + ').', listing.id);
        return;
      }
      if (seen.has(listing.id)) {
        note('error', 'listing-duplicate-id', 'Listing id "' + listing.id + '" appeared more than once.', listing.id);
        return;
      }
      seen.add(listing.id);
      out.push(listing);
    });
    return out;
  }

  function readOffer(raw, listingIds) {
    if (!raw) return null;
    const result = Dm.normalizeOffer(raw, { listingIds: listingIds || null, currency: Dm.DEFAULT_CURRENCY, sellerId: '' });
    collect(raw.id, result.issues);
    if (!result.offer) return null;
    const validation = Dm.validateOffer(result.offer, listingIds || null);
    collect(result.offer.id, validation.issues);
    if (!validation.valid) {
      note('error', 'offer-rejected', 'Offer "' + result.offer.id + '" was refused.', result.offer.id);
      return null;
    }
    return result.offer;
  }

  function readGuide(raw) {
    if (!raw) return null;
    const result = Dm.normalizeGuide(raw, { listingIds: null });
    collect(raw.id, result.issues);
    if (!result.guide) return null;
    collect(result.guide.id, Dm.validateGuide(result.guide).issues);
    return result.guide;
  }

  /* ======================================================================
     Memo — records this session has already served
     ----------------------------------------------------------------------
     The compare tray and the recently-viewed strip resolve ids the visitor
     picked earlier. They read the memo synchronously; anything unknown is
     fetched with store.hydrate(ids).
     ====================================================================== */
  const memo = new Map();
  const remember = (record) => {
    if (record && record.id) memo.set(record.id, record);
    return record;
  };
  const memoItem = (id) => (Dm.trim(id) && memo.has(Dm.trim(id)) ? memo.get(Dm.trim(id)) : null);

  /** Normalise the provider and the offer that a source attached to a listing. */
  function finishListing(listing) {
    if (!listing) return null;
    if (listing.seller) listing.seller = readSeller(listing.seller) || null;
    if (listing.offer) listing.offer = readOffer(listing.offer, [listing.id]) || null;
    if (listing.offer) listing.offerId = listing.offer.id;
    return remember(listing);
  }

  /* ======================================================================
     DEMO ADAPTER — the bundled catalogue, served without a network
     ====================================================================== */
  const demoAdapter = (function () {
    let data = null;
    let booted = null;
    let listings = [];
    let sellers = [];
    let guides = [];
    let tagList = [];

    function loadScript() {
      return new Promise((resolve, reject) => {
        if (typeof document === 'undefined' || !document.createElement) {
          reject(StoreError(FRIENDLY, 'demo-unavailable', 'No document available to load js/data.js.'));
          return;
        }
        const el = document.createElement('script');
        el.src = 'js/data.js';
        el.onload = () => resolve(window.PICKVANTA_DATA || null);
        el.onerror = () => reject(StoreError(FRIENDLY, 'demo-unavailable', 'js/data.js could not be loaded.'));
        document.head.appendChild(el);
      });
    }

    function load() {
      if (booted) return booted;
      booted = (window.PICKVANTA_DATA ? Promise.resolve(window.PICKVANTA_DATA) : loadScript())
        .then((loaded) => {
          if (!loaded) throw StoreError(FRIENDLY, 'demo-unavailable', 'js/data.js did not define window.PICKVANTA_DATA.');
          data = loaded;
          return build();
        });
      return booted;
    }

    function build() {
      const taxonomy = Dm.asArray(data.taxonomy).map(Dm.normalizeCategory).filter((c) => !!c.slug);
      context.taxonomy = taxonomy;

      sellers = Dm.asArray(data.sellers).map(readSeller).filter((s) => !!s && s.status === 'published');
      context.sellerIds = sellers.map((s) => s.id);
      const sellersById = new Map(sellers.map((s) => [s.id, s]));

      listings = readListings(data.listings).filter((l) => l.status === 'published');
      const listingIds = listings.map((l) => l.id);

      const offers = Dm.asArray(data.offers).map((o) => readOffer(o, listingIds)).filter(Boolean);
      const offersByListing = new Map();
      offers.forEach((offer) => {
        const listing = listings.find((l) => l.id === offer.listingId);
        if (listing) offer.sellerId = offer.sellerId || listing.sellerId;
        if (!offersByListing.has(offer.listingId) || offer.status === 'active') offersByListing.set(offer.listingId, offer);
      });
      listings.forEach((listing) => {
        listing.seller = listing.sellerId ? (sellersById.get(listing.sellerId) || null) : null;
        const offer = offersByListing.get(listing.id) || null;
        listing.offer = offer;
        listing.offerId = offer ? offer.id : null;
        remember(listing);
      });

      guides = Dm.asArray(data.guides).map(readGuide).filter(Boolean);
      tagList = tagCounts(listings);

      const hidden = Dm.asArray(data.listings).length - listings.length;
      if (hidden) note('info', 'listings-hidden', hidden + ' listing(s) are not published and stay out of every view.');

      const subcategoryIds = [...new Set(listings.map((l) => l.subcategory).filter(Boolean))];
      const locationCities = [...new Set(listings.map((l) => l.location.city).filter(Boolean))];

      const countBy = (key) => listings.reduce((acc, l) => {
        const value = l[key];
        if (value) acc[value] = (acc[value] || 0) + 1;
        return acc;
      }, {});

      return {
        taxonomy: taxonomy,
        locations: Dm.asArray(data.locations),
        settings: data,
        tags: tagList,
        facets: {
          categories: countBy('category'),
          subcategories: countBy('subcategory'),
          types: countBy('type'),
          availability: countBy('availability')
        },
        stats: {
          listings: listings.length,
          products: listings.filter((l) => l.type === 'product').length,
          services: listings.filter((l) => l.type === 'service').length,
          categories: taxonomy.length,
          subcategories: subcategoryIds.length,
          subcategoryIds: subcategoryIds,
          locationCities: locationCities,
          tags: tagList.length,
          sellers: new Set(listings.map((l) => l.sellerId).filter(Boolean)).size,
          locations: Dm.asArray(data.locations).filter((l) => l.format === 'local' && l.city).length,
          guides: guides.length,
          offers: listings.filter((l) => l.offer).length,
          hidden: hidden
        }
      };
    }

    /* There is no account service behind the demonstration catalogue, so these
       refuse instead of pretending. A page shows the honest reason. */
    const noAccounts = () => Promise.reject(StoreError(
      'Applications need the live catalogue connection. This build is running on the bundled demonstration catalogue.',
      'api-not-configured'));
    /* The admin panel is worse than useless without the database: there is
       nothing real to review, and an invented list would be a lie. */
    const noAdmin = () => Promise.reject(StoreError(
      'The admin panel needs the live database connection. This build is running on the bundled demonstration catalogue.',
      'api-not-configured'));

    return {
      kind: 'demo',
      isAsync: false,
      init: load,
      sellerAccountsMine: noAccounts,
      sellerAccountCreate: noAccounts,
      sellerAccountUpdate: noAccounts,
      adminCounts: noAdmin,
      adminAccounts: noAdmin,
      adminAccount: noAdmin,
      adminReview: noAdmin,
      /* The same refusal as the rest of the panel: the Deal Engine reads real
         records, and there is no demonstration version of them. There is no
         demonstration source to configure either. The canonical layer is the
         same — there is no demonstration product, variant or merchant offer,
         and inventing one would put a fabricated product in front of an
         operator. */
      dealEngineSources: noAdmin,
      dealEngineJobs: noAdmin,
      dealEngineImportedDeals: noAdmin,
      dealEngineReviewQueue: noAdmin,
      dealEngineImportedDeal: noAdmin,
      dealEngineImportedDealEvents: noAdmin,
      importedDealConvert: noAdmin,
      /* The taxonomy is public catalogue data, and the demonstration bundle has
         its own — the same list PV.store.categories() already serves. */
      referenceCategoryOptions: () => Promise.resolve(SCAFFOLD.taxonomy.map((c) => ({
        id: c.id,
        slug: c.slug,
        label: c.label,
        subcategories: Dm.asArray(c.subcategories)
          .map((sub) => ({ id: sub.id, slug: sub.slug, label: sub.label, categoryId: sub.category }))
      }))),
      dealSourceSave: noAdmin,
      canonicalProducts: noAdmin,
      canonicalVariants: noAdmin,
      canonicalOffers: noAdmin,
      dealEngineMerchants: noAdmin,
      list: (state, opts) => Promise.resolve(helpers.page(state, () => (
        opts && opts.dataset === 'deals' ? listings.filter((l) => !!l.offer) : listings
      ))),
      get: (id) => Promise.resolve(listings.find((l) => l.id === id || l.slug === id) || null),
      getMany: (ids) => Promise.resolve(Dm.asArray(ids)
        .map((id) => listings.find((l) => l.id === id || l.slug === id) || null)
        .filter(Boolean)),
      deals: () => Promise.resolve(listings.filter((l) => !!l.offer)),
      guides: () => Promise.resolve(guides.filter((g) => g.status === 'published')),
      sellers: () => Promise.resolve(sellers),
      related: (listing, limit) => Promise.resolve(relatedFor(listing, limit, listings)),
      suggest: (query, limit) => Promise.resolve(helpers.suggest(query, limit, {
        listings: listings, sellers: sellers, guides: guides
      })),
      home: (settings) => {
        const byId = (list, ids) => {
          const map = new Map(list.map((r) => [r.id, r]));
          return Dm.asArray(ids).map((id) => map.get(id)).filter(Boolean);
        };
        return Promise.resolve({
          featured: byId(listings, settings.homeFeaturedIds),
          deals: byId(listings.filter((l) => !!l.offer), settings.homeDealIds),
          guides: byId(guides, settings.homeGuideIds)
        });
      }
    };
  })();

  /* ======================================================================
     SUPABASE ADAPTER — the live catalogue over the Supabase REST API
     ====================================================================== */
  const supabaseAdapter = (function () {
    const LISTING_FIELDS = [
      'id', 'seller_id', 'category_id', 'subcategory_id', 'type', 'name', 'slug',
      'short_description', 'description', 'brand',
      'price_amount', 'price_min', 'price_max', 'currency', 'price_type', 'reference_price',
      'location_country', 'location_county', 'location_city', 'location_area', 'location_format', 'service_area',
      'availability', 'highlights', 'tags', 'specifications', 'images', 'status', 'created_at', 'updated_at',
      'sellers(id,name,slug,type,description,country,county,city,area,website,contact_email,contact_phone,verification_status,status)',
      'deals(id,listing_id,seller_id,title,description,deal_type,original_price,deal_price,discount_percent,currency,starts_at,ends_at,availability,status,conditions)'
    ].join(',');

    const SMALL_LISTING_FIELDS = [
      'id', 'type', 'name', 'slug', 'brand', 'category_id', 'subcategory_id',
      'price_amount', 'price_min', 'price_max', 'currency', 'price_type',
      'location_city', 'location_county', 'location_format', 'availability', 'images'
    ].join(',');

    /* Seller/provider accounts. Deliberately explicit: the private contact
       details are never pulled into a page that only needs a name. */
    const SELLER_ACCOUNT_FIELDS = [
      'id', 'owner_id', 'account_type', 'business_name', 'description',
      'contact_email', 'contact_phone', 'website',
      'country', 'county', 'city', 'area',
      'status', 'review_note', 'reviewed_at', 'seller_id', 'created_at', 'updated_at'
    ].join(',');

    /* How many applications the admin review queue asks for at a time. Small
       enough that a queue page is one modest request; the queue reports when
       there are more rather than pretending it has them all. */
    const ADMIN_QUEUE_PAGE = 50;

    /* Deal Engine sources. Explicit column lists: what the panel does not ask
       for, it cannot leak. `config` is included because an administrator has to
       be able to see and correct the non-secret configuration of a source —
       which is exactly why 0005 refuses a credential-shaped key and why 0006's
       validator refuses credential-shaped values. `notes` is still not
       requested: nothing in the panel reads or writes it. */
    const DEAL_SOURCE_FIELDS = [
      'id', 'name', 'source_type', 'provider_name', 'market_country', 'endpoint_url',
      'status', 'config', 'created_at', 'updated_at'
    ].join(',');
    const DEAL_SOURCE_PAGE = 50;

    /* One run of one task. Nothing in this build creates a row in this table;
       the view exists so that an operator can see what a future worker
       recorded, in the database's own words and numbers. */
    const DEAL_JOB_FIELDS = [
      'id', 'source_id', 'job_type', 'status', 'progress', 'detail', 'error', 'stats',
      'started_at', 'finished_at', 'created_at', 'updated_at'
    ].join(',');
    const DEAL_JOB_PAGE = 50;

    /* The prepared boundary for imported records (Step 14 §11). The Review
       Queue and the Import History are planned, so nothing renders a record
       yet — but the shape is fixed here so that the provenance a reviewer will
       need cannot quietly go missing: what the source said, the two URLs kept
       apart, the four statuses, and the times. */
    const IMPORTED_DEAL_FIELDS = [
      'id', 'source_id', 'job_id', 'external_merchant_id', 'external_product_id',
      'merchant_name', 'merchant_ref', 'source_url', 'affiliate_url',
      'imported_title', 'imported_description', 'imported_price', 'imported_currency',
      'imported_availability', 'imported_category', 'imported_metadata',
      'normalized_name', 'normalized_brand', 'normalized_category_id',
      'normalized_availability', 'model_number', 'gtin',
      'pipeline_status', 'validation_status', 'normalization_status',
      'deduplication_status', 'dedup_match_class', 'dedup_matched_deal_id',
      'review_status', 'review_note', 'reviewed_at', 'reviewed_by', 'error',
      'published_deal_id', 'imported_at', 'created_at', 'updated_at'
    ].join(',');
    const IMPORTED_DEAL_PAGE = 50;

    /* Only the columns the review queue's history panel renders. An event is a
       fact about the past: this reads it, and no part of this file writes one. */
    const EVENT_FIELDS = [
      'id', 'imported_deal_id', 'stage', 'outcome', 'detail', 'data', 'actor_id', 'created_at'
    ].join(',');

    /* The canonical layer (Step 15). Three projections, each with only the
       columns something reads:

         • products — the canonical identity. No seller, no price, no location:
           a product has never had any of them, and asking for a column that
           does not exist would fail the request rather than invent one;
         • product_variants — one configuration of a product, for the products
           that are sold in more than one;
         • merchant_offers — a merchant's offer through a source. Both URLs are
           requested and they are never interchanged, `title` is the merchant's
           own text (normalized to `merchantTitle`, so a call site cannot
           mistake it for a canonical name), and `currency` is requested so it
           can be shown exactly as recorded — including empty. */
    const PRODUCT_FIELDS = [
      'id', 'slug', 'name', 'brand', 'brand_normalized', 'description',
      'category_id', 'subcategory_id', 'model_number', 'mpn', 'gtin', 'identity_key',
      'status', 'created_at', 'updated_at'
    ].join(',');
    const PRODUCT_PAGE = 50;

    const VARIANT_FIELDS = [
      'id', 'product_id', 'slug', 'name', 'option_key', 'option_values', 'sku', 'gtin',
      'status', 'created_at', 'updated_at'
    ].join(',');
    const VARIANT_PAGE = 50;

    const MERCHANT_OFFER_FIELDS = [
      'id', 'product_id', 'variant_id', 'merchant_id', 'source_id',
      'title', 'merchant_product_ref', 'merchant_offer_ref',
      'price_amount', 'original_price', 'currency', 'price_observed_at',
      'status', 'source_url', 'affiliate_url',
      'imported_at', 'last_observed_at', 'created_at', 'updated_at'
    ].join(',');
    const MERCHANT_OFFER_PAGE = 50;

    /* An external merchant, as a source described it. `merchant_ref` is kept
       verbatim — it is the source's identifier, not ours — and `source_id` is
       the source that first introduced the merchant. */
    const MERCHANT_FIELDS = [
      'id', 'name', 'merchant_ref', 'website_url', 'country', 'source_id',
      'created_at', 'updated_at'
    ].join(',');
    const MERCHANT_PAGE = 50;

    const GUIDE_FIELDS = [
      'id', 'title', 'slug', 'category_id', 'question', 'summary', 'content', 'tags',
      'icon', 'level', 'read_time', 'cta', 'status', 'created_at', 'updated_at',
      'guide_listings(listing_id,position)'
    ].join(',');

    const configured = () => !!(CONFIG.url && CONFIG.anonKey);

    /* A read-only RPC answers with a single JSON value: an object for the stats
       and facet summaries, a list for the tag counts. */
    function asObject(result) {
      const body = result && result.body;
      if (body && !Array.isArray(body) && typeof body === 'object') return body;
      return Dm.asArray(result && result.rows)[0] || {};
    }

    function request(path, params, options) {
      const o = options || {};
      if (!configured()) {
        return Promise.reject(StoreError(FRIENDLY, 'api-not-configured',
          'mode is "api" but js/config.js has no Supabase url/anonKey.'));
      }
      if (typeof fetch !== 'function') {
        return Promise.reject(StoreError(FRIENDLY, 'api-unsupported', 'This browser does not provide fetch().'));
      }
      const query = params && params.length ? '?' + params.join('&') : '';
      const headers = {
        apikey: CONFIG.anonKey,
        Authorization: 'Bearer ' + CONFIG.anonKey,
        Accept: 'application/json'
      };
      if (o.count) headers.Prefer = 'count=exact';

      return fetch(CONFIG.url + '/rest/v1/' + path + query, {
        method: 'GET',
        headers: headers,
        cache: 'no-store'
      }).then((response) => {
        if (!response.ok) {
          return response.text().then((body) => {
            throw StoreError(FRIENDLY, 'api-' + response.status,
              path + ' → HTTP ' + response.status + ' ' + String(body || '').slice(0, 300));
          }, () => {
            throw StoreError(FRIENDLY, 'api-' + response.status, path + ' → HTTP ' + response.status);
          });
        }
        const range = response.headers && response.headers.get ? response.headers.get('content-range') : null;
        let total = null;
        if (range && String(range).indexOf('/') !== -1) {
          const parsed = parseInt(String(range).split('/')[1], 10);
          if (Number.isFinite(parsed)) total = parsed;
        }
        /* `rows` is always an array (PostgREST returns a list for tables);
           `body` keeps the parsed payload as it arrived so an RPC that returns
           a single JSON object is not flattened into an empty list. */
        return response.json().then((body) => ({ rows: Dm.asArray(body), body: body, total: total }));
      }, (err) => {
        throw StoreError(FRIENDLY, 'api-unreachable', path + ' → ' + (err && err.message ? err.message : 'network error'));
      });
    }

    /**
     * The only writing path in this layer, and it is deliberately small.
     *
     * It requires the caller's own session (token + user id) — there is no
     * version of this that works with the public anon key alone, so a page
     * cannot reach it by forgetting to sign in. The user's token is what
     * PostgREST hands to Row Level Security, which is what actually decides
     * whether the write is allowed: this function only refuses to send a
     * request it knows cannot be authorised.
     */
    function write(path, params, session, options) {
      const o = options || {};
      if (!configured()) {
        return Promise.reject(StoreError(FRIENDLY, 'api-not-configured',
          'mode is "api" but js/config.js has no Supabase url/anonKey.'));
      }
      if (!session || !session.token || !session.userId) {
        return Promise.reject(StoreError('Sign in to continue.', 'not-signed-in',
          'A seller/provider request was made without a session.'));
      }
      if (typeof fetch !== 'function') {
        return Promise.reject(StoreError(FRIENDLY, 'api-unsupported', 'This browser does not provide fetch().'));
      }
      const query = params && params.length ? '?' + params.join('&') : '';
      const headers = {
        apikey: CONFIG.anonKey,
        Authorization: 'Bearer ' + session.token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      };
      if (o.prefer) headers.Prefer = o.prefer;

      return fetch(CONFIG.url + '/rest/v1/' + path + query, {
        method: o.method || 'POST',
        headers: headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
        cache: 'no-store'
      }).then((response) => {
        if (!response.ok) {
          return response.text().then((body) => {
            /* The database's own refusal is the real reason; the interface
               turns this into a sentence. Nothing raw is shown to a person. */
            const error = StoreError(FRIENDLY, 'api-' + response.status,
              path + ' → HTTP ' + response.status + ' ' + String(body || '').slice(0, 300));
            /* One caller opts in to the database's own SQLSTATE and message as
               well as the HTTP status. Everything else behaves exactly as it
               did: without the flag, no field is added and no wording changes. */
            if (o.refusal) {
              const refusal = postgrestRefusal(body);
              if (refusal) { error.dbCode = refusal.code; error.dbMessage = refusal.message; }
            }
            throw error;
          }, () => {
            throw StoreError(FRIENDLY, 'api-' + response.status, path + ' → HTTP ' + response.status);
          });
        }
        /* A write can ask the database to count the rows it matched
           (`Prefer: count=exact`): the Deal Engine reads a total this way, and
           a total that came back is the only kind this layer reports. */
        const range = response.headers && response.headers.get ? response.headers.get('content-range') : null;
        let total = null;
        if (range && String(range).indexOf('/') !== -1) {
          const parsed = parseInt(String(range).split('/')[1], 10);
          if (Number.isFinite(parsed)) total = parsed;
        }
        return response.json().then((body) => ({ rows: Dm.asArray(body), body: body, total: total }));
      }, (err) => {
        throw StoreError(FRIENDLY, 'api-unreachable', path + ' → ' + (err && err.message ? err.message : 'network error'));
      });
    }

    /* ------------------------------------------- seller/provider accounts --
       The user's own application rows, and nothing else. RLS is the authority:
       the own-row policy limits every one of these to the signed-in person. */
    function sellerAccountsMine(session) {
      return write('seller_provider_profiles',
        ['select=' + SELLER_ACCOUNT_FIELDS,
         'owner_id=eq.' + encodeURIComponent(session.userId),
         'order=created_at.desc'],
        session, { method: 'GET' }
      ).then((result) => result.rows.map((row) => Dm.normalizeSellerAccount(row)));
    }

    function sellerAccountCreate(session, input) {
      return write('seller_provider_profiles',
        ['select=' + SELLER_ACCOUNT_FIELDS],
        session,
        {
          method: 'POST',
          prefer: 'return=representation',
          /* Only the fields an applicant may set. Ownership, status, the review
             columns and the catalogue link are not sent — the database would
             refuse them anyway (see the guard trigger in 0003), and sending
             them would suggest they were ours to choose. */
          body: [{
            owner_id: session.userId,
            account_type: input.accountType,
            business_name: input.businessName,
            description: input.description || '',
            contact_email: input.contactEmail || '',
            contact_phone: input.contactPhone || '',
            website: input.website || '',
            country: input.location && input.location.country ? input.location.country : Dm.DEFAULT_COUNTRY,
            county: (input.location && input.location.county) || '',
            city: (input.location && input.location.city) || '',
            area: (input.location && input.location.area) || ''
          }]
        }
      ).then((result) => (result.rows.length ? Dm.normalizeSellerAccount(result.rows[0]) : null));
    }

    function sellerAccountUpdate(session, id, input) {
      return write('seller_provider_profiles',
        /* Both filters are sent on purpose: even if a policy were ever written
           carelessly, the request itself can only ever name the caller's own
           row. */
        ['id=eq.' + encodeURIComponent(id),
         'owner_id=eq.' + encodeURIComponent(session.userId),
         'select=' + SELLER_ACCOUNT_FIELDS],
        session,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: {
            business_name: input.businessName,
            description: input.description || '',
            contact_email: input.contactEmail || '',
            contact_phone: input.contactPhone || '',
            website: input.website || '',
            country: input.location && input.location.country ? input.location.country : Dm.DEFAULT_COUNTRY,
            county: (input.location && input.location.county) || '',
            city: (input.location && input.location.city) || '',
            area: (input.location && input.location.area) || ''
          }
        }
      ).then((result) => (result.rows.length ? Dm.normalizeSellerAccount(result.rows[0]) : null));
    }

    /* ------------------------------------------------------- admin (Step 12)
       Administrative access, and the only part of this file that reads rows
       the caller does not own.

       Every request here is answered by the database according to the caller's
       own token: the `seller_profiles_select_admin` policy decides which rows
       an administrator may read, `public.is_admin()` gates the review function,
       and a non-administrator gets an empty list or a refusal. Nothing in this
       file — and nothing in the interface — decides who is an administrator.
       There is no method here that works with the anon key alone.
       ---------------------------------------------------------------------- */
    function adminCounts(session) {
      return write('rpc/admin_dashboard_counts', [], session, { method: 'POST', body: {} })
        .then((result) => Dm.normalizeAdminCounts(result.body));
    }

    function adminAccounts(session, options) {
      const o = options || {};
      const params = ['select=' + SELLER_ACCOUNT_FIELDS, 'order=created_at.desc'];
      /* The filter is a closed vocabulary, so a hand-edited URL cannot ask the
         database for something it does not have. It grants nothing either way:
         RLS still decides which rows come back. */
      if (o.status && Dm.isSellerAccountStatus(o.status)) {
        params.push('status=eq.' + encodeURIComponent(o.status));
      }
      params.push('limit=' + (o.limit > 0 ? Math.min(Number(o.limit), 200) : ADMIN_QUEUE_PAGE));
      params.push('offset=' + (o.offset > 0 ? Number(o.offset) : 0));
      return write('seller_provider_profiles', params, session, { method: 'GET' })
        .then((result) => ({ accounts: result.rows.map((row) => Dm.normalizeSellerAccount(row)) }));
    }

    function adminAccount(session, id) {
      return write('seller_provider_profiles',
        ['select=' + SELLER_ACCOUNT_FIELDS, 'id=eq.' + encodeURIComponent(id), 'limit=1'],
        session, { method: 'GET' }
      ).then((result) => (result.rows.length ? Dm.normalizeSellerAccount(result.rows[0]) : null));
    }

    /**
     * The review action itself. It calls the function 0003 already defines —
     * `public.seller_profile_set_status(target_id, new_status, note)` — which
     * checks is_admin() for itself, validates the status against the closed
     * vocabulary, records the reviewer and the time, and returns the row it
     * wrote. This layer never writes the status column directly, and never
     * assumes the write happened: the returned record is the database's answer.
     */
    function adminReview(session, id, status, note) {
      return write('rpc/seller_profile_set_status', [], session, {
        method: 'POST',
        body: { target_id: id, new_status: status, note: note || '' }
      }).then((result) => {
        const row = Array.isArray(result.body) ? result.body[0] : result.body;
        return row && row.id ? Dm.normalizeSellerAccount(row) : null;
      });
    }

    /* ------------------------------------------- Deal Engine (Step 13) ----
       The private side of PickVanta: which sources exist, and (in the steps
       that follow) what has been imported from them.

       Four deliberate choices, all of them about keeping imported data away
       from the public catalogue:
         • this is a separate boundary from the catalogue methods above, and
           the only one in this file that reads records no member of the
           public owns. The database decides who may read it: the policies in
           0005 are SELECT-only and gated on public.is_admin();
         • the only write here is a call to a database function that checks
           is_admin() for itself (public.deal_source_save in 0006). No table is
           written directly — not even a source, and not by an administrator;
         • `notes` is not requested, and neither is anything else the panel has
           no use for. `config` is requested, because an administrator has to
           be able to see and correct the non-secret configuration of a source;
         • the imported-record boundary is prepared and unused by any view:
           the Review Queue is a later step, and this layer would rather return
           a shape nobody renders yet than let a reviewer's field go missing.
       ---------------------------------------------------------------------- */
    function dealEngineSources(session) {
      return write('deal_sources',
        ['select=' + DEAL_SOURCE_FIELDS, 'order=name.asc', 'limit=' + DEAL_SOURCE_PAGE],
        session, { method: 'GET' }
      ).then((result) => ({ sources: result.rows.map(Dm.normalizeDealSource) }));
    }

    function dealEngineJobs(session) {
      return write('deal_engine_jobs',
        ['select=' + DEAL_JOB_FIELDS, 'order=created_at.desc', 'limit=' + DEAL_JOB_PAGE],
        session, { method: 'GET' }
      ).then((result) => ({ jobs: result.rows.map(Dm.normalizeDealJob) }));
    }

    /**
     * Who has supplied records through a source.
     *
     * An external merchant is not a PickVanta seller and never becomes one —
     * 0005 keeps them in their own table for exactly that reason — so this is a
     * read of imported provenance, not of anybody's account. It is here, next
     * to the sources, because the two belong together: `source_id` on an
     * external merchant is the source that first introduced it, and a later
     * merchant offer joins the two. Nothing writes it, and nothing in the panel
     * edits it: a merchant's identity comes from the source, not from PickVanta.
     */
    function dealEngineMerchants(session) {
      return write('external_merchants',
        ['select=' + MERCHANT_FIELDS, 'order=name.asc', 'limit=' + MERCHANT_PAGE],
        session, { method: 'GET' }
      ).then((result) => ({ merchants: result.rows.map(Dm.normalizeExternalMerchant) }));
    }

    /**
     * Imported records, read but not yet rendered.
     *
     * `total` is the database's own count (PostgREST's `Content-Range`), not a
     * length: a page that showed the length of a limited list as a total would
     * be reporting a number it invented. A read that comes back without a
     * count reports null, and the panel then says the count is not available
     * rather than showing zero.
     */
    function dealEngineImportedDeals(session, options) {
      const o = options || {};
      const wanted = Dm.num(o.limit);
      const limit = Math.max(0, Math.min(wanted === null ? 1 : wanted, IMPORTED_DEAL_PAGE));
      return write('imported_deals',
        ['select=' + IMPORTED_DEAL_FIELDS, 'order=created_at.desc', 'limit=' + limit],
        session, { method: 'GET', prefer: 'count=exact' }
      ).then((result) => ({
        records: result.rows.map(Dm.normalizeImportedDeal),
        total: typeof result.total === 'number' ? result.total : null
      }));
    }

    /* --------------------------------- the reviewed conversion (17A) -----
       The administrator's decision, and nothing else. One database function
       performs the whole conversion: public.imported_deal_convert() checks
       is_admin() for itself, validates everything against the canonical
       tables, writes the records and returns what the database now holds. This
       layer carries the decision there and the answer back. It never decides
       that a slug is free, that a GTIN may be placed where it was put, that a
       product is the right one, or that a record is convertible.

       The payload is built mode by mode, from the keys the chosen mode allows
       and no others: 0010 refuses a field sent in the wrong mode, so a value
       left over from another mode would fail the whole conversion. Nothing is
       copied from the imported record — the reviewer's own values are what is
       sent, and the imported evidence stays evidence.
     */

    /**
     * Imported records waiting for an administrator: the only state 0010 will
     * convert. Both conditions are applied by the database, in the query, and
     * are never filtered again here.
     */
    function dealEngineReviewQueue(session, options) {
      const o = options || {};
      const wanted = Dm.num(o.limit);
      const page = Math.max(1, Math.min(wanted === null ? IMPORTED_DEAL_PAGE : wanted, IMPORTED_DEAL_PAGE));
      /* One row more than the page is asked for, and only the page is kept. The
         extra row is the database saying "there is more"; it is never shown,
         never counted and never mistaken for a record the page may act on. */
      return write('imported_deals',
        ['select=' + IMPORTED_DEAL_FIELDS,
         'pipeline_status=eq.pending-review',
         'review_status=eq.pending',
         'order=created_at.desc',
         'limit=' + (page + 1)],
        session, { method: 'GET', prefer: 'count=exact' }
      ).then((result) => {
        const rows = Dm.asArray(result.rows);
        const records = rows.slice(0, page).map((row) => Dm.normalizeImportedDeal(row));
        const total = typeof result.total === 'number' ? result.total : null;
        return {
          records: records,
          /* The database's own exact count, or null when it did not give one:
             a count this layer did not receive is never invented. */
          total: total,
          /* True only because the database sent more rows than the page holds. */
          more: rows.length > page
        };
      });
    }

    /** One imported record by its id, for a view linked directly to it. */
    function dealEngineImportedDeal(session, id) {
      return write('imported_deals',
        ['select=' + IMPORTED_DEAL_FIELDS, 'id=eq.' + encodeURIComponent(id), 'limit=1'],
        session, { method: 'GET' }
      ).then((result) => (result.rows.length ? Dm.normalizeImportedDeal(result.rows[0]) : null));
    }

    /** One record's history, oldest first. Read-only in every direction. */
    function dealEngineImportedDealEvents(session, id) {
      return write('deal_engine_events',
        ['select=' + EVENT_FIELDS, 'imported_deal_id=eq.' + encodeURIComponent(id), 'order=created_at.asc'],
        session, { method: 'GET' }
      ).then((result) => result.rows.map(Dm.normalizeDealEngineEvent));
    }

    /* ---- the conversion payload: exactly what the chosen mode allows ---- */

    function conversionText(value) {
      return Dm.trim(value);
    }

    function conversionProductPayload(input) {
      const i = input || {};
      if (i.productMode === 'existing') {
        /* The administrator's explicit choice of an existing row. Sent on its
           own: 0010 refuses any other product field in this mode. */
        return { mode: 'existing', product_id: conversionText(i.productId) };
      }
      const product = { mode: 'create', name: conversionText(i.name), slug: conversionText(i.slug) };
      if (conversionText(i.brand)) product.brand = conversionText(i.brand);
      if (conversionText(i.modelNumber)) product.model_number = conversionText(i.modelNumber);
      if (conversionText(i.mpn)) product.mpn = conversionText(i.mpn);
      /* A GTIN belongs to the product only while the offer is product-level:
         0010 refuses a product GTIN on a conversion that names a variant. */
      if (i.variantMode === 'none' && conversionText(i.gtin)) product.gtin = conversionText(i.gtin);
      if (conversionText(i.categoryId)) product.category_id = conversionText(i.categoryId);
      if (conversionText(i.subcategoryId)) product.subcategory_id = conversionText(i.subcategoryId);
      return product;
    }

    function conversionVariantPayload(input) {
      const i = input || {};
      if (i.variantMode === 'none') return { mode: 'none' };
      if (i.variantMode === 'existing') {
        return { mode: 'existing', variant_id: conversionText(i.variantId) };
      }
      const variant = {
        mode: 'create',
        name: conversionText(i.variantName),
        slug: conversionText(i.variantSlug)
      };
      if (conversionText(i.variantSku)) variant.sku = conversionText(i.variantSku);
      if (conversionText(i.variantGtin)) variant.gtin = conversionText(i.variantGtin);
      const options = i.optionValues;
      if (options && typeof options === 'object' && !Array.isArray(options) && Object.keys(options).length) {
        variant.option_values = options;
      }
      return variant;
    }

    function conversionPayload(id, input) {
      const i = input || {};
      return {
        p_imported_deal_id: id,
        p_product: conversionProductPayload(i),
        p_variant: conversionVariantPayload(i),
        p_review_note: typeof i.reviewNote === 'string' ? i.reviewNote : '',
        p_normalization_note: typeof i.normalizationNote === 'string' ? i.normalizationNote : ''
      };
    }

    /**
     * What counts as a conversion: 0010's whole answer, or nothing.
     *
     * An HTTP 200 is not a conversion. If the body is not the shape 0010
     * documents (section 2j) — a conversion id, the product it created or
     * chose, the variant when there is one, the merchant offer, and the state
     * the record is now in — then this layer cannot say what happened, and it
     * returns null rather than reporting a success it cannot describe. The
     * caller treats null as "nothing is confirmed", never as success.
     */
    function readConversionResult(body) {
      const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
      if (!b) return null;
      const product = b.product && typeof b.product === 'object' ? b.product : null;
      const offer = b.merchant_offer && typeof b.merchant_offer === 'object' ? b.merchant_offer : null;
      const variant = b.variant && typeof b.variant === 'object' ? b.variant : null;
      const conversionId = Dm.trim(b.conversion_id);
      /* No variant is answered as `variant: null` (0010, section 2j), not as an
         object saying "none": the database states the absence rather than
         naming a mode, so that is what is reported back. */
      const variantMode = variant ? Dm.trim(variant.mode) : 'none';
      const variantId = variant ? Dm.trim(variant.id) : '';
      if (!conversionId) return null;
      if (!product || !Dm.trim(product.id) || !Dm.trim(product.mode)) return null;
      if (!offer || !Dm.trim(offer.id)) return null;
      if (!Dm.trim(b.pipeline_status) || !Dm.trim(b.review_status)) return null;
      /* A variant that is present has to say which mode it is, and a mode
         other than "none" has to name the variant it used. */
      if (variant && !variantMode) return null;
      if (variantMode !== 'none' && !variantId) return null;
      return {
        conversionId: conversionId,
        importedDealId: Dm.trim(b.imported_deal_id),
        productId: Dm.trim(product.id),
        productMode: Dm.trim(product.mode),
        productSlug: Dm.trim(product.slug),
        productName: Dm.trim(product.name),
        productStatus: Dm.trim(product.status),
        variantId: variantId,
        variantMode: variantMode,
        offerId: Dm.trim(offer.id),
        offerStatus: Dm.trim(offer.status),
        offerTitle: Dm.trim(offer.title),
        pipelineStatus: Dm.trim(b.pipeline_status),
        reviewStatus: Dm.trim(b.review_status),
        convertedAt: Dm.trim(b.converted_at)
      };
    }

    /**
     * The conversion itself. One call, one function, no table write.
     *
     * A refusal from 0010 is carried back with the database's own SQLSTATE and
     * message, because those messages were written for the person doing the
     * review; everything else — no live project, no session, an unreachable
     * database — passes through untouched, exactly as it does for every other
     * write in this file.
     */
    function importedDealConvert(session, id, input) {
      return write('rpc/imported_deal_convert', [], session, {
        method: 'POST',
        refusal: true,
        body: conversionPayload(id, input)
      }).then((result) => readConversionResult(result.body), (err) => {
        if (err && err.dbCode) {
          const mapped = StoreError(err.dbMessage || 'The database refused this conversion.',
            'conversion-refused', err.technical || '');
          mapped.dbCode = err.dbCode;
          mapped.dbMessage = err.dbMessage || '';
          throw mapped;
        }
        throw err;
      });
    }

    /**
     * The taxonomy an administrator picks from.
     *
     * Public catalogue data, read with the public key exactly as the catalogue
     * pages read it, and therefore published rows only — the same list a
     * visitor's taxonomy comes from. There is no administrator view of a draft
     * or archived category anywhere in this project, and this step adds none:
     * 0010 accepts any existing category id, so the picker offers what it can
     * honestly show and says so.
     */
    function referenceCategoryOptions(session) {
      return request('categories', [
        'select=id,slug,name,description,icon,position,subcategories(id,category_id,slug,name,position)',
        'status=eq.published',
        'order=position.asc'
      ]).then((result) => result.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        label: row.name,
        subcategories: Dm.asArray(row.subcategories)
          .filter((sub) => sub && sub.id)
          .map((sub) => ({ id: sub.id, slug: sub.slug, label: sub.name, categoryId: sub.category_id }))
      })));
    }

    /* ------------------------------------- canonical catalogue (Step 15) --
       The Product → Variant → Merchant Offer layer, read the same way the Deal
       Engine tables are: directly through the policies in 0008, which are
       SELECT-only and gated on public.is_admin(). There is no write here of any
       kind — not to a product, not to an offer, not to the link between an
       imported record and what it became. The database grants no client a write
       privilege on any of those tables, so adding one here would fail anyway,
       and the point of the layer is that nothing in a browser decides what a
       canonical product is.

       `total` is the database's own count (PostgREST's Content-Range), never
       the length of a limited list: a page that reported a list length as a
       total would be showing a number it invented. A read without a count
       reports null, and the panel says the count is not available.

       The three reads are separate on purpose. A product list must not be a
       join against offers, because a product with no merchant offer at all is
       the normal state of a record that has just been reviewed, and a join
       would hide it. */

    function canonicalProducts(session, options) {
      const o = options || {};
      const wanted = Dm.num(o.limit);
      const limit = Math.max(1, Math.min(wanted === null ? PRODUCT_PAGE : wanted, PRODUCT_PAGE));
      return write('products',
        ['select=' + PRODUCT_FIELDS, 'order=created_at.desc', 'limit=' + limit],
        session, { method: 'GET', prefer: 'count=exact' }
      ).then((result) => ({
        products: result.rows.map(Dm.normalizeProduct),
        total: typeof result.total === 'number' ? result.total : null
      }));
    }

    function canonicalVariants(session, options) {
      const o = options || {};
      const wanted = Dm.num(o.limit);
      const limit = Math.max(1, Math.min(wanted === null ? VARIANT_PAGE : wanted, VARIANT_PAGE));
      const params = ['select=' + VARIANT_FIELDS, 'order=name.asc', 'limit=' + limit];
      if (o.productId) params.push('product_id=eq.' + encodeURIComponent(o.productId));
      return write('product_variants', params, session, { method: 'GET', prefer: 'count=exact' }
      ).then((result) => ({
        variants: result.rows.map(Dm.normalizeProductVariant),
        total: typeof result.total === 'number' ? result.total : null
      }));
    }

    function canonicalOffers(session, options) {
      const o = options || {};
      const wanted = Dm.num(o.limit);
      const limit = Math.max(1, Math.min(wanted === null ? MERCHANT_OFFER_PAGE : wanted, MERCHANT_OFFER_PAGE));
      const params = ['select=' + MERCHANT_OFFER_FIELDS, 'order=created_at.desc', 'limit=' + limit];
      if (o.productId) params.push('product_id=eq.' + encodeURIComponent(o.productId));
      return write('merchant_offers', params, session, { method: 'GET', prefer: 'count=exact' }
      ).then((result) => ({
        offers: result.rows.map(Dm.normalizeMerchantOffer),
        total: typeof result.total === 'number' ? result.total : null
      }));
    }

    /**
     * Configuring a source.
     *
     * One database function, called by its name, with the values the operator
     * typed — no table write, no status column patched directly, no assumption
     * that it worked. public.deal_source_save() checks is_admin() for itself,
     * validates every value and returns the row the database holds; this layer
     * only carries it back. Creating passes no id; updating passes the one the
     * row already has.
     */
    /* The panel speaks camelCase; the database speaks its own column names.
       The translation lives here, in the one boundary, so no controller has to
       learn a column name — and so a field the function does not accept cannot
       be smuggled in by a caller that adds one. */
    function sourcePayload(input) {
      const i = input || {};
      return {
        name: Dm.trim(i.name),
        source_type: i.sourceType,
        provider_name: Dm.trim(i.providerName),
        market_country: Dm.trim(i.marketCountry).toUpperCase(),
        endpoint_url: Dm.trim(i.endpointUrl),
        status: i.status,
        config: i.config && typeof i.config === 'object' && !Array.isArray(i.config) ? i.config : {}
      };
    }

    function dealSourceSave(session, input, id) {
      const body = { p_source: sourcePayload(input) };
      if (id) body.p_id = id;
      return write('rpc/deal_source_save', [], session, {
        method: 'POST',
        body: body
      }).then((result) => {
        const row = Array.isArray(result.body) ? result.body[0] : result.body;
        return row && row.id ? Dm.normalizeDealSource(row) : null;
      });
    }

    function sellerFromRow(row) {
      if (!row) return null;
      return {
        id: row.id, name: row.name, slug: row.slug, type: row.type, description: row.description,
        location: {
          country: row.country, county: row.county, city: row.city, area: row.area,
          serviceArea: [], format: row.city ? 'local' : 'unspecified'
        },
        contact: { email: row.contact_email || null, phone: row.contact_phone || null, website: row.website || null },
        verificationStatus: row.verification_status,
        status: row.status
      };
    }

    function offerFromRow(row) {
      return {
        id: row.id, listingId: row.listing_id, sellerId: row.seller_id, title: row.title,
        description: row.description, kind: row.deal_type, originalPrice: row.original_price,
        offerPrice: row.deal_price, discountPercent: row.discount_percent, currency: row.currency,
        startsAt: row.starts_at, endsAt: row.ends_at, availability: row.availability,
        status: row.status, conditions: row.conditions || []
      };
    }

    function listingFromRow(row) {
      if (!row) return null;
      /* Published only. RLS already guarantees it; this keeps the guarantee
         true in the model even if a policy is ever loosened by mistake. */
      if (row.status && row.status !== 'published') return null;
      const seller = Array.isArray(row.sellers) ? row.sellers[0] : row.sellers;
      const deals = Dm.asArray(row.deals);
      const live = deals.find((d) => d.status === 'active') || deals.find((d) => d.status === 'scheduled') || null;
      return {
        id: row.id,
        type: row.type,
        name: row.name,
        slug: row.slug,
        shortDescription: row.short_description,
        description: row.description,
        brand: row.brand,
        category: row.category_id,
        subcategory: row.subcategory_id,
        tags: row.tags || [],
        highlights: row.highlights || [],
        images: row.images || [],
        price: { amount: row.price_amount, min: row.price_min, max: row.price_max, priceType: row.price_type },
        currency: row.currency,
        referencePrice: row.reference_price,
        location: {
          country: row.location_country, county: row.location_county, city: row.location_city,
          area: row.location_area, serviceArea: row.service_area || [], format: row.location_format
        },
        availability: row.availability,
        sellerId: row.seller_id,
        seller: seller || null,
        specifications: row.specifications || [],
        status: row.status || 'published',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        offerId: live ? live.id : null,
        /* Kept for the adapter only: the model reads offerId, and the adapter
           attaches the resolved offer (offers are their own table). */
        rawOffer: live || null
      };
    }

    function guideFromRow(row) {
      if (!row) return null;
      const links = Dm.asArray(row.guide_listings)
        .slice()
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
        .map((link) => link.listing_id);
      return {
        id: row.id, title: row.title, slug: row.slug, category: row.category_id,
        tags: row.tags || [], question: row.question, summary: row.summary,
        sections: row.content || [], relatedListingIds: links,
        icon: row.icon, level: row.level, readTime: row.read_time, cta: row.cta || null,
        status: row.status, createdAt: row.created_at, updatedAt: row.updated_at
      };
    }

    /* ------------------------------------------------- filters and order -- */
    function filterParams(state) {
      const params = ['status=eq.published'];
      if (state.category && state.category !== 'all') params.push('category_id=eq.' + encodeURIComponent(state.category));
      if (state.subcategory && state.subcategory !== 'all') {
        params.push('subcategory_id=eq.' + encodeURIComponent(Dm.trim(state.subcategory).toLowerCase()));
      }
      if (state.type && state.type !== 'all') params.push('type=eq.' + encodeURIComponent(state.type));
      if (state.tag && state.tag !== 'all') params.push('tags=cs.' + encodeURIComponent('{' + Dm.trim(state.tag) + '}'));
      if (state.availability && state.availability !== 'all') params.push('availability=eq.' + encodeURIComponent(state.availability));
      if (state.sellerId) params.push('seller_id=eq.' + encodeURIComponent(Dm.trim(state.sellerId)));

      if (state.band && state.band !== 'any') {
        const band = SCAFFOLD.priceBands.find((b) => b.code === state.band);
        if (band) {
          if (band.min != null) params.push('price_amount=gte.' + Number(band.min));
          if (band.max != null) params.push('price_amount=lte.' + Number(band.max));
        }
      }

      if (state.location && state.location !== 'any') {
        const code = Dm.slugify(state.location);
        if (code === 'online') {
          params.push('location_format=eq.online');
        } else {
          const place = Dm.asArray(SCAFFOLD.locations)
            .find((l) => Dm.slugify(l.city || '') === code || Dm.slugify(l.id || '') === code);
          const city = place && place.city ? place.city : Dm.titleCase(state.location);
          params.push('location_city=eq.' + encodeURIComponent(city));
        }
      }

      /* Free text narrows server-side on the maintained search_text column;
         the shared scorer then applies the exact matching rules. */
      Dm.asArray(state.terms).forEach((term) => {
        params.push('search_text=ilike.' + encodeURIComponent('*' + term + '*'));
      });

      return params;
    }

    function orderParam(sort) {
      switch (sort) {
        case 'price-asc': return 'price_amount.asc.nullslast';
        case 'price-desc': return 'price_amount.desc.nullslast';
        case 'name-asc': return 'name.asc';
        case 'name-desc': return 'name.desc';
        default: return 'created_at.desc';
      }
    }

    function readRowsAsListings(rows) {
      const raw = Dm.asArray(rows).map(listingFromRow).filter(Boolean);
      /* A listing row may arrive with its seller and its offer embedded. The
         model keeps the references (sellerId, offerId) and the adapter attaches
         the resolved records, so every view sees the same shape whichever
         source answered. */
      const sellersById = new Map();
      const offersById = new Map();
      raw.forEach((row) => {
        const sellerRow = Array.isArray(row.seller) ? row.seller[0] : row.seller;
        if (sellerRow && sellerRow.id) sellersById.set(String(sellerRow.id), readSeller(sellerFromRow(sellerRow)));
        if (row.rawOffer && row.rawOffer.id) offersById.set(String(row.id), row.rawOffer);
      });
      const listings = readListings(raw);
      listings.forEach((listing) => {
        const seller = listing.sellerId ? sellersById.get(String(listing.sellerId)) : null;
        if (seller) listing.seller = seller;
        const rawOffer = offersById.get(String(listing.id));
        const offer = rawOffer ? readOffer(offerFromRow(rawOffer), [listing.id]) : null;
        if (offer) {
          offer.sellerId = offer.sellerId || listing.sellerId;
          listing.offer = offer;
          listing.offerId = offer.id;
        }
        finishListing(listing);
      });
      return listings;
    }

    return {
      kind: 'api',
      isAsync: true,

      sellerAccountsMine: sellerAccountsMine,
      sellerAccountCreate: sellerAccountCreate,
      sellerAccountUpdate: sellerAccountUpdate,

      adminCounts: adminCounts,
      adminAccounts: adminAccounts,
      adminAccount: adminAccount,
      adminReview: adminReview,
      dealEngineSources: dealEngineSources,
      dealEngineJobs: dealEngineJobs,
      dealEngineImportedDeals: dealEngineImportedDeals,
      dealEngineReviewQueue: dealEngineReviewQueue,
      dealEngineImportedDeal: dealEngineImportedDeal,
      dealEngineImportedDealEvents: dealEngineImportedDealEvents,
      importedDealConvert: importedDealConvert,
      dealSourceSave: dealSourceSave,
      referenceCategoryOptions: referenceCategoryOptions,
      canonicalProducts: canonicalProducts,
      canonicalVariants: canonicalVariants,
      canonicalOffers: canonicalOffers,
      dealEngineMerchants: dealEngineMerchants,

      init: function () {
        return Promise.all([
          request('categories', ['select=id,slug,name,description,icon,position,subcategories(id,category_id,slug,name,position)',
            'status=eq.published', 'order=position.asc']),
          request('catalogue_settings', ['select=key,value']),
          request('rpc/catalogue_stats', []),
          request('rpc/catalogue_tags', []),
          request('rpc/catalogue_facets', [])
        ]).then(([categories, settings, stats, tags, facets]) => {
          const values = {};
          settings.rows.forEach((row) => { values[row.key] = row.value; });
          const taxonomy = categories.rows.map((row) => ({
            id: row.id, slug: row.slug, label: row.name, blurb: row.description, icon: row.icon,
            position: row.position,
            subcategories: Dm.asArray(row.subcategories).map((s) => ({
              id: s.id, slug: s.slug, label: s.name, category: s.category_id, position: s.position
            }))
          }));
          return {
            taxonomy: taxonomy,
            locations: values.locations || [],
            settings: values,
            /* the RPC's own columns; normalised by readTags() in applyScaffold */
            tags: tags.rows,
            stats: asObject(stats),
            facets: asObject(facets)
          };
        });
      },

      list: function (state, opts) {
        const pageSize = Number(state.pageSize) > 0 ? Number(state.pageSize) : null;
        const searching = !!state.q;
        /* The Deals page lists only records that carry an offer: the join is
           made mandatory for that request so the database filters the rows. */
        const dealsOnly = !!(opts && opts.dataset === 'deals');
        const fields = dealsOnly ? LISTING_FIELDS.replace('deals(', 'deals!inner(') : LISTING_FIELDS;
        const params = filterParams(state).concat([
          'select=' + fields,
          'order=' + orderParam(state.sort)
        ]);
        if (dealsOnly) params.push('deals.status=in.(scheduled,active)');

        /* Paged browsing asks the database for exactly one page. An unpaged
           browse asks for the filtered set, capped so a request can never pull
           the whole catalogue into the browser. */
        const limit = pageSize ? pageSize : MAX_ROWS;
        params.push('limit=' + limit);
        if (!searching && pageSize) {
          const page = Math.max(1, parseInt(state.page, 10) || 1);
          params.push('offset=' + (page - 1) * pageSize);
        }
        if (searching) {
          /* Keep candidate ranking honest: fetch a bounded pool, rank it here. */
          params.pop();
          params.push('limit=' + Math.max(MAX_ROWS, (pageSize || DEFAULT_PAGE_SIZE) * 4));
        }

        return request('listings', params, { count: !searching }).then((result) => {
          const listings = readRowsAsListings(result.rows);

          if (searching) {
            const matched = search(state.q, listings);
            const size = pageSize || matched.length || 1;
            const page = Math.max(1, parseInt(state.page, 10) || 1);
            return {
              items: size ? matched.slice((page - 1) * size, page * size) : matched,
              total: matched.length,
              truncated: false
            };
          }

          const total = result.total == null ? listings.length : result.total;
          return {
            items: listings,
            total: total,
            truncated: total > listings.length && !pageSize
          };
        });
      },

      get: function (id) {
        const key = Dm.trim(id);
        return request('listings', [
          'select=' + LISTING_FIELDS,
          'or=(id.eq.' + encodeURIComponent(key) + ',slug.eq.' + encodeURIComponent(key) + ')',
          'status=eq.published',
          'limit=1'
        ]).then((result) => readRowsAsListings(result.rows)[0] || null);
      },

      /** Resolve a list of ids in one request (chunked, so a long list cannot
          build an unreasonable URL). Used by the compare selection, the
          recently-viewed list and the listings a guide mentions. */
      getMany: function (ids) {
        const keys = Dm.asArray(ids).map((id) => Dm.trim(id)).filter(Boolean);
        if (!keys.length) return Promise.resolve([]);
        const chunks = [];
        for (let i = 0; i < keys.length; i += 25) chunks.push(keys.slice(i, i + 25));
        return Promise.all(chunks.map((chunk) => request('listings', [
          'select=' + LISTING_FIELDS,
          'id=in.(' + chunk.map((key) => '"' + key.replace(/"/g, '') + '"').join(',') + ')',
          'status=eq.published'
        ]).then((result) => readRowsAsListings(result.rows))))
          .then((lists) => lists.reduce((all, list) => all.concat(list), []));
      },

      /* Deal → Listing → Seller, resolved in one request. */
      deals: function () {
        return request('deals', [
          'select=id,listing_id,seller_id,title,description,deal_type,original_price,deal_price,discount_percent,currency,starts_at,ends_at,availability,status,conditions,listings!inner(' + LISTING_FIELDS + ')',
          'status=in.(scheduled,active)',
          'listings.status=eq.published',
          'order=ends_at.asc'
        ]).then((result) => {
          const rows = result.rows;
          const byListing = new Map();
          rows.forEach((row) => {
            const listing = readRowsAsListings([row.listings])[0];
            if (!listing) return;
            const offer = readOffer(offerFromRow(row), [listing.id]);
            if (!offer) return;
            offer.sellerId = offer.sellerId || listing.sellerId;
            listing.offer = offer;
            listing.offerId = offer.id;
            byListing.set(listing.id, remember(listing));
          });
          /* Deduplicate: a listing appears once, with its active offer. */
          return [...byListing.values()];
        });
      },

      guides: function () {
        return request('guides', [
          'select=' + GUIDE_FIELDS,
          'status=eq.published',
          'guide_listings.order=position.asc',
          'order=created_at.asc'
        ]).then((result) => result.rows.map((row) => readGuide(guideFromRow(row))).filter(Boolean));
      },

      sellers: function () {
        return request('sellers', [
          'select=id,name,slug,type,description,country,county,city,area,website,contact_email,contact_phone,verification_status,status',
          'status=eq.published',
          'order=name.asc'
        ]).then((result) => result.rows.map((row) => readSeller(sellerFromRow(row))).filter(Boolean));
      },

      related: function (listing, limit) {
        const params = ['select=' + LISTING_FIELDS, 'status=eq.published', 'id=neq.' + encodeURIComponent(listing.id)];
        const ors = ['category_id.eq.' + encodeURIComponent(listing.category)];
        const tags = Dm.asArray(listing.tags).slice(0, 3);
        if (tags.length) ors.push('tags.ov.' + encodeURIComponent('{' + tags.join(',') + '}'));
        params.push('or=(' + ors.join(',') + ')');
        params.push('limit=' + Math.max(24, (limit || 4) * 6));
        return request('listings', params).then((result) => relatedFor(listing, limit, readRowsAsListings(result.rows)));
      },

      suggest: function (query, limit) {
        const q = Dm.trim(query);
        if (!q) return Promise.resolve([]);
        return Promise.all([
          request('listings', ['select=' + SMALL_LISTING_FIELDS, 'status=eq.published',
            'search_text=ilike.' + encodeURIComponent('*' + q.toLowerCase() + '*'), 'limit=4']),
          request('guides', ['select=id,title,slug,category_id,status', 'status=eq.published',
            'title=ilike.' + encodeURIComponent('*' + q + '*'), 'limit=2'])
        ]).then(([listingResult, guideResult]) => {
          const listings = readListings(listingResult.rows.map(listingFromRow).filter(Boolean));
          listings.forEach(remember);
          const guides = guideResult.rows.map((row) => readGuide(guideFromRow(row))).filter(Boolean);
          return helpers.suggest(q, limit, { listings: listings, sellers: [], guides: guides });
        });
      },

      /* Homepage: the curated ids live in catalogue_settings and the records
         they point at are fetched in one request per group. */
      home: function (settings) {
        const featuredIds = Dm.asArray(settings.homeFeaturedIds);
        const dealIds = Dm.asArray(settings.homeDealIds);
        const guideIds = Dm.asArray(settings.homeGuideIds);
        const inList = (ids) => 'in.(' + ids.map((id) => '"' + String(id).replace(/"/g, '') + '"').join(',') + ')';

        return Promise.all([
          featuredIds.length ? request('listings', ['select=' + LISTING_FIELDS, 'status=eq.published', 'id=' + inList(featuredIds)])
            : Promise.resolve({ rows: [] }),
          dealIds.length ? request('deals', ['select=id,listing_id,seller_id,title,description,deal_type,original_price,deal_price,discount_percent,currency,starts_at,ends_at,availability,status,conditions,listings!inner(' + LISTING_FIELDS + ')',
            'id=' + inList(dealIds), 'listings.status=eq.published'])
            : Promise.resolve({ rows: [] }),
          guideIds.length ? request('guides', ['select=' + GUIDE_FIELDS, 'id=' + inList(guideIds), 'status=eq.published'])
            : Promise.resolve({ rows: [] })
        ]).then(([featuredRows, dealRows, guideRows]) => {
          const featured = readRowsAsListings(featuredRows.rows);
          const deals = dealRows.rows.map((row) => {
            const listing = readRowsAsListings([row.listings])[0];
            if (!listing) return null;
            const offer = readOffer(offerFromRow(row), [listing.id]);
            if (!offer) return null;
            listing.offer = offer;
            listing.offerId = offer.id;
            return remember(listing);
          }).filter(Boolean);
          const guides = guideRows.rows.map((row) => readGuide(guideFromRow(row))).filter(Boolean);

          const order = (list, ids) => {
            const map = new Map(list.map((r) => [r.id, r]));
            return ids.map((id) => map.get(id)).filter(Boolean);
          };
          return {
            featured: order(featured, featuredIds),
            deals: order(deals, dealIds),
            guides: order(guides, guideIds)
          };
        });
      }
    };
  })();

  /* ======================================================================
     Scaffolding — the small configuration every page needs
     ====================================================================== */
  let SCAFFOLD = {
    taxonomy: [], locations: [], settings: {}, tags: [], stats: {},
    priceBands: [], sortOptions: [], compareFocus: [], compareGroups: {},
    considerations: {}, goodToKnow: {}, needs: [], popularTags: [],
    defaultCompareIds: [], homeFeaturedIds: [], homeDealIds: [], homeGuideIds: [],
    subcategoryIds: [], facets: {}, version: 'demo', notice: 'Demonstration data only.'
  };

  function applyScaffold(loaded) {
    const settings = (loaded && loaded.settings) || {};
    const stats = (loaded && loaded.stats) || {};
    const isApi = activeAdapter.kind === 'api';
    SCAFFOLD = {
      taxonomy: (loaded && loaded.taxonomy) || [],
      locations: (loaded && loaded.locations) || [],
      settings: settings,
      tags: readTags(loaded && loaded.tags),
      stats: stats,
      priceBands: Dm.asArray(settings.priceBands),
      sortOptions: Dm.asArray(settings.sortOptions),
      compareFocus: Dm.asArray(settings.compareFocus),
      compareGroups: settings.compareGroups || {},
      considerations: settings.considerations || {},
      goodToKnow: settings.goodToKnow || {},
      needs: Dm.asArray(settings.needs),
      popularTags: Dm.asArray(settings.popularTags),
      defaultCompareIds: Dm.asArray(settings.defaultCompareIds),
      homeFeaturedIds: Dm.asArray(settings.homeFeaturedIds),
      homeDealIds: Dm.asArray(settings.homeDealIds),
      homeGuideIds: Dm.asArray(settings.homeGuideIds),
      subcategoryIds: Dm.asArray(stats.subcategoryIds),
      facets: (loaded && loaded.facets) || {},
      version: Dm.trim(settings.version) || (isApi ? 'live' : 'demo'),
      notice: Dm.trim(settings.demoNotice) || (isApi ? '' : 'Demonstration catalogue only — every listing, price, seller and offer here is invented.')
    };
    context.taxonomy = SCAFFOLD.taxonomy;
    context.sellerIds = Dm.asArray(settings.sellerIds);
    collect(null, Dm.validateTaxonomy(SCAFFOLD.taxonomy).issues);
    const configKeyed = Object.keys(SCAFFOLD.considerations)
      .concat(Object.keys(SCAFFOLD.goodToKnow))
      .concat(Object.keys(SCAFFOLD.compareGroups));
    collect(null, Dm.validateConfigReferences(SCAFFOLD.taxonomy, configKeyed).issues);
  }

  /* ======================================================================
     The shared engine — filtering, search, sorting, related options
     ====================================================================== */
  const STOP_WORDS = ['a', 'an', 'and', 'the', 'for', 'with', 'to', 'of', 'in', 'on', 'my', 'me', 'i',
    'need', 'needing', 'looking', 'want', 'show', 'find', 'some', 'please', 'best', 'good', 'top'];
  const TERM_SYNONYMS = { cheap: 'budget', affordable: 'budget', inexpensive: 'budget', 'high-end': 'premium' };

  const norm = (value) => Dm.str(value).toLowerCase().replace(/wi[-\s]?fi/g, 'wifi').replace(/['’]/g, '');
  const tokenize = (value) => norm(value).split(/[^a-z0-9]+/).filter(Boolean);

  function normalizeTerms(query) {
    const kept = [];
    tokenize(query).forEach((term) => {
      if (STOP_WORDS.indexOf(term) !== -1) return;
      const mapped = TERM_SYNONYMS[term] || term;
      if (kept.indexOf(mapped) === -1) kept.push(mapped);
    });
    return kept;
  }

  function searchFields(record) {
    const l = record.location || {};
    return {
      name: norm(record.name),
      brand: norm(record.brand),
      category: norm(store.categoryLabel(record.category)),
      subcategory: norm(store.subcategoryLabel(record.subcategory)),
      tags: norm(record.tags.join(' ')),
      seller: norm(record.seller && record.seller.name),
      location: norm([l.city, l.county, l.area, l.country].concat(l.serviceArea).join(' ')),
      body: norm(record.shortDescription + ' ' + record.description),
      specs: norm(record.specifications.map((s) => s.label + ' ' + s.value).join(' '))
    };
  }

  function search(query, list) {
    const pool = Array.isArray(list) ? list : [];
    const q = Dm.trim(query);
    if (!q) return pool.slice();
    const terms = normalizeTerms(q);
    if (!terms.length) return pool.slice();

    const scored = [];
    pool.forEach((record) => {
      const fields = searchFields(record);
      const tokens = {};
      Object.keys(fields).forEach((key) => { tokens[key] = tokenize(fields[key]); });

      const hit = (key, weight, term) => {
        if (tokens[key].some((t) => t.indexOf(term) === 0)) return weight;
        if (tokens[key].some((t) => t.indexOf(term) !== -1)) return weight - 1;
        if (fields[key].indexOf(term) !== -1) return Math.max(1, weight - 2);
        return 0;
      };

      let score = 0;
      let matched = 0;
      let strong = false;
      terms.forEach((term) => {
        const strongScore = hit('name', 12, term) + hit('brand', 9, term) + hit('category', 7, term) +
          hit('subcategory', 6, term) + hit('tags', 5, term);
        const weakScore = hit('seller', 5, term) + hit('location', 4, term) + hit('body', 3, term) + hit('specs', 2, term);
        if (strongScore + weakScore) matched++;
        if (strongScore) strong = true;
        score += strongScore + weakScore;
      });

      if (!matched) return;
      if (fields.name.indexOf(norm(q)) !== -1) score += 6;
      if (terms.length > 1 && terms.every((t) => fields.name.indexOf(t) !== -1)) score += 4;
      if (record.offer) score += 2;
      scored.push({ record: record, score: score, matched: matched, strong: strong });
    });

    const rank = (rows) => rows
      .sort((a, b) => b.score - a.score || a.record.name.localeCompare(b.record.name))
      .map((x) => x.record);

    const strict = scored.filter((r) => r.matched === terms.length);
    if (strict.length) return rank(strict);
    const needed = Math.max(1, Math.ceil(terms.length / 2));
    return rank(scored.filter((r) => r.matched >= needed && r.strong));
  }

  function matchesLocation(record, code) {
    const key = Dm.trim(code).toLowerCase();
    if (!key || key === 'any') return true;
    const l = record.location || {};
    if (key === 'online') return l.format === 'online';
    if (key === 'local') return l.format === 'local' || l.format === 'nationwide';
    return Dm.slugify(l.city) === key || Dm.slugify(l.county) === key;
  }

  function applyFilters(list, filters) {
    const f = filters || {};
    let out = Dm.asArray(list).slice();

    if (f.q) out = search(f.q, out);
    if (f.category && f.category !== 'all') out = out.filter((l) => l.category === f.category);
    if (f.subcategory && f.subcategory !== 'all') {
      const key = Dm.trim(f.subcategory).toLowerCase();
      out = out.filter((l) => l.subcategory.toLowerCase() === key || Dm.slugify(l.subcategory) === key);
    }
    if (f.tag && f.tag !== 'all') out = out.filter((l) => l.tags.indexOf(Dm.trim(f.tag).toLowerCase()) !== -1);
    if (f.type && f.type !== 'all') out = out.filter((l) => l.type === f.type);
    if (f.sellerId) out = out.filter((l) => l.sellerId === Dm.trim(f.sellerId));

    if (f.band && f.band !== 'any') {
      const band = SCAFFOLD.priceBands.find((b) => b.code === f.band);
      if (band) {
        out = out.filter((l) => {
          const v = Dm.priceValue(l);
          if (v === Number.MAX_SAFE_INTEGER) return false;
          if (band.min != null && v < band.min) return false;
          if (band.max != null && v > band.max) return false;
          return true;
        });
      }
    }

    if (f.location && f.location !== 'any') out = out.filter((l) => matchesLocation(l, f.location));
    if (f.availability && f.availability !== 'all') out = out.filter((l) => l.availability === f.availability);

    return out;
  }

  function activeFilterCount(state) {
    const s = state || {};
    let n = 0;
    if (s.category && s.category !== 'all') n++;
    if (s.subcategory && s.subcategory !== 'all') n++;
    if (s.tag && s.tag !== 'all') n++;
    if (s.type && s.type !== 'all') n++;
    if (s.band && s.band !== 'any') n++;
    if (s.location && s.location !== 'any') n++;
    if (s.availability && s.availability !== 'all') n++;
    return n;
  }

  function applySort(list, code, query) {
    const out = Dm.asArray(list).slice();
    switch (code) {
      case 'newest':
        return out.sort((a, b) => Dm.str(b.createdAt).localeCompare(Dm.str(a.createdAt)));
      case 'price-asc':
        return out.sort((a, b) => Dm.priceValue(a) - Dm.priceValue(b) || a.name.localeCompare(b.name));
      case 'price-desc':
        return out.sort((a, b) => Dm.priceValue(b) - Dm.priceValue(a) || a.name.localeCompare(b.name));
      case 'name-asc':
        return out.sort((a, b) => a.name.localeCompare(b.name));
      case 'name-desc':
        return out.sort((a, b) => b.name.localeCompare(a.name));
      case 'relevance':
      default:
        if (query) return search(query, out);
        return out.sort((a, b) => {
          const da = a.offer ? 1 : 0;
          const db = b.offer ? 1 : 0;
          if (da !== db) return db - da;
          return Dm.str(b.createdAt).localeCompare(Dm.str(a.createdAt));
        });
    }
  }

  const midPrice = (record) => (Dm.priceValue(record) === Number.MAX_SAFE_INTEGER ? null : Dm.priceValue(record));

  function relatedFor(item, limit, pool) {
    if (!item) return [];
    const max = limit || 4;
    const mine = midPrice(item);
    const scored = [];

    Dm.asArray(pool).forEach((r) => {
      if (r.id === item.id) return;
      let score = 0;
      const reasons = [];

      if (r.category === item.category) { score += 5; reasons.push('same category'); }
      if (item.subcategory && r.subcategory === item.subcategory) { score += 4; reasons.push('same kind of item'); }
      if (r.type === item.type) { score += 1; reasons.push(r.type === 'product' ? 'both products' : 'both services'); }

      const shared = r.tags.filter((t) => item.tags.indexOf(t) !== -1);
      if (shared.length) {
        score += 3 * Math.min(shared.length, 2);
        reasons.push('shares ' + shared.slice(0, 2).join(' + '));
      }

      if (item.brand && r.brand === item.brand) { score += 2; reasons.push('same brand'); }

      const myCity = (item.location && item.location.city) || '';
      const theirCity = (r.location && r.location.city) || '';
      const isTown = (c) => !!c && c !== 'Online' && c !== 'Nationwide';
      if (isTown(myCity) && myCity === theirCity) { score += 1; reasons.push('same area'); }

      const theirs = midPrice(r);
      if (mine != null && theirs != null && Math.abs(theirs - mine) / Math.max(mine, 1) <= 0.35) {
        score += 2;
        reasons.push('similar price');
      }

      if (score > 0) scored.push({ record: r, score: score, reasons: reasons });
    });

    return scored
      .sort((a, b) => b.score - a.score || Dm.str(b.record.createdAt).localeCompare(Dm.str(a.record.createdAt)) || a.record.name.localeCompare(b.record.name))
      .slice(0, max);
  }

  function tagCounts(listings) {
    const map = new Map();
    Dm.asArray(listings).forEach((l) => Dm.asArray(l.tags).forEach((t) => map.set(t, (map.get(t) || 0) + 1)));
    return [...map.entries()]
      .map(([tag, count]) => ({ tag: tag, label: store.tagLabel(tag), count: count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /* Tag counts reach the interface in two shapes: built here as
     { tag, label, count }, or straight from the database, where
     catalogue_tags() returns the columns of its RETURNS TABLE clause
     (tag, listings) over PostgREST. One normaliser turns either into the
     single shape the interface renders, so the two adapters agree and a tag
     can never surface without a label or a numeric count. */
  function readTags(rows) {
    return Dm.asArray(rows)
      .map((row) => {
        const tag = Dm.trim(row && row.tag);
        if (!tag) return null;
        const raw = row.count != null ? row.count : row.listings;
        const count = Number.isFinite(Number(raw)) ? Number(raw) : 0;
        return { tag: tag, label: Dm.trim(row.label) || store.tagLabel(tag), count: count };
      })
      .filter(Boolean)
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /* ======================================================================
     Engine helpers used by the adapters
     ====================================================================== */
  const helpers = {
    defaultPageSize: DEFAULT_PAGE_SIZE,
    /** Local paging for a source that already holds the catalogue. */
    page: function (state, pool) {
      const list = applySort(applyFilters(pool(), state), state.sort, state.q);
      const total = list.length;
      const size = Number(state.pageSize) > 0 ? Number(state.pageSize) : null;
      const page = Math.max(1, parseInt(state.page, 10) || 1);
      const pageCount = size ? Math.max(1, Math.ceil(total / size)) : 1;
      const current = Math.min(page, pageCount);
      return {
        items: size ? list.slice((current - 1) * size, current * size) : list,
        total: total,
        truncated: false
      };
    },
    suggest: function (query, limit, sources) {
      const q = Dm.trim(query).toLowerCase();
      const max = limit || 6;
      if (!q) return SCAFFOLD.taxonomy.slice(0, 4).map((c) => ({ label: c.label, meta: 'Category', href: 'discover.html?category=' + c.slug, icon: c.icon }));

      const out = [];
      const push = (row) => {
        if (out.length < max && !out.some((r) => r.label.toLowerCase() === row.label.toLowerCase())) out.push(row);
      };

      search(q, Dm.asArray(sources.listings)).slice(0, 3).forEach((r) => push({
        label: r.name,
        meta: Dm.typeLabel(r.type) + ' · ' + store.categoryLabel(r.category),
        href: 'detail.html?id=' + encodeURIComponent(r.id),
        icon: (Dm.primaryImage(r) || {}).icon
      }));
      SCAFFOLD.taxonomy.filter((c) => c.label.toLowerCase().indexOf(q) !== -1)
        .forEach((c) => push({ label: c.label, meta: 'Category', href: 'discover.html?category=' + c.slug, icon: c.icon }));
      Dm.asArray(sources.sellers).filter((s) => s.name.toLowerCase().indexOf(q) !== -1).slice(0, 2)
        .forEach((s) => push({ label: s.name, meta: s.typeLabel, href: 'discover.html?q=' + encodeURIComponent(s.name), icon: '🏬' }));
      Dm.asArray(sources.guides).filter((g) => g.title.toLowerCase().indexOf(q) !== -1).slice(0, 2)
        .forEach((g) => push({ label: g.title, meta: 'Guide outline', href: 'guides.html?q=' + encodeURIComponent(g.title), icon: g.icon }));
      return out.slice(0, max);
    }
  };

  /* ======================================================================
     Adapter lifecycle and the failure policy
     ====================================================================== */
  let initPromise = null;
  let homePromise = null;

  /* An adapter installed through store.use() (tests, previews, a future
     backend) stays in place until another one replaces it. */
  let customAdapter = null;

  function pickAdapter() {
    if (customAdapter) return customAdapter;
    if (CONFIG.mode !== 'api') return demoAdapter;
    if (!CONFIG.url || !CONFIG.anonKey) {
      note('error', 'api-not-configured',
        'mode is "api" but js/config.js has no Supabase url/anonKey — the bundled demonstration catalogue is being served instead.');
      return demoAdapter;
    }
    return supabaseAdapter;
  }

  function bootstrap() {
    return activeAdapter.init().then((loaded) => {
      applyScaffold(loaded || {});
      return store;
    });
  }

  function init() {
    if (initPromise) return initPromise;
    homePromise = null;
    diagnostics = [];
    fallbackActive = false;
    activeAdapter = pickAdapter();
    note('info', 'source-selected', 'Catalogue source: ' + activeAdapter.kind + '.');

    initPromise = bootstrap().catch((err) => {
      if (CONFIG.onFailure === 'demo' && activeAdapter.kind === 'api') {
        note('warning', 'fell-back-to-demo',
          'The live catalogue could not be reached at start-up; the bundled demonstration catalogue is being shown instead. ' +
          (err && err.technical ? err.technical : ''));
        fallbackActive = true;
        activeAdapter = demoAdapter;
        initPromise = null;
        return bootstrap().then(() => { initPromise = Promise.resolve(store); return store; });
      }
      note('error', 'init-failed', (err && err.technical) || String(err && err.message));
      throw StoreError(FRIENDLY, 'init-failed', err && err.technical);
    });
    return initPromise;
  }

  /** Read through the active adapter, applying the configured failure policy. */
  function fromSource(label, call) {
    return init().then(() => {
      const adapter = activeAdapter;
      return call(adapter).catch((err) => {
        const technical = (err && err.technical) || (err && err.message) || String(err);
        const code = (err && err.code) || 'catalogue-unavailable';
        if (CONFIG.onFailure === 'demo' && adapter.kind === 'api' && !fallbackActive) {
          note('warning', 'fell-back-to-demo',
            'Reading from the live catalogue failed (' + label + '); using the bundled demonstration catalogue. ' + technical);
          fallbackActive = true;
          activeAdapter = demoAdapter;
          return demoAdapter.init().then(() => call(demoAdapter));
        }
        note('error', code, label + ' failed: ' + technical);
        throw StoreError(FRIENDLY, code, technical);
      });
    });
  }

  /* ======================================================================
     Public API
     ====================================================================== */
  const store = {
    /* ---- lifecycle ------------------------------------------------------ */
    init: init,
    ready: init,
    reload: function () {
      initPromise = null;
      return init();
    },
    source: () => (activeAdapter ? activeAdapter.kind : CONFIG.mode),
    isAsync: () => !!(activeAdapter && activeAdapter.isAsync),
    fallbackActive: () => !!fallbackActive,
    config: () => Object.assign({}, CONFIG),
    diagnostics: () => diagnostics.slice(),
    use: function (adapter) {
      if (!adapter || typeof adapter.list !== 'function') return Promise.resolve(false);
      customAdapter = Object.assign({ kind: 'custom', isAsync: true }, adapter);
      activeAdapter = customAdapter;
      initPromise = null;
      return init().then(() => true).catch(() => false);
    },

    /* ---- browsing (envelope) ------------------------------------------- */
    query: function (state, opts) {
      const s = Object.assign({}, state || {});
      const o = opts || {};
      const empty = { ok: false, items: [], total: 0, page: 1, pageSize: 0, hasNext: false, hasPrev: false, truncated: false, error: null };
      if (s.page != null) {
        const p = parseInt(s.page, 10);
        if (!Number.isFinite(p) || p < 1) note('warning', 'invalid-page-ignored', 'Ignored an invalid page value ("' + s.page + '").');
      }
      s.terms = normalizeTerms(s.q || '');

      return fromSource('list', (adapter) => adapter.list(s, o)).then((result) => {
        const items = Dm.asArray(result && result.items);
        const total = Number.isFinite(Number(result && result.total)) ? Number(result.total) : items.length;
        const size = Number(s.pageSize) > 0 ? Number(s.pageSize) : null;
        const page = Math.max(1, parseInt(s.page, 10) || 1);
        const pageCount = size ? Math.max(1, Math.ceil(total / size)) : 1;
        const current = Math.min(page, pageCount);
        return {
          ok: true,
          items: items,
          total: total,
          page: current,
          pageSize: size || total,
          hasNext: size ? current * size < total : false,
          hasPrev: current > 1,
          truncated: !!(result && result.truncated),
          error: null
        };
      }).catch((err) => {
        return Object.assign({}, empty, { error: err && err.message ? err.message : FRIENDLY, code: err && err.code });
      });
    },
    getListings: (params) => store.query(params),
    searchListings: (query, params) => store.query(Object.assign({}, params || {}, { q: Dm.trim(query) })),
    filterListings: (filters) => store.query(filters),

    /* ---- single records (record or null) -------------------------------- */
    getListing: function (id) {
      const key = Dm.trim(id);
      if (!key) return Promise.resolve(null);
      const remembered = memoItem(key);
      if (remembered) return Promise.resolve(remembered);
      /* The adapter returns a resolved record (provider and offer attached);
         this layer only makes sure it is normalised and remembered. */
      return fromSource('getListing', (adapter) => adapter.get(key))
        .then((record) => (record && record.id ? finishListing(record) : null));
    },
    getDeal: function (id) {
      const key = Dm.trim(id);
      if (!key) return Promise.resolve(null);
      return store.getDeals().then((list) => {
        const record = list.find((l) => l.offer && l.offer.id === key) || null;
        return record ? Object.assign({}, record.offer, { listing: record }) : null;
      });
    },
    getGuide: function (id) {
      const key = Dm.trim(id);
      if (!key) return Promise.resolve(null);
      return store.getGuides().then((list) => list.find((g) => g.id === key || g.slug === key) || null);
    },

    /* ---- collections (arrays) ------------------------------------------- */
    getDeals: () => fromSource('deals', (adapter) => adapter.deals()).then((list) => Dm.asArray(list)),
    getGuides: () => fromSource('guides', (adapter) => adapter.guides()).then((list) => Dm.asArray(list)),
    getCategories: () => Promise.resolve(store.categories()),
    getSubcategories: (category) => Promise.resolve(store.subcategories(category)),
    /* Guides are a small fixed set (outlines, not articles), so they are
       filtered inside the data layer and returned whole — no paging needed. */
    queryGuides: function (state) {
      const s = state || {};
      const terms = s.q ? tokenize(s.q) : [];
      return store.getGuides().then((list) => list.filter((guide) => {
        if (s.category && s.category !== 'all' && guide.category !== s.category) return false;
        if (!terms.length) return true;
        const hay = norm([
          guide.title, guide.question || '', guide.summary,
          store.categoryLabel(guide.category),
          Dm.asArray(guide.sections).map((x) => x.title).join(' ')
        ].join(' '));
        const words = tokenize(hay);
        return terms.every((term) => hay.indexOf(term) !== -1 || words.some((w) => w.indexOf(term) === 0));
      }));
    },
    getSellers: () => fromSource('sellers', (adapter) => adapter.sellers()).then((list) => Dm.asArray(list)),
    getSeller: function (id) {
      const key = Dm.trim(id);
      if (!key) return Promise.resolve(null);
      return store.getSellers().then((list) => list.find((s) => s.id === key || s.slug === key) || null);
    },
    getListingsBySeller: function (sellerId) {
      const key = Dm.trim(sellerId);
      if (!key) return Promise.resolve([]);
      return store.query({ sellerId: key, pageSize: CONFIG.poolLimit }).then((env) => env.items);
    },
    getRelatedListings: function (id, limit) {
      return store.getListing(id).then((listing) => {
        if (!listing) return [];
        return fromSource('related', (adapter) => adapter.related(listing, limit || 4));
      });
    },
    /* The homepage previews ask for the same three curated groups, so the
       result is fetched once and shared — repeated calls are not repeated
       requests. A failure clears the memo so a retry really retries. */
    home: function () {
      if (homePromise) return homePromise;
      homePromise = init()
        .then(() => fromSource('home', (adapter) => adapter.home(SCAFFOLD.settings)))
        .then((home) => ({
          featured: Dm.asArray(home && home.featured),
          deals: Dm.asArray(home && home.deals),
          guides: Dm.asArray(home && home.guides)
        }))
        .catch((err) => {
          homePromise = null;
          throw err;
        });
      return homePromise;
    },
    suggest: (query, limit) => fromSource('suggest', (adapter) => adapter.suggest(query, limit)).then((rows) => Dm.asArray(rows)),

    /* ---- pools used by suggestion lists (compare, explore) -------------- */
    all: () => store.query({ pageSize: CONFIG.poolLimit, sort: 'name-asc' }).then((env) => env.items),
    byCategory: (slug) => store.query({ category: slug, pageSize: CONFIG.poolLimit, sort: 'name-asc' }).then((env) => env.items),
    bySubcategory: (value) => store.query({ subcategory: value, pageSize: CONFIG.poolLimit, sort: 'name-asc' }).then((env) => env.items),
    byType: (type) => store.query({ type: type, pageSize: CONFIG.poolLimit, sort: 'name-asc' }).then((env) => env.items),
    byTag: (tag) => store.query({ tag: tag, pageSize: CONFIG.poolLimit, sort: 'name-asc' }).then((env) => env.items),
    dataset: (name) => store.query({ dataset: name, pageSize: CONFIG.poolLimit }),

    /* ---- ids already served this session -------------------------------- */
    item: (id) => memoItem(id),
    items: (ids) => Dm.asArray(ids).map((id) => memoItem(id)).filter(Boolean),
    /** Fetch ids the memo has not seen (compare selection, recently viewed). */
    hydrate: function (ids) {
      const wanted = Dm.asArray(ids).map((id) => Dm.trim(id)).filter(Boolean);
      const missing = wanted.filter((id) => !memo.has(id));
      if (!missing.length) return Promise.resolve(wanted.map((id) => memoItem(id)).filter(Boolean));
      return fromSource('hydrate', (adapter) => (
        typeof adapter.getMany === 'function'
          ? adapter.getMany(missing)
          : Promise.all(missing.map((id) => adapter.get(id).catch(() => null)))
      ))
        .then((records) => {
          Dm.asArray(records).filter((record) => record && record.id).forEach(finishListing);
          /* Answer for every id that was asked for — already-remembered ones
             included — in the order the caller gave them. */
          return wanted.map((id) => memoItem(id)).filter(Boolean);
        });
    },

    /* ---- scaffolding (synchronous once init() resolves) ----------------- */
    categories: () => SCAFFOLD.taxonomy.slice(),
    category: (slug) => SCAFFOLD.taxonomy.find((c) => c.slug === slug || c.id === slug) || null,
    subcategories: function (category) {
      const ids = [];
      SCAFFOLD.taxonomy.forEach((c) => {
        if (category && category !== 'all' && c.slug !== category && c.id !== category) return;
        Dm.asArray(c.subcategories).forEach((s) => { if (ids.indexOf(s.id) === -1) ids.push(s.id); });
      });
      /* Offer only subcategories that have published records. */
      const inUse = SCAFFOLD.subcategoryIds;
      const filtered = inUse.length ? ids.filter((id) => inUse.indexOf(id) !== -1) : ids;
      return filtered.sort((a, b) => store.subcategoryLabel(a).localeCompare(store.subcategoryLabel(b)));
    },
    subcategoryLabel: (value) => {
      const found = Dm.findSubcategory(SCAFFOLD.taxonomy, null, value);
      return found ? found.label : Dm.titleCase(Dm.str(value));
    },
    locations: () => Dm.asArray(SCAFFOLD.locations).slice(),
    locationOptions: function () {
      const options = [{ code: 'any', label: 'All locations' }, { code: 'online', label: 'Online / nationwide' }];
      const inUse = Dm.asArray(SCAFFOLD.stats.locationCities).map((c) => Dm.slugify(c));
      Dm.asArray(SCAFFOLD.locations)
        .filter((l) => l.format === 'local' && l.city)
        .filter((l) => !inUse.length || inUse.indexOf(Dm.slugify(l.city)) !== -1)
        .forEach((l) => options.push({ code: Dm.slugify(l.city), label: l.label || l.city }));
      return options;
    },
    priceBands: () => SCAFFOLD.priceBands.map((b) => ({ code: b.code, label: store.priceBandLabel(b), min: b.min, max: b.max })),
    priceBandLabel: (band) => {
      const b = band || {};
      if (b.min == null && b.max == null) return 'Any price';
      if (b.min == null) return 'Under ' + Dm.money(b.max, Dm.DEFAULT_CURRENCY);
      if (b.max == null) return Dm.money(b.min, Dm.DEFAULT_CURRENCY) + ' and above';
      return Dm.money(b.min, Dm.DEFAULT_CURRENCY) + ' – ' + Dm.money(b.max, Dm.DEFAULT_CURRENCY);
    },
    sortOptions: () => SCAFFOLD.sortOptions.slice(),
    availabilityOptions: () => Dm.AVAILABILITY.slice(),
    listingStatuses: () => Dm.LISTING_STATUS.slice(),
    types: () => Dm.LISTING_TYPES.map((t) => ({ code: t, label: Dm.typeLabel(t) })),
    tags: () => Dm.asArray(SCAFFOLD.tags).slice(),
    /** Counts for the filter panel: { category, subcategory, type, availability }. */
    facets: () => ({
      category: Object.assign({}, (SCAFFOLD.facets && SCAFFOLD.facets.categories) || {}),
      subcategory: Object.assign({}, (SCAFFOLD.facets && SCAFFOLD.facets.subcategories) || {}),
      type: Object.assign({}, (SCAFFOLD.facets && SCAFFOLD.facets.types) || {}),
      availability: Object.assign({}, (SCAFFOLD.facets && SCAFFOLD.facets.availability) || {})
    }),
    tagExists: (tag) => !!Dm.trim(tag) && Dm.asArray(SCAFFOLD.tags).some((t) => t.tag === Dm.trim(tag).toLowerCase()),
    tagLabel: (tag) => Dm.str(tag).replace(/-/g, ' '),
    popularTags: () => SCAFFOLD.popularTags.slice(),
    needs: () => SCAFFOLD.needs.slice(),

    /* ---- decision support ---------------------------------------------- */
    considerations: (record) => {
      if (!record) return null;
      const key = record.category + ':' + store.subcategoryLabel(record.subcategory);
      const byLabel = record.category + ':' + Dm.titleCase(Dm.str(record.subcategory));
      return SCAFFOLD.considerations[key] || SCAFFOLD.considerations[byLabel] || SCAFFOLD.considerations[record.category] || null;
    },
    goodToKnow: (record) => {
      if (!record) return [];
      const key = record.category + ':' + store.subcategoryLabel(record.subcategory);
      const byLabel = record.category + ':' + Dm.titleCase(Dm.str(record.subcategory));
      return SCAFFOLD.goodToKnow[key] || SCAFFOLD.goodToKnow[byLabel] || SCAFFOLD.goodToKnow[record.category] || [];
    },
    compareConfig: (category) => SCAFFOLD.compareGroups[category] || null,
    compareFocusAreas: () => SCAFFOLD.compareFocus.slice(),
    focusArea: (code) => SCAFFOLD.compareFocus.find((f) => f.code === code) || null,
    defaultCompareIds: () => SCAFFOLD.defaultCompareIds.slice(),

    /* ---- guides --------------------------------------------------------- */
    guides: () => store.getGuides(),
    guide: (id) => store.getGuide(id),
    /** Records the guide points at, as far as the memo already knows. */
    guideListings: (guide) => Dm.asArray(guide && guide.relatedListingIds).map((id) => memoItem(id)).filter(Boolean),
    /** The same list, fetched and resolved through the store. */
    guideListingsAsync: (guide) => store.hydrate(Dm.asArray(guide && guide.relatedListingIds)),
    /** Warm the memo for every listing the given guides mention, in one call. */
    warmGuideListings: function (list) {
      const ids = [];
      Dm.asArray(list).forEach((guide) => Dm.asArray(guide && guide.relatedListingIds).forEach((id) => {
        if (ids.indexOf(id) === -1) ids.push(id);
      }));
      return store.hydrate(ids);
    },

    /* ---- offers --------------------------------------------------------- */
    offers: () => store.getDeals().then((list) => list.filter((l) => !!l.offer).map((l) => Object.assign({}, l.offer, { listing: l }))),
    offer: (id) => store.getDeal(id),
    offersFor: (listingId) => {
      const record = memoItem(listingId);
      return record && record.offer ? [record.offer] : [];
    },
    deals: () => store.getDeals(),

    /* ---- seller / provider accounts (Step 11) ----------------------------
       The application a signed-in person submits to sell products or provide
       services. Everything here needs that person's own session, and every
       request carries their token, so Row Level Security decides — this layer
       cannot widen what the database allows.

         available()          is there a live project to apply to at all?
         mine(session)        the caller's own applications
         create(session, x)   submit one (always lands as 'pending')
         update(session, id, x)  edit one while it is still pending

       Nothing here publishes a listing, approves anything or changes a status:
       those are not this stage's, and the database refuses them regardless.
       ---------------------------------------------------------------------- */
    sellerAccounts: {
      available: () => activeAdapter && activeAdapter.kind === 'api' && !!(CONFIG.url && CONFIG.anonKey),
      mine: (session) => Promise.resolve(activeAdapter.sellerAccountsMine(session)),
      create: (session, input) => Promise.resolve(activeAdapter.sellerAccountCreate(session, input)),
      update: (session, id, input) => Promise.resolve(activeAdapter.sellerAccountUpdate(session, id, input))
    },

    /* ------------------------------------------------------------- admin --
       Administrative access, kept in its own namespace so the catalogue's read
       paths never touch a private table and an admin call is always
       recognisable at the call site (PV.store.admin.…).

       These are not gated here. They are gated by the database, against the
       caller's own token: a request from a normal user comes back empty or
       refused, whatever the interface believes. A page that hides this
       namespace hides buttons, not data.
       ---------------------------------------------------------------------- */
    admin: {
      available: () => activeAdapter && activeAdapter.kind === 'api' && !!(CONFIG.url && CONFIG.anonKey),
      counts: (session) => Promise.resolve(activeAdapter.adminCounts(session)),
      accounts: (session, options) => Promise.resolve(activeAdapter.adminAccounts(session, options)),
      account: (session, id) => Promise.resolve(activeAdapter.adminAccount(session, id)),
      review: (session, id, status, note) => Promise.resolve(activeAdapter.adminReview(session, id, status, note))
    },

    /* ---- Deal Engine (Step 13; the reviewed conversion from Step 17A) -----
       Imported records and the pipeline around them, admin-only, and separate
       from the catalogue above. Public discovery never calls anything here: a
       visitor's page cannot reach an imported record, and no part of this
       falls back to the demonstration data.

       Three of these methods write, and every one of them writes through a
       database function that checks is_admin() for itself and validates what
       it is given — createSource/updateSource through
       public.deal_source_save(), and convert through
       public.imported_deal_convert(). The rest read. */
    dealEngine: {
      sources: (session) => Promise.resolve(activeAdapter.dealEngineSources(session)),
      jobs: (session) => Promise.resolve(activeAdapter.dealEngineJobs(session)),
      importedDeals: (session, options) => Promise.resolve(activeAdapter.dealEngineImportedDeals(session, options)),
      merchants: (session) => Promise.resolve(activeAdapter.dealEngineMerchants(session)),
      /* The review queue: records at pending-review + pending, decided by the
         query, not by the page. */
      reviewQueue: (session, options) => Promise.resolve(activeAdapter.dealEngineReviewQueue(session, options)),
      importedDeal: (session, id) => Promise.resolve(activeAdapter.dealEngineImportedDeal(session, id)),
      importedDealEvents: (session, id) => Promise.resolve(activeAdapter.dealEngineImportedDealEvents(session, id)),
      createSource: (session, input) => Promise.resolve(activeAdapter.dealSourceSave(session, input, null)),
      updateSource: (session, id, input) => Promise.resolve(activeAdapter.dealSourceSave(session, input, id)),
      /* The conversion. Its rules live in the database; this carries the
         decision there and returns what came back, or null when the database
         did not return a complete answer. */
      convert: (session, id, input) => Promise.resolve(activeAdapter.importedDealConvert(session, id, input))
    },

    /* ---- canonical catalogue (Step 15) -----------------------------------
       Product → Variant → Merchant Offer, read-only, admin-only, and separate
       from the public catalogue above.

       The name is `canonical` rather than `catalogue` for a reason worth
       stating: `store.catalogue()` further down is the wording helper that
       tells a page whether it is showing the demonstration dataset or the
       published catalogue, and a data namespace of the same name would shadow
       it. Two different things, two different names.

       Every method here takes a session, because every read is decided by the
       database against that session's token: 0008's policies are SELECT-only
       and gated on public.is_admin(), so a request from anybody else comes back
       empty — and empty is what this layer returns, not an error it invents.
       No page code reaches Supabase for this: these three methods are the whole
       surface, and they read and write nothing but these reads. There is no
       create, update or delete here by design; a canonical record is not made
       in a browser.

         products(session, { limit })     newest first, with the database's count
         variants(session, productId)     the configurations of one product
         offers(session, { limit, productId })  newest first, with the count
                                                                             */
    canonical: {
      available: () => activeAdapter && activeAdapter.kind === 'api' && !!(CONFIG.url && CONFIG.anonKey),
      products: (session, options) => Promise.resolve(activeAdapter.canonicalProducts(session, options)),
      /* The variants of one product. Asked without a product, this is a
         different question rather than a wider list, so it is not sent: the
         answer would be every configuration of everything, which nothing reads. */
      variants: (session, productId) => (productId
        ? Promise.resolve(activeAdapter.canonicalVariants(session, { productId: productId }))
        : Promise.resolve({ variants: [], total: null })),
      offers: (session, options) => Promise.resolve(activeAdapter.canonicalOffers(session, options)),
      /* The three counts, each the database's own total. A count that the
         database did not return stays null and is shown as not available —
         never as zero, which would be a number this layer made up. */
      counts: (session) => Promise.all([
        activeAdapter.canonicalProducts(session, { limit: 1 }),
        activeAdapter.canonicalVariants(session, { limit: 1 }),
        activeAdapter.canonicalOffers(session, { limit: 1 })
      ]).then((results) => ({
        products: results[0] ? results[0].total : null,
        variants: results[1] ? results[1].total : null,
        offers: results[2] ? results[2].total : null
      }))
    },

    /* ---- reference data (Step 17A) ---------------------------------------
       Read-only lists an administrator chooses from. Not catalogue records and
       not private records: categories and subcategories are public data, and
       this reads the published taxonomy a visitor's page reads. There is no
       administrator view of a draft category in this project, and this
       namespace does not add one. */
    reference: {
      categoryOptions: (session) => Promise.resolve(activeAdapter.referenceCategoryOptions(session))
    },

    /* ---- reporting / metadata ------------------------------------------- */
    stats: () => Object.assign({}, SCAFFOLD.stats),
    version: () => SCAFFOLD.version,
    notice: () => SCAFFOLD.notice,
    /* ------------------------------------------------------------ wording --
       One vocabulary for describing what the interface is showing: the bundled
       demonstration catalogue, or the published catalogue served from the
       database. Copy uses it so a live page never calls live data a demo, and a
       page that fell back to the demonstration data always says so. */
    catalogue: function () {
      const live = !!(activeAdapter && activeAdapter.kind === 'api') && !fallbackActive;
      return {
        mode: live ? 'live' : 'demo',
        live: live,
        /* “the demo dataset” / “the published catalogue” */
        phrase: live ? 'the published catalogue' : 'the demo dataset',
        /* “the demo catalogue” / “the catalogue” */
        noun: live ? 'the catalogue' : 'the demo catalogue',
        /* “demo records” / “published records” */
        records: live ? 'published records' : 'demo records',
        /* “a demo listing” / “a listing” */
        listing: live ? 'a listing' : 'a demo listing'
      };
    },

    /* ---- model primitives (one import surface for the UI) --------------- */
    money: Dm.money,
    defaultCurrency: () => Dm.DEFAULT_CURRENCY,
    priceText: Dm.priceText,
    priceValue: Dm.priceValue,
    priceUnitSuffix: Dm.priceUnitSuffix,
    formatDate: Dm.formatDate,
    categoryLabel: (slug) => {
      const c = SCAFFOLD.taxonomy.find((x) => x.slug === slug || x.id === slug);
      return c ? c.label : Dm.categoryLabel(slug);
    },
    typeLabel: Dm.typeLabel,
    availabilityInfo: Dm.availabilityInfo,
    listingStatusLabel: Dm.listingStatusLabel,
    locationLabel: Dm.locationLabel,
    serviceAreaText: Dm.serviceAreaText,
    sellerLabel: Dm.sellerLabel,
    offerKindLabel: Dm.offerKindLabel,
    primaryImage: Dm.primaryImage,
    offerState: (record) => {
      const offer = record && record.offer;
      if (!offer) return { code: 'none', daysLeft: null, startsAt: null, endsAt: null };
      return {
        code: offer.status,
        daysLeft: Dm.offerDaysLeft(offer),
        startsAt: offer.startsAt,
        endsAt: offer.endsAt
      };
    },
    savingsValue: (record) => {
      const offer = record && record.offer;
      if (!offer || offer.offerPrice == null || offer.originalPrice == null) return null;
      const diff = offer.originalPrice - offer.offerPrice;
      return diff > 0 ? diff : null;
    },

    /* ---- shared engine, exposed for tests and tooling ------------------- */
    search: search,
    filter: applyFilters,
    sort: applySort,
    matchesLocation: matchesLocation,
    activeFilterCount: activeFilterCount
  };

  return store;
})();
