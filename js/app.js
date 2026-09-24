/* ==========================================================================
   PickVanta — Home view (index.html)
   The landing page keeps its existing design. Everything it previews comes
   from the catalogue through the data layer (js/store.js) — the homepage holds
   no records of its own, so it works the same whether the catalogue is served
   by the demo adapter or by the live read-only API.
   ========================================================================== */
/* Category identity colours, assigned in taxonomy order. Kept here because it
   is presentation: the catalogue still decides what a category is. */
const TILE_TONES = [
  { accent: 'var(--grad-cobalt)', soft: 'var(--accent-soft)' },
  { accent: 'var(--grad-teal)', soft: 'var(--teal-soft)' },
  { accent: 'var(--grad-coral)', soft: 'var(--coral-soft)' },
  { accent: 'var(--grad-sun)', soft: '#FFF4E2' },
  { accent: 'linear-gradient(135deg,#6D4AFF,#B24AF2)', soft: 'var(--violet-soft)' },
  { accent: 'linear-gradient(135deg,#0EAE9B,#2B4BF2)', soft: 'var(--teal-soft)' },
  { accent: 'linear-gradient(135deg,#FF3B7B,#6D4AFF)', soft: 'var(--coral-soft)' },
  { accent: 'linear-gradient(135deg,#F5A524,#0EAE9B)', soft: 'var(--accent-soft)' }
];

