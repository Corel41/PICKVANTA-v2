/* ==========================================================================
   PickVanta — Discover view (discover.html)
   Browse everything in the demo dataset: products, services and offers.
   ========================================================================== */
PV.util.ready(function () {
  PV.ui.mountChrome('discover');

  PV.listing.init({
    page: 'discover',
    url: 'discover.html',
    countLabel: 'option',
    filters: ['category', 'type', 'band', 'location', 'availability'],
    list: function () {
      return PV.data.all();
    },
    cardFn: PV.card.item
  });

  /* Small headline stat that reflects the demo dataset, not a real catalogue. */
  const stat = PV.util.$('#datasetStat');
  if (stat) {
    const items = PV.data.all();
    const products = items.filter(function (i) { return i.type === 'product'; }).length;
    const services = items.filter(function (i) { return i.type === 'service'; }).length;
    stat.innerHTML =
      '<span><b>' + items.length + '</b> demo records</span>' +
      '<span><b>' + products + '</b> products</span>' +
      '<span><b>' + services + '</b> services</span>' +
      '<span><b>' + PV.data.deals().length + '</b> deals</span>';
  }
});
