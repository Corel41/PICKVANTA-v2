/* ==========================================================================
   PickVanta — shared listing view
   --------------------------------------------------------------------------
   Used by Discover (discover.html) and Deals (deals.html). Both views have the
   same skeleton — search, category navigation, filters, sort, results grid,
   empty state — so the behaviour lives here once and each page names the
   dataset it lists ('catalogue' or 'deals') and its card renderer.

   Records come from the data-access layer only: one PV.store.query(state) call
   returns { ok, items, total, page, pageSize, hasNext, hasPrev, error }, which
   this file renders — including its loading, empty and error states. Paging
   fields are carried through untouched so a future API can page without a
   change here.

   Interface state is held in the URL (?q=&category=&sub=&tag=&type=&band=
   &location=&availability=&sort=) so a filtered view can be linked and
   reloaded. No requests leave the page.
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
      subcategory: p.get('sub') || 'all',
      tag: p.get('tag') || 'all',
      type: p.get('type') || 'all',
      band: p.get('band') || 'any',
      location: p.get('location') || 'any',
      availability: p.get('availability') || 'all',
      sort: p.get('sort') || 'relevance'
    };
    if (cfg.filters && state.type !== 'all' && cfg.filters.indexOf('type') === -1) state.type = 'all';

    /* An unknown tag is ignored rather than emptying the page — a stale or
       mistyped ?tag= link should still show the catalogue. */
    if (cfg.filters && cfg.filters.indexOf('tag') !== -1 && state.tag !== 'all') {
      if (!PV.store.tagExists(state.tag)) state.tag = 'all';
    }

    /* A subcategory only makes sense together with its category, so a link that
       carries one without the other is quietly narrowed back to "all". */
    if (cfg.filters && cfg.filters.indexOf('subcategory') !== -1) {
      const subOk = state.category !== 'all' &&
        PV.store.subcategories(state.category).indexOf(state.subcategory) !== -1;
      if (!subOk) state.subcategory = 'all';
    }

    if (searchInput && state.q) searchInput.value = state.q;

    /* --------------------------------------------------------- rendering */
    /* Counts shown next to filter options come from the unfiltered dataset, so
       they describe the catalogue rather than the current result list. */
    function filterCounts() {
      const counts = { category: {}, type: {}, status: {} };
      baseList().forEach(function (i) {
        counts.category[i.category] = (counts.category[i.category] || 0) + 1;
        counts.type[i.type] = (counts.type[i.type] || 0) + 1;
        counts.status[i.status] = (counts.status[i.status] || 0) + 1;
      });
      return counts;
    }

    /** The unfiltered dataset this page lists, fetched through the store. */
    function baseList() {
      try {
        return PV.store.dataset(cfg.dataset);
      } catch (err) {
        return [];
      }
    }

    /** One call to the data layer; it returns the envelope the UI renders. */
    function queryData() {
      return PV.store.query(state, { dataset: cfg.dataset });
    }

    /* A data layer that has to fetch will report isAsync() true; until the
       result arrives the listing shows its loading state. With the demo
       adapter this never happens — there is no artificial delay. */
    function renderLoading() {
      grid.classList.add('is-empty');
      grid.innerHTML = PV.card.loading({
        title: 'Loading ' + countLabel + 's…',
        text: 'Fetching the catalogue from the data layer.'
      });
      if (resultsMeta) resultsMeta.textContent = 'Loading…';
    }

    function renderFailure(envelope) {
      grid.classList.remove('is-empty');
      grid.innerHTML = PV.card.error({
        detail: envelope && envelope.error ? envelope.error : '',
        actions: [
          { label: 'Browse Technology', href: cfg.url + '?category=technology' },
          { label: 'All ' + countLabel + 's', href: cfg.url }
        ]
      });
      if (resultsMeta) resultsMeta.textContent = 'Could not load ' + countLabel + 's';
      if (filtersCount) filtersCount.hidden = true;
      if (clearButton) clearButton.hidden = true;
      if (activeRow) { activeRow.hidden = true; activeRow.innerHTML = ''; }
      PV.ui.announce("We couldn't load these options right now.");
    }

    function render() {
      if (PV.store.isAsync()) {
        renderLoading();
        return;
      }
      const envelope = queryData();
      if (!envelope.ok) {
        renderFailure(envelope);
        return;
      }
      const list = envelope.items;
      /* The meta line reports the size of the whole dataset, not the number of
         matches — `envelope.total` is the filtered count a paged API would use. */
      const total = baseList().length;
      const plural = countLabel.slice(-1) === 's' ? '' : 's';
      const isSearch = !!state.q;
      const isNarrowed = isSearch || PV.store.activeFilterCount(state) > 0;

      if (resultsMeta) {
        resultsMeta.textContent = list.length + ' of ' + total + ' ' + countLabel + plural +
          (isSearch ? ' match “' + state.q + '”' : ' shown') +
          (isNarrowed && !isSearch ? ' (filtered)' : '');
      }

      if (!list.length) {
        grid.classList.add('is-empty');
        /* Recovery path: what is active, what else is worth trying, and a way
           back to the whole catalogue. Suggestions stay deterministic. */
        const activeTag = state.tag !== 'all' ? state.tag : null;
        const tagChoices = PV.store.popularTags()
          .filter(function (t) { return t !== activeTag; })
          .slice(0, 5)
          .map(function (t) { return { label: PV.store.tagLabel(t), href: cfg.url + '?tag=' + encodeURIComponent(t) }; });
        const examples = isSearch
          ? ['laptop', 'student', 'Nairobi', 'wireless'].map(function (q) { return { label: q, q: q }; })
          : ['student', 'remote-work', 'budget', 'premium', 'nairobi'].map(function (q) { return { label: q, q: q }; });

        grid.innerHTML = PV.card.empty({
          icon: isSearch ? '🔍' : '🧭',
          title: isSearch ? 'No options found' : 'Nothing matches these filters',
          text: isSearch
            ? 'Nothing in the demo catalogue matches “' + state.q + '”. Try a shorter term, a related tag, or start from a category.'
            : 'Every record is filtered out right now. Clear the filters to see all ' + total + ' demo ' + countLabel + plural + ' again.',
          suggestLabel: 'Popular categories:',
          suggestions: PV.store.categories().slice(0, 6).map(function (c) {
            return { label: c.icon + '  ' + c.label, href: cfg.url + '?category=' + c.slug };
          }),
          tags: tagChoices,
          tagLabel: activeTag ? 'Other tags:' : 'Related tags:',
          examples: examples,
          examplesLabel: 'Example searches:',
          buttons: isNarrowed ? [{ label: isSearch ? 'Clear search & filters' : 'Clear all filters', action: 'reset' }] : [],
          actions: [
            { label: 'Search all categories', href: cfg.url },
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
        const n = PV.store.activeFilterCount(state);
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
      if (state.subcategory !== 'all') chips.push(chip(state.subcategory, 'subcategory'));
      if (state.tag !== 'all') chips.push(chip('Tag: ' + PV.store.tagLabel(state.tag), 'tag'));
      if (state.type !== 'all') chips.push(chip(U.typeLabel(state.type) + 's', 'type'));
      if (state.band !== 'any') {
        const band = PV.store.priceBands().find(function (b) { return b.code === state.band; });
        if (band) chips.push(chip(band.label, 'band'));
      }
      if (state.location !== 'any') {
        const loc = PV.store.locationOptions().find(function (l) { return l.code === state.location; });
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
      const cats = PV.store.categories();
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

    /* --------------------------------------------------------- tag strip */
    /* Shortcuts into the same ?tag= state the filter panel uses. */
    function renderTags() {
      const host = U.$('#tagStrip');
      if (!host) return;
      const popular = PV.store.popularTags();
      const current = state.tag !== 'all' ? state.tag : null;
      const list = current && popular.indexOf(current) === -1 ? [current].concat(popular) : popular;
      host.innerHTML =
        '<a class="chip tag-chip' + (current ? '' : ' is-on') + '" href="' + cfg.url + '"' +
        (current ? '' : ' aria-current="true"') + '>All</a>' +
        list.map(function (t) {
          const on = current === t;
          return '<a class="chip tag-chip' + (on ? ' is-on' : '') + '" href="' + cfg.url + '?tag=' + encodeURIComponent(t) + '"' +
            (on ? ' aria-current="true"' : '') + '>' + U.esc(PV.store.tagLabel(t)) + '</a>';
        }).join('');
    }

    /* -------------------------------------------------------------- state */
    function setState(key, value) {
      if (key === 'reset') {
        state.q = '';
        state.category = 'all';
        state.subcategory = 'all';
        state.tag = 'all';
        state.type = 'all';
        state.band = 'any';
        state.location = 'any';
        state.availability = 'all';
        if (searchInput) searchInput.value = '';
      } else {
        state[key] = value;
        /* A subcategory belongs to one category, so switching category (or
           clearing it) drops any subcategory selection with it. */
        if (key === 'category') state.subcategory = 'all';
      }
      U.updateUrl({
        q: state.q,
        category: state.category,
        sub: state.subcategory,
        tag: state.tag,
        type: state.type,
        band: state.band,
        location: state.location,
        availability: state.availability,
        sort: state.sort
      });
      if (key === 'reset' || key === 'category' || key === 'subcategory' || key === 'tag' || key === 'type' || key === 'band' || key === 'location' || key === 'availability') {
        PV.ui.renderFilters(filtersHost, state, cfg.filters, setState, filterCounts());
      }
      renderCategories();
      renderTags();
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
      /* Retry is offered by the error state: the data layer is asked again. */
      if (e.target.closest('[data-state-action="retry"]')) {
        PV.ui.announce('Trying again…');
        render();
        return;
      }
      const btn = e.target.closest('[data-empty-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-empty-action');
      if (action === 'reset') setState('reset');
      if (action === 'search') {
        const q = btn.getAttribute('data-q') || '';
        if (searchInput) searchInput.value = q;
        setState('q', q);
      }
    });

    /* --------------------------------------------------------------- sort */
    PV.ui.renderSort(sortSelect, state.sort, function (value) {
      state.sort = value;
      U.updateUrl({ sort: value });
      render();
    });

    /* -------------------------------------------------- category + chips */
    renderCategories();
    renderTags();

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
          setState(key, key === 'band' || key === 'location' ? 'any' : 'all');
        }
      });
    }

    /* jump-chip quick searches from the homepage can arrive as ?q= */
    render();
  }

  return { init: init };
})();