PV.util.ready(function () {
  const U = PV.util;
  PV.ui.mountChrome(null);

  /* ------------------------------------------------------------ hero search */
  const heroForm = U.$('#searchForm');
  if (heroForm) {
    const box = PV.ui.bindSearch({
      root: heroForm,
      onSubmit: function (q) {
        if (!q) {
          const input = U.$('#searchInput');
          if (input) input.focus();
          PV.ui.toast('Type something to search — e.g. “headphones”, “internet” or “furniture”.');
          return;
        }
        window.location.href = 'discover.html?q=' + encodeURIComponent(q);
      }
    });
    if (U.params().get('focus') === 'search' && box) box.focus();
  }

  /* Example chips fill the field and search immediately. */
  U.$$('[data-fill]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      const value = chip.getAttribute('data-fill');
      const input = U.$('#searchInput');
      if (input) input.value = value;
      window.location.href = 'discover.html?q=' + encodeURIComponent(value);
    });
  });

  /* ----------------------------------------------------- recently viewed */
  /* Browser-only: the ids live in this device's storage and the records are
     resolved through the data layer like everything else. */
  const recentHost = U.$('#homeRecent');
  const recentSection = U.$('#recent');
  const recentClear = U.$('#recentClear');

  function renderRecent() {
    if (!recentHost || !recentSection) return;
    PV.recent.hydrate().then(function (items) {
      if (!items.length) {
        recentSection.hidden = true;
        recentHost.innerHTML = '';
        return;
      }
      recentSection.hidden = false;
      recentHost.innerHTML = items.map(function (record) {
        return '<a class="recent-item" href="' + U.esc(PV.hrefDetail(record.id)) + '">' +
          '<span class="recent-icon" aria-hidden="true">' + U.esc((U.primaryImage(record) || {}).icon || '📦') + '</span>' +
          '<span class="recent-text">' +
            '<strong>' + U.esc(record.name) + '</strong>' +
            '<small>' + U.esc(U.typeLabel(record.type)) + ' · ' + U.esc(U.categoryLabel(record.category)) + ' · ' + U.esc(U.priceText(record)) + '</small>' +
          '</span>' +
          '<span class="recent-arrow" aria-hidden="true">→</span>' +
          '</a>';
      }).join('');
    }).catch(function () {
      recentSection.hidden = true;
      recentHost.innerHTML = '';
    });
  }

  if (recentClear) {
    recentClear.addEventListener('click', function () {
      PV.recent.clear();
      PV.ui.toast('Cleared the recently viewed list on this device. Nothing was ever stored on a server.');
      recentSection.hidden = true;
    });
  }

  /* ---------------------------------------------- live compare state on home */
  /* Compare selection is browser-side, so this section never waits for the
     catalogue: it only reflects what the visitor already picked. */
  const ctaSide = U.$('.compare-cta-side');
  function renderCompareState() {
    const count = PV.compare.count();
    const existing = U.$('#homeCompareState');

    if (!count) {
      if (existing) existing.remove();
      if (ctaSide) ctaSide.classList.remove('has-selection');
      return;
    }
    const html =
      '<div class="cta-state" id="homeCompareState">' +
      '<span class="cta-state-label">' + count + ' of ' + PV.compare.max + ' selected for comparison</span>' +
      '<a class="link-arrow" href="compare.html?ids=' + encodeURIComponent(PV.compare.ids().join(',')) + '">Open your comparison <span aria-hidden="true">→</span></a>' +
      '</div>';
    if (existing) existing.outerHTML = html;
    else if (ctaSide) ctaSide.insertAdjacentHTML('afterbegin', html);
    if (ctaSide) ctaSide.classList.add('has-selection');
  }
  renderCompareState();
  PV.onCompareChange(renderCompareState);

  /* ======================================================================
     Catalogue previews
     ----------------------------------------------------------------------
     Every preview below is rendered from the catalogue, so the page waits for
     the data layer first. If the catalogue cannot be reached the preview
     sections show one honest error state with a retry action — the homepage is
     never left half-built, and a real failure is never hidden.
     ====================================================================== */
  const previewHosts = ['#homeDiscover', '#homeCategories', '#homeDeals', '#homeGuides'];

  function previewFailure(err) {
    const card = PV.card.error({
      detail: err && err.message ? err.message : '',
      actions: [
        { label: 'Open Discover', href: 'discover.html' },
        { label: 'Open Guides', href: 'guides.html' }
      ]
    });
    previewHosts.forEach(function (selector) {
      const host = U.$(selector);
      if (host) host.innerHTML = card;
    });
    PV.ui.announce("We couldn't load the catalogue just now.");
  }

  /* The hero composition: three real catalogue records as large tiles. It is
     presentation only — the records, their names, categories and prices all
     come from the store, so the homepage shows the catalogue it is actually
     connected to and never invents a product. */
  function renderHeroCollage(host, records) {
    const tiles = (records || []).filter(function (r) { return r && r.id; }).slice(0, 3);
    if (!tiles.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = tiles.map(function (record) {
      const img = U.primaryImage(record) || {};
      const visual = img.src
        /* media-img opts the tile into the shared broken-image fallback */
        ? '<img class="media-img" src="' + U.esc(img.src) + '" alt="" loading="eager" decoding="async" />'
        : '<span class="collage-tile" aria-hidden="true"' + (img.gradient ? ' style="background:' + U.esc(img.gradient) + '"' : '') + '>' +
          U.esc(img.icon || '📦') + '</span>';
      const label = U.categoryLabel(record.category);
      const name = String(record.name || '').split(' — ')[0] || record.name;
      return '<a href="' + PV.hrefDetail(record.id) + '" aria-label="' + U.esc(name + ' — ' + label + ', ' + U.priceText(record)) + '">' +
        visual +
        '<span class="collage-label"><span>' + U.esc(label) + '</span><b>' + U.esc(U.priceText(record)) + '</b></span>' +
        '</a>';
    }).join('');
  }

  function renderCatalogue() {
    /* ---------------------------------------------------- hero preview card */
    /* The three options shown in the hero compare preview come from the same
       records the Compare page seeds itself with — nothing is hard-coded in the
       markup. Names are shortened and attribute values trimmed so the small
       preview keeps its shape whatever the catalogue contains. */
    const heroList = U.$('#heroCompareList');
    if (heroList) {
      const heroIds = PV.store.defaultCompareIds();
      const heroCount = U.$('#heroOptionCount');
      if (heroCount) heroCount.textContent = heroIds.length + ' options';
      PV.store.hydrate(heroIds).then(function (heroRecords) {
        heroList.innerHTML = heroRecords.map(function (record) {
          const facts = (record.specifications || [])
            .map(function (a) { return String(a.value || '').split(',')[0].trim(); })
            .filter(function (v) { return v && v.length <= 16; })
            .slice(0, 3);
          const shortName = String(record.name || '').split(' — ')[0] || record.name;
          return (
            '<div class="option">' +
            '<div class="option-main">' +
            '<div class="option-icon" aria-hidden="true">' + U.esc((U.primaryImage(record) || {}).icon || '📦') + '</div>' +
            '<div class="option-meta">' +
            '<div class="option-name">' + U.esc(shortName) + '</div>' +
            '<div class="option-spec">' + U.esc((record.brand || U.sellerLabel(record)) + ' · ' + U.priceText(record)) + '</div>' +
            '</div>' +
            '</div>' +
            '<div class="option-right"><div class="option-facts">' +
            facts.map(function (f) { return '<span>' + U.esc(f) + '</span>'; }).join('') +
            '</div></div>' +
            '</div>'
          );
        }).join('');
      }).catch(function () {
        /* the hero card is decorative — an empty list is better than an error */
        heroList.innerHTML = '';
      });
    }

    /* ------------------------------------------------------ category grid */
    const catHost = U.$('#homeCategories');
    if (catHost) {
      const counts = PV.store.facets();
      catHost.innerHTML = PV.store.categories().map(function (c, index) {
        const count = counts.category[c.slug] || 0;
        /* Colour is identity, not data: the palette is assigned by position in
           the taxonomy, so a different catalogue simply gets a different
           rotation and nothing here has to know any category by name. */
        const tone = TILE_TONES[index % TILE_TONES.length];
        return '<a class="category" style="--tile-accent:' + tone.accent + ';--tile-soft:' + tone.soft + '" ' +
          'href="discover.html?category=' + U.esc(c.slug) + '" role="listitem">' +
          '<div class="cat-icon" aria-hidden="true">' + U.esc(c.icon) + '</div>' +
          '<strong>' + U.esc(c.label) + '</strong>' +
          '<span>' + U.esc(c.blurb) + '</span>' +
          '<span class="cat-count">' + count + ' demo record' + (count === 1 ? '' : 's') + '</span>' +
          '</a>';
      }).join('');
    }

    /* ------------------------------------------------------- deals preview */
    const dealHost = U.$('#homeDeals');
    if (dealHost) {
      PV.store.home().then(function (home) {
        dealHost.innerHTML = home.deals.map(function (record) { return PV.card.offer(record); }).join('');
      }).catch(previewFailure);
    }

    /* ---------------------------------------------------- explore by need */
    /* Each shortcut is a tag filter or a plain search into Discover — the same
       URL state every other part of the app uses. Nothing is personalised. */
    const needsHost = U.$('#homeNeeds');
    if (needsHost) {
      const needs = PV.store.needs();
      const groups = [];
      needs.forEach(function (n) {
        let g = groups.filter(function (x) { return x.label === n.group; })[0];
        if (!g) { g = { label: n.group, rows: [] }; groups.push(g); }
        g.rows.push(n);
      });
      needsHost.innerHTML = groups.map(function (g) {
        return '<div class="need-group">' +
          '<span class="need-group-label">' + U.esc(g.label) + '</span>' +
          '<div class="need-chips">' +
          g.rows.map(function (n) {
            const href = n.tag
              ? 'discover.html?tag=' + encodeURIComponent(n.tag)
              : 'discover.html?q=' + encodeURIComponent(n.q);
            const meta = n.tag ? 'tag: ' + PV.store.tagLabel(n.tag) : 'search: ' + n.q;
            return '<a class="chip need-chip" href="' + href + '" title="' + U.esc(meta) + '">' +
              '<span aria-hidden="true">' + U.esc(n.icon) + '</span> ' + U.esc(n.label) + '</a>';
          }).join('') +
          '</div>' +
          '</div>';
      }).join('');
    }

    /* ---------------------------------------------------- discover preview */
    const discoverHost = U.$('#homeDiscover');
    const collageHost = U.$('#heroCollage');
    if (discoverHost || collageHost) {
      /* A curated slice — spread across categories and price bands — so the
         homepage stays a shop window and the full catalogue stays in Discover. */
      PV.store.home().then(function (home) {
        if (collageHost) renderHeroCollage(collageHost, home.featured);
        if (discoverHost) {
          discoverHost.innerHTML = home.featured.map(function (record) { return PV.card.item(record); }).join('');
        }
      }).catch(previewFailure);
    }

    /* ----------------------------------------------------- guides preview */
    const guideHost = U.$('#homeGuides');
    if (guideHost) {
      PV.store.home().then(function (home) {
        guideHost.innerHTML = home.guides.map(function (guide) { return PV.card.guide(guide); }).join('');
      }).catch(previewFailure);
    }

    /* The homepage previews are a small slice of the whole catalogue, so the
       note under them reports the dataset's own counters. */
    const countHost = U.$('#homeDatasetNote');
    if (countHost) {
      const stats = PV.store.stats();
      const cities = (stats.locationCities || []).filter(function (c) { return ['Online', 'Nationwide'].indexOf(c) === -1; });
      /* The count is about the catalogue; the wording says where it came from,
         so a live page never describes the published catalogue as a demo. The
         records themselves stay demonstration content in both modes. */
      const cat = PV.store.catalogue();
      countHost.textContent =
        stats.listings + ' records, ' + stats.offers + ' offers and ' +
        stats.guides + ' guide outlines ' +
        (cat.live ? 'are served from the published catalogue' : 'are included in the bundled demonstration catalogue') +
        ' — covering ' +
        stats.categories + ' categories, ' + stats.subcategories + ' subcategories and ' +
        cities.length + ' locations. Every record is demonstration content: no real sellers, no real prices, ' +
        'no live availability.';
    }
  }

  /* Retry: the error state asks the data layer again (a single reload, so a
     failed start-up is not retried forever). */
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-state-action="retry"]')) return;
    const host = previewHosts.filter(function (selector) { return e.target.closest(selector); })[0];
    if (!host) return;
    PV.ui.announce('Trying again…');
    PV.store.reload().then(renderCatalogue, previewFailure);
  });

  PV.store.init().then(renderCatalogue, previewFailure);

  /* Recently viewed lives on this device only, so it is rendered in parallel. */
  renderRecent();
  PV.onRecentChange(renderRecent);
});
