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
    filters: ['category', 'type', 'band', 'location', 'availability'],
    list: function () {
      return PV.data.deals();
    },
    cardFn: PV.card.deal,
    hintDefault: 'Every offer here is attached to a product or a service. Open the item to see its full detail, or compare up to <strong>3 offers</strong>.'
  });

  const stat = PV.util.$('#datasetStat');
  if (stat) {
    const deals = PV.data.deals();
    const biggest = deals.reduce(function (best, d) {
      return !best || d.deal.discountPercent > best.deal.discountPercent ? d : best;
    }, null);
    stat.innerHTML =
      '<span><b>' + deals.length + '</b> demo offers</span>' +
      '<span><b>' + deals.filter(function (d) { return d.type === 'product'; }).length + '</b> on products</span>' +
      '<span><b>' + deals.filter(function (d) { return d.type === 'service'; }).length + '</b> on services</span>' +
      (biggest ? '<span>Largest demo discount <b>-' + biggest.deal.discountPercent + '%</b></span>' : '');
  }
});
