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

  /* Guides are searched locally with the same rules as the item search:
     title, question, summary, category and the outline topics. */
  function matches(guide) {
    if (state.category !== 'all' && guide.category !== state.category) return false;
    if (!state.q) return true;
    const hay = [guide.title, guide.question || '', guide.summary, U.categoryLabel(guide.category), guide.covers.join(' ')]
      .join(' ')
      .toLowerCase();
    const tokens = hay.split(/[^a-z0-9]+/).filter(Boolean);
    return state.q
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every(function (term) {
        return hay.indexOf(term) !== -1 || tokens.some(function (t) { return t.indexOf(term) === 0; });
      });
  }

  function renderCats() {
    if (!strip) return;
    const cats = PV.data.categories().filter(function (c) {
      return PV.data.guides().some(function (g) { return g.category === c.slug; });
    });
    strip.innerHTML =
      '<a class="cat-pill' + (state.category === 'all' ? ' is-active' : '') + '" href="guides.html">All guides</a>' +
      cats.map(function (c) {
        return '<a class="cat-pill' + (state.category === c.slug ? ' is-active' : '') + '" href="guides.html?category=' + c.slug + '">' +
          '<span aria-hidden="true">' + U.esc(c.icon) + '</span> ' + U.esc(c.label) + '</a>';
      }).join('');
  }

  function render() {
    const list = PV.data.guides().filter(matches);
    renderCats();

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
            : 'This category has no guide outlines in the demo set yet. Try another category.',
          suggestLabel: 'Jump to a category:',
          suggestions: PV.data.categories().slice(0, 4).map(function (c) {
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
