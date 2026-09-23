/* ==========================================================================
   PickVanta — interface layer (shared by every view)
   --------------------------------------------------------------------------
   Responsibilities:
     • tiny DOM/format helpers, plus re-exports of the data layer's price and
       label helpers so view code has a single import surface (PV.util.*)
     • reusable markup builders: cards, media, empty / loading / error states
     • shared chrome: header, mobile menu, footer, toast, compare tray
     • browser-local user state: the comparison selection and recently viewed
       lists (localStorage only, ids only, no backend)

   Catalogue data is never read here — it comes from js/store.js. No framework,
   no dependencies, no network calls.
   ========================================================================== */
window.PV = Object.assign(window.PV || {}, (function () {
  'use strict';

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

  /* ------------------------------------------------------ data-derived values */
  /* Formatting that belongs to the catalogue model (prices, labels, availability
     and offer windows) is implemented once — in js/domain.js and re-exported by
     js/store.js — and surfaced here as PV.util.* so view code has one import
     surface. */
  const S = window.PV.store;
  if (!S) throw new Error('PickVanta: js/store.js must load before js/core.js');

  const money = S.money;
  const defaultCurrency = S.defaultCurrency;
  const priceText = S.priceText;
  const priceValue = S.priceValue;
  const priceUnitSuffix = S.priceUnitSuffix;
  const categoryLabel = S.categoryLabel;
  const subcategoryLabel = S.subcategoryLabel;
  const availabilityInfo = S.availabilityInfo;
  const listingStatusLabel = S.listingStatusLabel;
  const typeLabel = S.typeLabel;
  const locationLabel = S.locationLabel;
  const serviceAreaText = S.serviceAreaText;
  const sellerLabel = S.sellerLabel;
  const offerKindLabel = S.offerKindLabel;
  const formatDate = S.formatDate;
  const primaryImage = S.primaryImage;

  /* Offer window as the interface shows it. The store returns the offer's own
     status and days left; this adds the tone and the wording — and never adds
     urgency the data does not contain. */
  function offerState(record) {
    const state = S.offerState(record);
    if (!state || state.code === 'none') return null;
    if (state.code === 'ended') return { code: 'ended', tone: 'muted', label: 'Demo offer ended ' + formatDate(state.endsAt) };
    if (state.code === 'scheduled') return { code: 'scheduled', tone: 'info', label: 'Starts ' + formatDate(state.startsAt) };
    if (state.code === 'withdrawn') return { code: 'withdrawn', tone: 'muted', label: 'Demo offer withdrawn' };
    if (state.daysLeft != null && state.daysLeft <= 14) return { code: 'ending', tone: 'warn', label: 'Ends ' + formatDate(state.endsAt) };
    return { code: 'active', tone: 'ok', label: 'Ends ' + formatDate(state.endsAt) };
  }

  function savings(record) {
    const value = S.savingsValue(record);
    return value == null ? null : money(value, record.currency || defaultCurrency());
  }

  /* Search, filtering, sorting and related-option logic live in the data-access
     layer (js/store.js) — there is exactly one implementation of each. */

  /* ----------------------------------------------------------- card markup */
  const ICON_PIN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
  const ICON_STORE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 4.5 4h15L21 9.5"/><path d="M4 9.5V20h16V9.5"/><path d="M9 20v-6h6v6"/></svg>';
  const ICON_CAL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>';

  /* Images are optional and may fail to load. A record with no src shows its
     icon tile; a record whose image does not load is swapped for the local
     placeholder by the delegated error handler (bindMediaFallback) — no
     external image service, no broken-image icon, no layout shift. */
  const FALLBACK_IMAGE = 'assets/placeholder.svg';

  function mediaMarkup(record, opts) {
    const o = opts || {};
    const rec = record || {};
    if (!rec.id || !rec.name) {
      /* Defensive: a record with no identity renders a quiet tile rather than a
         link to "detail.html?id=undefined". */
      return '<div class="card-media"><span class="media-icon" aria-hidden="true">📦</span></div>';
    }
    const img = primaryImage(rec) || {};
    const style = img.gradient ? ' style="background:' + img.gradient + '"' : '';
    const inner = img.src
      ? '<img class="media-img" src="' + esc(img.src) + '" alt="' + esc(img.alt || rec.name || 'Listing image') + '" loading="lazy" decoding="async" />' +
        '<span class="media-icon" aria-hidden="true" hidden>' + esc(img.icon || '📦') + '</span>'
      : '<span class="media-icon" aria-hidden="true">' + esc(img.icon || '📦') + '</span>';
    const flags =
      '<span class="type-flag">' + esc(typeLabel(rec.type)) + '</span>' +
      (o.offer && rec.offer
        ? '<span class="discount">-' + rec.offer.discountPercent + '% · Demo</span>'
        : rec.badge
        ? '<span class="badge-pill ' + esc(rec.badge.tone || 'neutral') + ' flag-right">' + esc(rec.badge.label) + '</span>'
        : '');
    return (
      '<a class="card-media-link" href="' + hrefDetail(rec.id) + '" aria-label="' + esc(rec.name || 'Open listing') + '">' +
      '<div class="card-media"' + style + '>' +
      flags +
      inner +
      '</div></a>'
    );
  }

  const hrefDetail = (id) => (id ? 'detail.html?id=' + encodeURIComponent(id) : 'discover.html');

  /**
   * Discovery card.
   * Visual hierarchy: category + type → name → description → price →
   * seller/location → availability → actions. A card with an offer also gets a
   * discount flag and a "Demo offer" pill so the offer is never mistaken for
   * the item itself.
   */
  function cardItem(record, opts) {
    const o = opts || {};
    const status = availabilityInfo(record.availability);
    const offer = record.offer ? offerState(record) : null;
    return (
      '<article class="product-card" data-card="' + esc(record.id) + '">' +
      mediaMarkup(record, { offer: !!record.offer }) +
      '<div class="card-body">' +
      '<div class="card-top">' +
      '<span class="store">' + esc(categoryLabel(record.category)) +
      (record.subcategory ? ' <span class="store-sub">· ' + esc(subcategoryLabel(record.subcategory)) + '</span>' : '') +
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

  /**
   * Offer card. An offer is never presented as its own product: the card shows
   * the underlying listing, then an explicit "special offer" block with
   * original price → offer price → saving, then seller, location, validity and
   * conditions. Everything is labelled as demo data, and no urgency is shown
   * unless the offer's own dates provide it.
   */
  function cardOffer(record) {
    const offer = record.offer;
    const state = offerState(record) || { tone: 'info', label: 'Demo offer' };
    const saved = savings(record);
    const currency = record.currency || S.defaultCurrency();
    const unit = priceUnitSuffix(record.price && record.price.priceType);
    return (
      '<article class="deal-card" data-card="' + esc(record.id) + '">' +
      mediaMarkup(record, { offer: true }) +
      '<div class="card-body">' +
      '<div class="card-top">' +
      '<span class="store">' + esc(categoryLabel(record.category)) +
      (record.subcategory ? ' <span class="store-sub">· ' + esc(subcategoryLabel(record.subcategory)) + '</span>' : '') +
      '</span>' +
      '<span class="type-chip">' + esc(typeLabel(record.type)) + '</span>' +
      '</div>' +
      '<h3><a href="' + hrefDetail(record.id) + '">' + esc(record.name) + '</a></h3>' +
      '<p class="card-desc">' + esc(record.shortDescription) + '</p>' +
      '<div class="offer-block">' +
      '<span class="offer-flag">Special offer · demo</span>' +
      (offer.title ? '<p class="offer-headline">' + esc(offer.title) + '</p>' : '') +
      '<div class="offer-prices">' +
      '<span class="offer-was">Was <s>' + esc(money(offer.originalPrice, currency)) + unit + '</s></span>' +
      '<span class="offer-now">Now <strong>' + esc(money(offer.offerPrice, currency)) + unit + '</strong></span>' +
      (offer.discountPercent ? '<span class="save-pill">Save ' + offer.discountPercent + '%' + (saved ? ' · ' + esc(saved) : '') + '</span>' : '') +
      '</div>' +
      '</div>' +
      '<div class="card-meta">' +
      '<span class="meta-item">' + ICON_STORE + esc(sellerLabel(record)) + '<span class="meta-demo">demo</span></span>' +
      '<span class="meta-item">' + ICON_PIN + esc(locationLabel(record)) + '</span>' +
      '<span class="meta-item">' + ICON_CAL + (offer.endsAt ? 'Offer ends ' + esc(formatDate(offer.endsAt)) : 'No end date given') + '</span>' +
      '<span class="status-pill ' + esc(state.tone) + '">' + esc(state.label) + '</span>' +
      (offer.conditions.length
        ? '<span class="meta-item">' + offer.conditions.length + ' condition' + (offer.conditions.length === 1 ? '' : 's') + ' (demo)</span>'
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
    const offer = record.offer || null;
    const ref = record.referencePrice != null ? record.referencePrice : (offer ? offer.originalPrice : null);
    const currency = record.currency || S.defaultCurrency();
    return (
      '<div class="price-row">' +
      '<span class="price">' + esc(priceText(record)) + '</span>' +
      (offer && offer.offerPrice != null
        ? '<span class="price-old">' + esc(money(offer.originalPrice, currency)) + '</span>'
        : ref != null
        ? '<span class="price-old">ref. ' + esc(money(ref, currency)) + '</span>'
        : '') +
      (offer && savings(record) ? '<span class="save-pill">Save ' + esc(savings(record)) + '</span>' : '') +
      '</div>'
    );
  }

  /** Compare toggle used on every card and on the detail page. */
  function compareButton(id) {
    const record = S.item(id);
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
      '<ul class="guide-covers">' + guide.sections.map((c) => '<li>' + esc(c.title) + '</li>').join('') + '</ul>' +
      '</details>' +
      '<div class="guide-foot">' +
      '<span class="rating">' + esc(guide.level) + ' · ' + esc(guide.readTime) + '</span>' +
      '<button type="button" class="link-btn guide-open" data-later="Guide articles">Read outline</button>' +
      '</div>' +
      /* Guides are decision-support entry points: each one opens a matching
         slice of the catalogue using the existing filters. */
      (guide.cta && guide.cta.href
        ? '<a class="guide-link" href="' + esc(guide.cta.href) + '">' + esc(guide.cta.label) +
          ' <span aria-hidden="true">→</span></a>'
        : '') +
      /* The listings a guide actually discusses, resolved through the store:
         decision support that never turns into an advertisement. */
      (function () {
        const examples = S.guideListings(guide).slice(0, 3);
        return examples.length
          ? '<p class="guide-related">Listings mentioned: ' + examples.map((r) =>
              '<a href="' + hrefDetail(r.id) + '">' + esc(r.name) + '</a>').join(', ') + '</p>'
          : '';
      })() +
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
  /** Reusable "loading" state — used by a page whose data source is async. */
  function loadingState(opts) {
    const o = opts || {};
    return (
      '<div class="empty state-loading" role="status" aria-live="polite">' +
      '<div class="empty-icon" aria-hidden="true">⏳</div>' +
      '<h3>' + esc(o.title || 'Loading options…') + '</h3>' +
      '<p>' + esc(o.text || 'Fetching the catalogue.') + '</p>' +
      '</div>'
    );
  }

  /**
   * Reusable "could not load" state. It never hides the problem: the message is
   * shown and a retry action is offered. Pages bind [data-state-action="retry"].
   */
  function errorState(opts) {
    const o = opts || {};
    return (
      '<div class="empty state-error" role="alert">' +
      '<div class="empty-icon" aria-hidden="true">⚠️</div>' +
      '<h3>' + esc(o.title || "We couldn't load these options right now.") + '</h3>' +
      '<p>' + esc(o.text || 'Nothing was changed. Try again, or browse the categories below.') + '</p>' +
      (o.detail ? '<p class="state-detail">' + esc(o.detail) + '</p>' : '') +
      '<div class="empty-actions">' +
      '<button type="button" class="btn-primary" data-state-action="retry">Try again</button>' +
      (o.actions || []).map((a) => '<a class="btn-secondary" href="' + esc(a.href) + '">' + esc(a.label) + '</a>').join('') +
      '</div>' +
      '</div>'
    );
  }

  function emptyState(opts) {
    const o = opts || {};
    /* Inline empty states sit under an existing heading (h3); a state that
       replaces a whole page takes the page heading (h1). */
    const level = o.level === 1 ? 1 : 3;
    return (
      '<div class="empty" role="status">' +
      '<div class="empty-icon" aria-hidden="true">' + esc(o.icon || '🔍') + '</div>' +
      '<h' + level + '>' + esc(o.title || 'No matches found') + '</h' + level + '>' +
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

  /* Only the shape of the stored value is checked here: whether an id still
     exists in the catalogue is decided once the data layer has answered (see
     `hydrate` below), because with the API adapter nothing is known at load
     time. */
  function readRecent() {
    let stored = [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]');
      if (Array.isArray(parsed)) stored = parsed.filter((id) => typeof id === 'string' && id);
    } catch (e) {
      return [];
    }
    return stored.slice(0, RECENT_MAX);
  }

  /* Ids that are no longer in the catalogue are dropped after a fetch, so a
     deleted record can never render an empty card. */
  function pruneRecent(known) {
    const keep = recentIds.filter((id) => known.indexOf(id) !== -1);
    if (keep.length === recentIds.length) return false;
    recentIds = keep;
    persistRecent();
    return true;
  }

  const recent = {
    max: RECENT_MAX,
    ids: () => recentIds.slice(),
    /** Records the data layer already holds — no request. */
    items: () => S.items(recentIds),
    /** The stored records, fetched through the data layer when not yet known. */
    hydrate() {
      if (!recentIds.length) return Promise.resolve([]);
      return S.hydrate(recentIds).then((records) => {
        pruneRecent(records.map((r) => r.id));
        return records;
      });
    },
    count: () => recentIds.length,
    has: (id) => recentIds.indexOf(id) !== -1,
    add(id, record) {
      const known = record || S.item(id);
      if (!id || !known) return;
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
      return Array.isArray(val)
        ? val.filter((id) => typeof id === 'string' && id).slice(0, COMPARE_MAX)
        : [];
    } catch (e) {
      return [];
    }
  }

  /* A stored id is only known to be valid once the data layer has answered
     (the API adapter has no catalogue at load time), so stale ids are dropped
     after a fetch instead of at read time. */
  function pruneCompare(known) {
    const keep = compareIds.filter((id) => known.indexOf(id) !== -1);
    if (keep.length === compareIds.length) return false;
    compareIds = keep;
    writeStore(compareIds);
    return true;
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
    /** The selected records, fetched through the data layer when not yet held. */
    hydrate() {
      if (!compareIds.length) return Promise.resolve([]);
      return S.hydrate(compareIds).then((records) => {
        if (pruneCompare(records.map((r) => r.id))) changed();
        return records;
      });
    },
    /* `name` comes from the control that was clicked, so the messages work
       even before the record has been fetched. */
    add(id, name) {
      if (!id) return false;
      const record = S.item(id);
      const label = name || (record ? record.name : 'this option');
      if (compareIds.indexOf(id) !== -1) return true;
      if (compareIds.length >= COMPARE_MAX) {
        toast('You can compare up to ' + COMPARE_MAX + ' options. Remove one from the tray below to swap it for “' + label + '”.');
        return false;
      }
      compareIds.push(id);
      writeStore(compareIds);
      announce('Added “' + label + '”. ' + compareIds.length + ' of ' + COMPARE_MAX + ' selected for comparison.');
      changed();
      return true;
    },
    remove(id) {
      const record = S.item(id);
      compareIds = compareIds.filter((x) => x !== id);
      writeStore(compareIds);
      announce((record ? 'Removed “' + record.name + '”. ' : 'Removed an option. ') + compareIds.length + ' of ' + COMPARE_MAX + ' selected for comparison.');
      changed();
    },
    toggle(id, name) {
      if (compare.has(id)) {
        compare.remove(id);
        toast('Removed from comparison. This selection only exists in your browser — nothing is saved on a server.');
      } else if (compare.add(id, name)) {
        const left = COMPARE_MAX - compareIds.length;
        toast(
          'Added to comparison (' + compareIds.length + ' of ' + COMPARE_MAX + '). ' +
            (left > 0
              ? 'Add ' + left + ' more option' + (left === 1 ? '' : 's') + ', or open the comparison now.'
              : 'Tray full — open Compare, or remove an option to swap.')
        );
      }
    },
    set(ids) {
      compareIds = (ids || []).filter((id) => typeof id === 'string' && id).slice(0, COMPARE_MAX);
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
      const name = btn.getAttribute('data-compare-name') || (S.item(id) || {}).name || 'this option';
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
      '<div class="footer-col"><h2>' + esc(title) + '</h2>' +
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
      /* The demonstration notice lives in the dataset, not in this template. */
      '<p>Modern discovery, comparison and deals platform. Find, compare, and choose products, services, and deals in one place. ' +
      '<span id="footerNotice"></span></p>' +
      '</div>' +
      col('Product', [
        { label: 'Home', href: 'index.html' },
        { label: 'Discover', href: 'discover.html' },
        { label: 'Deals', href: 'deals.html' },
        { label: 'Compare', href: 'compare.html' },
        { label: 'Guides', href: 'guides.html' }
      ]) +
      /* Filled from the catalogue once the data layer is ready. */
      '<div class="footer-col"><h2>Browse</h2><span id="footerBrowse"></span></div>' +
      col('Company', [
        { label: 'Account', later: 'Account' },
        { label: 'Contact', later: 'Contact' },
        { label: 'About', later: 'About' }
      ]) +
      '</div>' +
      '<div class="footer-bottom">' +
      '<p>© 2026 PickVanta. <span id="footerBuild">Demo build</span> — no accounts, payments or live pricing.</p>' +
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
    const items = S.items(compare.ids());
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
                '<span class="tray-thumb" aria-hidden="true">' + esc((primaryImage(i) || {}).icon || '📦') + '</span>' +
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

  /* --------------------------------------------------------- media fallback */
  /* One delegated listener for every listing image: if an image cannot load,
     the tile falls back to the bundled placeholder and keeps its alt text. */
  function bindMediaFallback() {
    if (window.__pvMediaFallback) return;
    window.__pvMediaFallback = true;
    document.addEventListener('error', (e) => {
      const img = e.target;
      if (!img || !img.classList || !img.classList.contains('media-img')) return;
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = '1';
      img.classList.add('media-img-fallback');
      img.src = FALLBACK_IMAGE;
    }, true);
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
      const rows = S.suggest(input.value, 6);
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
        S.categories().map((c) => ({ key: 'category', value: c.slug, label: c.icon + '  ' + c.label }))
      ));
    }
    /* Subcategory only appears once a category is chosen: it lists that
       category's own subcategories, so it never becomes a wall of options. */
    if (has('subcategory') && active.category && active.category !== 'all') {
      const subs = S.subcategories(active.category);
      /* Counts come from the data layer's facet totals — the filter panel never
         needs a copy of the catalogue to draw itself. */
      const countIn = (sub) => {
        const c = counts && counts.subcategory ? counts.subcategory[sub] : null;
        return typeof c === 'number' ? c : 0;
      };
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
        S.types().map((t) => ({ key: 'type', value: t.code, label: t.label + 's' }))
      ));
    }
    if (has('band')) {
      html += radioGroup('Price range', 'f-band', null, S.priceBands().map((b) => ({ key: 'band', value: b.code, label: b.label })));
    }
    if (has('location')) {
      html += radioGroup('Location', 'f-location', null, S.locationOptions().map((l) => ({ key: 'location', value: l.code, label: l.label })));
    }
    if (has('tag')) {
      const activeTag = active.tag && active.tag !== 'all' ? active.tag : 'all';
      const all = S.tags();
      const popular = S.popularTags();
      const isPopular = (t) => popular.indexOf(t) !== -1;
      /* A tag that is not in the shortcut list still needs a visible radio, so
         the current selection is always on screen. */
      const ordered = all
        .filter((t) => isPopular(t.tag) || t.tag === activeTag)
        .sort((a, b) => popular.indexOf(a.tag) - popular.indexOf(b.tag));
      const rest = all.filter((t) => ordered.indexOf(t) === -1);
      /* The store normalises tag counts to { tag, label, count }; the fallbacks
         keep a malformed row from ever rendering an empty label or
         "undefined" — a missing count simply shows no number. */
      const tagRadio = (t) =>
        '<label class="check"><input type="radio" name="f-tag" value="' + esc(t.tag) + '"' +
        (activeTag === t.tag ? ' checked' : '') + ' />' +
        '<span class="check-label">' + esc(t.label || S.tagLabel(t.tag)) + '</span>' +
        (typeof t.count === 'number' ? '<span class="check-count">' + t.count + '</span>' : '') +
        '</label>';

      html +=
        '<div class="filter-group">' +
        '<span class="filter-legend">Tag</span>' +
        '<div class="filter-options">' +
        '<label class="check"><input type="radio" name="f-tag" value="all"' + (activeTag === 'all' ? ' checked' : '') + ' />' +
        '<span class="check-label">All tags</span></label>' +
        ordered.map(tagRadio).join('') +
        '</div>' +
        (all.length ? '' :
          '<p class="filter-note">No tags are published in this catalogue yet.</p>') +
        (rest.length
          ? '<details class="filter-more"><summary>More tags (' + rest.length + ')</summary>' +
            '<div class="filter-options">' + rest.map(tagRadio).join('') + '</div></details>'
          : '') +
        '<p class="filter-note">Tags describe what a record is good for, how it is used or where it is — they are keywords, not scores.</p>' +
        '</div>';
    }
    if (has('availability')) {
      html += radioGroup('Availability', 'f-availability', 'availability', [{ key: 'availability', value: 'all', label: 'Any availability' }].concat(
        S.availabilityOptions().map((s) => ({ key: 'availability', value: s.code, label: s.label }))
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
    select.innerHTML = S.sortOptions().map((o) => '<option value="' + esc(o.code) + '">' + esc(o.label) + '</option>').join('');
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
  /* The footer names the catalogue (categories, build label, dataset notice).
     Those come from the data layer, so they are written once it has answered —
     the chrome itself is painted once and never repainted, which keeps its
     event handlers intact. */
  /* A dataset that is not the live one must never be passed off as live. When
     the data layer falls back from the API to the bundled demonstration
     catalogue (config.onFailure = 'demo'), the page says so, once, at the top
     of the content. */
  function showFallbackNotice() {
    if ($('#fallbackNotice')) return;
    const main = $('#main');
    if (!main) return;
    const notice = document.createElement('div');
    notice.className = 'notice warning';
    notice.id = 'fallbackNotice';
    notice.setAttribute('role', 'status');
    notice.textContent =
      'The live catalogue could not be reached, so the bundled demonstration catalogue is being shown instead. ' +
      'Every listing, price, seller and offer here is invented demonstration content — nothing on this page is live.';
    main.insertBefore(notice, main.firstChild);
  }

  function fillChrome() {
    const noticeHost = $('#footerNotice');
    if (noticeHost) noticeHost.textContent = S.notice();

    const buildHost = $('#footerBuild');
    if (buildHost) {
      const live = S.source() === 'api' && !S.fallbackActive();
      buildHost.textContent = (live ? 'Live catalogue build ' : 'Demo build ') + S.version();
    }

    const browseHost = $('#footerBrowse');
    if (browseHost) {
      browseHost.innerHTML = S.categories().slice(0, 5)
        .map((c) => '<a href="discover.html?category=' + esc(c.slug) + '">' + esc(c.label) + '</a>')
        .join('');
    }
  }

  function mountChrome(activePage) {
    bindMediaFallback();
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
          toast('Search ' + S.catalogue().phrase + ' — type a product, service, brand or category.');
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
        compare.toggle(toggle.getAttribute('data-compare-toggle'), toggle.getAttribute('data-compare-name'));
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

    /* The catalogue arrives asynchronously (the API adapter fetches it), so the
       chrome is completed and the browser-side selection is re-resolved as soon
       as the data layer is ready. A failure here is not fatal: the page itself
       shows the error state and the tray simply stays as it is. */
    S.init().then(() => {
      fillChrome();
      if (S.fallbackActive()) showFallbackNotice();
      return Promise.all([compare.hydrate(), recent.hydrate()]);
    }).then(() => {
      syncCompareButtons();
      renderTray();
      compareListeners.forEach((fn) => { try { fn(compare.ids()); } catch (e) {} });
      recentListeners.forEach((fn) => { try { fn(); } catch (e) {} });
    }).catch(() => {
      fillChrome();
    });
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
    /* Presentation helpers. The format/label helpers are re-exports of the
       data layer's model helpers — there is one implementation of each. */
    util: {
      $, $$, esc, money, defaultCurrency, priceText, priceValue, priceUnitSuffix, formatDate,
      categoryLabel, subcategoryLabel, typeLabel, locationLabel, serviceAreaText, sellerLabel,
      availabilityInfo, listingStatusLabel, offerState, savings, offerKindLabel, primaryImage,
      params, updateUrl, ready
    },
    /* The data-access layer, re-exported for pages that want it by name. */
    store: S,
    card: { item: cardItem, offer: cardOffer, guide: cardGuide, media: mediaMarkup, empty: emptyState, loading: loadingState, error: errorState },
    compare,
    onCompareChange,
    recent,
    onRecentChange,
    ui: {
      toast, announce, mountChrome, bindSearch, renderFilters, renderSort, bindFiltersDrawer,
      syncCompareButtons, renderTray, toggleTray, headerMarkup, footerMarkup, bindMediaFallback
    },
    hrefDetail
  };
})());
