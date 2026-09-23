/* ==========================================================================
   PickVanta — shared listing view
   --------------------------------------------------------------------------
   Used by Discover (discover.html) and Deals (deals.html). Both views have the
   same skeleton — search, category navigation, filters, sort, results grid,
   empty state — so the behaviour lives here once and each page supplies its
   own dataset and card renderer.

   State is held in the URL (?q=&category=&type=&band=&location=&availability=
   &sort=) so a filtered view can be linked and reloaded. Everything runs on
   the local demo dataset — no requests leave the page.
   ========================================================================== */
window.PV = window.PV || {};

PV.listing = (function () {
  'use strict';

  const U = PV.util;

  function init(config) {
    const cfg = config || {};
    const results = U.$('#results');
    const resultsMeta = U.$('#resultsMeta');
    const grid = U.$('#resultsGrid');
    const filtersHost = U.$('#filterPanel');
    const sortSelect = U.$('#sortSelect');
    const searchInput = U.$('#pageSearch');
    const searchForm = U.$('#searchForm');
    const catStrip = U.$('#categoryStrip');
    const activeRow = U.$('#activeFilters');
    const filtersCount = U.$('#filtersCount');
    const clearButton = U.$('#clearFilters');
    const hintText = U.$('#compareHintText');
    const countLabel = cfg.countLabel || 'option';

    if (!grid) return;

    const p = U.params();
    const state = {
      q: p.get('q') || '',
      category: p.get('category') || 'all',
      type: p.get('type') || 'all',
      band: p.get('band') || 'any',
      location: p.get('location') || 'any',
      availability: p.get('availability') || 'all',
      sort: p.get('sort') || 'relevance'
    };
    if (cfg.filters && state.type !== 'all' && cfg.filters.indexOf('type') === -1) state.type = 'all';

    if (searchInput && state.q) searchInput.value = state.q;

    /* --------------------------------------------------------- rendering */
    /* Counts shown next to filter options come from the unfiltered demo set,
       so they describe the dataset rather than the current result list. */
    function filterCounts() {
      const base = cfg.list();
      const counts = { category: {}, type: {}, status: {} };
      base.forEach(function (i) {
        counts.category[i.category] = (counts.category[i.category] || 0) + 1;
        counts.type[i.type] = (counts.type[i.type] || 0) + 1;
        counts.status[i.status] = (counts.status[i.status] || 0) + 1;
      });
      return counts;
    }

    function computeList() {
      const base = cfg.list();
      const filtered = PV.filters.apply(base, state);
      return PV.sort.apply(filtered, state.sort, state.q);
    }

    function render() {
      const list = computeList();
      const total = cfg.list().length;
      const plural = countLabel.slice(-1) === 's' ? '' : 's';
      const isSearch = !!state.q;
      const isNarrowed = isSearch || PV.filters.activeCount(state) > 0;

      if (resultsMeta) {
        resultsMeta.textContent = list.length + ' of ' + total + ' ' + countLabel + plural +
          (isSearch ? ' match “' + state.q + '”' : ' shown') +
          (isNarrowed && !isSearch ? ' (filtered)' : '');
      }

      if (!list.length) {
        grid.classList.add('is-empty');
        grid.innerHTML = PV.card.empty({
          icon: isSearch ? '🔍' : '🧭',
          title: isSearch ? 'No matches found' : 'Nothing matches these filters',
          text: isSearch
            ? 'Nothing in the demo dataset matches “' + state.q + '”. Try a shorter or different search term, or start from a category.'
            : 'Every record is filtered out right now. Clear the filters to see all ' + total + ' demo ' + countLabel + plural + ' again.',
          suggestLabel: 'Browse a category:',
          suggestions: PV.data.categories().slice(0, 4).map(function (c) {
            return { label: c.icon + '  ' + c.label, href: cfg.url + '?category=' + c.slug };
          }),
          buttons: isNarrowed ? [{ label: isSearch ? 'Clear search & filters' : 'Clear all filters', action: 'reset' }] : [],
          actions: [
            { label: cfg.page === 'deals' ? 'Start discovering products' : 'See demo deals', href: cfg.page === 'deals' ? 'discover.html' : 'deals.html' },
            { label: 'Browse guides', href: 'guides.html' }
          ],
          footnote: 'Filters and search run on the demo dataset inside this page — no live listings are queried.'
        });
      } else {
        grid.classList.remove('is-empty');
        grid.innerHTML = list.map(function (record) { return cfg.cardFn(record); }).join('');
        lastShown = list.length;
        updateHint();
      }

      if (filtersCount) {
        const n = PV.filters.activeCount(state);
        filtersCount.textContent = String(n);
        filtersCount.hidden = n === 0;
      }
      if (clearButton) clearButton.hidden = !isNarrowed;

      renderActiveChips();
      PV.ui.syncCompareButtons();
    }

    function chip(label, key) {
      return (
        '<button type="button" class="chip chip-remove" data-clear="' + U.esc(key) + '">' +
        U.esc(label) + ' <span aria-hidden="true">×</span>' +
        '</button>'
      );
    }

    function renderActiveChips() {
      if (!activeRow) return;
      const chips = [];
      if (state.q) chips.push(chip('Search: ' + state.q, 'q'));
      if (state.category !== 'all') chips.push(chip(U.categoryLabel(state.category), 'category'));
      if (state.type !== 'all') chips.push(chip(U.typeLabel(state.type) + 's', 'type'));
      if (state.band !== 'any') {
        const band = PV.data.priceBands().find(function (b) { return b.code === state.band; });
        if (band) chips.push(chip(band.label, 'band'));
      }
      if (state.location !== 'any') {
        const loc = PV.data.locationOptions().find(function (l) { return l.code === state.location; });
        if (loc) chips.push(chip(loc.label, 'location'));
      }
      if (state.availability !== 'all') chips.push(chip(U.statusInfo(state.availability).label, 'availability'));

      activeRow.innerHTML = chips.length
        ? '<span class="active-label">Active filters:</span>' + chips.join('') +
          '<button type="button" class="chip chip-clear" data-clear="all">Clear all</button>'
        : '';
      activeRow.hidden = chips.length === 0;
    }

    /* -------------------------------------------------------- category bar */
    function renderCategories() {
      if (!catStrip) return;
      const cats = PV.data.categories();
      catStrip.innerHTML =
        '<a class="cat-pill' + (state.category === 'all' ? ' is-active' : '') + '" href="' + cfg.url + '">' +
        '<span aria-hidden="true">✨</span> All</a>' +
        cats
          .map(function (c) {
            return (
              '<a class="cat-pill' + (state.category === c.slug ? ' is-active' : '') + '" href="' +
              cfg.url + '?category=' + c.slug + '" title="' + U.esc(c.blurb) + '">' +
              '<span aria-hidden="true">' + U.esc(c.icon) + '</span> ' + U.esc(c.label) + '</a>'
            );
          })
          .join('');
    }

    /* -------------------------------------------------------------- state */
    function setState(key, value) {
      if (key === 'reset') {
        state.q = '';
        state.category = 'all';
        state.type = 'all';
        state.band = 'any';
        state.location = 'any';
        state.availability = 'all';
        if (searchInput) searchInput.value = '';
      } else {
        state[key] = value;
      }
      U.updateUrl({
        q: state.q,
        category: state.category,
        type: state.type,
        band: state.band,
        location: state.location,
        availability: state.availability,
        sort: state.sort
      });
      if (key === 'reset' || key === 'category' || key === 'type' || key === 'band' || key === 'location' || key === 'availability') {
        PV.ui.renderFilters(filtersHost, state, cfg.filters, setState, filterCounts());
      }
      renderCategories();
      render();
    }

    /* --------------------------------------------------------- search box */
    if (searchForm) {
      if (searchInput) searchInput.value = state.q;
      const box = PV.ui.bindSearch({
        root: searchForm,
        onSubmit: function (q) {
          setState('q', q);
          render();
        }
      });
      if (U.params().get('focus') && box) box.focus();
    }

    /* ------------------------------------------------------------ filters */
    PV.ui.renderFilters(filtersHost, state, cfg.filters, setState, filterCounts());
    PV.ui.bindFiltersDrawer();

    /* the toolbar hint doubles as the compare-tray status line */
    let lastShown = 0;
    function updateHint() {
      if (!hintText) return;
      const count = PV.compare.count();
      const plural = countLabel.slice(-1) === 's' ? '' : 's';
      hintText.innerHTML = count
        ? '<strong>' + count + ' of ' + PV.compare.max + '</strong> selected for comparison · ' +
          lastShown + ' ' + countLabel + plural + ' shown'
        : cfg.hintDefault || 'Select up to three options with Compare to line them up side by side.';
    }
    PV.onCompareChange(updateHint);

    /* one-click recovery: clears search and every filter */
    if (clearButton) {
      clearButton.addEventListener('click', function () { setState('reset'); });
    }
    grid.addEventListener('click', function (e) {
      if (e.target.closest('[data-empty-action="reset"]')) setState('reset');
    });

    /* --------------------------------------------------------------- sort */
    PV.ui.renderSort(sortSelect, state.sort, function (value) {
      state.sort = value;
      U.updateUrl({ sort: value });
      render();
    });

    /* -------------------------------------------------- category + chips */
    renderCategories();

    if (activeRow) {
      activeRow.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-clear]');
        if (!btn) return;
        const key = btn.getAttribute('data-clear');
        if (key === 'all') {
          setState('reset');
          return;
        }
        if (key === 'q') {
          if (searchInput) searchInput.value = '';
          setState('q', '');
        } else {
          setState(key, key === 'band' ? 'any' : key === 'location' ? 'any' : key === 'availability' ? 'all' : 'all');
        }
      });
    }

    /* jump-chip quick searches from the homepage can arrive as ?q= */
    render();
  }

  return { init: init };
})();
