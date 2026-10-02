/* ==========================================================================
   PickVanta — runtime configuration (js/config.js)
   --------------------------------------------------------------------------
   This file holds the PUBLIC configuration only. It is committed, so it must
   never contain a secret:

     • the Supabase URL is public;
     • the Supabase anon key is a public, browser-safe key — it is protected by
       Row Level Security, not by secrecy. Never put the service-role key, a
       database password or any private key in this file (or anywhere else in
       the repository).

   Default state: mode 'demo', which serves the bundled demonstration catalogue
   from js/data.js. No network access, no configuration needed.

   To run against the real catalogue:

     1. apply db/migrations/0001_catalogue.sql and db/seed/0001_catalogue.sql
        to your Supabase project (see the README);
     2. set mode to 'api' and fill in url + anonKey below (see
        js/config.example.js for a filled-in example);
     3. reload the site.

   onFailure decides what a visitor sees when the live catalogue cannot be
   reached:
     'error'  (default) the page shows the error state with a retry control —
              a real outage is never hidden behind stale demo data;
     'demo'   explicitly opt in to serving the bundled demo dataset instead,
              with the demonstration notice shown on the page. Use this for
              development and previews, never to disguise a production failure.
   ========================================================================== */
window.PV_CONFIG = {
  /* 'demo'  the bundled demonstration catalogue in js/data.js (default);
     'api'   the live catalogue read from the Supabase project below. */
  mode: 'demo',
  supabase: {
    /* e.g. https://YOUR-PROJECT-REF.supabase.co — public. */
    url: '',
    /* The project's anon (publishable) key. Public by design: Row Level
       Security decides what it may read. Never the service-role key. */
    anonKey: ''
  },
  /* What a visitor sees when the live catalogue cannot be reached:
     'error' show the error state with a retry control (default — a real
             outage is never hidden behind demo data);
     'demo'  serve the bundled demonstration catalogue instead, clearly
             labelled as a demonstration. For development and previews. */
  onFailure: 'error',
  /* Records per request when a page asks for a pool of options (compare
     suggestions, typeahead). Browsing always uses real pagination. */
  poolLimit: 60
};

/* ---------------------------------------------------------------------------
   Optional local override
   ---------------------------------------------------------------------------
   Anything that sets window.PV_CONFIG_OVERRIDE before this file — an inline
   snippet in a deployment, or a js/config.local.js script tag added ahead of
   this one (that file is git-ignored) — replaces the matching values here.
   Nothing secret may ever go in an override: it is shipped to the browser.
   --------------------------------------------------------------------------- */
(function () {
  const override = window.PV_CONFIG_OVERRIDE;
  if (!override || typeof override !== 'object') return;
  window.PV_CONFIG = Object.assign({}, window.PV_CONFIG, override, {
    supabase: Object.assign({}, window.PV_CONFIG.supabase, override.supabase || {})
  });
})();
