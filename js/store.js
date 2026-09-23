/* ==========================================================================
   PickVanta — data access layer (js/store.js)
   --------------------------------------------------------------------------
   The single boundary between the interface and whatever supplies the
   catalogue. Pages and controllers never read a data source directly; they ask
   this module, and this module decides where records come from:

       page → controller → store.js → domain.js (model) → js/data.js   (today)
       page → controller → store.js → domain.js (model) → API → DB     (later)

   Only `demoAdapter` knows that `js/data.js` exists. A backend adapter
   implements the same three methods (catalogue / guides / meta) and is handed
   to `store.use(adapter)`; nothing above this file changes.

   MODEL
     Records are normalised and validated against js/domain.js. Anything that
     cannot be a listing is excluded from every result and reported through
     `store.diagnostics()` — one malformed record never breaks the catalogue.

   LIFECYCLE
     `status` is draft | published | archived. Only *published* listings are
     readable: they are the only records that appear in results, deals, related
     options, curated selections, counts or by-id lookups.

   No DOM, no network, no user state (the compare selection and recently viewed
   lists are browser-local and live in js/core.js).
   ========================================================================== */
window.PV = window.PV || {};

window.PV.store = (function () {
  'use strict';

  const Dm = window.PV.domain;
  if (!Dm) throw new Error('PickVanta: js/domain.js must load before js/store.js');

  /* ---------------------------------------------------------- adapter ---- */
  const demoAdapter = {
    kind: 'demo',
    isAsync: false,
    catalogue: function () {
      const data = window.PICKVANTA_DATA || {};
      return {
        taxonomy: Dm.asArray(data.taxonomy),
        locations: Dm.asArray(data.locations),
        sellers: Dm.asArray(data.sellers),
        listings: Dm.asArray(data.listings),
        offers: Dm.asArray(data.offers),
        guides: Dm.asArray(data.guides)
      };
    },
    meta: function () {
      return window.PICKVANTA_DATA || {};
    }
  };

  let adapter = demoAdapter;

  /* ------------------------------------------------------- diagnostics --- */
  /* Every problem found while reading the source is collected here — never
     thrown, never rendered. `store.diagnostics()` exposes the list. */
  let diagnostics = [];
  const note = (severity, code, message, ref) => {
    diagnostics.push({ severity: severity, code: code, message: message, ref: ref || null });
  };
  const collect = (ref, issues) => {
    Dm.asArray(issues).forEach((i) => note(i.severity, i.code, i.message, i.ref || ref || null));
  };

  /* ------------------------------------------------------------- load ---- */
  let TAXONOMY = [];
  let LOCATIONS = [];
  let ALL_LISTINGS = [];       /* every parsed listing, whatever its status   */
  let LISTINGS = [];           /* published listings — the readable catalogue */
  let OFFERS = [];
  let GUIDES = [];
  let META = {};
  const listingById = new Map();
  const offerById = new Map();
  const guideById = new Map();

  function load() {
    diagnostics = [];
    const raw = adapter.catalogue() || {};
    META = adapter.meta() || {};

    /* ---- taxonomy (categories + subcategories) -------------------------- */
    TAXONOMY = Dm.asArray(raw.taxonomy).map(Dm.normalizeCategory).filter((c) => !!c.slug);
    collect(null, Dm.validateTaxonomy(TAXONOMY).issues);

    /* ---- locations ------------------------------------------------------ */
    LOCATIONS = Dm.asArray(raw.locations)
      .map((l, idx) => ({
        id: Dm.trim(l && l.id) || 'loc-' + (idx + 1),
        label: Dm.trim(l && l.label) || Dm.trim(l && l.city) || 'Unnamed place',
        city: Dm.trim(l && l.city),
        county: Dm.trim(l && l.county),
        country: Dm.trim(l && l.country),
        format: Dm.LOCATION_FORMATS.indexOf(Dm.trim(l && l.format)) !== -1 ? Dm.trim(l && l.format) : 'unspecified'
      }))
      .filter((l) => !!l.id);

    /* ---- sellers -------------------------------------------------------- */
    const sellerIds = [];
    const sellerById = new Map();
    const sellerRecords = Dm.asArray(raw.sellers).map(function (s) {
      const seller = Dm.normalizeSeller(s, TAXONOMY);
      collect(seller.id, Dm.validateSeller(seller).issues);
      if (sellerIds.indexOf(seller.id) === -1) sellerIds.push(seller.id);
      sellerById.set(seller.id, seller);
      return seller;
    }).filter((s) => {
      if (s.status !== 'published') {
        note('info', 'seller-unpublished', 'Seller "' + s.id + '" is not published, so its listings keep no reference.', s.id);
        return false;
      }
      return true;
    });

    /* ---- listings ------------------------------------------------------- */
    ALL_LISTINGS = [];
    const listingIds = [];
    const seenIds = new Set();
    Dm.asArray(raw.listings).forEach(function (r) {
      const result = Dm.normalizeListing(r, { taxonomy: TAXONOMY, sellerIds: sellerIds });
      collect(r && r.id, result.issues);
      if (!result.listing) return;
      const validation = Dm.validateListing(result.listing);
      collect(result.listing.id, validation.issues);
      if (!validation.valid) {
        note('error', 'listing-rejected', 'Listing "' + (result.listing.id || '(no id)') + '" was rejected because it is not usable.', result.listing.id || null);
        return;
      }
      if (seenIds.has(result.listing.id)) {
        note('error', 'listing-duplicate-id', 'Listing id "' + result.listing.id + '" appears more than once; the later record was ignored.', result.listing.id);
        return;
      }
      seenIds.add(result.listing.id);
      listingIds.push(result.listing.id);
      ALL_LISTINGS.push(result.listing);
    });

    /* ---- offers (each one references its listing) ------------------------ */
    OFFERS = [];
    const seenOffers = new Set();
    Dm.asArray(raw.offers).forEach(function (o) {
      const result = Dm.normalizeOffer(o, {
        listingIds: listingIds,
        currency: Dm.DEFAULT_CURRENCY,
        sellerId: ''
      });
      collect(o && o.id, result.issues);
      if (!result.offer) return;
      const validation = Dm.validateOffer(result.offer, listingIds);
      collect(result.offer.id, validation.issues);
      if (!validation.valid) {
        note('error', 'offer-rejected', 'Offer "' + (result.offer.id || '(no id)') + '" was rejected.', result.offer.id || null);
        return;
      }
      if (seenOffers.has(result.offer.id)) {
        note('error', 'offer-duplicate-id', 'Offer id "' + result.offer.id + '" appears more than once.', result.offer.id);
        return;
      }
      seenOffers.add(result.offer.id);
      OFFERS.push(result.offer);
    });

    /* ---- join the provider onto each listing (a join, not duplication) --- */
    ALL_LISTINGS.forEach(function (listing) {
      listing.seller = listing.sellerId ? sellerById.get(listing.sellerId) || null : null;
    });

    /* ---- join offers onto listings (a join, not stored duplication) ------ */
    const byListing = new Map();
    OFFERS.forEach(function (offer) {
      const listing = ALL_LISTINGS.find((l) => l.id === offer.listingId);
      if (listing) offer.sellerId = offer.sellerId || listing.sellerId;
      if (!byListing.has(offer.listingId) || offer.status === 'active') byListing.set(offer.listingId, offer);
    });
    ALL_LISTINGS.forEach(function (listing) {
      const offer = byListing.get(listing.id) || null;
      listing.offer = offer;
      listing.offerId = offer ? offer.id : null;
    });
    OFFERS.forEach(function (offer) {
      if (!byListing.has(offer.listingId) || byListing.get(offer.listingId).id !== offer.id) {
        note('info', 'offer-not-attached', 'Offer "' + offer.id + '" is not the active offer shown for its listing.', offer.id);
      }
    });

    /* ---- guides --------------------------------------------------------- */
    GUIDES = [];
    Dm.asArray(raw.guides).forEach(function (g) {
      const result = Dm.normalizeGuide(g, { listingIds: listingIds });
      collect(g && g.id, result.issues);
      if (!result.guide) return;
      collect(result.guide.id, Dm.validateGuide(result.guide).issues);
      GUIDES.push(result.guide);
    });

    /* ---- config references must point at real taxonomy ------------------- */
    const configKeyed = Object.keys(META.considerations || {})
      .concat(Object.keys(META.goodToKnow || {}))
      .concat(Object.keys(META.compareGroups || {}));
    collect(null, Dm.validateConfigReferences(TAXONOMY, configKeyed).issues);

    /* ---- readable catalogue: published listings only --------------------- */
    LISTINGS = ALL_LISTINGS.filter((l) => l.status === 'published');
    const hidden = ALL_LISTINGS.length - LISTINGS.length;
    if (hidden) note('info', 'listings-hidden', hidden + ' listing(s) are not published and stay out of every view.');

    listingById.clear();
    LISTINGS.forEach((l) => listingById.set(l.id, l));
    offerById.clear();
    OFFERS.forEach((o) => offerById.set(o.id, o));
    guideById.clear();
    GUIDES.forEach((g) => guideById.set(g.id, g));

    /* ---- version / notice ------------------------------------------------ */
    /* Payload-level metadata is accepted as well as an adapter meta() block,
       so an API can report its own version and notice with the data. */
    META = Object.assign({}, META, {
      version: Dm.trim(META.version) || Dm.trim(raw.version) || 'demo',
      notice: Dm.trim(META.demoNotice) || Dm.trim(raw.demoNotice) || 'Demonstration data only.',
      priceBands: Dm.asArray(META.priceBands),
      sortOptions: Dm.asArray(META.sortOptions),
      compareFocus: Dm.asArray(META.compareFocus),
      compareGroups: META.compareGroups || {},
      considerations: META.considerations || {},
      goodToKnow: META.goodToKnow || {},
      needs: Dm.asArray(META.needs),
      popularTags: Dm.asArray(META.popularTags),
      defaultCompareIds: Dm.asArray(META.defaultCompareIds),
      homeFeaturedIds: Dm.asArray(META.homeFeaturedIds),
      homeDealIds: Dm.asArray(META.homeDealIds),
      homeGuideIds: Dm.asArray(META.homeGuideIds)
    });

    return { listings: LISTINGS.length, offers: OFFERS.length, guides: GUIDES.length };
  }

  load();

  /* ------------------------------------------------------------- API ----- */
  /* The stable surface the pages use today and an API will satisfy tomorrow.
     Every listing-returning call returns normalised, published listings only. */
  const store = {
    /* ---- adapter boundary ------------------------------------------------ */
    source: () => adapter.kind,
    isAsync: () => !!adapter.isAsync,
    use(nextAdapter) {
      if (!nextAdapter || typeof nextAdapter.catalogue !== 'function') return false;
      adapter = Object.assign({ kind: 'custom', isAsync: false, meta: () => ({}) }, nextAdapter);
      load();
      return true;
    },
    reload: load,
    diagnostics: () => diagnostics.slice(),

    /* ---- the documented API contract ------------------------------------ */
    /** getListings({ page, pageSize, …filters }) → the paged envelope. */
    getListings: (params) => store.query(params),
    /** getListing(id) → one published listing, or null. */
    getListing: (id) => {
      const key = Dm.trim(id);
      return key && listingById.has(key) ? listingById.get(key) : null;
    },
    /** searchListings(query, { page, pageSize }) → the paged envelope. */
    searchListings: (query, params) => store.query(Object.assign({}, params || {}, { q: Dm.trim(query) })),
    /** filterListings(filters) → the paged envelope. */
    filterListings: (filters) => store.query(filters),
    /** getCategories() → the taxonomy. */
    getCategories: () => TAXONOMY.slice(),
    /** getSubcategories(categorySlug?) → canonical subcategories. */
    getSubcategories: (category) => store.subcategories(category).map((id) => {
      const found = Dm.findSubcategory(TAXONOMY, category, id);
      return found || { id: id, slug: id, label: id, category: category || '' };
    }),
    /** getDeals() → published listings that carry a live offer. */
    getDeals: () => store.deals(),
    /** getDeal(id) → one offer with its listing attached, or null. */
    getDeal: (id) => {
      const offer = offerById.get(Dm.trim(id));
      if (!offer) return null;
      const listing = store.getListing(offer.listingId);
      return listing ? Object.assign({}, offer, { listing: listing }) : null;
    },
    getGuides: () => GUIDES.slice(),
    getGuide: (id) => guideById.get(Dm.trim(id)) || null,
    /** getRelatedListings(id, limit) → deterministic matches with reasons. */
    getRelatedListings: (id, limit) => {
      const listing = store.getListing(id);
      return listing ? store.related(listing, limit) : [];
    },
    /** getListingsBySeller(sellerId) → everything a provider publishes here. */
    getListingsBySeller: (sellerId) => {
      const key = Dm.trim(sellerId);
      return key ? LISTINGS.filter((l) => l.sellerId === key) : [];
    },
    getSellers: () => store.sellers(),
    getSeller: (id) => store.sellers().find((s) => s.id === Dm.trim(id)) || null,

    /* ---- catalogue ------------------------------------------------------- */
    all: () => LISTINGS.slice(),
    item: (id) => store.getListing(id),
    items: (ids) => Dm.asArray(ids).map((id) => store.getListing(id)).filter(Boolean),
    byCategory: (slug) => LISTINGS.filter((l) => l.category === slug),
    /* Accepts the canonical subcategory id or its display label. */
    bySubcategory: (value) => {
      const key = Dm.trim(value).toLowerCase();
      return LISTINGS.filter((l) => l.subcategory.toLowerCase() === key || Dm.slugify(l.subcategory) === key);
    },
    byType: (type) => LISTINGS.filter((l) => l.type === type),
    byTag: (tag) => LISTINGS.filter((l) => l.tags.indexOf(Dm.trim(tag).toLowerCase()) !== -1),
    dataset: (name) => (name === 'deals' ? store.deals() : store.all()),

    /* ---- taxonomy -------------------------------------------------------- */
    categories: () => TAXONOMY.slice(),
    category: (slug) => TAXONOMY.find((c) => c.slug === slug || c.id === slug) || null,
    /* Subcategory values are canonical ids; labels come from the taxonomy so a
       name is never duplicated in two places. */
    subcategories: (category) => {
      const out = [];
      LISTINGS.forEach((l) => {
        if (!l.subcategory) return;
        if (category && category !== 'all' && l.category !== category) return;
        if (out.indexOf(l.subcategory) === -1) out.push(l.subcategory);
      });
      return out.sort((a, b) => store.subcategoryLabel(a).localeCompare(store.subcategoryLabel(b)));
    },
    subcategoryLabel: (value) => {
      const found = Dm.findSubcategory(TAXONOMY, null, value);
      return found ? found.label : Dm.titleCase(Dm.str(value));
    },
    locations: () => LOCATIONS.slice(),
    /* Filter vocabulary for locations: 'online' plus one entry per place. */
    locationOptions: () => {
      const options = [{ code: 'any', label: 'All locations' }, { code: 'online', label: 'Online / nationwide' }];
      LOCATIONS.filter((l) => l.format === 'local' && l.city).forEach((l) => options.push({ code: Dm.slugify(l.city), label: l.label }));
      return options;
    },
    tags: () => {
      const map = new Map();
      LISTINGS.forEach((l) => l.tags.forEach((t) => map.set(t, (map.get(t) || 0) + 1)));
      return [...map.entries()]
        .map(([tag, count]) => ({ tag: tag, label: store.tagLabel(tag), count: count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    },
    tagExists: (tag) => !!Dm.trim(tag) && LISTINGS.some((l) => l.tags.indexOf(Dm.trim(tag).toLowerCase()) !== -1),
    tagLabel: (tag) => Dm.str(tag).replace(/-/g, ' '),
    popularTags: () => META.popularTags.slice(),

    /* ---- filters vocabulary --------------------------------------------- */
    priceBands: () => META.priceBands.map((b) => ({ code: b.code, label: store.priceBandLabel(b), min: b.min, max: b.max })),
    priceBandLabel: (band) => {
      const b = band || {};
      if (b.min == null && b.max == null) return 'Any price';
      if (b.min == null) return 'Under ' + Dm.money(b.max, Dm.DEFAULT_CURRENCY);
      if (b.max == null) return Dm.money(b.min, Dm.DEFAULT_CURRENCY) + ' and above';
      return Dm.money(b.min, Dm.DEFAULT_CURRENCY) + ' – ' + Dm.money(b.max, Dm.DEFAULT_CURRENCY);
    },
    sortOptions: () => META.sortOptions.slice(),
    availabilityOptions: () => Dm.AVAILABILITY.slice(),
    listingStatuses: () => Dm.LISTING_STATUS.slice(),
    types: () => Dm.LISTING_TYPES.map((t) => ({ code: t, label: Dm.typeLabel(t) })),

    /* ---- guides ---------------------------------------------------------- */
    guides: () => GUIDES.filter((g) => g.status === 'published'),
    guide: (id) => {
      const found = guideById.get(Dm.trim(id));
      return found && found.status === 'published' ? found : null;
    },
    /* Guides list decision-support copy; listings they point at are always
       resolved through the store so a stale reference cannot break a page. */
    guideListings: (guide) => Dm.asArray(guide && guide.relatedListingIds).map((id) => store.getListing(id)).filter(Boolean),

    /* ---- offers ---------------------------------------------------------- */
    /* Offer → underlying listing → details. `listing` is always attached. */
    offers: () => OFFERS
      .filter((o) => !!store.getListing(o.listingId) && o.status !== 'withdrawn')
      .map((o) => Object.assign({}, o, { listing: store.getListing(o.listingId) })),
    offer: (id) => store.getDeal(id),
    offerFor: (listingId) => {
      const listing = store.getListing(listingId);
      return listing && listing.offer ? listing.offer : null;
    },
    deals: () => LISTINGS.filter((l) => !!l.offer && l.offer.status === 'active' || !!l.offer && l.offer.status === 'scheduled'),

    /* ---- curated selections --------------------------------------------- */
    home: () => {
      const pick = (ids, fallback, limit) => {
        const chosen = ids.length ? store.items(ids) : [];
        return (chosen.length ? chosen : fallback()).slice(0, limit);
      };
      return {
        featured: pick(META.homeFeaturedIds, () => store.all(), 8),
        deals: pick(META.homeDealIds, () => store.deals(), 3),
        guides: pick(META.homeGuideIds, () => store.guides(), 3)
      };
    },
    defaultCompareIds: () => META.defaultCompareIds.slice(),

    /* ---- decision support ------------------------------------------------ */
    considerations: (record) => {
      if (!record) return null;
      const key = record.category + ':' + store.subcategoryLabel(record.subcategory);
      const byLabel = record.category + ':' + Dm.titleCase(Dm.str(record.subcategory));
      return META.considerations[key] || META.considerations[byLabel] || META.considerations[record.category] || null;
    },
    goodToKnow: (record) => {
      if (!record) return [];
      const key = record.category + ':' + store.subcategoryLabel(record.subcategory);
      const byLabel = record.category + ':' + Dm.titleCase(Dm.str(record.subcategory));
      return META.goodToKnow[key] || META.goodToKnow[byLabel] || META.goodToKnow[record.category] || [];
    },
    compareConfig: (category) => META.compareGroups[category] || null,
    compareFocusAreas: () => META.compareFocus.slice(),
    focusArea: (code) => META.compareFocus.find((f) => f.code === code) || null,
    needs: () => META.needs.slice(),
    related: (item, limit) => relatedFor(item, limit),

    /* ---- seller references ---------------------------------------------- */
    /* Sellers with at least one published listing, so a dead reference is
       never offered in the UI. */
    sellers: () => {
      const ids = [...new Set(LISTINGS.map((l) => l.sellerId).filter(Boolean))];
      return Dm.asArray(adapter.catalogue().sellers)
        .map((s) => Dm.normalizeSeller(s, TAXONOMY))
        .filter((s) => ids.indexOf(s.id) !== -1)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    /* ---- reporting ------------------------------------------------------- */
    stats: () => ({
      listings: LISTINGS.length,
      products: LISTINGS.filter((l) => l.type === 'product').length,
      services: LISTINGS.filter((l) => l.type === 'service').length,
      categories: TAXONOMY.length,
      subcategories: store.subcategories('all').length,
      tags: store.tags().length,
      sellers: store.sellers().length,
      locations: LOCATIONS.filter((l) => l.format === 'local' && l.city).length,
      guides: store.guides().length,
      offers: store.deals().length,
      hidden: ALL_LISTINGS.length - LISTINGS.length
    }),
    notice: () => META.notice,
    version: () => META.version,

    /* ---- model primitives (re-exported so the UI has one import surface) -- */
    money: Dm.money,
    defaultCurrency: () => Dm.DEFAULT_CURRENCY,
    priceText: Dm.priceText,
    priceValue: Dm.priceValue,
    priceUnitSuffix: Dm.priceUnitSuffix,
    categoryLabel: (slug) => {
      const c = TAXONOMY.find((x) => x.slug === slug);
      return c ? c.label : Dm.categoryLabel(slug);
    },
    typeLabel: Dm.typeLabel,
    availabilityInfo: Dm.availabilityInfo,
    listingStatusLabel: Dm.listingStatusLabel,
    locationLabel: Dm.locationLabel,
    serviceAreaText: Dm.serviceAreaText,
    sellerLabel: Dm.sellerLabel,
    offerKindLabel: Dm.offerKindLabel,
    formatDate: Dm.formatDate,
    primaryImage: Dm.primaryImage,
    /* Offer window as data; the UI adds the wording. */
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
    }
  };

  /* ------------------------------------------------------------- search -- */
  /* One search implementation for the whole application. Filler words carry no
     filtering value; a few everyday words map onto catalogue vocabulary; the
     match itself is word-prefix based over the record's own fields. */
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

  /** Search fields come from the domain model — including the structured ones. */
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
    const pool = Array.isArray(list) ? list : LISTINGS;
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
        if (tokens[key].some((t) => t.indexOf(term) === 0)) return weight;          // word prefix
        if (tokens[key].some((t) => t.indexOf(term) !== -1)) return weight - 1;     // inside a word
        if (fields[key].indexOf(term) !== -1) return Math.max(1, weight - 2);      // spans words
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

  /* ------------------------------------------------------------ filtering - */
  /* Location filtering matches the listing's own place: online, nationwide or a
     city/county. Service areas are visible detail, not a location claim. */
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

    if (f.band && f.band !== 'any') {
      const band = META.priceBands.find((b) => b.code === f.band);
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

  /* --------------------------------------------------------------- sorting */
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

  /* --------------------------------------------------------------- related */
  const midPrice = (record) => Dm.priceValue(record) === Number.MAX_SAFE_INTEGER ? null : Dm.priceValue(record);

  /** Deterministic matches with human reasons — never a ranking or a score. */
  function relatedFor(item, limit) {
    if (!item) return [];
    const max = limit || 4;
    const mine = midPrice(item);
    const scored = [];

    LISTINGS.forEach((r) => {
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

  /* ----------------------------------------------------------- query API -- */
  /**
   * The one call listing pages make. Returns the envelope a future API returns:
   *   { ok, items, total, page, pageSize, hasNext, hasPrev, error }
   */
  function query(state, opts) {
    const s = state || {};
    const o = opts || {};
    const empty = { ok: false, items: [], total: 0, page: 1, pageSize: 0, hasNext: false, hasPrev: false, error: null };
    try {
      if (s.page != null) {
        const p = parseInt(s.page, 10);
        if (!Number.isFinite(p) || p < 1) note('warning', 'invalid-page-ignored', 'Ignored an invalid page value ("' + s.page + '").');
      }
      const pool = store.dataset(o.dataset);
      let list = applyFilters(pool, s);
      list = applySort(list, s.sort, s.q);
      const total = list.length;
      const size = Number.isFinite(Number(s.pageSize)) && Number(s.pageSize) > 0 ? Number(s.pageSize) : null;
      const page = Math.max(1, parseInt(s.page, 10) || 1);
      const pageCount = size ? Math.max(1, Math.ceil(total / size)) : 1;
      const current = Math.min(page, pageCount);
      const items = size ? list.slice((current - 1) * size, current * size) : list;
      return {
        ok: true,
        items: items,
        total: total,
        page: current,
        pageSize: size || total,
        hasNext: size ? current * size < total : false,
        hasPrev: current > 1,
        error: null
      };
    } catch (err) {
      /* Never fail silently: the caller always gets an envelope it can render. */
      const message = err && err.message ? err.message : 'The catalogue could not be read.';
      note('error', 'query-failed', message);
      return Object.assign({}, empty, { error: message });
    }
  }

  /* -------------------------------------------------------- typeahead ----- */
  function suggest(query, limit) {
    const q = Dm.trim(query).toLowerCase();
    const max = limit || 6;
    if (!q) return TAXONOMY.slice(0, 4).map((c) => ({ label: c.label, meta: 'Category', href: 'discover.html?category=' + c.slug, icon: c.icon }));

    const out = [];
    const push = (row) => {
      if (out.length < max && !out.some((r) => r.label.toLowerCase() === row.label.toLowerCase())) out.push(row);
    };

    search(q, LISTINGS).slice(0, 3).forEach((r) => push({
      label: r.name,
      meta: Dm.typeLabel(r.type) + ' · ' + store.categoryLabel(r.category),
      href: 'detail.html?id=' + encodeURIComponent(r.id),
      icon: (Dm.primaryImage(r) || {}).icon
    }));
    TAXONOMY.filter((c) => c.label.toLowerCase().indexOf(q) !== -1).forEach((c) => push({ label: c.label, meta: 'Category', href: 'discover.html?category=' + c.slug, icon: c.icon }));
    store.sellers().filter((s) => s.name.toLowerCase().indexOf(q) !== -1).slice(0, 2)
      .forEach((s) => push({ label: s.name, meta: s.typeLabel, href: 'discover.html?q=' + encodeURIComponent(s.name), icon: '🏬' }));
    store.guides().filter((g) => g.title.toLowerCase().indexOf(q) !== -1).slice(0, 2)
      .forEach((g) => push({ label: g.title, meta: 'Guide outline', href: 'guides.html?q=' + encodeURIComponent(g.title), icon: g.icon }));
    return out.slice(0, max);
  }

  Object.assign(store, {
    search: search,
    filter: applyFilters,
    sort: applySort,
    query: query,
    suggest: suggest,
    activeFilterCount: activeFilterCount,
    matchesLocation: matchesLocation
  });

  return store;
})();
