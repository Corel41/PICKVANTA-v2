/* ==========================================================================
   PickVanta — Guides view (guides.html)
   Buyers' guides. This stage establishes the card structure and filtering
   only: the full articles are intentionally not written yet, and guide cards
   never link to a page that does not exist.
   ========================================================================== */
PV.util.ready(function () {
  const U = PV.util;
  PV.ui.mountChrome('guides');

  const grid = U.$('#guideGrid');
  const meta = U.$('#guideMeta');
  const strip = U.$('#guideCategories');
  const form = U.$('#searchForm');
  const empty = U.$('#guideEmpty');

  if (!grid) return;

  const state = {
    q: U.params().get('q') || '',
    category: U.params().get('category') || 'all'
  };

  const searchInput = U.$('#pageSearch');
  if (searchInput && state.q) searchInput.value = state.q;

  /* Guides are filtered by the data layer (PV.store.queryGuides) so the search
     rules stay in one place: title, question, summary, category and the
     outline topics. */
  function renderCats(list) {
    if (!strip) return;
    const cats = PV.store.categories().filter(function (c) {
      return list.some(function (g) { return g.category === c.slug; });
    });
    strip.innerHTML =
      '<a class="cat-pill' + (state.category === 'all' ? ' is-active' : '') + '" href="guides.html">All guides</a>' +
      cats.map(function (c) {
        return '<a class="cat-pill' + (state.category === c.slug ? ' is-active' : '') + '" href="guides.html?category=' + c.slug + '">' +
          '<span aria-hidden="true">' + U.esc(c.icon) + '</span> ' + U.esc(c.label) + '</a>';
      }).join('');
  }

  function renderList(list) {
    renderCats(list);

    if (meta) {
      meta.textContent = list.length
        ? list.length + ' guide outline' + (list.length === 1 ? '' : 's') + (state.q ? ' matching “' + state.q + '”' : '')
        : 'No guides match the current filters';
    }

    if (!list.length) {
      grid.innerHTML = '';
      grid.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.innerHTML = PV.card.empty({
          icon: '📘',
          title: state.q ? 'No matches found' : 'No guides in this category yet',
          text: state.q
            ? 'No guide outline matches “' + state.q + '”. Try a shorter topic, or browse all guides.'
            : 'This category has no guide outlines in ' +
              (PV.store.catalogue().live ? 'the catalogue' : 'the demo set') + ' yet. Try another category.',
          suggestLabel: 'Jump to a category:',
          suggestions: PV.store.categories().slice(0, 4).map(function (c) {
            return { label: c.icon + '  ' + c.label, href: 'guides.html?category=' + c.slug };
          }),
          buttons: state.q ? [{ label: 'Clear search', action: 'clear-search' }] : [],
          actions: [
            { label: 'All guides', href: 'guides.html' },
            { label: 'Start discovering', href: 'discover.html' }
          ],
          footnote: 'Guides are outlines in this build — full articles are not written yet.'
        });
      }
      return;
    }

    grid.hidden = false;
    if (empty) empty.hidden = true;
    grid.innerHTML = list.map(function (guide) { return PV.card.guide(guide); }).join('');
  }

  /* One request per render: the guides, then the listings they mention (each
     guide card names the records it discusses). */
  let renderToken = 0;

  function render() {
    const token = ++renderToken;
    PV.store.init().then(function () {
      return PV.store.queryGuides(state).then(function (list) {
        if (token !== renderToken) return;
        return PV.store.warmGuideListings(list).then(function () {
          if (token !== renderToken) return;
          renderList(list);
        });
      });
    }).catch(function (err) {
      if (token !== renderToken) return;
      grid.hidden = false;
      if (empty) empty.hidden = true;
      grid.innerHTML = PV.card.error({
        detail: err && err.message ? err.message : '',
        actions: [{ label: 'Browse Discover', href: 'discover.html' }]
      });
      if (meta) meta.textContent = 'Could not load guide outlines';
      PV.ui.announce("We couldn't load these options right now.");
    });
  }

  if (form) {
    PV.ui.bindSearch({
      root: form,
      onSubmit: function (q) {
        state.q = q;
        U.updateUrl({ q: q });
        render();
      }
    });
  }

  if (empty) {
    empty.addEventListener('click', function (e) {
      if (!e.target.closest('[data-empty-action="clear-search"]')) return;
      state.q = '';
      if (searchInput) searchInput.value = '';
      U.updateUrl({ q: '' });
      render();
      if (searchInput) searchInput.focus();
    });
  }

  render();
});
