/* ==========================================================================
   PickVanta — data access layer (js/store.js)
   --------------------------------------------------------------------------
   The single boundary between the interface and whatever is supplying the
   catalogue. Pages and controllers never read the demo dataset directly; they
   ask this module for records, and this module decides where they come from:

       page → controller → PV.store → js/data.js   (today, synchronous demo data)
       page → controller → PV.store → API → DB     (later, asynchronous)

   Only `demoAdapter` below knows that `js/data.js` exists. To move to a real
   backend, write another adapter with the same five methods and hand it to
   `store.use(adapter)` — nothing above this file has to change.

   Everything here is deterministic: no scoring, no ranking, no recommendation.
   ========================================================================== */
window.PV = window.PV || {};

window.PV.store = (function () {
  'use strict';

  /* ---------------------------------------------------------- adapter ---- */
  /* The demo adapter reads the global that js/data.js publishes. An API
     adapter would fetch the same shapes; `isAsync: true` tells the UI to show
     its loading state while it waits. */
  const demoAdapter = {
    kind: 'demo',
    isAsync: false,
    catalogue: function () {
      const data = window.PICKVANTA_DATA || {};
      return Array.isArray(data.items) ? data.items : [];
    },
    guides: function () {
      const data = window.PICKVANTA_DATA || {};
      return Array.isArray(data.guides) ? data.guides : [];
    },
    meta: function () {
      return window.PICKVANTA_DATA || {};
    }
  };

  let adapter = demoAdapter;

  /* ------------------------------------------------------- diagnostics --- */
  /* Records that could not be normalised are reported here instead of being
     silently dropped or rendered as "undefined". Nothing in the UI shows this;
     it exists so problems are visible rather than hidden. */
  let diagnostics = [];
  const note = (kind, detail) => diagnostics.push({ kind: kind, detail: detail });

  /* ---------------------------------------------------------- helpers ---- */
  const str = (value) => (value == null ? '' : String(value));
  const trim = (value) => str(value).trim();
  const asArray = (value) => (Array.isArray(value) ? value : []);

  /** Stable, human-readable id derived from a name — the future foreign key. */
  const slug = (value, prefix) =>
    (prefix || '') + str(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  const CURRENCY_SYMBOL = { KES: 'KSh ', EUR: '€', USD: '$', GBP: '£' };
  const UNIT_LABEL = {
    month: 'month', night: 'night', year: 'year', visit: 'visit',
    session: 'session', lesson: 'lesson', day: 'day', hour: 'hour', week: 'week', person: 'person'
  };
  const DEAL_KIND_LABEL = {
    percentage: 'Percentage discount',
    'fixed-price': 'Fixed-price offer',
    package: 'Service package',
    bundle: 'Bundle offer',
    limited: 'Limited-time offer',
    billing: 'Billing discount',
    introductory: 'Introductory price'
  };
  const TYPE_LABEL = { product: 'Product', service: 'Service' };
  const FALLBACK_STATUSES = [
    { code: 'available', label: 'Available', tone: 'ok', help: '' },
    { code: 'by-appointment', label: 'By appointment', tone: 'info', help: '' },
    { code: 'limited', label: 'Limited', tone: 'warn', help: '' },
    { code: 'unavailable', label: 'Unavailable', tone: 'muted', help: '' }
  ];

  const humanise = (code) => trim(code).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  /* ------------------------------------------------------- normalising --- */
  /* The catalogue model. Optional blocks are filled with safe defaults so the
     UI never has to test for their absence, and no field can render as
     undefined/null/NaN. */
  function normalizePrice(price) {
    const p = price && typeof price === 'object' ? price : {};
    const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
    return {
      amount: num(p.amount),
      min: num(p.min),
      max: num(p.max),
      currency: trim(p.currency) || 'KES',
      unit: trim(p.unit) || null
    };
  }

  function normalizeSeller(seller) {
    const s = seller && typeof seller === 'object' ? seller : {};
    const name = trim(s.name) || 'Demo seller';
    if (!trim(s.name)) note('seller-name-missing', name);
    return {
      id: trim(s.id) || slug(name, 'seller-'),
      name: name,
      type: trim(s.type) || (s.id ? 'Provider' : 'Demo seller'),
      rating: typeof s.rating === 'number' ? s.rating : null,
      verified: !!s.verified,
      demo: true
    };
  }

  function normalizeLocation(location) {
    const l = location && typeof location === 'object' ? location : {};
    return {
      city: trim(l.city) || 'Location not stated',
      country: trim(l.country) || '',
      format: trim(l.format) || 'unspecified'
    };
  }

  function normalizeImage(image, name) {
    const i = image && typeof image === 'object' ? image : {};
    return {
      icon: trim(i.icon) || '📦',
      gradient: trim(i.gradient) || '',
      /* A remote URL is optional: the UI renders an <img> when one exists and
         falls back to the icon tile (or the local placeholder) when it does
         not load. No image service is involved. */
      src: trim(i.src) || null,
      alt: trim(i.alt) || trim(name) || 'Listing image'
    };
  }

  function normalizeAttributes(attributes) {
    return asArray(attributes)
      .map((a) => ({
        label: trim(a && a.label),
        value: trim(a && a.value),
        group: trim(a && a.group) || 'Specifications'
      }))
      .filter((a) => a.label && a.value);
  }

  /* Deals stay attached to their item — an offer is never a second product.
     The normalised offer carries the ids a real API will need later. */
  function normalizeOffer(deal, item) {
    if (!deal || typeof deal !== 'object') return null;
    const dealPrice = deal.dealPrice == null ? null : Number(deal.dealPrice);
    const referencePrice = deal.referencePrice == null ? null : Number(deal.referencePrice);
    const derived = dealPrice != null && referencePrice ? Math.round(((referencePrice - dealPrice) / referencePrice) * 100) : 0;
    return {
      id: trim(deal.id) || 'offer-' + item.id,
      itemId: item.id,
      kind: trim(deal.kind) || 'offer',
      headline: trim(deal.headline),
      dealPrice: dealPrice,
      referencePrice: referencePrice,
      discountPercent: Number.isFinite(Number(deal.discountPercent)) && deal.discountPercent != null ? Number(deal.discountPercent) : derived,
      currency: (item.price && item.price.currency) || 'KES',
      validFrom: trim(deal.validFrom) || null,
      validTo: trim(deal.validTo) || null,
      conditions: asArray(deal.conditions).map(trim).filter(Boolean),
      sellerId: item.sellerId,
      location: item.location,
      status: trim(deal.status) || null,
      demo: true
    };
  }

  /**
   * One normalised catalogue record. Unknown extra fields are preserved so a
   * future API can add to the model without breaking older pages.
   */
  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') {
      note('record-not-an-object', String(raw));
      return null;
    }
    const id = trim(raw.id);
    const name = trim(raw.name);
    if (!id || !name) {
      note('record-missing-id-or-name', id || name || '(unnamed)');
      return null;
    }
    /* type is explicit data, never inferred from a name or category. A record
       that states neither is treated as a product and reported. */
    let type = trim(raw.type);
    if (type !== 'product' && type !== 'service') {
      note('record-type-missing-or-invalid', id + ' → ' + (type || '(none)'));
      type = 'product';
    }
    const seller = normalizeSeller(raw.seller);
    const item = Object.assign({}, raw, {
      id: id,
      name: name,
      type: type,
      brand: trim(raw.brand),
      category: trim(raw.category) || 'uncategorised',
      subcategory: trim(raw.subcategory),
      shortDescription: trim(raw.shortDescription),
      description: trim(raw.description) || trim(raw.shortDescription),
      price: normalizePrice(raw.price),
      referencePrice: raw.referencePrice == null ? null : Number(raw.referencePrice),
      location: normalizeLocation(raw.location),
      seller: seller,
      /* Future seller/provider accounts will reference these ids. */
      sellerId: seller.id,
      image: normalizeImage(raw.image, name),
      attributes: normalizeAttributes(raw.attributes),
      tags: asArray(raw.tags).map((t) => trim(t).toLowerCase()).filter(Boolean),
      highlights: asArray(raw.highlights).map(trim).filter(Boolean),
      status: trim(raw.status) || 'available',
      listedAt: trim(raw.listedAt) || null,
      badge: raw.badge && raw.badge.label ? { label: trim(raw.badge.label), tone: trim(raw.badge.tone) || 'neutral' } : null,
      rating: raw.rating && typeof raw.rating.value === 'number' ? { value: raw.rating.value, count: raw.rating.count || 0, demo: true } : null
    });
    item.deal = normalizeOffer(raw.deal, item);
    /* A record may name a type that disagrees with its category list; that is
       the dataset's business, not an inference here — it is reported only so a
       swapped-in API is easy to check. */
    return item;
  }

  function normalizeGuide(raw) {
    if (!raw || typeof raw !== 'object') {
      note('guide-not-an-object', String(raw));
      return null;
    }
    const id = trim(raw.id);
    const title = trim(raw.title);
    if (!id || !title) {
      note('guide-missing-id-or-title', id || title || '(untitled)');
      return null;
    }
    const link = raw.link && trim(raw.link.href) ? { label: trim(raw.link.label) || 'Explore the catalogue', href: trim(raw.link.href) } : null;
    return Object.assign({}, raw, {
      id: id,
      title: title,
      question: trim(raw.question),
      category: trim(raw.category) || 'guides',
      icon: trim(raw.icon) || '📘',
      summary: trim(raw.summary),
      readTime: trim(raw.readTime) || 'Outline',
      level: trim(raw.level) || 'All levels',
      covers: asArray(raw.covers).map(trim).filter(Boolean),
      link: link
    });
  }

  /* ------------------------------------------------------------ loading -- */
  /* Reads the adapter once and normalises everything. `store.use(other)` and
     `store.reload()` exist so an API adapter can drop in without a rewrite. */
  let CATALOGUE = [];
  let GUIDES = [];
  let META = {};
  let byId = new Map();

  function load() {
    diagnostics = [];
    const rawItems = adapter.catalogue();
    const rawGuides = adapter.guides();
    const rawMeta = adapter.meta() || {};
    const seen = new Set();

    CATALOGUE = [];
    asArray(rawItems).forEach(function (raw) {
      const item = normalizeItem(raw);
      if (!item) return;
      if (seen.has(item.id)) {
        note('duplicate-record-id', item.id);
        return;
      }
      seen.add(item.id);
      CATALOGUE.push(item);
    });
    byId = new Map(CATALOGUE.map((i) => [i.id, i]));

    GUIDES = asArray(rawGuides).map(normalizeGuide).filter(Boolean);

    META = {
      version: trim(rawMeta.version) || 'demo',
      notice: trim(rawMeta.demoNotice) || 'Demonstration data only.',
      priceBands: asArray(rawMeta.priceBands),
      sortOptions: asArray(rawMeta.sortOptions),
      locationOptions: asArray(rawMeta.locationOptions),
      considerations: rawMeta.considerations || {},
      goodToKnow: rawMeta.goodToKnow || {},
      compareGroups: rawMeta.compareGroups || {},
      compareFocus: asArray(rawMeta.compareFocus),
      needs: asArray(rawMeta.needs),
      popularTags: asArray(rawMeta.popularTags),
      defaultCompareIds: asArray(rawMeta.defaultCompareIds),
      homeFeaturedIds: asArray(rawMeta.homeFeaturedIds),
      homeDealIds: asArray(rawMeta.homeDealIds),
      homeGuideIds: asArray(rawMeta.homeGuideIds),
      statuses: asArray(rawMeta.statuses),
      types: asArray(rawMeta.types)
    };

    /* Categories and subcategories are derived from the records themselves when
       the source does not supply them, so an API that only returns records
       still produces a working taxonomy. */
    const declared = asArray(rawMeta.categories);
    const derived = [];
    CATALOGUE.forEach(function (i) {
      if (i.category === 'uncategorised') return;
      if (derived.some((c) => c.slug === i.category)) return;
      derived.push({ slug: i.category, label: humanise(i.category), icon: '📦', blurb: '' });
    });
    META.categories = declared.length ? declared : derived;
    if (!declared.length && derived.length) note('taxonomy-derived-from-records', derived.length + ' categories');

    return { items: CATALOGUE.length, guides: GUIDES.length };
  }

  load();

  /* ------------------------------------------------------------- store --- */
  const store = {
    /* ---- adapter boundary ------------------------------------------------ */
    /** Which source is in use ('demo' today, 'api' later). */
    source: () => adapter.kind,
    /** True when the source needs to be awaited (an API adapter sets this). */
    isAsync: () => !!adapter.isAsync,
    /** Swap in another adapter and re-read. The only hook a backend needs. */
    use(nextAdapter) {
      if (!nextAdapter || typeof nextAdapter.catalogue !== 'function') return false;
      adapter = Object.assign({ kind: 'custom', isAsync: false, guides: () => [], meta: () => ({}) }, nextAdapter);
      load();
      return true;
    },
    reload: load,
    /** Normalisation problems found while reading the source (never rendered). */
    diagnostics: () => diagnostics.slice(),
    /** Normalise a single raw record the same way the adapter does. */
    normalize: normalizeItem,

    /* ---- catalogue ------------------------------------------------------- */
    all: () => CATALOGUE.slice(),
    item: (id) => (id && byId.has(String(id)) ? byId.get(String(id)) : null),
    has: (id) => !!(id && byId.has(String(id))),  /* used by the compare/recent stores' id validation */
    items: (ids) => asArray(ids).map((id) => store.item(id)).filter(Boolean),
    byCategory: (slug) => CATALOGUE.filter((i) => i.category === slug),
    bySubcategory: (name) => CATALOGUE.filter((i) => i.subcategory === name),
    byType: (type) => CATALOGUE.filter((i) => i.type === type),
    byTag: (tag) => CATALOGUE.filter((i) => (i.tags || []).indexOf(tag) !== -1),
    /* The two listing datasets. Discover uses the catalogue, Deals the offers. */
    dataset: (name) => (name === 'deals' ? store.deals() : store.all()),

    /* ---- guides ---------------------------------------------------------- */
    guides: () => GUIDES.slice(),
    guide: (id) => GUIDES.find((g) => g.id === id) || null,

    /* ---- taxonomy -------------------------------------------------------- */
    categories: () => META.categories.slice(),
    category: (slugSlug) => META.categories.find((c) => c.slug === slugSlug) || null,
    subcategories: (category) => {
      const seen = [];
      CATALOGUE.forEach((i) => {
        if (!i.subcategory) return;
        if (category && category !== 'all' && i.category !== category) return;
        if (seen.indexOf(i.subcategory) === -1) seen.push(i.subcategory);
      });
      return seen.sort((a, b) => a.localeCompare(b));
    },
    tags: () => {
      const map = new Map();
      CATALOGUE.forEach((i) => (i.tags || []).forEach((t) => map.set(t, (map.get(t) || 0) + 1)));
      return [...map.entries()]
        .map(([tag, count]) => ({ tag: tag, label: store.tagLabel(tag), count: count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    },
    tagExists: (tag) => !!tag && CATALOGUE.some((i) => (i.tags || []).indexOf(tag) !== -1),
    tagLabel: (tag) => str(tag).replace(/-/g, ' '),
    popularTags: () => META.popularTags.slice(),
    priceBands: () => META.priceBands.slice(),
    sortOptions: () => META.sortOptions.slice(),
    locationOptions: () => META.locationOptions.slice(),
    statuses: () => (META.statuses.length ? META.statuses : FALLBACK_STATUSES).slice(),
    types: () => (META.types.length
      ? META.types
      : [{ code: 'product', label: 'Product' }, { code: 'service', label: 'Service' }]).slice(),
    sellers: () => {
      const map = new Map();
      CATALOGUE.forEach((i) => {
        if (!map.has(i.seller.id)) map.set(i.seller.id, i.seller);
      });
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    stats: () => ({
      items: CATALOGUE.length,
      products: CATALOGUE.filter((i) => i.type === 'product').length,
      services: CATALOGUE.filter((i) => i.type === 'service').length,
      categories: META.categories.length,
      subcategories: store.subcategories('all').length,
      tags: store.tags().length,
      guides: GUIDES.length,
      offers: store.offers().length
    }),
    /* The dataset's own labelling, so a page never hard-codes the notice. */
    notice: () => META.notice,
    version: () => META.version,

    /* ---- offers ---------------------------------------------------------- */
    /* An offer always carries its item, so the UI can always walk
       offer → item → details. */
    /* Offer → underlying item → details. `item` is always attached so the UI
       never has to look the item up again. */
    offers: () => CATALOGUE.filter((i) => !!i.deal).map((i) => Object.assign({}, i.deal, { item: i })),
    offer: (id) => store.offers().find((o) => o.id === id) || null,
    deals: () => CATALOGUE.filter((i) => !!i.deal && store.dealState(i).code !== 'ended'),

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
    /* Subcategory guidance wins over category guidance. */
    considerations: (record) => {
      if (!record) return null;
      return META.considerations[record.category + ':' + record.subcategory] || META.considerations[record.category] || null;
    },
    goodToKnow: (record) => {
      if (!record) return [];
      return META.goodToKnow[record.category + ':' + record.subcategory] || META.goodToKnow[record.category] || [];
    },
    compareConfig: (category) => META.compareGroups[category] || null,
    compareFocusAreas: () => META.compareFocus.slice(),
    focusArea: (code) => META.compareFocus.find((f) => f.code === code) || null,
    needs: () => META.needs.slice(),
    related: (item, limit) => relatedFor(item, limit),

    /* ---- presentation primitives ---------------------------------------- */
    /* Price and label helpers live with the model they describe; the UI layer
       re-exports them so view code has a single import surface. */
    money: (amount, currency) => {
      const n = Number(amount);
      if (!isFinite(n)) return '';
      const code = currency || 'KES';
      return (CURRENCY_SYMBOL[code] || code + ' ') + n.toLocaleString('en-US', { maximumFractionDigits: n % 1 ? 2 : 0 });
    },
    priceText: (record) => {
      const p = record && record.price;
      if (!p || (p.amount == null && (p.min == null || p.max == null))) return 'Price on request';
      const unit = p.unit ? '/' + (UNIT_LABEL[p.unit] || p.unit) : '';
      if (p.amount != null) return store.money(p.amount, p.currency) + unit;
      return store.money(p.min, p.currency) + ' – ' + store.money(p.max, p.currency) + unit;
    },
    priceValue: (record) => {
      const p = record && record.price;
      if (!p) return Number.MAX_SAFE_INTEGER;
      if (p.amount != null) return Number(p.amount);
      if (p.min != null) return Number(p.min);
      return Number.MAX_SAFE_INTEGER;
    },
    categoryLabel: (slugValue) => {
      const c = META.categories.find((x) => x.slug === slugValue);
      return c ? c.label : 'Uncategorised';
    },
    statusInfo: (code) => store.statuses().find((s) => s.code === code) || { code: code, label: humanise(code) || 'Status not stated', tone: 'info', help: '' },
    typeLabel: (code) => TYPE_LABEL[code] || 'Item',
    locationLabel: (record) => {
      const l = record && record.location;
      if (!l) return 'Location not stated';
      if (l.format === 'online' || l.city === 'Online') return 'Online / nationwide';
      if (l.format === 'nationwide') return 'Nationwide (demo)';
      return l.city + (l.country && l.country !== 'Online' ? ', ' + l.country : '');
    },
    sellerLabel: (record) => (record && record.seller && record.seller.name) || 'Seller not stated',
    dealKindLabel: (deal) => (deal && deal.kind ? DEAL_KIND_LABEL[deal.kind] || 'Demo offer' : 'Demo offer'),
    /* Deal window as data only — the UI turns this into tone and wording. */
    dealState: (record) => {
      const deal = record && record.deal;
      if (!deal || !deal.validTo) return { code: 'none', daysLeft: null, validFrom: null, validTo: null };
      const start = deal.validFrom ? new Date(deal.validFrom + 'T00:00:00') : null;
      const end = new Date(deal.validTo + 'T23:59:59');
      if (isNaN(end)) return { code: 'none', daysLeft: null, validFrom: deal.validFrom, validTo: deal.validTo };
      const now = new Date();
      const daysLeft = Math.ceil((end - now) / 86400000);
      if (now > end) return { code: 'ended', daysLeft: daysLeft, validFrom: deal.validFrom, validTo: deal.validTo };
      if (start && !isNaN(start) && now < start) return { code: 'upcoming', daysLeft: daysLeft, validFrom: deal.validFrom, validTo: deal.validTo };
      if (daysLeft <= 14) return { code: 'ending', daysLeft: daysLeft, validFrom: deal.validFrom, validTo: deal.validTo };
      return { code: 'active', daysLeft: daysLeft, validFrom: deal.validFrom, validTo: deal.validTo };
    },
    savingsValue: (record) => {
      const deal = record && record.deal;
      if (!deal || deal.dealPrice == null || deal.referencePrice == null) return null;
      const diff = deal.referencePrice - deal.dealPrice;
      return diff > 0 ? diff : null;
    },
    UNIT_LABEL: UNIT_LABEL
  };

  /* ------------------------------------------------------------- search -- */
  /* One search implementation for the whole application. Words that carry no
     filtering value are ignored, a few everyday words map onto catalogue
     vocabulary, and matching happens on word prefixes. */
  const STOP_WORDS = ['a', 'an', 'and', 'the', 'for', 'with', 'to', 'of', 'in', 'on', 'my', 'me', 'i',
    'need', 'needing', 'looking', 'want', 'show', 'find', 'some', 'please', 'best', 'good', 'top'];
  const TERM_SYNONYMS = { cheap: 'budget', affordable: 'budget', inexpensive: 'budget', 'high-end': 'premium' };

  /** Lower-case and normalise the spellings the catalogue mixes together. */
  const norm = (value) => str(value).toLowerCase().replace(/wi[-\s]?fi/g, 'wifi').replace(/['’]/g, '');
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

  function search(query, list) {
    const pool = Array.isArray(list) ? list : CATALOGUE;
    const q = trim(query);
    if (!q) return pool.slice();
    const terms = normalizeTerms(q);
    if (!terms.length) return pool.slice();

    const scored = [];
    pool.forEach((record) => {
      const fields = {
        name: norm(record.name),
        brand: norm(record.brand),
        category: norm(store.categoryLabel(record.category)),
        subcategory: norm(record.subcategory),
        tags: norm((record.tags || []).join(' ')),
        seller: norm(record.seller && record.seller.name),
        location: norm(((record.location && record.location.city) || '') + ' ' + ((record.location && record.location.country) || '')),
        body: norm((record.shortDescription || '') + ' ' + (record.description || '')),
        specs: norm((record.attributes || []).map((a) => a.label + ' ' + a.value).join(' '))
      };
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
        const termScore = strongScore + weakScore;
        if (termScore) matched++;
        if (strongScore) strong = true;
        score += termScore;
      });

      if (!matched) return;
      if (fields.name.indexOf(norm(q)) !== -1) score += 6;
      if (terms.length > 1 && terms.every((t) => fields.name.indexOf(t) !== -1)) score += 4;
      if (record.deal) score += 2;
      if (record.badge && record.badge.tone === 'accent') score += 1;
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
  /* Location state uses the option codes from the dataset: 'online', 'local'
     (i.e. anywhere in the country) or a city prefix such as 'mombasa'. */
  function matchesLocation(record, code) {
    if (!code || code === 'any') return true;
    const loc = (record && record.location) || {};
    if (code === 'online') return loc.format === 'online' || loc.city === 'Online';
    if (code === 'local') return loc.format === 'local' || loc.format === 'nationwide';
    return (loc.city || '').toLowerCase().indexOf(code) === 0;
  }

  function applyFilters(list, filters) {
    const f = filters || {};
    let out = asArray(list).slice();

    if (f.q) out = search(f.q, out);
    if (f.category && f.category !== 'all') out = out.filter((i) => i.category === f.category);
    if (f.subcategory && f.subcategory !== 'all') out = out.filter((i) => i.subcategory === f.subcategory);
    if (f.tag && f.tag !== 'all') out = out.filter((i) => (i.tags || []).indexOf(f.tag) !== -1);
    if (f.type && f.type !== 'all') out = out.filter((i) => i.type === f.type);

    if (f.band && f.band !== 'any') {
      const bands = store.priceBands();
      const band = bands.find((b) => b.code === f.band);
      if (band) {
        out = out.filter((i) => {
          const v = store.priceValue(i);
          if (v === Number.MAX_SAFE_INTEGER) return false;
          if (band.min != null && v < band.min) return false;
          if (band.max != null && v > band.max) return false;
          return true;
        });
      }
    }

    if (f.location && f.location !== 'any') out = out.filter((i) => matchesLocation(i, f.location));
    if (f.availability && f.availability !== 'all') out = out.filter((i) => i.status === f.availability);

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
  /* Same order as before: newest by default, deals and rating first for
     relevance, price by numeric value with a stable name tie-break. */
  function applySort(list, code, query) {
    const out = asArray(list).slice();
    switch (code) {
      case 'newest':
        return out.sort((a, b) => String(b.listedAt).localeCompare(String(a.listedAt)));
      case 'price-asc':
        return out.sort((a, b) => store.priceValue(a) - store.priceValue(b) || a.name.localeCompare(b.name));
      case 'price-desc':
        return out.sort((a, b) => store.priceValue(b) - store.priceValue(a) || a.name.localeCompare(b.name));
      case 'name-asc':
        return out.sort((a, b) => a.name.localeCompare(b.name));
      case 'name-desc':
        return out.sort((a, b) => b.name.localeCompare(a.name));
      case 'relevance':
      default:
        if (query) return search(query, out);
        return out.sort((a, b) => {
          const da = a.deal ? 1 : 0;
          const db = b.deal ? 1 : 0;
          if (da !== db) return db - da;
          const ra = (a.rating && a.rating.value) || 0;
          const rb = (b.rating && b.rating.value) || 0;
          if (ra !== rb) return rb - ra;
          return String(b.listedAt).localeCompare(String(a.listedAt));
        });
    }
  }

  /* --------------------------------------------------------------- related */
  const midPrice = (record) => {
    const p = (record && record.price) || {};
    if (p.amount != null) return Number(p.amount);
    if (p.min != null) return Number(p.min);
    return null;
  };

  /** Deterministic matches with human reasons — never a ranking or a score. */
  function relatedFor(item, limit) {
    if (!item) return [];
    const max = limit || 4;
    const mine = midPrice(item);
    const scored = [];

    CATALOGUE.forEach((r) => {
      if (r.id === item.id) return;
      let score = 0;
      const reasons = [];

      if (r.category === item.category) { score += 5; reasons.push('same category'); }
      if (item.subcategory && r.subcategory === item.subcategory) { score += 4; reasons.push('same kind of item'); }
      if (r.type === item.type) { score += 1; reasons.push(r.type === 'product' ? 'both products' : 'both services'); }

      const shared = (r.tags || []).filter((t) => (item.tags || []).indexOf(t) !== -1);
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
      .sort((a, b) =>
        b.score - a.score ||
        ((b.record.rating && b.record.rating.value) || 0) - ((a.record.rating && a.record.rating.value) || 0) ||
        a.record.name.localeCompare(b.record.name)
      )
      .slice(0, max);
  }

  /* ----------------------------------------------------------- query API -- */
  /**
   * The one call listing pages make. Returns the envelope a future API will
   * return too:
   *   { ok, items, total, page, pageSize, hasNext, hasPrev, error }
   * Paging is honoured but not surfaced: with pageSize unset the whole result
   * set is returned, exactly as today.
   */
  function query(state, opts) {
    const s = state || {};
    const o = opts || {};
    const empty = { ok: false, items: [], total: 0, page: 1, pageSize: 0, hasNext: false, hasPrev: false, error: null };
    try {
      if (!s.q && s.page != null) {
        const p = parseInt(s.page, 10);
        if (!Number.isFinite(p) || p < 1) note('invalid-page-ignored', String(s.page));
      }
      const pool = store.dataset(o.dataset);
      let list = applyFilters(pool, s);
      list = applySort(list, s.sort, s.q);
      const total = list.length;
      const validPageSize = Number.isFinite(Number(s.pageSize)) && Number(s.pageSize) > 0 ? Number(s.pageSize) : null;
      const page = Math.max(1, parseInt(s.page, 10) || 1);
      const pageCount = validPageSize ? Math.max(1, Math.ceil(total / validPageSize)) : 1;
      const current = Math.min(page, pageCount);
      const items = validPageSize ? list.slice((current - 1) * validPageSize, current * validPageSize) : list;
      return {
        ok: true,
        items: items,
        total: total,
        page: current,
        pageSize: validPageSize || total,
        hasNext: validPageSize ? current * validPageSize < total : false,
        hasPrev: current > 1,
        error: null
      };
    } catch (err) {
      /* Never fail silently: the caller gets an envelope it can render. */
      const message = err && err.message ? err.message : 'The catalogue could not be read.';
      note('query-failed', message);
      return Object.assign({}, empty, { error: message });
    }
  }

  /* -------------------------------------------------------- typeahead ----- */
  function suggest(query, limit) {
    const q = trim(query).toLowerCase();
    const max = limit || 6;
    if (!q) return META.categories.slice(0, 4).map((c) => ({ label: c.label, meta: 'Category', href: 'discover.html?category=' + c.slug, icon: c.icon }));

    const out = [];
    const push = (row) => {
      if (out.length < max && !out.some((r) => r.label.toLowerCase() === row.label.toLowerCase())) out.push(row);
    };

    search(q, CATALOGUE).slice(0, 3).forEach((r) => push({
      label: r.name, meta: store.typeLabel(r.type) + ' · ' + store.categoryLabel(r.category),
      href: 'detail.html?id=' + encodeURIComponent(r.id), icon: r.image.icon
    }));
    META.categories.filter((c) => c.label.toLowerCase().indexOf(q) !== -1).forEach((c) => push({ label: c.label, meta: 'Category', href: 'discover.html?category=' + c.slug, icon: c.icon }));
    store.sellers().filter((s) => s.name.toLowerCase().indexOf(q) !== -1).slice(0, 2)
      .forEach((s) => push({ label: s.name, meta: s.type || 'Seller', href: 'discover.html?q=' + encodeURIComponent(s.name), icon: '🏬' }));
    GUIDES.filter((g) => g.title.toLowerCase().indexOf(q) !== -1).slice(0, 2)
      .forEach((g) => push({ label: g.title, meta: 'Guide outline', href: 'guides.html?q=' + encodeURIComponent(g.title), icon: g.icon }));
    return out.slice(0, max);
  }

  /* Expose the search/filter/sort trio the listing controller needs. */
  Object.assign(store, {
    search: search,
    filter: applyFilters,
    sort: applySort,
    query: query,
    suggest: suggest,
    activeFilterCount: activeFilterCount
  });

  return store;
})();
