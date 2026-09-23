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

  const ALL = PV.data.all();
  let diffsOnly = false;
  let seededTitle = false;

  /* ------------------------------------------------------------- selection */
  const fromUrl = (U.params().get('ids') || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (id) { return !!PV.data.item(id); })
    .slice(0, MAX);

  if (fromUrl.length) {
    PV.compare.set(fromUrl);
  } else if (U.params().has('ids')) {
    /* a link carried ids that are not in the demo dataset — show the empty
       state rather than silently substituting other options */
    PV.compare.set([]);
  } else if (!PV.compare.count()) {
    PV.compare.set(window.PICKVANTA_DATA.defaultCompareIds || []);
    seededTitle = true;
  }

  function ids() {
    return PV.compare.ids();
  }
  function items() {
    return PV.data.items(ids());
  }

  /* ----------------------------------------------------------- row builder */
  function coreRows(list) {
    const rows = [
      { key: 'type', section: 'Overview', label: 'Type', values: list.map(function (i) { return U.typeLabel(i.type); }) },
      { key: 'category', label: 'Category', values: list.map(function (i) { return U.categoryLabel(i.category); }) },
      { key: 'brand', label: 'Brand', values: list.map(function (i) { return i.brand || '—'; }) },
      { key: 'price', section: 'Price & offer', label: 'Price', strong: true, values: list.map(function (i) { return U.priceText(i); }) },
      { key: 'reference', label: 'Reference price', values: list.map(function (i) {
          const ref = i.deal && i.deal.referencePrice != null ? i.deal.referencePrice : i.referencePrice;
          return ref != null ? U.money(ref, (i.price && i.price.currency) || 'USD') : '—';
        }) },
      { key: 'dealPrice', label: 'Deal price (demo)', values: list.map(function (i) {
          return i.deal && i.deal.dealPrice != null
            ? U.money(i.deal.dealPrice, (i.price && i.price.currency) || 'USD') + (i.price && i.price.unit ? '/' + (U.UNIT_LABEL[i.price.unit] || i.price.unit) : '')
            : '—';
        }) },
      { key: 'offer', label: 'Offer status', values: list.map(function (i) {
          const st = U.dealState(i);
          return st ? st.label : 'No demo offer';
        }) },
      { key: 'seller', section: 'Provider & availability', label: 'Seller / provider', values: list.map(function (i) { return U.sellerLabel(i); }) },
      { key: 'sellerType', label: 'Seller type', values: list.map(function (i) { return (i.seller && i.seller.type) || '—'; }) },
      { key: 'location', label: 'Location', values: list.map(function (i) { return U.locationLabel(i); }) },
      { key: 'availability', label: 'Availability', values: list.map(function (i) { return U.statusInfo(i.status).label; }) },
      { key: 'listed', label: 'Listed', values: list.map(function (i) { return U.formatDate(i.listedAt); }) }
    ];

    /* Attribute rows are built from whatever the records actually contain, so
       new categories with new specifications need no changes here. */
    const labels = [];
    list.forEach(function (i) {
      (i.attributes || []).forEach(function (a) {
        if (labels.indexOf(a.label) === -1) labels.push(a.label);
      });
    });
    labels.forEach(function (label) {
      rows.push({
        key: 'attr:' + label,
        section: 'Specifications',
        label: label,
        values: list.map(function (i) {
          const found = (i.attributes || []).find(function (a) { return a.label === label; });
          return found ? found.value : '—';
        })
      });
    });
    return rows;
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
      const record = chosen ? PV.data.item(chosen) : null;

      html += '<div class="cmp-picker' + (record ? '' : ' is-empty') + '">';
      html += '<div class="cmp-picker-head"><span class="cmp-slot">Option ' + letters[slot] + '</span>';
      if (record) {
        html += '<button type="button" class="cmp-remove" data-slot-remove="' + U.esc(record.id) + '" aria-label="Remove ' + U.esc(record.name) + '">Remove</button>';
      }
      html += '</div>';

      html += '<label class="cmp-select"><span class="visually-hidden">Choose option ' + letters[slot] + '</span>' +
        '<select data-slot="' + slot + '">' +
        '<option value="">' + (slot === 0 ? 'Choose an option…' : 'Add another option…') + '</option>' +
        PV.data.categories().map(function (c) {
          const inCat = ALL.filter(function (i) { return i.category === c.slug; });
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
    toolsHost.innerHTML =
      '<label class="switch"><input type="checkbox" id="diffsOnly"' + (diffsOnly ? ' checked' : '') + ' /><span>Show differences only</span></label>' +
      '<span class="tools-spacer"></span>' +
      '<a class="btn-secondary" href="discover.html">Find more options</a>' +
      '<button type="button" class="btn-ghost" data-clear-compare>Clear all</button>' +
      '<span class="tools-count">' + list.length + ' of ' + MAX + ' selected</span>';

    const box = U.$('#diffsOnly');
    if (box) {
      box.addEventListener('change', function () {
        diffsOnly = box.checked;
        renderMatrix();
      });
    }
    const clear = U.$('[data-clear-compare]');
    if (clear) {
      clear.addEventListener('click', function () {
        PV.compare.clear();
        render();
      });
    }
  }

  function renderMatrix() {
    if (!matrixHost) return;
    const list = items();

    if (!list.length) {
      matrixHost.innerHTML = PV.card.empty({
        icon: '⚖️',
        title: 'Nothing selected to compare yet',
        text: 'Choose up to three products or services in the slots above, or add options with the Compare button while you browse Discover or Deals.',
        suggestions: PV.data.categories().slice(0, 4).map(function (c) {
          return { label: c.icon + '  ' + c.label, href: 'discover.html?category=' + c.slug };
        }),
        suggestLabel: 'Start from a category:',
        actions: [
          { label: 'Browse Discover', href: 'discover.html' },
          { label: 'See demo deals', href: 'deals.html' }
        ]
      });
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
        const tds = r.values.map(function (v) {
          const strong = r.strong || r.key === 'dealPrice';
          return '<td data-label="' + U.esc(r.label) + '"' + (strong ? ' class="cmp-strong"' : '') + '>' + U.esc(v) + '</td>';
        }).join('');
        let group = '';
        if (r.section && r.section !== lastSection) {
          lastSection = r.section;
          group = '<tr class="cmp-group"><th scope="colgroup" colspan="' + (list.length + 1) + '">' + U.esc(r.section) + '</th></tr>';
        }
        return group +
          '<tr class="' + (isDiff ? 'row-differs' : 'row-same') + '">' +
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
            return '<div class="' + (differs(r) ? 'differs' : '') + '"><dt>' + U.esc(r.label) + '</dt><dd' + (r.strong ? ' class="cmp-strong"' : '') + '>' + U.esc(v) + '</dd></div>';
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
      '<p class="cmp-footnote"><strong>You decide what matters.</strong> Rows marked “Differs” are only rows where the demo values are not identical — PickVanta does not score, rank or recommend any option here.</p>';
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
