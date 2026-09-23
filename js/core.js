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

  const money = (amount, currency) => {
    const n = Number(amount);
    if (!isFinite(n)) return '';
    return (currency === 'EUR' ? '€' : '$') + n.toLocaleString('en-US', { maximumFractionDigits: n % 1 ? 2 : 0 });
  };

  const UNIT_LABEL = { month: 'mo', night: 'night', year: 'yr', visit: 'visit' };

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
    if (l.format === 'online') return 'Online / nationwide';
    if (l.city === 'Online') return 'Online';
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
    return diff > 0 ? money(diff) : null;
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
    types: () => D.types.slice(),
    statuses: () => D.statuses.slice(),
    priceBands: () => D.priceBands.slice(),
    sortOptions: () => D.sortOptions.slice(),
    locationOptions: () => D.locationOptions.slice(),
    brands: () => [...new Set(D.items.map((i) => i.brand).filter(Boolean))].sort(),
    sellers: () => {
      const map = new Map();
      D.items.forEach((i) => {
        if (!i.seller) return;
        if (!map.has(i.seller.name)) map.set(i.seller.name, i.seller);
      });
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    related: (item, limit) => {
      if (!item) return [];
      return D.items
        .filter((i) => i.id !== item.id && (i.category === item.category || i.type === item.type))
        .sort((a, b) => (a.category === item.category ? -1 : 1) - (b.category === item.category ? -1 : 1))
        .slice(0, limit || 4);
    },
    notice: D.demoNotice || 'Demonstration data only.',
    version: D.version || 'demo'
  };

  /* ---------------------------------------------------------------- search */
  const haystack = (record) =>
    [
      record.name,
      record.brand,
      record.subcategory,
      categoryLabel(record.category),
      record.shortDescription,
      record.description,
      record.seller && record.seller.name,
      record.location && record.location.city,
      record.location && record.location.country,
      (record.attributes || []).map((a) => a.label + ' ' + a.value).join(' '),
      (record.tags || []).join(' ')
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

  /**
   * Keyword search across the demo dataset.
   * Matches names, descriptions, categories, brands and sellers.
   * Every term must match somewhere (AND); scores decide the order.
   */
  function search(query, list) {
    const pool = list || D.items;
    const q = String(query || '').trim().toLowerCase();
    if (!q) return pool.slice();

    const terms = q.split(/\s+/).filter(Boolean);
    const scored = [];

    pool.forEach((record) => {
      const name = record.name.toLowerCase();
      const brand = (record.brand || '').toLowerCase();
      const cat = categoryLabel(record.category).toLowerCase();
      const sub = (record.subcategory || '').toLowerCase();
      const seller = ((record.seller && record.seller.name) || '').toLowerCase();
      const body = ((record.shortDescription || '') + ' ' + (record.description || '')).toLowerCase();
      const specs = ((record.attributes || []).map((a) => a.label + ' ' + a.value).join(' ') || '').toLowerCase();
      const loc = ((record.location && record.location.city) || '').toLowerCase();
      const all = haystack(record);

      let score = 0;
      let matchedAll = true;

      terms.forEach((term) => {
        let termScore = 0;
        if (name.startsWith(term)) termScore += 14;
        else if (new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(name)) termScore += 11;
        else if (name.includes(term)) termScore += 8;
        if (brand.includes(term)) termScore += 9;
        if (cat.includes(term)) termScore += 7;
        if (sub.includes(term)) termScore += 6;
        if (seller.includes(term)) termScore += 5;
        if (loc.includes(term)) termScore += 4;
        if (body.includes(term)) termScore += 3;
        if (specs.includes(term)) termScore += 2;
        if (!termScore && !all.includes(term)) matchedAll = false;
        score += termScore;
      });

      if (!matchedAll) return;
      if (name.includes(q)) score += 6; // whole-phrase bonus
      if (record.deal) score += 2;
      if (record.badge && record.badge.tone === 'accent') score += 1;
      scored.push({ record: record, score: score });
    });

    return scored.sort((a, b) => b.score - a.score || a.record.name.localeCompare(b.record.name)).map((s) => s.record);
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

  /** Discovery card — reuses the homepage product card design. */
  function cardItem(record) {
    const status = statusInfo(record.status);
    return (
      '<article class="product-card" data-card="' + esc(record.id) + '">' +
      mediaMarkup(record, {}) +
      '<div class="card-body">' +
      '<div class="card-top">' +
      '<span class="store">' + esc(categoryLabel(record.category)) + ' · ' + esc(record.subcategory || typeLabel(record.type)) + '</span>' +
      (record.rating ? '<span class="rating">★ ' + record.rating.value.toFixed(1) + '</span>' : '') +
      '</div>' +
      '<h3><a href="' + hrefDetail(record.id) + '">' + esc(record.name) + '</a></h3>' +
      '<p class="card-desc">' + esc(record.shortDescription) + '</p>' +
      priceRow(record) +
      '<div class="card-meta">' +
      '<span class="meta-item">' + ICON_STORE + esc(sellerLabel(record)) + '</span>' +
      '<span class="meta-item">' + ICON_PIN + esc(locationLabel(record)) + '</span>' +
      '<span class="status-pill ' + esc(status.tone) + '">' + esc(status.label) + '</span>' +
      '</div>' +
      '<div class="card-actions">' +
      '<a class="small-btn" href="' + hrefDetail(record.id) + '">View details</a>' +
      compareButton(record.id) +
      '</div>' +
      '</div>' +
      '</article>'
    );
  }

  /** Deal card — same family as the homepage deal card, plus offer fields. */
  function cardDeal(record) {
    const deal = record.deal;
    const state = dealState(record) || { tone: 'info', label: 'Demo offer' };
    const saved = savings(record);
    return (
      '<article class="deal-card" data-card="' + esc(record.id) + '">' +
      mediaMarkup(record, { deal: true }) +
      '<div class="card-body">' +
      '<div class="card-top">' +
      '<span class="store">' + esc(sellerLabel(record)) + ' · Demo seller</span>' +
      '<span class="status-pill ' + esc(state.tone) + '">' + esc(state.label) + '</span>' +
      '</div>' +
      '<h3><a href="' + hrefDetail(record.id) + '">' + esc(record.name) + '</a></h3>' +
      '<div class="price-row">' +
      '<span class="price">' + esc(money(deal.dealPrice, record.price && record.price.currency)) + (record.price && record.price.unit ? '/' + (UNIT_LABEL[record.price.unit] || record.price.unit) : '') + '</span>' +
      (deal.referencePrice ? '<span class="price-old">' + esc(money(deal.referencePrice, record.price && record.price.currency)) + '</span>' : '') +
      (saved ? '<span class="save-pill">Save ' + esc(saved) + '</span>' : '') +
      '</div>' +
      '<p class="card-desc">' + esc(record.shortDescription) + '</p>' +
      '<div class="card-meta">' +
      '<span class="meta-item">' + ICON_PIN + esc(locationLabel(record)) + '</span>' +
      '<span class="meta-item">' + ICON_CAL + 'Offer ends ' + esc(formatDate(deal.validTo)) + '</span>' +
      '<span class="meta-item">' + esc(deal.conditions && deal.conditions.length ? deal.conditions.length + ' condition' + (deal.conditions.length === 1 ? '' : 's') + ' (demo)' : 'No conditions listed') + '</span>' +
      '</div>' +
      '<div class="card-actions">' +
      '<a class="small-btn" href="' + hrefDetail(record.id) + '">View offer</a>' +
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

  function compareButton(id) {
    return '<button type="button" class="small-btn primary" data-compare-toggle="' + esc(id) + '">Compare</button>';
  }

  function cardGuide(guide) {
    return (
      '<article class="guide-card" data-guide="' + esc(guide.id) + '">' +
      '<div class="guide-media" aria-hidden="true">' + esc(guide.icon) + '</div>' +
      '<div class="card-body">' +
      '<div class="card-top">' +
      '<span class="store">' + esc(categoryLabel(guide.category)) + '</span>' +
      '<span class="rating">' + esc(guide.level) + ' · ' + esc(guide.readTime) + '</span>' +
      '</div>' +
      '<h3>' + esc(guide.title) + '</h3>' +
      '<p class="card-desc">' + esc(guide.summary) + '</p>' +
      '<ul class="guide-covers">' + guide.covers.map((c) => '<li>' + esc(c) + '</li>').join('') + '</ul>' +
      '<p class="guide-note">Guide outline — full articles are not part of this stage.</p>' +
      '</div>' +
      '</article>'
    );
  }

  /** Reusable empty state. */
  function emptyState(opts) {
    const o = opts || {};
    return (
      '<div class="empty" role="status">' +
      '<div class="empty-icon" aria-hidden="true">' + esc(o.icon || '🔍') + '</div>' +
      '<h3>' + esc(o.title || 'No matches found') + '</h3>' +
      '<p>' + esc(o.text || 'Try a different search term or category.') + '</p>' +
      (o.suggestions && o.suggestions.length
        ? '<div class="empty-chips">' + o.suggestions.map((s) => '<a class="chip" href="' + esc(s.href) + '">' + esc(s.label) + '</a>').join('') + '</div>'
        : '') +
      (o.actions && o.actions.length
        ? '<div class="empty-actions">' + o.actions.map((a) => '<a class="btn-secondary" href="' + esc(a.href) + '">' + esc(a.label) + '</a>').join('') + '</div>'
        : '') +
      '</div>'
    );
  }

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
    add(id) {
      if (!data.item(id)) return false;
      if (compareIds.indexOf(id) !== -1) return true;
      if (compareIds.length >= COMPARE_MAX) {
        toast('You can compare up to ' + COMPARE_MAX + ' options in this build.');
        return false;
      }
      compareIds.push(id);
      writeStore(compareIds);
      changed();
      return true;
    },
    remove(id) {
      compareIds = compareIds.filter((x) => x !== id);
      writeStore(compareIds);
      changed();
    },
    toggle(id) {
      if (compare.has(id)) {
        compare.remove(id);
        toast('Removed from comparison — nothing is saved on a server.');
      } else if (compare.add(id)) {
        toast('Added to comparison (' + compareIds.length + '/' + COMPARE_MAX + '). Demo selection only.');
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

  function syncCompareButtons() {
    $$('[data-compare-toggle]').forEach((btn) => {
      const on = compare.has(btn.getAttribute('data-compare-toggle'));
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', String(on));
      if (!btn.dataset.locked) btn.textContent = on ? 'In compare ✓' : 'Compare';
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
  function renderTray() {
    let tray = $('#compareTray');
    if (!tray) {
      tray = document.createElement('div');
      tray.id = 'compareTray';
      tray.className = 'compare-tray';
      document.body.appendChild(tray);
    }
    const items = data.items(compare.ids());
    if (!items.length) {
      tray.hidden = true;
      tray.innerHTML = '';
      document.body.classList.remove('has-tray');
      return;
    }
    tray.hidden = false;
    document.body.classList.add('has-tray');
    tray.innerHTML =
      '<div class="shell tray-inner">' +
      '<div class="tray-left">' +
      '<span class="tray-label">Compare <b>' + items.length + '/' + compare.max + '</b></span>' +
      '<div class="tray-chips">' +
      items
        .map(
          (i) =>
            '<span class="tray-chip"><span aria-hidden="true">' + esc((i.image && i.image.icon) || '📦') + '</span><span class="tray-chip-name">' + esc(i.name) + '</span>' +
            '<button type="button" class="tray-x" data-tray-remove="' + esc(i.id) + '" aria-label="Remove ' + esc(i.name) + ' from comparison">×</button></span>'
        )
        .join('') +
      '</div>' +
      '</div>' +
      '<div class="tray-right">' +
      '<button type="button" class="btn-ghost" data-tray-clear>Clear</button>' +
      '<a class="btn-primary" href="compare.html?ids=' + encodeURIComponent(compare.ids().join(',')) + '">Compare ' + items.length + ' option' + (items.length === 1 ? '' : 's') + '</a>' +
      '</div>' +
      '</div>';
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
  function renderFilters(host, state, groups, onChange) {
    if (!host) return;
    const active = state || {};
    const has = (g) => !groups || groups.indexOf(g) !== -1;

    const radioGroup = (legend, name, options) =>
      '<div class="filter-group">' +
      '<span class="filter-legend">' + esc(legend) + '</span>' +
      '<div class="filter-options">' +
      options
        .map(
          (o) =>
            '<label class="check"><input type="radio" name="' + esc(name) + '" value="' + esc(o.value) + '"' +
            (String(active[o.key]) === String(o.value) ? ' checked' : '') +
            ' /><span>' + esc(o.label) + '</span></label>'
        )
        .join('') +
      '</div></div>';

    let html = '';
    if (has('category')) {
      html += radioGroup('Category', 'f-category', [{ key: 'category', value: 'all', label: 'All categories' }].concat(
        D.categories.map((c) => ({ key: 'category', value: c.slug, label: c.icon + '  ' + c.label }))
      ));
    }
    if (has('type')) {
      html += radioGroup('Type', 'f-type', [{ key: 'type', value: 'all', label: 'Products & services' }].concat(
        D.types.map((t) => ({ key: 'type', value: t.code, label: t.label + 's' }))
      ));
    }
    if (has('band')) {
      html += radioGroup('Price range', 'f-band', D.priceBands.map((b) => ({ key: 'band', value: b.code, label: b.label })));
    }
    if (has('location')) {
      html += radioGroup('Location', 'f-location', D.locationOptions.map((l) => ({ key: 'location', value: l.code, label: l.label })));
    }
    if (has('availability')) {
      html += radioGroup('Availability', 'f-availability', [{ key: 'availability', value: 'all', label: 'Any availability' }].concat(
        D.statuses.map((s) => ({ key: 'availability', value: s.code, label: s.label }))
      ));
    }
    html += '<button type="button" class="filter-reset" data-filter-reset>Clear all filters</button>';

    host.innerHTML = html;

    $$('input[type="radio"]', host).forEach((input) => {
      input.addEventListener('change', () => {
        const key = { 'f-category': 'category', 'f-type': 'type', 'f-band': 'band', 'f-location': 'location', 'f-availability': 'availability' }[input.name];
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
      if (e.target.closest('[data-tray-clear]')) {
        compare.clear();
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
      categoryLabel, statusInfo, typeLabel, locationLabel, sellerLabel, dealState, savings,
      params, updateUrl, ready, UNIT_LABEL
    },
    data,
    search: { query: search, suggest },
    filters: { apply: applyFilters, matchesLocation, activeCount: activeFilterCount },
    sort: { apply: applySort },
    card: { item: cardItem, deal: cardDeal, guide: cardGuide, empty: emptyState, media: mediaMarkup },
    compare,
    onCompareChange,
    ui: {
      toast, mountChrome, bindSearch, renderFilters, renderSort, bindFiltersDrawer,
      syncCompareButtons, renderTray, headerMarkup, footerMarkup
    },
    hrefDetail
  };
})();
