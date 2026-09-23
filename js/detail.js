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
  const record = id ? PV.store.item(id) : null;

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
  const category = PV.store.category(record.category);
  const currency = (record.price && record.price.currency) || 'KES';
  const considerationGroups = PV.store.considerations(record);
  const goodToKnowNotes = PV.store.goodToKnow(record);
  const relatedMatches = PV.store.related(record, 4);
  const related = relatedMatches.map(function (m) { return m.record; });

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

  /* ------------------------------------------------------- quick facts */
  /* A compact, skimmable summary. Products and services lead with different
     information, and a fact is only rendered when the record actually has it —
     no "undefined", no empty labels. */
  function quickFacts() {
    const facts = [];
    const attr = function (label) {
      const found = (record.attributes || []).find(function (a) { return a.label === label; });
      return found ? found.value : '';
    };
    const push = function (label, value) {
      if (value !== undefined && value !== null && String(value).trim() !== '') facts.push({ label: label, value: String(value) });
    };

    const isService = record.type === 'service';
    push(isService ? 'Service type' : 'Type', U.typeLabel(record.type) + (record.subcategory ? ' · ' + record.subcategory : ''));
    if (isService) push('Provider', U.sellerLabel(record));
    else push('Brand', record.brand);

    push('Price', U.priceText(record));
    if (isService) push('Service area', attr('Service area'));
    push('Location', U.locationLabel(record));
    push('Availability', status.label);

    if (isService) {
      push('Turnaround', attr('Turnaround') || attr('Timeline'));
      push('Included', attr('Included'));
    } else {
      /* One representative specification, taken straight from the record, plus
         the practical ownership details when the record states them. */
      const firstSpec = (record.attributes || [])[0];
      if (firstSpec) push('Key specification', firstSpec.label + ': ' + firstSpec.value);
      push('Condition', attr('Condition'));
      push('Warranty', attr('Warranty'));
    }
    push('Offer', deal ? (deal.headline || U.dealKindLabel(deal)) : 'No demo offer on this record');
    return facts;
  }

  /* Highlights come from the record's own highlights[] when it has them.
     Otherwise they are read straight off the structured attributes, so nothing
     is invented and there is no second content source. */
  function highlightList() {
    if (record.highlights && record.highlights.length) return record.highlights.slice(0, 5);
    return (record.attributes || []).map(function (a) { return a.value; }).filter(Boolean).slice(0, 5);
  }

  /* --------------------------------------------------- compare shortcuts */
  const similar = PV.store.related(record, 3)
    .map(function (m) { return m.record; })
    .filter(function (i) { return i.category === record.category; });
  const compareIds = [record.id].concat(similar.slice(0, 2).map(function (i) { return i.id; }));
  const compareHref = 'compare.html?ids=' + encodeURIComponent(compareIds.join(','));

  const multi = (record.attributes || []).length ? attributeSections() : [];

  host.innerHTML =
    /* ---------------------------------------------------------- top area */
    '<section class="detail-top" id="detailTop">' +
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
              '<span class="tag-static demo-tag">Demo listing</span>' +
              (record.badge ? '<span class="badge-pill ' + U.esc(record.badge.tone || 'neutral') + '">' + U.esc(record.badge.label) + '</span>' : '') +
            '</div>' +

            '<h1>' + U.esc(record.name) + '</h1>' +
            '<p class="detail-lead">' + U.esc(record.shortDescription) + '</p>' +

            '<div class="detail-price-row">' +
              '<span class="detail-price">' + U.esc(U.priceText(record)) + '</span>' +
              '<span class="price-note">Illustrative demo price</span>' +
              (deal && deal.referencePrice ? '<span class="price-old">' + U.esc(U.money(deal.referencePrice, currency)) + '</span>' : '') +
              (!deal && record.referencePrice ? '<span class="price-old">ref. ' + U.esc(U.money(record.referencePrice, currency)) + '</span>' : '') +
              (saved ? '<span class="save-pill">Save ' + U.esc(saved) + ' (demo)</span>' : '') +
            '</div>' +

            '<dl class="detail-facts">' +
              '<div><dt><span class="fact-icon" aria-hidden="true">🏬</span>Seller / provider</dt><dd>' + U.esc(U.sellerLabel(record)) + (record.seller && record.seller.verified ? ' <span class="verified">✓ verified (demo)</span>' : '') + ' <small>· ' + U.esc(record.seller ? record.seller.type : 'seller') + '</small></dd></div>' +
              (record.brand ? '<div><dt><span class="fact-icon" aria-hidden="true">🏷</span>Brand</dt><dd>' + U.esc(record.brand) + '</dd></div>' : '') +
              '<div><dt><span class="fact-icon" aria-hidden="true">📍</span>Location</dt><dd>' + U.esc(U.locationLabel(record)) + '</dd></div>' +
              '<div><dt><span class="fact-icon" aria-hidden="true">📦</span>Type</dt><dd>' + U.esc(U.typeLabel(record.type)) + (record.subcategory ? ' <small>· ' + U.esc(record.subcategory) + '</small>' : '') + '</dd></div>' +
              '<div><dt><span class="fact-icon" aria-hidden="true">🗓</span>Availability</dt><dd><span class="status-pill ' + U.esc(status.tone) + '">' + U.esc(status.label) + '</span> <small>(' + U.esc(status.help) + ')</small></dd></div>' +
              '<div><dt><span class="fact-icon" aria-hidden="true">🔖</span>Listed</dt><dd>' + U.esc(U.formatDate(record.listedAt)) + ' <small>· demo record</small></dd></div>' +
              (record.rating ? '<div><dt><span class="fact-icon" aria-hidden="true">★</span>Demo rating</dt><dd>' + record.rating.value.toFixed(1) + ' <small>from ' + record.rating.count + ' demo reviews</small></dd></div>' : '') +
              (deal && dealState ? '<div><dt><span class="fact-icon" aria-hidden="true">🏷</span>Offer status</dt><dd><span class="status-pill ' + U.esc(dealState.tone) + '">' + U.esc(dealState.label) + '</span> <small>· demo offer</small></dd></div>' : '') +
              /* Services state where they work and how long they take; products
                 do not get these rows at all. */
              (function () {
                const area = (record.attributes || []).find(function (a) { return a.label === 'Service area'; });
                return area ? '<div><dt><span class="fact-icon" aria-hidden="true">🗺</span>Service area</dt><dd>' + U.esc(area.value) + '</dd></div>' : '';
              })() +
              (function () {
                const turn = (record.attributes || []).find(function (a) { return a.label === 'Turnaround' || a.label === 'Timeline'; });
                return turn ? '<div><dt><span class="fact-icon" aria-hidden="true">⏱</span>' + U.esc(turn.label) + '</dt><dd>' + U.esc(turn.value) + '</dd></div>' : '';
              })() +
            '</dl>' +

            /* Quick facts — the whole option in one block, before any reading */
            '<div class="block" id="quickFacts">' +
              '<h2 class="block-title">Quick facts</h2>' +
              '<dl class="quick-facts">' +
                quickFacts().map(function (f) {
                  return '<div><dt>' + U.esc(f.label) + '</dt><dd>' + U.esc(f.value) + '</dd></div>';
                }).join('') +
              '</dl>' +
            '</div>' +

            /* Highlights sit above the actions so they are read before deciding */
            (highlightList().length
              ? '<div class="highlights-block">' +
                  '<h2 class="block-title">Key highlights</h2>' +
                  '<ul class="highlight-list">' + highlightList().map(function (h) { return '<li>' + U.esc(h) + '</li>'; }).join('') + '</ul>' +
                '</div>'
              : '') +

            /* What to consider — questions worth asking for this kind of option */
            (considerationGroups
              ? '<div class="block consider-block">' +
                  '<h2 class="block-title">What to consider</h2>' +
                  '<p class="block-note">General prompts for this kind of ' + U.esc(record.type) +
                  ', not a verdict on this listing. Nothing below is scored or ranked.</p>' +
                  considerationGroups.map(function (g) {
                    return '<div class="consider-group"><h3>' + U.esc(g.title) + '</h3><ul class="consider-list">' +
                      g.items.map(function (item) {
                        return '<li><strong>' + U.esc(item.label) + '</strong><span>' + U.esc(item.hint) + '</span></li>';
                      }).join('') + '</ul></div>';
                  }).join('') +
                '</div>'
              : '') +

            '<div class="actions-row">' +
              '<button type="button" class="btn-primary btn-large compare-btn" data-compare-toggle="' + U.esc(record.id) + '" data-compare-name="' + U.esc(record.name) + '" aria-pressed="false">' +
                '<span class="cmp-btn-icon" aria-hidden="true">+</span><span class="cmp-btn-label">Compare</span>' +
              '</button>' +
              (deal ? '<a class="btn-secondary btn-large" href="#dealBox">View deal</a>' : '') +
              (related.length ? '<a class="btn-secondary btn-large" href="#related">Explore similar options</a>' : '') +
              '<button type="button" class="btn-ghost btn-large" data-later="Saving items">Save</button>' +
              '<button type="button" class="btn-ghost btn-large" data-later="Seller contact">Contact seller</button>' +
            '</div>' +

            '<p class="actions-note">Compare adds this option to the demo comparison tray (up to 3). Save and Contact seller are demo interactions — there is no account, no messaging and no real seller contact in this build.</p>' +
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
          '<p class="panel-note">Illustrative description for interface demonstration. Not a manufacturer or provider statement.</p>' +
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
          '<p class="panel-note">Demo seller: the name, rating and verification badge are invented for this interface. PickVanta does not contact sellers, verify providers or check stock in this build.</p>' +
          '<button type="button" class="btn-secondary btn-block" data-later="Seller contact">Contact seller (demo)</button>' +
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
                '<span class="deal-flag">Special offer · demo</span>' +
                '<h2 id="deal-title">Offer attached to ' + U.esc(record.name) + '</h2>' +
                (deal.headline ? '<p class="deal-headline">' + U.esc(deal.headline) + '</p>' : '') +
                '<p class="deal-sub">The offer changes the price of this ' + U.esc(record.type) + ' — it is not a separate item.</p>' +
                '<h3 class="deal-sub-title">Price</h3>' +
                '<div class="deal-terms">' +
                  '<div><span>Deal price (demo)</span><strong>' + U.esc(U.money(deal.dealPrice, currency)) + (record.price && record.price.unit ? '/' + (U.UNIT_LABEL[record.price.unit] || record.price.unit) : '') + '</strong></div>' +
                  '<div><span>Reference price</span><strong>' + U.esc(U.money(deal.referencePrice, currency)) + '</strong></div>' +
                  '<div><span>Discount</span><strong>-' + deal.discountPercent + '%</strong></div>' +
                '</div>' +
                '<h3 class="deal-sub-title">Offer</h3>' +
                '<div class="deal-terms">' +
                  '<div><span>Offer type</span><strong>' + U.esc(U.dealKindLabel(deal)) + '</strong></div>' +
                  '<div><span>Valid from</span><strong>' + U.esc(U.formatDate(deal.validFrom)) + '</strong></div>' +
                  '<div><span>Valid to</span><strong>' + U.esc(U.formatDate(deal.validTo)) + '</strong></div>' +
                  '<div><span>Status</span><strong>' + U.esc(dealState ? dealState.label : 'Demo offer') + '</strong></div>' +
                '</div>' +
                '<h3 class="deal-sub-title">Important context</h3>' +
                '<p class="deal-context">This is a demonstration offer. PickVanta does not process the transaction — there is no checkout, no payment and no order. Prices are illustrative, and the reference price is an invented comparison figure rather than a checked market price.</p>' +
                (deal.conditions && deal.conditions.length
                  ? '<div class="deal-conditions"><h3>Conditions (demo)</h3><ul>' + deal.conditions.map(function (c) { return '<li>' + U.esc(c) + '</li>'; }).join('') + '</ul></div>'
                  : '') +
                '<p class="deal-disclaimer">This offer is invented for interface demonstration. It is not available, not checked against live pricing, and cannot be claimed.</p>' +
              '</div>' +
              '<div class="deal-box-side">' +
                '<a class="btn-primary btn-block" href="deals.html?q=' + encodeURIComponent(record.name) + '">Open on the Deals page</a>' +
                '<a class="btn-secondary btn-block" href="#detailTop">Back to the item</a>' +
                '<button type="button" class="btn-secondary btn-block compare-btn" data-compare-toggle="' + U.esc(record.id) + '" data-compare-name="' + U.esc(record.name) + '" aria-pressed="false">' +
                  '<span class="cmp-btn-icon" aria-hidden="true">+</span><span class="cmp-btn-label">Compare this option</span>' +
                '</button>' +
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
    (relatedMatches.length
      ? '<section class="section" id="related" aria-labelledby="rel-title">' +
          '<div class="shell">' +
            '<div class="section-head"><div>' +
              '<h2 id="rel-title">Related options</h2>' +
              '<p>Deterministic matches on category, subcategory, tags, brand, price range and location — not an algorithm, not a recommendation and not a ranking. Each card says why it appears.</p>' +
            '</div>' +
            '<a class="link-arrow" href="discover.html?category=' + U.esc(record.category) + '">See all ' + U.esc(U.categoryLabel(record.category)) + ' <span aria-hidden="true">→</span></a>' +
            '</div>' +
            '<div class="products-grid grid-4">' +
              relatedMatches.map(function (m) { return PV.card.item(m.record, { reasons: m.reasons, reasonLabel: 'Why this appears:' }); }).join('') +
            '</div>' +
          '</div>' +
        '</section>'
      : '');

  /* Good to know — general educational notes for this kind of option. */
  if (goodToKnowNotes.length) {
    const knowHost = U.$('#detailKnow');
    if (knowHost) {
      knowHost.innerHTML =
        '<section class="section section-tight" id="goodToKnow" aria-labelledby="know-title">' +
          '<div class="shell">' +
            '<div class="panel know-panel">' +
              '<h2 id="know-title" class="panel-title">Good to know</h2>' +
              '<p class="panel-note">General context for this kind of ' + U.esc(record.type) +
              ' — educational notes, not claims about this provider or listing.</p>' +
              '<ul class="know-list">' + goodToKnowNotes.map(function (n) { return '<li>' + U.esc(n) + '</li>'; }).join('') + '</ul>' +
            '</div>' +
          '</div>' +
        '</section>';
    }
  }

  /* Remember this visit for the "Recently viewed on this device" list. */
  PV.recent.add(record.id);

  PV.ui.syncCompareButtons();
  PV.ui.renderTray();
});
