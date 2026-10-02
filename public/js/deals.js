/* ==========================================================================
   PickVanta — Deals view (deals.html)
   Offers attached to products and services in the demo dataset.
   Deals are never presented as live or purchasable.
   ========================================================================== */
PV.util.ready(function () {
  PV.ui.mountChrome('deals');

  PV.listing.init({
    page: 'deals',
    url: 'deals.html',
    countLabel: 'demo offer',
    filters: ['category', 'type', 'tag', 'band', 'location', 'availability'],
    dataset: 'deals',
    cardFn: PV.card.offer,
    hintDefault: 'Every offer here is attached to a product or a service. Open the item to see its full detail, or compare up to <strong>3 offers</strong>.'
  });

  const stat = PV.util.$('#datasetStat');
  if (stat) {
    PV.store.getDeals().then(function (deals) {
      if (!deals.length) {
        stat.hidden = true;
        return;
      }
      const biggest = deals.reduce(function (best, d) {
        return !best || d.offer.discountPercent > best.offer.discountPercent ? d : best;
      }, null);
      stat.innerHTML =
        '<span><b>' + deals.length + '</b> demo offers</span>' +
        '<span><b>' + deals.filter(function (d) { return d.type === 'product'; }).length + '</b> on products</span>' +
        '<span><b>' + deals.filter(function (d) { return d.type === 'service'; }).length + '</b> on services</span>' +
        (biggest ? '<span>Largest demo discount <b>-' + biggest.offer.discountPercent + '%</b></span>' : '');
    }).catch(function () {
      stat.hidden = true;
    });
  }
});
