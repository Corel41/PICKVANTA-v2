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
    const deals = PV.data.deals().slice(0, 3);
    dealHost.innerHTML = deals.map(function (record) { return PV.card.deal(record); }).join('');
  }

  /* ------------------------------------------------------ discover preview */
  const discoverHost = U.$('#homeDiscover');
  if (discoverHost) {
    const featured = PV.sort.apply(PV.data.all(), 'relevance').slice(0, 5);
    discoverHost.innerHTML = featured.map(function (record) { return PV.card.item(record); }).join('');
  }

  /* ------------------------------------------------------- guides preview */
  const guideHost = U.$('#homeGuides');
  if (guideHost) {
    guideHost.innerHTML = PV.data.guides().slice(0, 3).map(function (guide) { return PV.card.guide(guide); }).join('');
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
    countHost.textContent =
      PV.data.all().length + ' demo records, ' + PV.data.deals().length + ' demo offers and ' +
      PV.data.guides().length + ' guide outlines are included in this build. Everything is static demonstration content.';
  }
});
