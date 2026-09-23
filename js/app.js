/* ==========================================================================
   PickVanta — Home view (index.html)
   The landing page keeps its existing design. Step 2 only connects it to the
   rest of the product: real search over the demo dataset, category links into
   Discover, and previews rendered from the same data layer used by every
   other view.
   ========================================================================== */
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

  /* ------------------------------------------------------ hero preview card */
  /* The three options shown in the hero compare preview come from the same
     records the Compare page seeds itself with — nothing is hard-coded in the
     markup. Names are shortened and attribute values trimmed so the small
     preview keeps its shape whatever the catalogue contains. */
  const heroList = U.$('#heroCompareList');
  if (heroList) {
    const heroIds = window.PICKVANTA_DATA.defaultCompareIds || [];
    const heroCount = U.$('#heroOptionCount');
    if (heroCount) heroCount.textContent = heroIds.length + ' options';
    heroList.innerHTML = PV.data.items(heroIds).map(function (record) {
      const facts = (record.attributes || [])
        .map(function (a) { return String(a.value || '').split(',')[0].trim(); })
        .filter(function (v) { return v && v.length <= 16; })
        .slice(0, 3);
      const shortName = String(record.name || '').split(' — ')[0] || record.name;
      return (
        '<div class="option">' +
        '<div class="option-main">' +
        '<div class="option-icon" aria-hidden="true">' + U.esc((record.image && record.image.icon) || '📦') + '</div>' +
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
  }

  /* -------------------------------------------------------- category grid */
  const catHost = U.$('#homeCategories');
  if (catHost) {
    catHost.innerHTML = PV.data.categories().map(function (c) {
      const count = PV.data.all().filter(function (i) { return i.category === c.slug; }).length;
      return '<a class="category" href="discover.html?category=' + U.esc(c.slug) + '" role="listitem">' +
        '<div class="cat-icon" aria-hidden="true">' + U.esc(c.icon) + '</div>' +
        '<strong>' + U.esc(c.label) + '</strong>' +
        '<span>' + U.esc(c.blurb) + '</span>' +
        '<span class="cat-count">' + count + ' demo record' + (count === 1 ? '' : 's') + '</span>' +
        '</a>';
    }).join('');
  }

  /* --------------------------------------------------------- deals preview */
  const dealHost = U.$('#homeDeals');
  if (dealHost) {
    const deals = PV.data.home().deals;
    dealHost.innerHTML = deals.map(function (record) { return PV.card.deal(record); }).join('');
  }

  /* ------------------------------------------------------ explore by need */
  /* Each shortcut is a tag filter or a plain search into Discover — the same
     URL state every other part of the app uses. Nothing is personalised. */
  const needsHost = U.$('#homeNeeds');
  if (needsHost) {
    const needs = PV.data.needs();
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
          const meta = n.tag ? 'tag: ' + PV.data.tagLabel(n.tag) : 'search: ' + n.q;
          return '<a class="chip need-chip" href="' + href + '" title="' + U.esc(meta) + '">' +
            '<span aria-hidden="true">' + U.esc(n.icon) + '</span> ' + U.esc(n.label) + '</a>';
        }).join('') +
        '</div>' +
        '</div>';
    }).join('');
  }

  /* ----------------------------------------------------- recently viewed */
  const recentHost = U.$('#homeRecent');
  const recentSection = U.$('#recent');
  const recentClear = U.$('#recentClear');

  function renderRecent() {
    if (!recentHost || !recentSection) return;
    const items = PV.recent.items();
    if (!items.length) {
      recentSection.hidden = true;
      recentHost.innerHTML = '';
      return;
    }
    recentSection.hidden = false;
    recentHost.innerHTML = items.map(function (record) {
      return '<a class="recent-item" href="' + U.esc(PV.hrefDetail(record.id)) + '">' +
        '<span class="recent-icon" aria-hidden="true">' + U.esc((record.image && record.image.icon) || '📦') + '</span>' +
        '<span class="recent-text">' +
          '<strong>' + U.esc(record.name) + '</strong>' +
          '<small>' + U.esc(U.typeLabel(record.type)) + ' · ' + U.esc(U.categoryLabel(record.category)) + ' · ' + U.esc(U.priceText(record)) + '</small>' +
        '</span>' +
        '<span class="recent-arrow" aria-hidden="true">→</span>' +
        '</a>';
    }).join('');
  }

  if (recentClear) {
    recentClear.addEventListener('click', function () {
      PV.recent.clear();
      PV.ui.toast('Cleared the recently viewed list on this device. Nothing was ever stored on a server.');
      recentSection.hidden = true;
    });
  }
  renderRecent();
  PV.onRecentChange(renderRecent);

  /* ------------------------------------------------------ discover preview */
  const discoverHost = U.$('#homeDiscover');
  if (discoverHost) {
    /* A curated slice — spread across categories and price bands — so the
       homepage stays a shop window and the full catalogue stays in Discover. */
    const featured = PV.data.home().featured;
    discoverHost.innerHTML = featured.map(function (record) { return PV.card.item(record); }).join('');
  }

  /* ------------------------------------------------------- guides preview */
  const guideHost = U.$('#homeGuides');
  if (guideHost) {
    guideHost.innerHTML = PV.data.home().guides.map(function (guide) { return PV.card.guide(guide); }).join('');
  }

  /* ---------------------------------------------- live compare state on home */
  /* If the visitor has already picked options, the homepage reflects it so the
     journey continues instead of restarting. */
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

  /* The homepage previews are a small slice of the demo dataset. */
  const countHost = U.$('#homeDatasetNote');
  if (countHost) {
    const items = PV.data.all();
    const cities = [];
    items.forEach(function (i) {
      const c = i.location && i.location.city;
      if (c && ['Online', 'Nationwide'].indexOf(c) === -1 && cities.indexOf(c) === -1) cities.push(c);
    });
    countHost.textContent =
      PV.data.all().length + ' demo records, ' + PV.data.deals().length + ' demo offers and ' +
      PV.data.guides().length + ' guide outlines are included in this build — covering ' +
      PV.data.categories().length + ' categories, ' + PV.data.subcategories('all').length + ' subcategories and ' +
      cities.length + ' demo locations. Everything is invented demonstration content: no real sellers, no real prices, ' +
      'no live availability.';
  }
});
