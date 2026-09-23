/* ==========================================================================
   PickVanta — Compare view (compare.html)
   Options side by side. The interface only presents differences — it does not
   score, rank or declare a winner, and there is no recommendation algorithm.
   ========================================================================== */
PV.util.ready(function () {
  const U = PV.util;
  PV.ui.mountChrome('compare');

  const MAX = PV.compare.max;
  const pickersHost = U.$('#comparePickers');
  const matrixHost = U.$('#compareMatrix');
  const toolsHost = U.$('#compareTools');
  const suggestHost = U.$('#compareSuggest');
  const noticeHost = U.$('#compareNotice');

  const ALL = PV.store.all();
  let diffsOnly = false;
  let seededTitle = false;
  /* Compare focus: which areas the visitor asked to have emphasised. It only
     highlights rows — it never scores, ranks or picks anything. */
  let focusAreas = [];

  /* ------------------------------------------------------------- selection */
  const fromUrl = (U.params().get('ids') || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (id) { return !!PV.store.item(id); })
    .slice(0, MAX);

  if (fromUrl.length) {
    PV.compare.set(fromUrl);
  } else if (U.params().has('ids')) {
    /* a link carried ids that are not in the demo dataset — show the empty
       state rather than silently substituting other options */
    PV.compare.set([]);
  } else if (!PV.compare.count()) {
    PV.compare.set(PV.store.defaultCompareIds());
    seededTitle = true;
  }

  function ids() {
    return PV.compare.ids();
  }
  function items() {
    return PV.store.items(ids());
  }

  /* ----------------------------------------------------------- row builder */
  /* Reads a named attribute straight off the record — used for rows such as
     "Service area" that exist in the data but not on every record type. */
  function attrValue(record, label) {
    const found = (record.attributes || []).find(function (a) { return a.label === label; });
    return found && found.value ? found.value : '—';
  }

  /* Which group a row belongs to, when the compared records share a category
     and that category has a configuration. Anything unmatched lands in the
     last configured group, and a category without configuration keeps the
     generic sections. */
  function applyGrouping(rows, list) {
    const categories = [...new Set(list.map(function (i) { return i.category; }))];
    if (categories.length !== 1) return rows;
    const config = PV.store.compareConfig(categories[0]);
    if (!config) return rows;

    const allServices = list.every(function (i) { return i.type === 'service'; });
    const groups = (allServices && config.serviceGroups) ? config.serviceGroups : config.groups;
    if (!groups || !groups.length) return rows;

    const fallback = groups[groups.length - 1].title;

    function titleFor(row) {
      const byKey = groups.find(function (g) { return g.rows && g.rows.indexOf(row.key) !== -1; });
      if (byKey) return byKey.title;
      const haystack = (row.label + ' ' + (row.attrGroup || '')).toLowerCase();
      const byKeyword = groups.find(function (g) {
        return g.keywords && g.keywords.some(function (k) { return haystack.indexOf(k) !== -1; });
      });
      if (byKeyword) return byKeyword.title;
      return fallback;
    }

    const order = groups.map(function (g) { return g.title; });
    rows.forEach(function (row) { row.section = titleFor(row); });
    /* Rows are emitted in group order so each group heading appears once and
       its rows stay together. */
    return rows
      .map(function (row, idx) { return { row: row, idx: idx }; })
      .sort(function (a, b) {
        return order.indexOf(a.row.section) - order.indexOf(b.row.section) || a.idx - b.idx;
      })
      .map(function (x) { return x.row; });
  }

  /* Within a differing row, a value that appears only once is what actually
     distinguishes that option. The tint marks the difference itself — it says
     nothing about which value is better. */
  function uniqueValueFlags(row) {
    const counts = {};
    row.values.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    return row.values.map(function (v) { return counts[v] === 1; });
  }

  /* Does a row belong to one of the selected focus areas? */
  function rowInFocus(row) {
    if (!focusAreas.length) return false;
    return focusAreas.some(function (code) {
      const area = PV.store.focusArea(code);
      if (!area) return false;
      if (area.rows && area.rows.indexOf(row.key) !== -1) return true;
      if (area.allAttributes && row.key.indexOf('attr:') === 0) return true;
      if (!area.keywords || !area.keywords.length) return false;
      const haystack = (row.label + ' ' + (row.attrGroup || '')).toLowerCase();
      return area.keywords.some(function (k) { return haystack.indexOf(k) !== -1; });
    });
  }

  function coreRows(list) {
    const rows = [
      { key: 'type', section: 'Overview', label: 'Type', values: list.map(function (i) { return U.typeLabel(i.type); }) },
      { key: 'category', label: 'Category', values: list.map(function (i) {
          return U.categoryLabel(i.category) + (i.subcategory ? ' · ' + i.subcategory : '');
        }) },
      { key: 'brand', label: 'Brand / provider', values: list.map(function (i) {
          /* Services often have no brand — show the provider instead of a dash. */
          return i.brand || U.sellerLabel(i) || '—';
        }) },
      { key: 'price', section: 'Price & offer', label: 'Price', strong: true, values: list.map(function (i) { return U.priceText(i); }) },
      { key: 'reference', label: 'Reference price', values: list.map(function (i) {
          const ref = i.deal && i.deal.referencePrice != null ? i.deal.referencePrice : i.referencePrice;
          return ref != null ? U.money(ref, (i.price && i.price.currency) || 'KES') : '—';
        }) },
      { key: 'dealPrice', label: 'Deal price (demo)', values: list.map(function (i) {
          return i.deal && i.deal.dealPrice != null
            ? U.money(i.deal.dealPrice, (i.price && i.price.currency) || 'KES') + (i.price && i.price.unit ? '/' + (U.UNIT_LABEL[i.price.unit] || i.price.unit) : '')
            : '—';
        }) },
      { key: 'offer', label: 'Offer status', values: list.map(function (i) {
          const st = U.dealState(i);
          return st ? st.label : 'No demo offer';
        }) },
      { key: 'seller', section: 'Provider & availability', label: 'Seller / provider', values: list.map(function (i) { return U.sellerLabel(i); }) },
      { key: 'sellerType', label: 'Seller type', values: list.map(function (i) { return (i.seller && i.seller.type) || '—'; }) },
      /* Service area is only a row when at least one compared record states it,
         so unrelated rows are never forced into the table. */
      { key: 'serviceArea', label: 'Service area', values: list.map(function (i) { return attrValue(i, 'Service area'); }) },
      { key: 'location', label: 'Location', values: list.map(function (i) { return U.locationLabel(i); }) },
      { key: 'availability', label: 'Availability', values: list.map(function (i) { return U.statusInfo(i.status).label; }) },
      { key: 'listed', label: 'Listed', values: list.map(function (i) { return U.formatDate(i.listedAt); }) }
    ];

    /* Attribute rows are built from whatever the records actually contain, so
       new categories with new specifications need no changes here. */
    const labels = [];
    const groupOf = {};
    list.forEach(function (i) {
      (i.attributes || []).forEach(function (a) {
        if (labels.indexOf(a.label) === -1) {
          labels.push(a.label);
          groupOf[a.label] = a.group || '';
        }
      });
    });
    labels.forEach(function (label) {
      rows.push({
        key: 'attr:' + label,
        section: 'Specifications',
        label: label,
        attrGroup: groupOf[label],
        values: list.map(function (i) {
          const found = (i.attributes || []).find(function (a) { return a.label === label; });
          return found ? found.value : '—';
        })
      });
    });
    /* A row that is empty for every option carries no information, so it is
       dropped rather than shown as a column of dashes. */
    const kept = rows.filter(function (r) {
      return !r.values.every(function (v) { return String(v).trim() === '—'; });
    });
    return applyGrouping(kept, list);
  }

  /* A row "differs" whenever the demo values are not all identical. A spec that
     only one option has (others show "—") is a real difference, so it is kept
     in differences-only mode instead of being hidden. */
  function differs(row) {
    const norm = row.values.map(function (v) { return String(v).trim().toLowerCase() || '—'; });
    return new Set(norm).size > 1;
  }

  /* -------------------------------------------------------------- renderers */
  function renderPickers() {
    if (!pickersHost) return;
    const current = ids();
    const letters = ['A', 'B', 'C'];

    let html = '';
    for (let slot = 0; slot < MAX; slot++) {
      const chosen = current[slot] || '';
      const record = chosen ? PV.store.item(chosen) : null;

      html += '<div class="cmp-picker' + (record ? '' : ' is-empty') + '">';
      html += '<div class="cmp-picker-head"><span class="cmp-slot">Option ' + letters[slot] + '</span>';
      if (record) {
        html += '<button type="button" class="cmp-remove" data-slot-remove="' + U.esc(record.id) + '" aria-label="Remove ' + U.esc(record.name) + '">Remove</button>';
      }
      html += '</div>';

      html += '<label class="cmp-select"><span class="visually-hidden">Choose option ' + letters[slot] + '</span>' +
        '<select data-slot="' + slot + '">' +
        '<option value="">' + (slot === 0 ? 'Choose an option…' : 'Add another option…') + '</option>' +
        PV.store.categories().map(function (c) {
          const inCat = PV.store.byCategory(c.slug);
          if (!inCat.length) return '';
          return '<optgroup label="' + U.esc(c.label) + '">' +
            inCat.map(function (i) {
              const used = current.indexOf(i.id) !== -1 && i.id !== chosen;
              return '<option value="' + U.esc(i.id) + '"' + (i.id === chosen ? ' selected' : '') + (used ? ' disabled' : '') + '>' +
                U.esc(i.name) + (used ? ' (already selected)' : '') + '</option>';
            }).join('') +
            '</optgroup>';
        }).join('') +
        '</select></label>';

      if (record) {
        html += '<div class="cmp-picker-body">' +
          '<a class="cmp-picker-name" href="' + U.esc(PV.hrefDetail(record.id)) + '">' +
          '<span class="cmp-picker-icon" aria-hidden="true">' + U.esc((record.image && record.image.icon) || '📦') + '</span>' +
          '<span>' + U.esc(record.name) + '</span></a>' +
          '<div class="cmp-picker-meta">' + U.esc(U.priceText(record)) + ' · ' + U.esc(U.sellerLabel(record)) + '</div>' +
          '<div class="cmp-picker-tags">' +
          '<span class="status-pill ' + U.esc(U.statusInfo(record.status).tone) + '">' + U.esc(U.statusInfo(record.status).label) + '</span>' +
          (U.dealState(record) ? '<span class="status-pill ' + U.esc(U.dealState(record).tone) + '">' + U.esc(U.dealState(record).label) + '</span>' : '') +
          '</div></div>';
      } else {
        html += '<p class="cmp-picker-empty">Empty slot — pick a record to compare.</p>';
      }
      html += '</div>';
    }
    pickersHost.innerHTML = html;

    U.$$('select[data-slot]', pickersHost).forEach(function (select) {
      select.addEventListener('change', function () {
        const slot = Number(select.getAttribute('data-slot'));
        const next = ids();
        if (select.value) next[slot] = select.value;
        else next.splice(slot, 1);
        PV.compare.set(next.filter(Boolean));
        render();
      });
    });
    U.$$('[data-slot-remove]', pickersHost).forEach(function (btn) {
      btn.addEventListener('click', function () {
        PV.compare.remove(btn.getAttribute('data-slot-remove'));
        render();
      });
    });
  }

  function renderTools() {
    if (!toolsHost) return;
    const list = items();
    if (!list.length) {
      toolsHost.innerHTML = '';
      return;
    }
    const diffs = coreRows(list).filter(differs).length;
    const totalRows = coreRows(list).length;

    toolsHost.innerHTML =
      '<label class="switch"><input type="checkbox" id="diffsOnly"' + (diffsOnly ? ' checked' : '') + ' /><span>Show differences only</span></label>' +
      '<span class="tools-meta">' + diffs + ' of ' + totalRows + ' rows differ</span>' +
      '<span class="tools-spacer"></span>' +
      '<a class="btn-secondary" href="discover.html">Find more options</a>' +
      '<button type="button" class="btn-ghost" data-clear-compare>Clear all</button>' +
      '<span class="tools-count">' + list.length + ' of ' + MAX + ' selected</span>';

    const box = U.$('#diffsOnly');
    if (box) {
      box.addEventListener('change', function () {
        diffsOnly = box.checked;
        renderMatrix();
        PV.ui.announce(diffsOnly
          ? 'Showing ' + diffs + ' differing rows of ' + totalRows + '.'
          : 'Showing all ' + totalRows + ' rows.');
      });
    }
    const clear = U.$('[data-clear-compare]');
    if (clear) {
      clear.addEventListener('click', function () {
        PV.compare.clear();
        render();
      });
    }

    /* Compare focus: the visitor chooses which areas to emphasise. Focus only
       highlights rows — it never ranks or scores anything. The chip list is
       rendered once and only its classes change, so keyboard focus stays put. */
    const focusHost = U.$('#compareFocus');
    if (focusHost) {
      const areas = PV.store.compareFocusAreas();
      focusHost.innerHTML =
        '<div class="focus-head">' +
          '<span class="filter-legend">Compare focus</span>' +
          '<p class="focus-note">Choose the areas you care about. Matching rows are highlighted below — PickVanta does not score, rank or choose for you.</p>' +
        '</div>' +
        '<div class="focus-chips" id="focusChips" role="group" aria-label="Compare focus areas">' +
          areas.map(function (a) {
            const on = focusAreas.indexOf(a.code) !== -1;
            return '<button type="button" class="chip focus-chip' + (on ? ' is-on' : '') + '" data-focus="' + U.esc(a.code) + '"' +
              ' aria-pressed="' + (on ? 'true' : 'false') + '" title="' + U.esc(a.help) + '">' +
              U.esc(a.label) + '</button>';
          }).join('') +
          '<button type="button" class="chip chip-clear" data-focus-clear' + (focusAreas.length ? '' : ' hidden') + '>Clear focus</button>' +
        '</div>' +
        '<div id="focusStatusHost">' + focusStatusHtml(list) + '</div>';

      const statusHost = U.$('#focusStatusHost', focusHost);
      const clearChip = U.$('[data-focus-clear]', focusHost);

      const applyFocus = function (message) {
        U.$$('[data-focus]', focusHost).forEach(function (btn) {
          const on = focusAreas.indexOf(btn.getAttribute('data-focus')) !== -1;
          btn.classList.toggle('is-on', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        if (clearChip) clearChip.hidden = !focusAreas.length;
        if (statusHost) statusHost.innerHTML = focusStatusHtml(list);
        renderMatrix();
        PV.ui.announce(message || (statusHost ? statusHost.textContent : ''));
      };

      U.$$('[data-focus]', focusHost).forEach(function (btn) {
        btn.addEventListener('click', function () {
          const code = btn.getAttribute('data-focus');
          const area = PV.store.focusArea(code);
          const label = area ? area.label : code;
          const wasOn = focusAreas.indexOf(code) !== -1;
          focusAreas = wasOn
            ? focusAreas.filter(function (c) { return c !== code; })
            : focusAreas.concat([code]);
          applyFocus(label + (wasOn ? ' removed from the compare focus.' : ' added to the compare focus.'));
        });
      });
      if (clearChip) {
        clearChip.addEventListener('click', function () {
          focusAreas = [];
          applyFocus('Compare focus cleared — every row is shown the same way.');
        });
      }
    }
  }

  /* Focus status copy. It reports what is highlighted, and says so plainly when
     a chosen area has nothing to match in this particular comparison. */
  function focusStatusHtml(list) {
    if (!focusAreas.length) {
      return '<p class="focus-status" role="status" id="focusStatus">No focus selected — every row is shown the same way.</p>';
    }
    const labels = focusAreas.map(function (code) {
      const area = PV.store.focusArea(code);
      return U.esc(area ? area.label : code);
    }).join(' · ');
    const matched = coreRows(list).filter(rowInFocus).length;
    return '<p class="focus-status" role="status" id="focusStatus">' +
      (matched
        ? 'Your selected comparison areas are highlighted below: ' + labels + '.'
        : 'Nothing in this comparison matches ' + labels + ' — the rows below are shown the same way.') +
      '</p>';
  }

  function renderMatrix() {
    if (!matrixHost) return;
    const list = items();

    if (!list.length) {
      matrixHost.innerHTML =
        '<div class="cmp-intro">' +
          '<h3>Compare options side by side</h3>' +
          '<p>Select up to ' + MAX + ' products or services while you browse and PickVanta lines them up row by row. ' +
          'Only the rows where the demo values differ are flagged — nothing is scored and no option is recommended.</p>' +
          '<div class="cmp-intro-actions">' +
            '<a class="btn-primary" href="discover.html">Search the catalogue</a>' +
            '<a class="btn-secondary" href="deals.html">See the demo deals</a>' +
          '</div>' +
          '<div class="empty-chips">' +
            '<span class="empty-chip-label">Browse a category:</span>' +
            ['technology', 'home', 'automotive', 'services'].map(function (slug) {
              const c = PV.store.category(slug);
              if (!c) return '';
              return '<a class="chip" href="discover.html?category=' + U.esc(slug) + '">' + U.esc(c.icon + '  ' + c.label) + '</a>';
            }).join('') +
          '</div>' +
          '<div class="empty-chips">' +
            '<span class="empty-chip-label">Example searches:</span>' +
            ['laptop', 'wireless', 'detailing', 'student'].map(function (q) {
              return '<a class="chip" href="discover.html?q=' + encodeURIComponent(q) + '">' + U.esc(q) + '</a>';
            }).join('') +
          '</div>' +
          '<div class="cmp-intro-notes">' +
            '<p><strong>Selected for comparison</strong> is a choice you make here — it is kept in this browser only.</p>' +
            '<p><strong>Recently viewed</strong> is a separate, smaller list of pages you opened. Neither is an account or a favourites list.</p>' +
          '</div>' +
        '</div>';
      return;
    }

    if (list.length === 1) {
      matrixHost.innerHTML =
        '<div class="cmp-hint" role="status">One option selected. Add at least one more using the slots above, the quick picks below, or <a href="discover.html">Discover</a> to see a side-by-side view.</div>' +
        renderSingle(list[0]);
      return;
    }

    const rows = coreRows(list).filter(function (r) { return !diffsOnly || differs(r); });
    const letters = ['A', 'B', 'C'];

    if (!rows.length) {
      matrixHost.innerHTML = '<div class="cmp-hint" role="status">These options are identical across every row in the demo dataset. Turn off “Show only differences” to see all rows.</div>';
      return;
    }

    const head =
      '<thead><tr><th scope="col" class="cmp-corner"><span>Feature</span></th>' +
      list.map(function (i, idx) {
        return '<th scope="col" class="cmp-col-head">' +
          '<span class="cmp-thumb" aria-hidden="true">' + U.esc((i.image && i.image.icon) || '📦') + '</span>' +
          '<span class="cmp-slot">Option ' + letters[idx] + '</span>' +
          '<a class="cmp-head-name" href="' + U.esc(PV.hrefDetail(i.id)) + '">' + U.esc(i.name) + '</a>' +
          '<span class="cmp-head-price">' + U.esc(U.priceText(i)) + '</span>' +
          '<span class="cmp-head-meta">' + U.esc(U.categoryLabel(i.category)) + ' · ' + U.esc(U.sellerLabel(i)) + '</span>' +
          '</th>';
      }).join('') +
      '</tr></thead>';

    let lastSection = null;
    const body =
      '<tbody>' +
      rows.map(function (r) {
        const isDiff = differs(r);
        const focused = rowInFocus(r);
        const uniq = isDiff ? uniqueValueFlags(r) : r.values.map(function () { return false; });
        const tds = r.values.map(function (v, vi) {
          const strong = r.strong || r.key === 'dealPrice';
          const classes = [];
          if (strong) classes.push('cmp-strong');
          if (uniq[vi]) classes.push('is-uniq');
          return '<td data-label="' + U.esc(r.label) + '"' + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + '>' + U.esc(v) + '</td>';
        }).join('');
        let group = '';
        if (r.section && r.section !== lastSection) {
          lastSection = r.section;
          group = '<tr class="cmp-group"><th scope="colgroup" colspan="' + (list.length + 1) + '">' + U.esc(r.section) + '</th></tr>';
        }
        return group +
          '<tr class="' + (isDiff ? 'row-differs' : 'row-same') + (focused ? ' is-focus' : '') + '">' +
          '<th scope="row"><span class="row-label">' + U.esc(r.label) + '</span><em class="row-flag">' + (isDiff ? 'Differs' : 'Same') + '</em></th>' +
          tds + '</tr>';
      }).join('') +
      '</tbody>';

    /* Two presentations of the same rows: a table for wide screens and stacked
       option cards for narrow ones. Both come from `rows`, so nothing is
       duplicated in the data layer. */
    const stacked =
      '<div class="cmp-stack">' +
      list.map(function (i, idx) {
        return '<article class="cmp-stack-card">' +
          '<header>' +
          '<span class="cmp-thumb" aria-hidden="true">' + U.esc((i.image && i.image.icon) || '📦') + '</span>' +
          '<div class="cmp-stack-head">' +
          '<span class="cmp-slot">Option ' + letters[idx] + '</span>' +
          '<a href="' + U.esc(PV.hrefDetail(i.id)) + '">' + U.esc(i.name) + '</a>' +
          '<span class="cmp-head-meta">' + U.esc(U.priceText(i)) + ' · ' + U.esc(U.statusInfo(i.status).label) + '</span>' +
          '</div></header>' +
          '<dl>' + rows.map(function (r) {
            const v = r.values[idx];
            const isDiff = differs(r);
            const uniq = isDiff ? uniqueValueFlags(r)[idx] : false;
            const classes = [];
            if (r.strong) classes.push('cmp-strong');
            if (uniq) classes.push('is-uniq');
            return '<div class="' + (isDiff ? 'differs' : '') + (rowInFocus(r) ? ' is-focus' : '') + '">' +
              '<dt>' + U.esc(r.label) + '</dt><dd' + (classes.length ? ' class="' + classes.join(' ') + '"' : '') + '>' + U.esc(v) + '</dd></div>';
          }).join('') + '</dl>' +
          '</article>';
      }).join('') +
      '</div>';

    matrixHost.innerHTML =
      '<p class="cmp-scroll-hint">Swipe the table sideways to see every option.</p>' +
      '<div class="cmp-scroll" role="region" aria-label="Comparison table" tabindex="0">' +
      '<table class="cmp-table"><caption class="visually-hidden">Side-by-side comparison of ' + list.length + ' options from the demo dataset</caption>' +
      head + body + '</table></div>' +
      stacked +
      '<p class="cmp-footnote"><strong>You decide what matters.</strong> Rows marked “Differs” only mean the demo values are not identical, and a tinted value is one that no other selected option shares. Every option is shown the same way — PickVanta does not score, rank or recommend any of them.' +
      (focusAreas.length ? ' Highlighted rows match your selected comparison areas.' : '') +
      (diffsOnly ? ' Showing the ' + rows.length + ' rows that differ.' : '') + '</p>';
  }

  function renderSingle(record) {
    const rows = coreRows([record]);
    return (
      '<div class="cmp-single">' +
      '<h3>' + U.esc(record.name) + '</h3>' +
      '<dl class="spec-list">' + rows.map(function (r) {
        return '<div><dt>' + U.esc(r.label) + '</dt><dd>' + U.esc(r.values[0]) + '</dd></div>';
      }).join('') + '</dl>' +
      '<p class="panel-note">Add a second option to see values side by side.</p>' +
      '</div>'
    );
  }

  function renderSuggest() {
    if (!suggestHost) return;
    const chosen = ids();
    const others = ALL.filter(function (i) { return chosen.indexOf(i.id) === -1; }).slice(0, 5);
    if (!others.length) {
      suggestHost.innerHTML = '<h2 class="panel-title" id="suggest-title">Add another option</h2>' +
        '<p class="panel-text small">Every record in the demo dataset is already in a comparison slot.</p>';
      return;
    }
    if (chosen.length >= MAX) {
      suggestHost.innerHTML =
        '<h2 class="panel-title" id="suggest-title">Add another option</h2>' +
        '<p class="panel-text small">All ' + MAX + ' comparison slots are in use. Remove one above to swap in a different record.</p>' +
        '<div class="suggest-list">' +
        others.slice(0, 3).map(function (i) {
          return '<button type="button" class="suggest-row is-disabled" data-full-hint>' +
            '<span class="suggest-icon" aria-hidden="true">' + U.esc((i.image && i.image.icon) || '📦') + '</span>' +
            '<span class="suggest-text"><strong>' + U.esc(i.name) + '</strong><small>' + U.esc(U.categoryLabel(i.category)) + ' · ' + U.esc(U.priceText(i)) + '</small></span>' +
            '<span class="suggest-plus" aria-hidden="true">+</span></button>';
        }).join('') +
        '</div>';
      U.$$('[data-full-hint]', suggestHost).forEach(function (btn) {
        btn.addEventListener('click', function () {
          PV.ui.toast('Three options are already being compared — remove one first.');
        });
      });
      return;
    }
    suggestHost.innerHTML =
      '<h2 class="panel-title" id="suggest-title">Add another option</h2>' +
      '<p class="panel-text small">Quick picks from the demo dataset. Compare works with any records — not only technology.</p>' +
      '<div class="suggest-list">' +
      others.map(function (i) {
        return '<button type="button" class="suggest-row" data-add-option="' + U.esc(i.id) + '">' +
          '<span class="suggest-icon" aria-hidden="true">' + U.esc((i.image && i.image.icon) || '📦') + '</span>' +
          '<span class="suggest-text"><strong>' + U.esc(i.name) + '</strong><small>' + U.esc(U.categoryLabel(i.category)) + ' · ' + U.esc(U.priceText(i)) + '</small></span>' +
          '<span class="suggest-plus" aria-hidden="true">+</span>' +
          '</button>';
      }).join('') +
      '</div>';
    U.$$('[data-add-option]', suggestHost).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (PV.compare.add(btn.getAttribute('data-add-option'))) render();
      });
    });
  }

  function renderNotice() {
    if (!noticeHost) return;
    if (seededTitle && ids().length) {
      noticeHost.innerHTML =
        '<div class="notice">Showing a starting demo selection of ' + ids().length + ' technology products so the comparison layout is visible. ' +
        'Change the slots below — nothing is saved to a server. Demo data only.</div>';
      seededTitle = false;
    }
  }

  function render() {
    renderPickers();
    renderTools();
    renderMatrix();
    renderSuggest();
    renderNotice();
  }

  PV.onCompareChange(function () {
    /* keep the URL shareable when slots change */
    U.updateUrl({ ids: PV.compare.ids().join(',') });
  });

  render();
});
