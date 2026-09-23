/* ==========================================================================
   PickVanta — core UI layer (shared by every view)
   --------------------------------------------------------------------------
   Responsibilities:
     • tiny DOM/format helpers
     • read-only access to the demo data layer (js/data.js)
     • keyword search over the demo dataset
     • filtering + sorting helpers
     • reusable card / empty-state markup builders
     • shared chrome: header, mobile menu, footer, toast, compare tray
     • compare selection store (in-memory + localStorage, no backend)

   No framework, no dependencies, no network calls.
   ========================================================================== */
window.PV = (function () {
  'use strict';

  const D = window.PICKVANTA_DATA || { items: [], categories: [], guides: [] };

  /* ------------------------------------------------------------- helpers */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Demo prices are stated in Kenyan Shillings (KES). The other symbols are
     kept so a record can still be rendered if a currency is added later. */
  const CURRENCY_SYMBOL = { KES: 'KSh ', EUR: '€', USD: '$', GBP: '£' };
  const money = (amount, currency) => {
    const n = Number(amount);
    if (!isFinite(n)) return '';
    const code = currency || 'KES';
    const symbol = CURRENCY_SYMBOL[code] || code + ' ';
    return symbol + n.toLocaleString('en-US', { maximumFractionDigits: n % 1 ? 2 : 0 });
  };

  /* Plain labels for the offer kinds used by the demo deals. Purely wording —
     the deal stays attached to its product or service. */
  const DEAL_KIND_LABEL = {
    percentage: 'Percentage discount',
    'fixed-price': 'Fixed-price offer',
    package: 'Service package',
    bundle: 'Bundle offer',
    limited: 'Limited-time offer',
    billing: 'Billing discount',
    introductory: 'Introductory price'
  };
  const dealKindLabel = (deal) => (deal && deal.kind ? DEAL_KIND_LABEL[deal.kind] || 'Demo offer' : 'Demo offer');

  const UNIT_LABEL = {
    month: 'month', night: 'night', year: 'year', visit: 'visit',
    session: 'session', lesson: 'lesson', day: 'day', hour: 'hour'
  };

  /** Human price for a record: amount, amount+unit, or a range. */
  function priceText(record) {
    const p = record && record.price;
    if (!p) return 'Price on request';
    const unit = p.unit ? '/' + (UNIT_LABEL[p.unit] || p.unit) : '';
    if (p.amount != null) return money(p.amount, p.currency) + unit;
    if (p.min != null && p.max != null) return money(p.min, p.currency) + ' – ' + money(p.max, p.currency) + unit;
    return 'Price on request';
  }

  /** Numeric value used for sorting (ranges use their lower bound). */
  function priceValue(record) {
    const p = record && record.price;
    if (!p) return Number.MAX_SAFE_INTEGER;
    if (p.amount != null) return Number(p.amount);
    if (p.min != null) return Number(p.min);
    return Number.MAX_SAFE_INTEGER;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function categoryLabel(slug) {
    const c = D.categories.find((x) => x.slug === slug);
    return c ? c.label : 'Uncategorised';
  }

  function statusInfo(code) {
    return D.statuses.find((s) => s.code === code) || { code: code, label: code, tone: 'info', help: '' };
  }

  function typeLabel(code) {
    return { product: 'Product', service: 'Service' }[code] || 'Item';
  }

  function locationLabel(record) {
    const l = record && record.location;
    if (!l) return 'Location not stated';
    if (l.format === 'online' || l.city === 'Online') return 'Online / nationwide';
    if (l.format === 'nationwide') return 'Nationwide (demo)';
    return l.city + (l.country && l.country !== 'Online' ? ', ' + l.country : '');
  }

  function sellerLabel(record) {
    const s = record && record.seller;
    return s ? s.name : 'Seller not stated';
  }

  /** Deal window state — computed, never hard-coded in markup. */
  function dealState(record) {
    const deal = record && record.deal;
    if (!deal) return null;
    const now = new Date();
    const start = new Date(deal.validFrom + 'T00:00:00');
    const end = new Date(deal.validTo + 'T23:59:59');
    const daysLeft = Math.ceil((end - now) / 86400000);
    if (now > end) return { code: 'ended', tone: 'muted', label: 'Demo offer ended ' + formatDate(deal.validTo) };
    if (now < start) return { code: 'upcoming', tone: 'info', label: 'Starts ' + formatDate(deal.validFrom) };
    if (daysLeft <= 14) return { code: 'ending', tone: 'warn', label: 'Ends ' + formatDate(deal.validTo) };
    return { code: 'active', tone: 'ok', label: 'Ends ' + formatDate(deal.validTo) };
  }

  function savings(record) {
    const deal = record && record.deal;
    if (!deal || deal.dealPrice == null || deal.referencePrice == null) return null;
    const diff = deal.referencePrice - deal.dealPrice;
    return diff > 0 ? money(diff, record.price && record.price.currency) : null;
  }

  /* ----------------------------------------------------------- data access */
  const data = {
    all: () => D.items.slice(),
    item: (id) => D.items.find((i) => i.id === id) || null,
    items: (ids) => ids.map((id) => data.item(id)).filter(Boolean),
    deals: () =>
      D.items
        .filter((i) => !!i.deal)
        .filter((i) => {
          const st = dealState(i);
          return st && st.code !== 'ended';
        }),
    guides: () => D.guides.slice(),
    guide: (id) => D.guides.find((g) => g.id === id) || null,
    categories: () => D.categories.slice(),
    category: (slug) => D.categories.find((c) => c.slug === slug) || null,
    priceBands: () => D.priceBands.slice(),
    sortOptions: () => D.sortOptions.slice(),
    locationOptions: () => D.locationOptions.slice(),
    /* Subcategories are derived from the records themselves — no second list to
       keep in sync. Passing a category slug narrows them to that category. */
    subcategories: (category) => {
      const seen = [];
      D.items.forEach((i) => {
        if (!i.subcategory) return;
        if (category && category !== 'all' && i.category !== category) return;
        if (seen.indexOf(i.subcategory) === -1) seen.push(i.subcategory);
      });
      return seen.sort((a, b) => a.localeCompare(b));
    },
    /* Curated homepage selection. Ids live in the data file so the homepage
       stays a small, deliberate slice instead of a second catalogue. */
    home: () => {
      const pick = (ids, fallback, limit) => {
        const chosen = (ids || []).length ? data.items(ids) : [];
        const list = chosen.length ? chosen : fallback();
        return list.slice(0, limit);
      };
      return {
        featured: pick(D.homeFeaturedIds, () => data.all(), 8),
        deals: pick(D.homeDealIds, () => data.deals(), 3),
        guides: pick(D.homeGuideIds, () => data.guides(), 3)
      };
    },
    /* ---- Step 5 decision-support accessors -------------------------------- */
    /* Subcategory-specific guidance wins over category-wide guidance. */
    considerations: (record) => {
      if (!record) return null;
      const C = D.considerations || {};
      return C[record.category + ':' + record.subcategory] || C[record.category] || null;
    },
    goodToKnow: (record) => {
      if (!record) return [];
      const G = D.goodToKnow || {};
      return G[record.category + ':' + record.subcategory] || G[record.category] || [];
    },
    compareConfig: (category) => ((D.compareGroups || {})[category] || null),
    compareFocusAreas: () => (D.compareFocus || []).slice(),
    focusArea: (code) => (D.compareFocus || []).find((f) => f.code === code) || null,
    needs: () => (D.needs || []).slice(),
    popularTags: () => (D.popularTags || []).slice(),
    tagLabel: (tag) => String(tag || '').replace(/-/g, ' '),
    /* Tags actually present in the catalogue, with how many records carry them. */
    tags: () => {
      const map = new Map();
      D.items.forEach((i) => (i.tags || []).forEach((t) => map.set(t, (map.get(t) || 0) + 1)));
      return [...map.entries()]
        .map(([tag, count]) => ({ tag: tag, label: data.tagLabel(tag), count: count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    },
    sellers: () => {
      const map = new Map();
      D.items.forEach((i) => {
        if (!i.seller) return;
        if (!map.has(i.seller.name)) map.set(i.seller.name, i.seller);
      });
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    /* Related options: deterministic matching on category, subcategory, type,
       tags, brand and price band. Returns { record, reasons[] } so the UI can
       say *why* something is related. No ranking, scoring or recommendation. */
    related: (item, limit) => relatedFor(item, limit),
    notice: D.demoNotice || 'Demonstration data only.',
    version: D.version || 'demo'
  };

  /* ---------------------------------------------------- related discovery */
  const midPrice = (record) => {
    const p = (record && record.price) || {};
    if (p.amount != null) return Number(p.amount);
    if (p.min != null) return Number(p.min);
    return null;
  };

  function relatedFor(item, limit) {
    if (!item) return [];
    const max = limit || 4;
    const mine = midPrice(item);
    const scored = [];

    D.items.forEach((r) => {
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

      /* Same service area / town — only for records that name a real town, so
         "Online" and "Nationwide" records never produce a city match. */
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

  /* ---------------------------------------------------------------- search */
  /* Words that carry no filtering value on their own. Kept deliberately short. */
  const STOP_WORDS = ['a', 'an', 'and', 'the', 'for', 'with', 'to', 'of', 'in', 'on', 'my', 'me', 'i',
    'need', 'needing', 'looking', 'want', 'show', 'find', 'some', 'please', 'best', 'good', 'top'];
  /* Everyday words mapped onto the vocabulary the catalogue actually uses. */
  const TERM_SYNONYMS = { cheap: 'budget', affordable: 'budget', inexpensive: 'budget', 'high-end': 'premium' };

  /** Lower-case and normalise the spellings the catalogue mixes together. */
  const norm = (value) => String(value == null ? '' : value)
    .toLowerCase()
    .replace(/wi[-\s]?fi/g, 'wifi')
    .replace(/[’']/g, '');

  const tokenize = (value) => norm(value).split(/[^a-z0-9]+/).filter(Boolean);

  /** Query terms after stop-word removal and vocabulary mapping. */
  function normalizeTerms(query) {
    const raw = tokenize(query);
    const kept = [];
    raw.forEach((term) => {
      if (STOP_WORDS.indexOf(term) !== -1) return;
      const mapped = TERM_SYNONYMS[term] || term;
      if (kept.indexOf(mapped) === -1) kept.push(mapped);
    });
    /* A query made only of filler words ("the best") carries no filtering
       information, so it is treated like an empty search. */
    return kept;
  }

  /**
   * Lightweight keyword search over the demo dataset.
   *
   * Matching rules (deliberately simple — no engine, no index, no backend):
   *   • case-insensitive, punctuation-tolerant; "wi-fi" and "wifi" are the same
   *   • common filler words are ignored and a few everyday words are mapped onto
   *     catalogue vocabulary ("cheap" → "budget")
   *   • word-prefix matching, so "cancel" finds "cancelling" and "phone" finds
   *     "Smartphones"
   *   • every query term must match somewhere (AND); if nothing matches at all,
   *     a relaxed pass accepts records matching most terms, provided at least one
   *     term matched a strong field (name, brand, category, subcategory, tag)
   *   • results are ranked by field weight, then by name
   *
   * Fields searched: name, brand, category, subcategory, tags, seller, location,
   * description and specification values.
   */
  function search(query, list) {
    const pool = list || D.items;
    const q = String(query || '').trim();
    if (!q) return pool.slice();

    const terms = normalizeTerms(q);
    if (!terms.length) return pool.slice();

    const scored = [];

    pool.forEach((record) => {
      const fields = {
        name: norm(record.name),
        brand: norm(record.brand),
        category: norm(categoryLabel(record.category)),
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
      const phrase = norm(q);
      if (fields.name.indexOf(phrase) !== -1) score += 6;                              // whole phrase in the name
      if (terms.length > 1 && terms.every((t) => fields.name.indexOf(t) !== -1)) score += 4;
      if (record.deal) score += 2;
      if (record.badge && record.badge.tone === 'accent') score += 1;
      scored.push({ record: record, score: score, matched: matched, strong: strong });
    });

    const rank = (rows) => rows
      .sort((a, b) => b.score - a.score || a.record.name.localeCompare(b.record.name))
      .map((x) => x.record);

    /* Strict pass: every term must match somewhere. */
    const strict = scored.filter((r) => r.matched === terms.length);
    if (strict.length) return rank(strict);

    /* Relaxed pass: most terms matched and at least one of them hit a strong
       field, so "website development" still finds the web design service. */
    const needed = Math.max(1, Math.ceil(terms.length / 2));
    return rank(scored.filter((r) => r.matched >= needed && r.strong));
  }

  /** Typeahead suggestions: records, categories, brands/sellers and guides. */
  function suggest(query, limit) {
    const q = String(query || '').trim().toLowerCase();
    const max = limit || 6;
    if (!q) {
      return D.categories.slice(0, 4).map((c) => ({ label: c.label, meta: 'Category', href: 'discover.html?category=' + c.slug, icon: c.icon }));
    }
    const out = [];
    const push = (row) => {
      if (out.length < max && !out.some((r) => r.label.toLowerCase() === row.label.toLowerCase())) out.push(row);
    };

    D.categories.forEach((c) => {
      if (c.label.toLowerCase().includes(q) || c.blurb.toLowerCase().includes(q)) {
        push({ label: c.label, meta: 'Category · ' + c.blurb.split(',')[0], href: 'discover.html?category=' + c.slug, icon: c.icon });
      }
    });
    search(q, D.items).forEach((r) => {
      push({ label: r.name, meta: typeLabel(r.type) + ' · ' + categoryLabel(r.category), href: 'detail.html?id=' + r.id, icon: r.image.icon });
    });
    data.sellers().forEach((s) => {
      if (s.name.toLowerCase().includes(q)) push({ label: s.name, meta: 'Demo seller · ' + s.type, href: 'discover.html?q=' + encodeURIComponent(s.name), icon: '🏬' });
    });
    D.guides.forEach((g) => {
      if (g.title.toLowerCase().includes(q)) push({ label: g.title, meta: 'Guide · ' + categoryLabel(g.category), href: 'guides.html?q=' + encodeURIComponent(g.title), icon: '📘' });
    });
    return out.slice(0, max);
  }

  /* ------------------------------------------------------- filter + sort */
  function matchesLocation(record, code) {
    if (!code || code === 'any') return true;
    const loc = record.location || {};
    if (code === 'online') return loc.format === 'online' || loc.city === 'Online';
    if (code === 'local') return loc.format === 'local' || loc.format === 'nationwide';
    return (loc.city || '').toLowerCase().indexOf(code) === 0;
  }

  /**
   * Apply the demo filter set. Every filter is optional and purely local.
   * filters = { q, category, type, band, location, availability }
   */
  function applyFilters(list, filters) {
    const f = filters || {};
    let out = list.slice();

    if (f.q) out = search(f.q, out);

    if (f.category && f.category !== 'all') out = out.filter((i) => i.category === f.category);
    if (f.subcategory && f.subcategory !== 'all') out = out.filter((i) => i.subcategory === f.subcategory);
    if (f.tag && f.tag !== 'all') out = out.filter((i) => (i.tags || []).indexOf(f.tag) !== -1);
    if (f.type && f.type !== 'all') out = out.filter((i) => i.type === f.type);

    if (f.band && f.band !== 'any') {
      const band = D.priceBands.find((b) => b.code === f.band);
      if (band) {
        out = out.filter((i) => {
          const v = priceValue(i);
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

  function applySort(list, code, query) {
    const out = list.slice();
    switch (code) {
      case 'newest':
        return out.sort((a, b) => String(b.listedAt).localeCompare(String(a.listedAt)));
      case 'price-asc':
        return out.sort((a, b) => priceValue(a) - priceValue(b) || a.name.localeCompare(b.name));
      case 'price-desc':
        return out.sort((a, b) => priceValue(b) - priceValue(a) || a.name.localeCompare(b.name));
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

  /* ----------------------------------------------------------- card markup */
  const ICON_PIN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
  const ICON_STORE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 4.5 4h15L21 9.5"/><path d="M4 9.5V20h16V9.5"/><path d="M9 20v-6h6v6"/></svg>';
  const ICON_CAL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>';

  function mediaMarkup(record, opts) {
    const o = opts || {};
    const img = record.image || {};
    const style = img.gradient ? ' style="background:' + img.gradient + '"' : '';
    const inner = img.src
      ? '<img src="' + esc(img.src) + '" alt="' + esc(img.alt || record.name) + '" loading="lazy" />'
      : '<span class="media-icon" aria-hidden="true">' + (img.icon || '📦') + '</span>';
    const flags =
      '<span class="type-flag">' + esc(typeLabel(record.type)) + '</span>' +
      (o.deal
        ? '<span class="discount">-' + record.deal.discountPercent + '% · Demo</span>'
        : record.badge
        ? '<span class="badge-pill ' + esc(record.badge.tone || 'neutral') + ' flag-right">' + esc(record.badge.label) + '</span>'
        : '');
    return (
      '<a class="card-media-link" href="' + hrefDetail(record.id) + '" aria-label="' + esc(record.name) + '">' +
      '<div class="card-media"' + style + '>' +
      flags +
      inner +
      '</div></a>'
    );
  }

  const hrefDetail = (id) => 'detail.html?id=' + encodeURIComponent(id);

  /**
   * Discovery card.
   * Visual hierarchy: category + type → name → description → price →
   * seller/location → availability → actions. A card with a deal also gets a
   * discount flag and a "Demo offer" pill so the offer is never mistaken for
   * the item itself.
   */
  function cardItem(record, opts) {
    const o = opts || {};
    const status = statusInfo(record.status);
    const offer = record.deal ? dealState(record) : null;
    return (
      '<article class="product-card" data-card="' + esc(record.id) + '">' +
      mediaMarkup(record, { deal: !!record.deal }) +
      '<div class="card-body">' +
      '<div class="card-top">' +
      '<span class="store">' + esc(categoryLabel(record.category)) +
      (record.subcategory ? ' <span class="store-sub">· ' + esc(record.subcategory) + '</span>' : '') +
      '</span>' +
      '<span class="type-chip">' + esc(typeLabel(record.type)) + '</span>' +
      '</div>' +
      '<h3><a href="' + hrefDetail(record.id) + '">' + esc(record.name) + '</a></h3>' +
      '<p class="card-desc">' + esc(record.shortDescription) + '</p>' +
      priceRow(record) +
      '<div class="card-meta">' +
      '<span class="meta-item">' + ICON_STORE + esc(sellerLabel(record)) + '<span class="meta-demo">demo</span></span>' +
      '<span class="meta-item">' + ICON_PIN + esc(locationLabel(record)) + '</span>' +
      '<span class="status-pill ' + esc(status.tone) + '">' + esc(status.label) + '</span>' +
      (offer ? '<span class="status-pill offers">Demo offer · ' + esc(offer.label.toLowerCase()) + '</span>' : '') +
      (record.rating ? '<span class="meta-item meta-rating">★ ' + record.rating.value.toFixed(1) + ' demo</span>' : '') +
      '</div>' +
      (o.reasons && o.reasons.length
        ? '<p class="card-reason"><span aria-hidden="true">↳</span> <strong>' + esc(o.reasonLabel || 'Matched on') + '</strong> ' +
          esc(o.reasons.slice(0, 3).join(' · ')) + '</p>'
        : '') +
      '<div class="card-actions">' +
      '<a class="small-btn primary" href="' + hrefDetail(record.id) + '">View details</a>' +
      compareButton(record.id) +
      '</div>' +
      '</div>' +
      '</article>'
    );
  }

  /** Deal card — same family as the homepage deal card, plus offer fields. */
  /**
   * Deal card. A deal is never presented as its own product: the card shows
   * the underlying item name, then an explicit "special offer" block with
   * reference price → deal price → saving, then seller, location, validity
   * and conditions. Everything is labelled as demo data.
   */
  function cardDeal(record) {
    const deal = record.deal;
    const state = dealState(record) || { tone: 'info', label: 'Demo offer' };
    const saved = savings(record);
    const currency = record.price && record.price.currency;
    const unit = record.price && record.price.unit ? '/' + (UNIT_LABEL[record.price.unit] || record.price.unit) : '';
    return (
      '<article class="deal-card" data-card="' + esc(record.id) + '">' +
      mediaMarkup(record, { deal: true }) +
      '<div class="card-body">' +
      '<div class="card-top">' +
      '<span class="store">' + esc(categoryLabel(record.category)) +
      (record.subcategory ? ' <span class="store-sub">· ' + esc(record.subcategory) + '</span>' : '') +
      '</span>' +
      '<span class="type-chip">' + esc(typeLabel(record.type)) + '</span>' +
      '</div>' +
      '<h3><a href="' + hrefDetail(record.id) + '">' + esc(record.name) + '</a></h3>' +
      '<p class="card-desc">' + esc(record.shortDescription) + '</p>' +
      '<div class="offer-block">' +
      '<span class="offer-flag">Special offer · demo</span>' +
      (deal.headline ? '<p class="offer-headline">' + esc(deal.headline) + '</p>' : '') +
      '<div class="offer-prices">' +
      '<span class="offer-was">Was <s>' + esc(money(deal.referencePrice, currency)) + unit + '</s></span>' +
      '<span class="offer-now">Now <strong>' + esc(money(deal.dealPrice, currency)) + unit + '</strong></span>' +
      (deal.discountPercent ? '<span class="save-pill">Save ' + deal.discountPercent + '%' + (saved ? ' · ' + esc(saved) : '') + '</span>' : '') +
      '</div>' +
      '</div>' +
      '<div class="card-meta">' +
      '<span class="meta-item">' + ICON_STORE + esc(sellerLabel(record)) + '<span class="meta-demo">demo</span></span>' +
      '<span class="meta-item">' + ICON_PIN + esc(locationLabel(record)) + '</span>' +
      '<span class="meta-item">' + ICON_CAL + 'Offer ends ' + esc(formatDate(deal.validTo)) + '</span>' +
      '<span class="status-pill ' + esc(state.tone) + '">' + esc(state.label) + '</span>' +
      (deal.conditions && deal.conditions.length
        ? '<span class="meta-item">' + deal.conditions.length + ' condition' + (deal.conditions.length === 1 ? '' : 's') + ' (demo)</span>'
        : '<span class="meta-item">No conditions listed</span>') +
      '</div>' +
      '<div class="card-actions">' +
      '<a class="small-btn primary" href="' + hrefDetail(record.id) + '">View item &amp; offer</a>' +
      compareButton(record.id) +
      '</div>' +
      '</div>' +
      '</article>'
    );
  }

  function priceRow(record) {
    const ref = record.referencePrice || (record.deal && record.deal.referencePrice);
    const isDeal = !!(record.deal && record.deal.dealPrice != null);
    return (
      '<div class="price-row">' +
      '<span class="price">' + esc(priceText(record)) + '</span>' +
      (isDeal
        ? '<span class="price-old">' + esc(money(record.deal.referencePrice, record.price && record.price.currency)) + '</span>'
        : ref
        ? '<span class="price-old">ref. ' + esc(money(ref, record.price && record.price.currency)) + '</span>'
        : '') +
      (record.deal && savings(record) ? '<span class="save-pill">Save ' + esc(savings(record)) + '</span>' : '') +
      '</div>'
    );
  }

  /** Compare toggle used on every card and on the detail page. */
  function compareButton(id) {
    const record = data.item(id);
    const name = record ? record.name : 'this option';
    return (
      '<button type="button" class="small-btn compare-btn" data-compare-toggle="' + esc(id) + '"' +
      ' data-compare-name="' + esc(name) + '" aria-pressed="false"' +
      ' aria-label="Add ' + esc(name) + ' to the comparison">' +
      '<span class="cmp-btn-icon" aria-hidden="true">+</span>' +
      '<span class="cmp-btn-label">Compare</span>' +
      '</button>'
    );
  }

  /**
   * Guide card: what question it answers, which category it belongs to and
   * what it covers. The outline sits in a native <details> element — no fake
   * article page, no JavaScript needed to open it.
   */
  function cardGuide(guide) {
    const category = categoryHref(guide.category);
    return (
      '<article class="guide-card" data-guide="' + esc(guide.id) + '">' +
      '<div class="guide-head">' +
      '<span class="guide-media" aria-hidden="true">' + esc(guide.icon) + '</span>' +
      '<a class="guide-cat" href="' + esc(category) + '">' + esc(categoryLabel(guide.category)) + '</a>' +
      '</div>' +
      '<h3>' + esc(guide.title) + '</h3>' +
      (guide.question ? '<p class="guide-question">Answers: ' + esc(guide.question) + '</p>' : '') +
      '<p class="card-desc">' + esc(guide.summary) + '</p>' +
      '<details class="guide-details">' +
      '<summary>What it covers</summary>' +
      '<ul class="guide-covers">' + guide.covers.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>' +
      '</details>' +
      '<div class="guide-foot">' +
      '<span class="rating">' + esc(guide.level) + ' · ' + esc(guide.readTime) + '</span>' +
      '<button type="button" class="link-btn guide-open" data-later="Guide articles">Read outline</button>' +
      '</div>' +
      /* Guides are decision-support entry points: each one opens a matching
         slice of the catalogue using the existing filters. */
      (guide.link && guide.link.href
        ? '<a class="guide-link" href="' + esc(guide.link.href) + '">' + esc(guide.link.label) +
          ' <span aria-hidden="true">→</span></a>'
        : '') +
      '<p class="guide-note">Outline only — the full article is not written yet.</p>' +
      '</article>'
    );
  }

  /** Category link used by guide cards and empty states. */
  function categoryHref(slug) {
    return 'discover.html?category=' + encodeURIComponent(slug);
  }

  /**
   * Reusable empty state with a recovery path: optional category suggestions,
   * a primary recovery action (button, handled by the caller) and links.
   */
  function emptyState(opts) {
    const o = opts || {};
    return (
      '<div class="empty" role="status">' +
      '<div class="empty-icon" aria-hidden="true">' + esc(o.icon || '🔍') + '</div>' +
      '<h3>' + esc(o.title || 'No matches found') + '</h3>' +
      '<p>' + esc(o.text || 'Try a different search term or category.') + '</p>' +
      (o.suggestions && o.suggestions.length
        ? '<div class="empty-chips">' +
          '<span class="empty-chip-label">' + esc(o.suggestLabel || 'Browse a category:') + '</span>' +
          o.suggestions.map((s) => '<a class="chip" href="' + esc(s.href) + '">' + esc(s.label) + '</a>').join('') +
          '</div>'
        : '') +
      (o.tags && o.tags.length
        ? '<div class="empty-chips">' +
          '<span class="empty-chip-label">' + esc(o.tagLabel || 'Related tags:') + '</span>' +
          o.tags.map((t) => '<a class="chip" href="' + esc(t.href) + '">' + esc(t.label) + '</a>').join('') +
          '</div>'
        : '') +
      (o.examples && o.examples.length
        ? '<div class="empty-chips">' +
          '<span class="empty-chip-label">' + esc(o.examplesLabel || 'Example searches:') + '</span>' +
          o.examples.map((e) => '<button type="button" class="chip" data-empty-action="search" data-q="' + esc(e.q) + '">' + esc(e.label) + '</button>').join('') +
          '</div>'
        : '') +
      ((o.buttons && o.buttons.length) || (o.actions && o.actions.length)
        ? '<div class="empty-actions">' +
          (o.buttons || []).map((b) => '<button type="button" class="btn-primary" data-empty-action="' + esc(b.action) + '">' + esc(b.label) + '</button>').join('') +
          (o.actions || []).map((a) => '<a class="btn-secondary" href="' + esc(a.href) + '">' + esc(a.label) + '</a>').join('') +
          '</div>'
        : '') +
      (o.footnote ? '<p class="empty-footnote">' + esc(o.footnote) + '</p>' : '') +
      '</div>'
    );
  }

  /* ------------------------------------------------- recently viewed store */
  /* Browser-only convenience list: newest first, no duplicates, capped, and
     pruned whenever an id is no longer part of the demo catalogue. It is not an
     account, a favourites list or anything server-side — it never leaves the
     device, and it stores ids only. */
  const RECENT_KEY = 'pickvanta.recent.v1';
  const RECENT_MAX = 5;
  const recentListeners = [];
  let recentIds = [];

  function persistRecent() {
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(recentIds));
    } catch (e) {
      /* storage unavailable — the list simply stays empty for this session */
    }
  }

  /* Stored ids are validated against the catalogue on every read, so an id that
     no longer exists can never render an empty card. */
  function readRecent() {
    let stored = [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
      if (Array.isArray(parsed)) stored = parsed.filter((id) => typeof id === 'string');
    } catch (e) {
      return [];
    }
    const clean = stored.filter((id) => !!data.item(id)).slice(0, RECENT_MAX);
    if (clean.length !== stored.length) {
      recentIds = clean;
      persistRecent();
    }
    return clean;
  }

  const recent = {
    max: RECENT_MAX,
    ids: () => recentIds.slice(),
    items: () => data.items(recentIds),
    count: () => recentIds.length,
    has: (id) => recentIds.indexOf(id) !== -1,
    add(id) {
      if (!data.item(id)) return;
      recentIds = [id].concat(recentIds.filter((x) => x !== id)).slice(0, RECENT_MAX);
      persistRecent();
      recentListeners.forEach((fn) => fn());
    },
    clear() {
      recentIds = [];
      persistRecent();
      recentListeners.forEach((fn) => fn());
    }
  };

  function onRecentChange(fn) {
    if (typeof fn === 'function') recentListeners.push(fn);
  }

  recentIds = readRecent();

  /* -------------------------------------------------------- compare store */
  const COMPARE_KEY = 'pickvanta.compare.v1';
  const COMPARE_MAX = 3;

  function readStore() {
    try {
      const raw = window.localStorage.getItem(COMPARE_KEY);
      const val = raw ? JSON.parse(raw) : [];
      return Array.isArray(val) ? val.filter((id) => !!data.item(id)).slice(0, COMPARE_MAX) : [];
    } catch (e) {
      return [];
    }
  }
  function writeStore(ids) {
    try {
      window.localStorage.setItem(COMPARE_KEY, JSON.stringify(ids.slice(0, COMPARE_MAX)));
    } catch (e) {
      /* storage unavailable (private mode / local file) — selection stays in memory */
    }
  }

  let compareIds = readStore();

  const compare = {
    max: COMPARE_MAX,
    ids: () => compareIds.slice(),
    count: () => compareIds.length,
    has: (id) => compareIds.indexOf(id) !== -1,
    full: () => compareIds.length >= COMPARE_MAX,
    add(id) {
      const record = data.item(id);
      if (!record) return false;
      if (compareIds.indexOf(id) !== -1) return true;
      if (compareIds.length >= COMPARE_MAX) {
        toast('You can compare up to ' + COMPARE_MAX + ' options. Remove one from the tray below to swap it for “' + record.name + '”.');
        return false;
      }
      compareIds.push(id);
      writeStore(compareIds);
      announce('Added “' + record.name + '”. ' + compareIds.length + ' of ' + COMPARE_MAX + ' selected for comparison.');
      changed();
      return true;
    },
    remove(id) {
      const record = data.item(id);
      compareIds = compareIds.filter((x) => x !== id);
      writeStore(compareIds);
      announce((record ? 'Removed “' + record.name + '”. ' : 'Removed an option. ') + compareIds.length + ' of ' + COMPARE_MAX + ' selected for comparison.');
      changed();
    },
    toggle(id) {
      const record = data.item(id);
      if (compare.has(id)) {
        compare.remove(id);
        toast('Removed from comparison. This selection only exists in your browser — nothing is saved on a server.');
      } else if (compare.add(id)) {
        const left = COMPARE_MAX - compareIds.length;
        toast(
          'Added to comparison (' + compareIds.length + ' of ' + COMPARE_MAX + '). ' +
            (left > 0
              ? 'Add ' + left + ' more option' + (left === 1 ? '' : 's') + ', or open the comparison now.'
              : 'Tray full — open Compare, or remove an option to swap.') +
            (record ? '' : '')
        );
      }
    },
    set(ids) {
      compareIds = (ids || []).filter((id) => !!data.item(id)).slice(0, COMPARE_MAX);
      writeStore(compareIds);
      changed();
    },
    clear() {
      compareIds = [];
      writeStore(compareIds);
      changed();
    }
  };

  const compareListeners = [];
  function onCompareChange(fn) {
    compareListeners.push(fn);
  }
  function changed() {
    syncCompareButtons();
    renderTray();
    compareListeners.forEach((fn) => {
      try {
        fn(compare.ids());
      } catch (e) {
        /* listener errors must not break the page */
      }
    });
  }

  /** Keeps every compare control on the page in sync with the selection. */
  function syncCompareButtons() {
    $$('[data-compare-toggle]').forEach((btn) => {
      const id = btn.getAttribute('data-compare-toggle');
      const on = compare.has(id);
      const name = btn.getAttribute('data-compare-name') || (data.item(id) || {}).name || 'this option';
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', (on ? 'Remove from comparison: ' : 'Add to comparison: ') + name);

      const icon = $('.cmp-btn-icon', btn);
      const label = $('.cmp-btn-label', btn);
      if (icon) icon.textContent = on ? '✓' : '+';
      if (label) label.textContent = on ? 'Added' : 'Compare';
      else btn.textContent = on ? 'Added ✓' : 'Compare';
    });
  }

  /* -------------------------------------------------------------- chrome */
  const NAV = [
    { label: 'Discover', href: 'discover.html', page: 'discover' },
    { label: 'Deals', href: 'deals.html', page: 'deals' },
    { label: 'Compare', href: 'compare.html', page: 'compare' },
    { label: 'Guides', href: 'guides.html', page: 'guides' }
  ];

  function headerMarkup(active) {
    const link = (n) =>
      '<a href="' + n.href + '"' + (active === n.page ? ' class="is-current" aria-current="page"' : '') + '>' +
      esc(n.label) +
      (n.page === 'compare' ? '<span class="nav-count" data-compare-count hidden>0</span>' : '') +
      '</a>';

    return (
      '<header class="topbar" id="siteHeader" role="banner">' +
      '<div class="shell">' +
      '<nav class="nav" aria-label="Primary">' +
      '<a href="index.html" class="brand" aria-label="PickVanta home"><span class="brand-mark" aria-hidden="true">P</span><span>PickVanta</span></a>' +
      '<div class="navlinks" role="navigation" aria-label="Main">' + NAV.map(link).join('') + '</div>' +
      '<div class="nav-actions">' +
      '<button class="icon-btn" id="headerSearchBtn" type="button" aria-label="Search PickVanta">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/></svg>' +
      '</button>' +
      '<button class="btn-secondary" type="button" data-later="Sign in">Sign In</button>' +
      '<button class="hamburger" id="hamburger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="mobilePanel"><span></span></button>' +
      '</div>' +
      '</nav>' +
      '</div>' +
      '<div class="mobile-panel" id="mobilePanel" hidden>' +
      '<div class="shell">' +
      '<div class="mobile-links">' +
      NAV.map((n) => '<a href="' + n.href + '">' + esc(n.label) + ' <span aria-hidden="true">→</span></a>').join('') +
      '</div>' +
      '<div class="mobile-actions">' +
      '<button class="btn-secondary" type="button" data-later="Sign in">Sign In</button>' +
      '<a class="btn-primary" href="discover.html">Start discovering</a>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</header>'
    );
  }

  function footerMarkup() {
    const col = (title, links) =>
      '<div class="footer-col"><h4>' + esc(title) + '</h4>' +
      links
        .map((l) =>
          l.later
            ? '<button type="button" class="link-btn" data-later="' + esc(l.later) + '">' + esc(l.label) + '</button>'
            : '<a href="' + esc(l.href) + '">' + esc(l.label) + '</a>'
        )
        .join('') +
      '</div>';

    return (
      '<footer id="siteFooter" role="contentinfo">' +
      '<div class="shell">' +
      '<div class="footer-grid">' +
      '<div class="footer-brand">' +
      '<a href="index.html" class="brand" aria-label="PickVanta home"><span class="brand-mark" aria-hidden="true" style="background:white;color:#0B1220">P</span><span>PickVanta</span></a>' +
      '<p>Modern discovery, comparison and deals platform. Find, compare, and choose products, services, and deals in one place. This build uses demonstration data only — no real products, prices or merchants.</p>' +
      '</div>' +
      col('Product', [
        { label: 'Home', href: 'index.html' },
        { label: 'Discover', href: 'discover.html' },
        { label: 'Deals', href: 'deals.html' },
        { label: 'Compare', href: 'compare.html' },
        { label: 'Guides', href: 'guides.html' }
      ]) +
      col('Browse', D.categories.slice(0, 5).map((c) => ({ label: c.label, href: 'discover.html?category=' + c.slug }))) +
      col('Company', [
        { label: 'Account', later: 'Account' },
        { label: 'Contact', later: 'Contact' },
        { label: 'About', later: 'About' }
      ]) +
      '</div>' +
      '<div class="footer-bottom">' +
      '<p>© 2026 PickVanta. Step 2 build — demonstration data only, no accounts, payments or live pricing.</p>' +
      '<div class="footer-bottom-links">' +
      '<button type="button" class="link-btn" data-later="Privacy">Privacy</button>' +
      '<button type="button" class="link-btn" data-later="Terms">Terms</button>' +
      '<button type="button" class="link-btn" data-later="Contact">Contact</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</footer>'
    );
  }

  /* ---------------------------------------------------------------- toast */
  let toastTimer = null;
  function toast(message) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
  }

  /* --------------------------------------------------------- compare tray */
  /**
   * Screen-reader announcement for comparison changes. Written immediately so
   * assistive technology picks it up without waiting; a zero-width space keeps
   * repeated identical messages from being swallowed.
   */
  function announce(message) {
    let el = $('#trayAnnounce');
    if (!el) {
      el = document.createElement('p');
      el.id = 'trayAnnounce';
      el.className = 'visually-hidden';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = el.textContent === message ? message + '\u200B' : message;
  }

  /**
   * The compare tray: a compact, dismissible bar that shows how many options
   * are selected, lets each one be removed, and links into the Compare view.
   * It never covers content (the page gets bottom padding while it is shown).
   */
  function renderTray() {
    let tray = $('#compareTray');
    if (!tray) {
      tray = document.createElement('div');
      tray.id = 'compareTray';
      tray.className = 'compare-tray';
      document.body.appendChild(tray);
    }
    const items = data.items(compare.ids());
    const open = tray.classList.contains('tray-open');

    if (!items.length) {
      tray.hidden = true;
      tray.classList.remove('tray-open');
      tray.innerHTML = '';
      document.body.classList.remove('has-tray', 'tray-expanded');
      return;
    }

    tray.hidden = false;
    document.body.classList.add('has-tray');
    const two = items.length >= 2;

    tray.innerHTML =
      '<div class="shell tray-inner">' +
        '<div class="tray-left">' +
          '<span class="tray-label">' +
            '<span class="tray-title">Compare</span>' +
            '<b>' + items.length + ' of ' + compare.max + '</b> selected' +
          '</span>' +
          '<button type="button" class="tray-toggle" data-tray-toggle aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="trayItems">' +
            (open ? 'Hide selected' : 'Show selected') +
          '</button>' +
          '<div class="tray-chips" id="trayItems">' +
            items.map((i) =>
              '<span class="tray-chip">' +
                '<span class="tray-thumb" aria-hidden="true">' + esc((i.image && i.image.icon) || '📦') + '</span>' +
                '<span class="tray-chip-text">' +
                  '<span class="tray-chip-name">' + esc(i.name) + '</span>' +
                  '<span class="tray-chip-meta">' + esc(categoryLabel(i.category)) + ' · ' + esc(priceText(i)) + '</span>' +
                '</span>' +
                '<button type="button" class="tray-x" data-tray-remove="' + esc(i.id) + '" aria-label="Remove ' + esc(i.name) + ' from the comparison">×</button>' +
              '</span>'
            ).join('') +
          '</div>' +
        '</div>' +
        '<div class="tray-right">' +
          (two
            ? '<span class="tray-hint">You decide what matters — PickVanta does not rank these.</span>'
            : '<span class="tray-hint">Add one more option to compare side by side.</span>') +
          '<button type="button" class="btn-ghost" data-tray-clear>Clear</button>' +
          '<a class="btn-primary" href="compare.html?ids=' + encodeURIComponent(compare.ids().join(',')) + '">' +
            (two ? 'Compare now' : 'Open comparison') +
          '</a>' +
        '</div>' +
      '</div>';
  }

  function toggleTray() {
    const tray = $('#compareTray');
    if (!tray || tray.hidden) return;
    const open = tray.classList.toggle('tray-open');
    document.body.classList.toggle('tray-expanded', open);
    const btn = $('[data-tray-toggle]', tray);
    if (btn) {
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Hide selected' : 'Show selected';
    }
  }

  /* ------------------------------------------------------- search binding */
  /**
   * Bind a search form. Works on the homepage, Discover and Deals.
   * opts = { root, onSubmit(q), mode }
   */
  function bindSearch(opts) {
    const root = opts && opts.root;
    if (!root) return null;
    const form = root.tagName === 'FORM' ? root : $('form', root);
    const input = $('input[type="search"]', root) || $('input', root);
    const box = $('.suggestions', root);
    if (!form || !input) return null;

    let items = [];
    const close = () => {
      if (box) {
        box.classList.remove('show');
        input.setAttribute('aria-expanded', 'false');
      }
      items = [];
    };

    function render() {
      if (!box) return;
      const rows = suggest(input.value, 6);
      if (!rows.length) return close();
      items = rows;
      box.innerHTML = rows
        .map(
          (r, idx) =>
            '<a class="suggestion" role="option" id="sugg-' + idx + '" href="' + esc(r.href) + '" data-value="' + esc(r.label) + '">' +
            '<span><span aria-hidden="true">' + esc(r.icon || '🔎') + '</span> <strong>' + esc(r.label) + '</strong> <small>· ' + esc(r.meta) + '</small></span>' +
            '<small>Open</small>' +
            '</a>'
        )
        .join('');
      box.classList.add('show');
      input.setAttribute('aria-expanded', 'true');
    }

    input.addEventListener('focus', render);
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      const list = $$('.suggestion', box || root);
      if (!list.length) return;
      const active = $('.suggestion[aria-selected="true"]', box || root);
      let idx = active ? list.indexOf(active) : -1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        idx = (idx + 1) % list.length;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        idx = idx <= 0 ? list.length - 1 : idx - 1;
      } else if (e.key === 'Escape') {
        close();
        return;
      } else if (e.key === 'Enter') {
        if (active) {
          e.preventDefault();
          window.location.href = active.getAttribute('href');
        }
        return;
      } else {
        return;
      }
      list.forEach((n) => n.setAttribute('aria-selected', 'false'));
      if (list[idx]) list[idx].setAttribute('aria-selected', 'true');
    });

    if (box) {
      box.addEventListener('click', () => close());
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      close();
      opts.onSubmit(q);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#' + (root.id || '__none'))) close();
    });

    return { input: input, close: close, focus: () => input.focus() };
  }

  /* ------------------------------------------------------ filter controls */
  /**
   * Render the demo filter set. opts = { groups: ['category','type','band','location','availability'] }
   */
  function renderFilters(host, state, groups, onChange, counts) {
    if (!host) return;
    const active = state || {};
    const has = (g) => !groups || groups.indexOf(g) !== -1;
    const countFor = (kind, value) => {
      const c = counts && counts[kind] ? counts[kind][value] : null;
      return typeof c === 'number' ? '<span class="check-count">' + c + '</span>' : '';
    };

    const radioGroup = (legend, name, kind, options) =>
      '<div class="filter-group">' +
      '<span class="filter-legend">' + esc(legend) + '</span>' +
      '<div class="filter-options">' +
      options
        .map(
          (o) =>
            '<label class="check"><input type="radio" name="' + esc(name) + '" value="' + esc(o.value) + '"' +
            (String(active[o.key]) === String(o.value) ? ' checked' : '') +
            ' /><span class="check-label">' + esc(o.label) + '</span>' +
            (o.value === 'all' || o.value === 'any'
              ? ''
              : typeof o.count === 'number'
              ? '<span class="check-count">' + o.count + '</span>'
              : countFor(kind, o.value)) +
            '</label>'
        )
        .join('') +
      '</div></div>';

    let html = '';
    if (has('category')) {
      html += radioGroup('Category', 'f-category', 'category', [{ key: 'category', value: 'all', label: 'All categories' }].concat(
        D.categories.map((c) => ({ key: 'category', value: c.slug, label: c.icon + '  ' + c.label }))
      ));
    }
    /* Subcategory only appears once a category is chosen: it lists that
       category's own subcategories, so it never becomes a wall of options. */
    if (has('subcategory') && active.category && active.category !== 'all') {
      const subs = data.subcategories(active.category);
      const inCat = D.items.filter((i) => i.category === active.category);
      const countIn = (sub) => inCat.filter((i) => i.subcategory === sub).length;
      html += radioGroup(
        'Subcategory',
        'f-subcategory',
        null,
        [{ key: 'subcategory', value: 'all', label: 'All ' + categoryLabel(active.category) + ' subcategories' }].concat(
          subs.map((s) => ({ key: 'subcategory', value: s, label: s, count: countIn(s) }))
        )
      );
    }
    if (has('type')) {
      html += radioGroup('Type', 'f-type', 'type', [{ key: 'type', value: 'all', label: 'Products & services' }].concat(
        D.types.map((t) => ({ key: 'type', value: t.code, label: t.label + 's' }))
      ));
    }
    if (has('band')) {
      html += radioGroup('Price range', 'f-band', null, D.priceBands.map((b) => ({ key: 'band', value: b.code, label: b.label })));
    }
    if (has('location')) {
      html += radioGroup('Location', 'f-location', null, D.locationOptions.map((l) => ({ key: 'location', value: l.code, label: l.label })));
    }
    if (has('tag')) {
      const activeTag = active.tag && active.tag !== 'all' ? active.tag : 'all';
      const all = data.tags();
      const popular = data.popularTags();
      const isPopular = (t) => popular.indexOf(t) !== -1;
      /* A tag that is not in the shortcut list still needs a visible radio, so
         the current selection is always on screen. */
      const ordered = all
        .filter((t) => isPopular(t.tag) || t.tag === activeTag)
        .sort((a, b) => popular.indexOf(a.tag) - popular.indexOf(b.tag));
      const rest = all.filter((t) => ordered.indexOf(t) === -1);
      const tagRadio = (t) =>
        '<label class="check"><input type="radio" name="f-tag" value="' + esc(t.tag) + '"' +
        (activeTag === t.tag ? ' checked' : '') + ' />' +
        '<span class="check-label">' + esc(t.label) + '</span>' +
        '<span class="check-count">' + t.count + '</span></label>';

      html +=
        '<div class="filter-group">' +
        '<span class="filter-legend">Tag</span>' +
        '<div class="filter-options">' +
        '<label class="check"><input type="radio" name="f-tag" value="all"' + (activeTag === 'all' ? ' checked' : '') + ' />' +
        '<span class="check-label">All tags</span></label>' +
        ordered.map(tagRadio).join('') +
        '</div>' +
        (rest.length
          ? '<details class="filter-more"><summary>More tags (' + rest.length + ')</summary>' +
            '<div class="filter-options">' + rest.map(tagRadio).join('') + '</div></details>'
          : '') +
        '<p class="filter-note">Tags describe what a record is good for, how it is used or where it is — they are keywords, not scores.</p>' +
        '</div>';
    }
    if (has('availability')) {
      html += radioGroup('Availability', 'f-availability', 'status', [{ key: 'availability', value: 'all', label: 'Any availability' }].concat(
        D.statuses.map((s) => ({ key: 'availability', value: s.code, label: s.label }))
      ));
    }
    html += '<button type="button" class="filter-reset" data-filter-reset>Clear all filters</button>';

    host.innerHTML = html;

    $$('input[type="radio"]', host).forEach((input) => {
      input.addEventListener('change', () => {
        const key = {
          'f-category': 'category', 'f-subcategory': 'subcategory', 'f-type': 'type',
          'f-band': 'band', 'f-location': 'location', 'f-availability': 'availability',
          'f-tag': 'tag'
        }[input.name];
        if (key) onChange(key, input.value);
      });
    });
    const reset = $('[data-filter-reset]', host);
    if (reset) reset.addEventListener('click', () => onChange('reset', null));
  }

  function renderSort(select, value, onChange) {
    if (!select) return;
    select.innerHTML = D.sortOptions.map((o) => '<option value="' + esc(o.code) + '">' + esc(o.label) + '</option>').join('');
    select.value = value || 'relevance';
    select.addEventListener('change', () => onChange(select.value));
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

  /* -------------------------------------------------------------- filters drawer */
  function bindFiltersDrawer() {
    const toggle = $('#filtersToggle');
    const panel = $('#filtersPanel');
    const backdrop = $('#filtersBackdrop');
    if (!toggle || !panel) return;
    const close = () => {
      panel.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      if (backdrop) backdrop.hidden = true;
      document.body.style.overflow = '';
    };
    const open = () => {
      panel.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      if (backdrop) backdrop.hidden = false;
      document.body.style.overflow = 'hidden';
    };
    toggle.addEventListener('click', () => (panel.classList.contains('open') ? close() : open()));
    if (backdrop) backdrop.addEventListener('click', close);
    const done = $('#filtersClose');
    if (done) done.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    return { close: close };
  }

  /* --------------------------------------------------------- global wiring */
  function mountChrome(activePage) {
    const headerHost = $('#siteHeader');
    const footerHost = $('#siteFooter');
    if (headerHost) headerHost.outerHTML = headerMarkup(activePage);
    if (footerHost) footerHost.outerHTML = footerMarkup();

    /* mobile menu */
    const hamburger = $('#hamburger');
    const mobilePanel = $('#mobilePanel');
    const closeMobile = () => {
      if (!hamburger || !mobilePanel) return;
      hamburger.setAttribute('aria-expanded', 'false');
      mobilePanel.classList.remove('open');
      mobilePanel.hidden = true;
      document.body.style.overflow = '';
    };
    if (hamburger && mobilePanel) {
      hamburger.addEventListener('click', () => {
        const expanded = hamburger.getAttribute('aria-expanded') === 'true';
        hamburger.setAttribute('aria-expanded', String(!expanded));
        mobilePanel.classList.toggle('open', !expanded);
        mobilePanel.hidden = expanded;
        document.body.style.overflow = !expanded ? 'hidden' : '';
      });
      $$('a', mobilePanel).forEach((a) => a.addEventListener('click', closeMobile));
    }

    /* header search button → focus the page search, or go to Discover */
    const headerSearch = $('#headerSearchBtn');
    if (headerSearch) {
      headerSearch.addEventListener('click', () => {
        const target = $('#pageSearch') || $('#searchInput');
        if (target) {
          target.focus();
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          toast('Search the demo dataset — type a product, service, brand or category.');
        } else {
          window.location.href = 'discover.html?focus=search';
        }
      });
    }

    /* compare count in the nav */
    const syncCount = () => {
      const n = compare.count();
      $$('[data-compare-count]').forEach((el) => {
        el.textContent = String(n);
        el.hidden = n === 0;
      });
    };
    syncCount();
    onCompareChange(syncCount);

    /* compare toggles anywhere on the page */
    document.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-compare-toggle]');
      if (toggle) {
        e.preventDefault();
        compare.toggle(toggle.getAttribute('data-compare-toggle'));
        return;
      }
      const remove = e.target.closest('[data-tray-remove]');
      if (remove) {
        compare.remove(remove.getAttribute('data-tray-remove'));
        return;
      }
      if (e.target.closest('[data-tray-toggle]')) {
        toggleTray();
        return;
      }
      if (e.target.closest('[data-tray-clear]')) {
        compare.clear();
        announce('Comparison cleared.');
        toast('Comparison cleared.');
        return;
      }
      /* features that intentionally do not exist yet */
      const later = e.target.closest('[data-later]');
      if (later) {
        e.preventDefault();
        const name = later.getAttribute('data-later');
        toast(
          name === 'Sign in'
            ? 'Accounts and sign-in are not part of this stage — no login exists yet.'
            : name + ' is not part of this stage. Demo interface only.'
        );
      }
    });

    /* escape closes overlays */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMobile();
    });

    renderTray();
    syncCompareButtons();
    document.addEventListener('click', () => syncCompareButtons());
  }

  /* ------------------------------------------------------------ url helpers */
  function params() {
    return new URLSearchParams(window.location.search);
  }
  function updateUrl(values) {
    const p = new URLSearchParams(window.location.search);
    Object.keys(values || {}).forEach((k) => {
      const v = values[k];
      if (v === null || v === undefined || v === '' || v === 'all' || v === 'any') p.delete(k);
      else p.set(k, v);
    });
    const qs = p.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
  }

  /* ------------------------------------------------------------ boot helpers */
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  return {
    util: {
      $, $$, esc, money, priceText, priceValue, formatDate,
      categoryLabel, statusInfo, typeLabel, locationLabel, sellerLabel, dealState, savings, dealKindLabel,
      params, updateUrl, ready, UNIT_LABEL
    },
    data,
    search: { query: search, suggest },
    filters: { apply: applyFilters, matchesLocation, activeCount: activeFilterCount },
    sort: { apply: applySort },
    card: { item: cardItem, deal: cardDeal, guide: cardGuide, empty: emptyState },
    compare,
    onCompareChange,
    recent,
    onRecentChange,
    ui: {
      toast, announce, mountChrome, bindSearch, renderFilters, renderSort, bindFiltersDrawer,
      syncCompareButtons, renderTray, toggleTray, headerMarkup, footerMarkup
    },
    hrefDetail
  };
})();
