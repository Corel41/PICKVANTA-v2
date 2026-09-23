/* ==========================================================================
   PickVanta — Detail view (detail.html?id=…)
   One reusable detail template for any record type: product, service or an
   item that carries a deal. Nothing on this page is item-specific — every
   block is driven by the record from js/data.js.
   ========================================================================== */
PV.util.ready(function () {
  const U = PV.util;
  PV.ui.mountChrome(null);

  const host = U.$('#detail');
  const crumb = U.$('#crumb');
  const id = U.params().get('id');
  const record = id ? PV.data.item(id) : null;

  if (!host) return;

  if (!record) {
    document.title = 'Item not found | PickVanta';
    if (crumb) {
      crumb.innerHTML =
        '<a href="index.html">Home</a><span aria-hidden="true">/</span>' +
        '<a href="discover.html">Discover</a><span aria-hidden="true">/</span><span>Not found</span>';
    }
    host.innerHTML =
      '<div class="shell">' +
      PV.card.empty({
        icon: '🧭',
        title: 'That item is not in the demo dataset',
        text: 'The link may be old, or the item id is not part of this stage’s demo content. Browse Discover to pick another option.',
        actions: [
          { label: 'Go to Discover', href: 'discover.html' },
          { label: 'See demo deals', href: 'deals.html' }
        ]
      }) +
      '</div>';
    return;
  }

  document.title = record.name + ' | PickVanta';

  const status = U.statusInfo(record.status);
  const deal = record.deal;
  const dealState = U.dealState(record);
  const saved = U.savings(record);
  const category = PV.data.category(record.category);
  const currency = (record.price && record.price.currency) || 'USD';
  const related = PV.data.related(record, 4);

  /* ------------------------------------------------------------- crumbs */
  if (crumb) {
    crumb.innerHTML =
      '<a href="index.html">Home</a><span aria-hidden="true">/</span>' +
      '<a href="discover.html">Discover</a><span aria-hidden="true">/</span>' +
      '<a href="discover.html?category=' + U.esc(record.category) + '">' + U.esc(U.categoryLabel(record.category)) + '</a>' +
      '<span aria-hidden="true">/</span><span>' + U.esc(record.name) + '</span>';
  }

  /* --------------------------------------------- grouped specifications */
  function attributeSections() {
    const groups = [];
    (record.attributes || []).forEach(function (a) {
      const name = a.group || 'Specifications';
      let g = groups.find(function (x) { return x.name === name; });
      if (!g) {
        g = { name: name, rows: [] };
        groups.push(g);
      }
      g.rows.push(a);
    });
    return groups;
  }

  /* --------------------------------------------------- compare shortcuts */
  const similar = PV.data.related(record, 3).filter(function (i) { return i.category === record.category; });
  const compareIds = [record.id].concat(similar.slice(0, 2).map(function (i) { return i.id; }));
  const compareHref = 'compare.html?ids=' + encodeURIComponent(compareIds.join(','));

  const multi = (record.attributes || []).length ? attributeSections() : [];

  host.innerHTML =
    /* ---------------------------------------------------------- top area */
    '<section class="detail-top">' +
      '<div class="shell">' +
        '<div class="detail-grid">' +
          '<div class="detail-media-wrap">' +
            '<div class="detail-media"' + (record.image && record.image.gradient ? ' style="background:' + record.image.gradient + '"' : '') + '>' +
              (record.image && record.image.src
                ? '<img src="' + U.esc(record.image.src) + '" alt="' + U.esc(record.image.alt || record.name) + '" />'
                : '<span class="detail-icon" aria-hidden="true">' + U.esc((record.image && record.image.icon) || '📦') + '</span>') +
              '<span class="type-flag">' + U.esc(U.typeLabel(record.type)) + '</span>' +
              (deal ? '<span class="discount">-' + deal.discountPercent + '% · Demo</span>' : record.badge ? '<span class="badge-pill ' + U.esc(record.badge.tone || 'neutral') + ' flag-right">' + U.esc(record.badge.label) + '</span>' : '') +
            '</div>' +
            '<p class="media-note">Image placeholder — demo records use a colour tile until real media exists.</p>' +
          '</div>' +

          '<div class="detail-info">' +
            '<div class="detail-tags">' +
              '<a class="tag-link" href="discover.html?category=' + U.esc(record.category) + '">' + U.esc((category && category.icon) || '') + ' ' + U.esc(U.categoryLabel(record.category)) + '</a>' +
              (record.subcategory ? '<span class="tag-static">' + U.esc(record.subcategory) + '</span>' : '') +
              (record.badge ? '<span class="badge-pill ' + U.esc(record.badge.tone || 'neutral') + '">' + U.esc(record.badge.label) + '</span>' : '') +
            '</div>' +

            '<h1>' + U.esc(record.name) + '</h1>' +
            '<p class="detail-lead">' + U.esc(record.shortDescription) + '</p>' +

            '<div class="detail-price-row">' +
              '<span class="detail-price">' + U.esc(U.priceText(record)) + '</span>' +
              (deal && deal.referencePrice ? '<span class="price-old">' + U.esc(U.money(deal.referencePrice, currency)) + '</span>' : '') +
              (!deal && record.referencePrice ? '<span class="price-old">ref. ' + U.esc(U.money(record.referencePrice, currency)) + '</span>' : '') +
              (saved ? '<span class="save-pill">Save ' + U.esc(saved) + ' (demo)</span>' : '') +
            '</div>' +

            '<dl class="detail-facts">' +
              '<div><dt>Seller</dt><dd>' + U.esc(U.sellerLabel(record)) + (record.seller && record.seller.verified ? ' <span class="verified">✓ verified (demo)</span>' : '') + '</dd></div>' +
              '<div><dt>Type</dt><dd>' + U.esc(record.seller ? record.seller.type : U.typeLabel(record.type)) + '</dd></div>' +
              '<div><dt>Location</dt><dd>' + U.esc(U.locationLabel(record)) + '</dd></div>' +
              '<div><dt>Availability</dt><dd><span class="status-pill ' + U.esc(status.tone) + '">' + U.esc(status.label) + '</span> <small>(' + U.esc(status.help) + ')</small></dd></div>' +
              '<div><dt>Listed</dt><dd>' + U.esc(U.formatDate(record.listedAt)) + ' <small>· demo record</small></dd></div>' +
              (record.rating ? '<div><dt>Demo rating</dt><dd>★ ' + record.rating.value.toFixed(1) + ' <small>from ' + record.rating.count + ' demo reviews</small></dd></div>' : '') +
              (deal && dealState ? '<div><dt>Offer status</dt><dd><span class="status-pill ' + U.esc(dealState.tone) + '">' + U.esc(dealState.label) + '</span> <small>· demo offer</small></dd></div>' : '') +
            '</dl>' +

            '<div class="actions-row">' +
              '<button type="button" class="btn-primary btn-large" data-compare-toggle="' + U.esc(record.id) + '">Compare</button>' +
              (deal ? '<a class="btn-secondary btn-large" href="#dealBox">View deal</a>' : '') +
              '<button type="button" class="btn-secondary btn-large" data-later="Saving items">Save</button>' +
              '<button type="button" class="btn-secondary btn-large" data-later="Seller contact">Contact seller</button>' +
            '</div>' +

            '<p class="actions-note">Compare adds this option to the demo comparison tray. Saving and seller contact are not built in this stage — no messages or favourites are stored.</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</section>' +

    /* ------------------------------------------------------ description */
    '<section class="section" aria-labelledby="about-title">' +
      '<div class="shell detail-two-col">' +
        '<div class="panel">' +
          '<h2 id="about-title" class="panel-title">About this ' + U.esc(record.type) + '</h2>' +
          '<p class="panel-text">' + U.esc(record.description) + '</p>' +
          (record.highlights && record.highlights.length
            ? '<ul class="highlight-list">' + record.highlights.map(function (h) { return '<li>' + U.esc(h) + '</li>'; }).join('') + '</ul>'
            : '') +
        '</div>' +

        '<div class="panel side-panel">' +
          '<h2 class="panel-title">Seller &amp; availability</h2>' +
          '<div class="seller-card">' +
            '<div class="seller-avatar" aria-hidden="true">' + U.esc(U.sellerLabel(record).charAt(0)) + '</div>' +
            '<div>' +
              '<strong>' + U.esc(U.sellerLabel(record)) + '</strong>' +
              '<span>' + U.esc(record.seller ? record.seller.type : 'Seller') + (record.seller && record.seller.rating ? ' · ★ ' + record.seller.rating.toFixed(1) + ' (demo)' : '') + '</span>' +
            '</div>' +
          '</div>' +
          '<dl class="detail-facts compact">' +
            '<div><dt>Location</dt><dd>' + U.esc(U.locationLabel(record)) + '</dd></div>' +
            '<div><dt>Current status</dt><dd><span class="status-pill ' + U.esc(status.tone) + '">' + U.esc(status.label) + '</span></dd></div>' +
          '</dl>' +
          '<p class="panel-note">Demo sellers and statuses are illustrative. PickVanta does not contact sellers or check stock in this stage.</p>' +
          (similar.length
            ? '<a class="btn-secondary btn-block" href="' + U.esc(compareHref) + '">Compare with ' + similar.length + ' similar option' + (similar.length === 1 ? '' : 's') + '</a>'
            : '') +
        '</div>' +
      '</div>' +
    '</section>' +

    /* -------------------------------------------------------- deal block */
    (deal
      ? '<section class="section" id="dealBox" aria-labelledby="deal-title">' +
          '<div class="shell">' +
            '<div class="deal-box">' +
              '<div class="deal-box-main">' +
                '<span class="deal-flag">Demo offer</span>' +
                '<h2 id="deal-title">' + U.esc(record.name) + ' — offer detail</h2>' +
                '<div class="deal-terms">' +
                  '<div><span>Deal price</span><strong>' + U.esc(U.money(deal.dealPrice, currency)) + (record.price && record.price.unit ? '/' + (U.UNIT_LABEL[record.price.unit] || record.price.unit) : '') + '</strong></div>' +
                  '<div><span>Reference price</span><strong>' + U.esc(U.money(deal.referencePrice, currency)) + '</strong></div>' +
                  '<div><span>Discount</span><strong>-' + deal.discountPercent + '%</strong></div>' +
                  '<div><span>Valid from</span><strong>' + U.esc(U.formatDate(deal.validFrom)) + '</strong></div>' +
                  '<div><span>Valid to</span><strong>' + U.esc(U.formatDate(deal.validTo)) + '</strong></div>' +
                  '<div><span>Status</span><strong>' + U.esc(dealState ? dealState.label : 'Demo offer') + '</strong></div>' +
                '</div>' +
                (deal.conditions && deal.conditions.length
                  ? '<div class="deal-conditions"><h3>Conditions (demo)</h3><ul>' + deal.conditions.map(function (c) { return '<li>' + U.esc(c) + '</li>'; }).join('') + '</ul></div>'
                  : '') +
                '<p class="deal-disclaimer">This offer is invented for interface demonstration. It is not available, not checked against live pricing, and cannot be claimed.</p>' +
              '</div>' +
              '<div class="deal-box-side">' +
                '<a class="btn-primary btn-block" href="deals.html?q=' + encodeURIComponent(record.name) + '">Open on Deals page</a>' +
                '<button type="button" class="btn-secondary btn-block" data-compare-toggle="' + U.esc(record.id) + '">Compare</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>'
      : '') +

    /* -------------------------------------------------------- key details */
    (multi.length
      ? '<section class="section" aria-labelledby="spec-title">' +
          '<div class="shell">' +
            '<div class="section-head"><div>' +
              '<h2 id="spec-title">Key information</h2>' +
              '<p>Attributes are stored per record, so different categories can expose different specifications later.</p>' +
            '</div>' +
            '<a class="link-arrow" href="' + U.esc(compareHref) + '">Compare these details <span aria-hidden="true">→</span></a>' +
            '</div>' +
            '<div class="spec-groups">' +
              multi.map(function (g) {
                return '<div class="spec-group"><h3>' + U.esc(g.name) + '</h3><dl class="spec-list">' +
                  g.rows.map(function (r) { return '<div><dt>' + U.esc(r.label) + '</dt><dd>' + U.esc(r.value) + '</dd></div>'; }).join('') +
                  '</dl></div>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</section>'
      : '') +

    /* ------------------------------------------------------------ related */
    (related.length
      ? '<section class="section" aria-labelledby="rel-title">' +
          '<div class="shell">' +
            '<div class="section-head"><div>' +
              '<h2 id="rel-title">More in ' + U.esc(U.categoryLabel(record.category)) + '</h2>' +
              '<p>Other demo records from the same category and type.</p>' +
            '</div>' +
            '<a class="link-arrow" href="discover.html?category=' + U.esc(record.category) + '">See all <span aria-hidden="true">→</span></a>' +
            '</div>' +
            '<div class="products-grid grid-4">' + related.map(PV.card.item).join('') + '</div>' +
          '</div>' +
        '</section>'
      : '');

  PV.ui.syncCompareButtons();
  PV.ui.renderTray();
});
