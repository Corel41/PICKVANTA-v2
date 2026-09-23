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
    filters: ['category', 'subcategory', 'type', 'tag', 'band', 'location', 'availability'],
    dataset: 'catalogue',
    cardFn: PV.card.item,
    hintDefault: 'Pick up to <strong>3 options</strong> with <strong>Compare</strong> — the tray at the bottom of the screen keeps your selection together.'
  });

  /* Small headline stat that reflects the demo dataset, not a real catalogue. */
  const stat = PV.util.$('#datasetStat');
  if (stat) {
    const stats = PV.store.stats();
    stat.innerHTML =
      '<span><b>' + stats.items + '</b> demo records</span>' +
      '<span><b>' + stats.products + '</b> products</span>' +
      '<span><b>' + stats.services + '</b> services</span>' +
      '<span><b>' + stats.offers + '</b> deals</span>';
  }
});
