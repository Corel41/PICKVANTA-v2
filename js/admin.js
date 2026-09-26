/* ==========================================================================
   PickVanta — admin panel controller (Steps 12–13)
   --------------------------------------------------------------------------
   The operational side of PickVanta: a dashboard of real counts, the seller
   /provider review queue, and the Deal Engine's sources.

   What this file is not: an authorization layer. It decides what to *draw*,
   never what is allowed. Every request goes to js/store.js, which sends the
   administrator's own token, and the database answers according to
   `public.is_admin()` and its row policies:

     • a signed-out visitor sees a sign-in prompt and no admin request is made;
     • a signed-in non-administrator sees an access-denied panel and no admin
       request is made — and if one were made anyway, the database would refuse
       it or return nothing;
     • an administrator sees the panel, and still cannot make the database do
       anything an administrator may not do.

   The panel deliberately mirrors the applicant-facing page (js/sell.js): same
   store, same domain vocabulary, same design system, same honest states.
   ========================================================================== */
window.PV = window.PV || {};

PV.admin = (function () {
  'use strict';

  const D = PV.domain;
  const U = PV.util;
  const auth = PV.auth;

  const root = U.$('#adminRoot');
  if (!root) return {};

  const QUEUE_PAGE = 50;
  /* How many imported records the Import Deals section reads (Step 17B). The
     store clamps any request to the same 50, so this is the largest single read
     the database will answer for them — the section never asks for the table. */
  const IMPORTS_PAGE = 50;
  /* How many canonical records the Products section shows. The counts above the
     tables are the database's totals, so a list cut short by this number says
     how many more there are instead of implying it is all of them. */
  const CATALOGUE_PREVIEW = 25;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SECTIONS = ['dashboard', 'sellers', 'products', 'sources', 'jobs', 'imports', 'review'];

  /* The panel's structure. `active` items work today; `planned` items are the
     intended architecture and are deliberately not clickable — a dead control
     would suggest functionality that does not exist. */
  const NAV = [
    {
      label: 'Operations',
      items: [
        { id: 'dashboard', label: 'Dashboard', active: true },
        { id: 'sellers', label: 'Seller & provider review', active: true }
      ]
    },
    {
      label: 'Marketplace',
      items: [
        { id: 'listings', label: 'Listings' },
        { id: 'products', label: 'Products', active: true },
        { id: 'categories', label: 'Categories' },
        { id: 'deals', label: 'Deals' }
      ]
    },
    {
      label: 'Deal Engine',
      items: [
        { id: 'sources', label: 'Sources', active: true },
        { id: 'jobs', label: 'Jobs', active: true },
        { id: 'imports', label: 'Import Deals', active: true },
        { id: 'review', label: 'Review Queue', active: true },
        { id: 'history', label: 'Import History' },
        { id: 'affiliates', label: 'Affiliate Links' },
        { id: 'scans', label: 'Scheduled Scans' }
      ]
    },
    {
      label: 'Insights',
      items: [{ id: 'analytics', label: 'Analytics' }]
    },
    {
      label: 'System',
      items: [{ id: 'settings', label: 'Settings' }]
    }
  ];

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'active', label: 'Active' },
    { id: 'rejected', label: 'Rejected' },
    { id: 'suspended', label: 'Suspended' },
    { id: 'archived', label: 'Archived' }
  ];

  /* ------------------------------------------------------------- state ---- */
  const state = {
    section: 'dashboard',
    filter: 'pending',
    selectedId: '',
    counts: null,
    countsError: '',
    queue: [],
    queueMore: false,
    queueLoaded: false,
    queueError: '',
    detail: null,
    detailLoaded: false,
    detailError: '',
    sources: [],
    sourcesLoaded: false,
    sourcesError: '',
    /* The source form: null when closed. Every keystroke is kept here so a
       re-render never loses what the operator typed. */
    form: null,
    jobs: [],
    jobsLoaded: false,
    jobsError: '',
    importedTotal: null,
    /* Import Deals (Step 17B): one bounded page of the imported records, the
       database's own count of the whole table, and whether more exist than the
       page shows. Kept apart from the review queue's state — this section only
       inspects records, so a failure here can never empty the queue's list. */
    imports: [],
    importsTotal: null,
    importsMore: false,
    importsLoaded: false,
    importsError: '',
    /* The review queue (Step 17A): the records waiting for a decision, the one
       being read, its history, the reference lists the decision form chooses
       from, and the decision itself. Nothing here is derived, matched or
       inferred — every value is a column the database returned. */
    reviewQueue: [],
    reviewQueueTotal: null,
    reviewQueueMore: false,
    reviewQueueLoaded: false,
    reviewQueueError: '',
    reviewRecord: null,
    reviewRecordLoaded: false,
    reviewRecordError: '',
    reviewEvents: [],
    reviewEventsLoaded: false,
    reviewRefsError: '',
    reviewTaxonomyLoaded: false,
    reviewTaxonomy: [],
    reviewProducts: [],
    reviewProductsTotal: null,
    reviewVariants: [],
    reviewVariantsFor: '',
    reviewVariantsLoaded: false,
    reviewSources: [],
    conversion: null,
    conversionErrors: {},
    conversionConfirm: false,
    conversionResult: null,
    /* The canonical layer (Step 15). Raw, ordered reads — nothing is derived,
       ranked or summarised into a new number. */
    catalogueCounts: null,
    catalogueProducts: [],
    catalogueOffers: [],
    catalogueMerchants: [],
    catalogueSources: [],
    catalogueLoaded: false,
    catalogueError: '',
    action: null,          /* the review action awaiting confirmation */
    note: '',
    noteError: '',
    busy: false,
    message: '',
    messageTone: 'neutral'
  };
  let focusAfterRender = '';

  const esc = U.esc;
  const session = () => (auth && typeof auth.session === 'function' ? auth.session() : null);
  const isAdmin = () => !!(auth && typeof auth.isAdmin === 'function' && auth.isAdmin());

  /* ----------------------------------------------------------- address ----
     The URL carries the view so a review can be linked or reloaded:
       admin.html?section=sellers&status=pending&id=<uuid>
     Every part of it is validated before it is used, and none of it is ever
     treated as proof of anything: authorization is the session plus the
     database. An unrecognised section falls back to the dashboard, an unknown
     status falls back to pending, and anything that is not a UUID is ignored. */
  function readAddress() {
    const p = U.params();
    const section = p.get('section');
    const status = p.get('status');
    const id = p.get('id');
    state.section = SECTIONS.indexOf(section) !== -1 ? section : 'dashboard';
    state.filter = FILTERS.some((f) => f.id === status) ? status : 'pending';
    state.selectedId = id && UUID.test(id) ? id : '';
  }

  function writeAddress() {
    const parts = ['section=' + encodeURIComponent(state.section)];
    if (state.section === 'sellers') {
      parts.push('status=' + encodeURIComponent(state.filter));
      if (state.selectedId) parts.push('id=' + encodeURIComponent(state.selectedId));
    }
    if (state.section === 'review' && state.selectedId) {
      parts.push('id=' + encodeURIComponent(state.selectedId));
    }
    try {
      window.history.replaceState({}, '', 'admin.html?' + parts.join('&'));
    } catch (err) {
      /* A file:// page cannot rewrite its address; the panel still works. */
    }
  }

  /* ---------------------------------------------------------- wording ---- */
  /* Failures become plain sentences. Raw database text never reaches the
     operator, and a refusal is described as what it is. */
  function messageFor(err) {
    const code = err && err.code ? err.code : '';
    if (code === 'api-not-configured') {
      return 'The admin panel needs the live database connection. This build is running on the ' +
        'bundled demonstration catalogue.';
    }
    if (code === 'api-401') return 'Your session has expired. Sign in again to continue.';
    if (code === 'api-403') {
      return 'The database refused that. Only an administrator can review applications, and the ' +
        'decision is the database’s, not this page’s.';
    }
    if (code === 'api-404') return 'That application is no longer in the database.';
    if (code === 'api-409') return 'That application was already changed by someone else. Reloading the list.';
    if (code === 'api-unreachable') {
      return 'We could not reach the database. Check your connection and try again.';
    }
    if (code === 'not-signed-in') return 'Sign in again to continue.';
    return 'That did not go through and nothing was changed. Try again in a moment.';
  }

  function statusPill(account) {
    const copy = D.adminStatusCopy(account.status);
    return '<span class="status-pill status-' + esc(copy.tone) + '">' + esc(copy.label) + '</span>';
  }

  /* A count is either the database's number or it is not shown at all. */
  function countText(value) {
    return typeof value === 'number' && isFinite(value) ? String(value) : 'Not available';
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatClock(date) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  /* ------------------------------------------------------------- shell --- */
  function navMarkup() {
    return (
      '<nav class="admin-nav" aria-label="Admin sections">' +
      NAV.map(function (group) {
        return (
          '<div class="admin-nav-group">' +
          '<h2 class="admin-nav-title">' + esc(group.label) + '</h2>' +
          '<ul class="admin-nav-list">' +
          group.items.map(function (item) {
            if (!item.active) {
              return '<li class="admin-nav-item is-planned">' +
                '<span class="admin-nav-label">' + esc(item.label) + '</span>' +
                '<span class="admin-soon">Planned</span>' +
                '</li>';
            }
            const current = state.section === item.id;
            return '<li class="admin-nav-item">' +
              '<button type="button" class="admin-nav-link' + (current ? ' is-current' : '') + '"' +
              ' data-admin-nav="' + esc(item.id) + '"' +
              (current ? ' aria-current="true"' : '') + '>' +
              esc(item.label) + '</button></li>';
          }).join('') +
          '</ul></div>'
        );
      }).join('') +
      '<p class="admin-nav-note">Planned sections are the intended architecture. ' +
      'None of them is built yet, and none of them is clickable. Products is an ' +
      'operational view, not an editor: it counts the canonical records and shows ' +
      'the most recent, and nothing there can be changed. The Deal Engine has its ' +
      'foundation and one deliberate action: an administrator can convert a single ' +
      'imported record in the Review Queue; Import Deals reads the imported records ' +
      'themselves, and can change nothing. No connector reads a source, no worker ' +
      'runs a job, and nothing converts anything by itself.</p>' +
      '</nav>'
    );
  }

  function activeSectionTitle() {
    if (state.section === 'sellers') return state.selectedId ? 'Application' : 'Seller & provider review';
    if (state.section === 'products') return 'Products';
    if (state.section === 'sources') return 'Sources';
    if (state.section === 'jobs') return 'Jobs';
    if (state.section === 'imports') return 'Import Deals';
    if (state.section === 'review') return state.selectedId ? 'Imported record' : 'Review queue';
    return 'Dashboard';
  }

  function shell(main) {
    return (
      '<div class="admin-shell">' +
      '<aside class="admin-side">' + navMarkup() + '</aside>' +
      '<div class="admin-main">' +
      '<div class="admin-main-head">' +
      '<h2 class="admin-main-title">' + esc(activeSectionTitle()) + '</h2>' +
      (state.busy ? '<span class="admin-working" role="status">Working…</span>' : '') +
      '</div>' +
      (state.message
        ? '<p class="admin-message tone-' + esc(state.messageTone) + '" id="adminMessage"' +
          ' role="status" tabindex="-1">' + esc(state.message) + '</p>'
        : '') +
      main +
      '</div>' +
      '</div>'
    );
  }

  /* ------------------------------------------------- access states -------
     Four honest states, and only the last one reads any admin data. */
  function accessView(kind, extra) {
    const back = '<div class="admin-actions"><a class="btn-secondary" href="discover.html">Back to the catalogue</a></div>';
    if (kind === 'loading') {
      return PV.card.loading({ title: 'Checking your access…', text: 'Confirming your account with the authentication service.' });
    }
    if (kind === 'offline') {
      return '<div class="admin-panel panel">' +
        '<h2>Admin needs the live database</h2>' +
        '<p class="panel-text">This build is running on the bundled demonstration catalogue, so there are no ' +
        'applications to review and nothing to count. The panel appears as soon as the site is connected to a ' +
        'Supabase project.</p>' + back + '</div>';
    }
    if (kind === 'signed-out') {
      return '<div class="admin-panel panel">' +
        '<h2>Sign in to continue</h2>' +
        '<p class="panel-text">The admin panel is for PickVanta administrators. Sign in with the account that ' +
        'holds the administrator role — the database decides who that is, and this page cannot see anything ' +
        'until it has confirmed it.</p>' +
        '<div class="admin-actions"><a class="btn-primary" href="account.html">Go to sign in</a>' +
        '<a class="btn-secondary" href="discover.html">Back to the catalogue</a></div></div>';
    }
    if (kind === 'denied') {
      return '<div class="admin-panel panel">' +
        '<h2>This area is for administrators</h2>' +
        '<p class="panel-text">You are signed in' + (extra ? ' as ' + esc(extra) : '') + ', but this account is ' +
        'not a PickVanta administrator, so there is nothing here to show you. No application data was requested ' +
        'or displayed.</p>' +
        '<p class="panel-note">Administrator access is a role the database holds on your profile. It is not ' +
        'something this page, a link or a URL can grant.</p>' + back + '</div>';
    }
    if (kind === 'error') {
      return '<div class="admin-panel panel">' +
        '<h2>The panel could not be opened</h2>' +
        '<p class="panel-text">' + esc(extra || 'Something went wrong reading your account.') + '</p>' +
        '<div class="admin-actions"><button type="button" class="btn-primary" data-retry-access="1">Try again</button>' +
        '<a class="btn-secondary" href="discover.html">Back to the catalogue</a></div></div>';
    }
    return '';
  }

  /* --------------------------------------------------------- dashboard --- */
  function statCard(label, value, definition, tone) {
    return (
      '<li class="admin-stat' + (tone ? ' tone-' + esc(tone) : '') + '">' +
      '<span class="admin-stat-label">' + esc(label) + '</span>' +
      '<strong class="admin-stat-value">' + esc(countText(value)) + '</strong>' +
      '<span class="admin-stat-note">' + esc(definition) + '</span>' +
      '</li>'
    );
  }

  function dashboardView() {
    if (state.countsError) {
      return '<div class="admin-panel panel">' +
        '<h3>Dashboard counts could not be read</h3>' +
        '<p class="panel-text">' + esc(state.countsError) + '</p>' +
        '<div class="admin-actions"><button type="button" class="btn-primary" data-retry-counts="1">Try again</button></div>' +
        '</div>';
    }
    if (!state.counts) {
      return PV.card.loading({ title: 'Reading the database…', text: 'Counting applications, listings and offers.' });
    }

    const a = state.counts.applications;
    const c = state.counts.catalogue;
    const pending = a.pending;
    const waiting = typeof pending === 'number'
      ? (pending === 1 ? '1 application is waiting for review.' : pending + ' applications are waiting for review.')
      : 'The number of applications waiting for review could not be read.';

    return (
      '<p class="admin-provenance">Live database information — row counts read from the database at ' +
      esc(formatClock(new Date())) + '. Nothing here is estimated, sampled or carried over from a previous visit.</p>' +

      '<div class="admin-callout' + (pending === 0 ? ' tone-calm' : '') + '">' +
      '<div><h3>' + esc(waiting) + '</h3>' +
      '<p class="admin-callout-text">Reviews are performed in the queue, where each application is shown with its ' +
      'contact details, its location and the note the reviewer leaves behind.</p></div>' +
      '<button type="button" class="btn-primary" data-admin-nav="sellers" data-go-pending="1">Open the review queue</button>' +
      '</div>' +

      '<h3 class="admin-subhead">Applications</h3>' +
      '<ul class="admin-stat-grid">' +
      statCard('Pending', a.pending, 'Applied for, not yet reviewed.', 'waiting') +
      statCard('Active', a.active, 'Approved. Nothing is published by approving.') +
      statCard('Suspended', a.suspended, 'Paused after review.') +
      statCard('Rejected', a.rejected, 'Reviewed and not approved.') +
      statCard('Archived', a.archived, 'Closed and kept for records.') +
      statCard('Total', a.total, 'Every application, whatever its status.') +
      '</ul>' +

      '<h3 class="admin-subhead">Catalogue</h3>' +
      '<ul class="admin-stat-grid">' +
      statCard('Published listings', c.published_listings, 'Listings a visitor can browse.') +
      statCard('Active offers', c.active_deals, 'Offers on a published listing, scheduled or running.') +
      statCard('Catalogue sellers', c.demo_sellers, 'The public display records the catalogue uses.') +
      '</ul>' +

      '<div class="admin-note">' +
      '<p><strong>Catalogue sellers are not PickVanta accounts.</strong> The catalogue’s public records are the ' +
      'display records a listing points at; a seller or provider application is a person’s request to run a ' +
      'business here. They are separate tables, they are counted separately, and nothing on this page merges them.</p>' +
      '<p><strong>Traffic, conversions, commissions and revenue are a later stage.</strong> No figure on this page ' +
      'is estimated, extrapolated or modelled: these are row counts, and where a number could not be read it says so.</p>' +
      '</div>'
    );
  }

  /* ------------------------------------------------- Deal Engine: sources --
     The first operational piece of the Deal Engine: where imported deals will
     come from. It reads real rows and writes through the database's own
     function (public.deal_source_save, 0006) — never a table write, never a
     status column patched from here. Nothing on this page contacts an
     endpoint, and no job is started by anything an operator does here.
     ------------------------------------------------------------------------ */

  /** The host part of a recorded endpoint, or the value itself if unreadable. */
  function endpointLabel(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    try {
      return new URL(value).host || value;
    } catch (err) {
      return value;
    }
  }

  function endpointCell(url) {
    const value = String(url || '').trim();
    if (!value) return '<span class="admin-muted">Not recorded</span>';
    /* Only a URL the validator accepts becomes a link. Anything else — a
       value the database constraint should have refused — stays text. */
    if (!D.isSafeHttpUrl(value)) {
      return '<span class="admin-muted">' + esc(value) + '</span>';
    }
    return '<a class="admin-source-link" href="' + esc(value) + '" target="_blank" ' +
      'rel="noopener noreferrer">' + esc(endpointLabel(value)) + '</a>';
  }

  /* Configuration is non-secret by construction: 0005 refuses a
     credential-shaped key and 0006's validator refuses credential-shaped
     values. It is shown as text, escaped, and never as markup. */
  function configCell(config) {
    const keys = config && typeof config === 'object' ? Object.keys(config) : [];
    if (!keys.length) return '<span class="admin-muted">None recorded</span>';
    return '<code class="admin-source-config">' + esc(JSON.stringify(config)) + '</code>';
  }

  function configSummary(config) {
    const keys = config && typeof config === 'object' ? Object.keys(config) : [];
    if (!keys.length) return 'No configuration';
    return keys.length + (keys.length === 1 ? ' key' : ' keys');
  }

  function pipelineStrip() {
    return '<h3 class="admin-subhead">The pipeline this feeds</h3>' +
      '<ol class="admin-pipeline">' +
      D.DEAL_PIPELINE_STAGES.map(function (stage) {
        return '<li class="admin-pipeline-step">' +
          '<span class="admin-pipeline-label">' + esc(stage.label) + '</span>' +
          '<span class="admin-pipeline-note">' + esc(stage.blurb) + '</span>' +
          '</li>';
      }).join('') +
      '</ol>' +
      '<p class="admin-note-line">Ends as ' +
      D.DEAL_PIPELINE_TERMINAL.map(function (stage) { return esc(stage.label.toLowerCase()); }).join(', ') +
      '. No stage of this runs yet: there is no connector, no worker and no schedule, and nothing ' +
      'publishes itself — an imported record waits for a person.</p>';
  }

  /* --------------------------------------------------------- source form -- */
  /* The one place in the panel that writes. It sends what the operator typed
     to the database and shows what the database sent back; a refusal is a
     refusal, and the form says so rather than pretending. */

  function sourceField(name, label, help, control, helpId) {
    const error = state.form.errors[name] || '';
    return '<div class="field">' +
      '<label for="source' + name.charAt(0).toUpperCase() + name.slice(1) + '">' + esc(label) + '</label>' +
      control +
      /* The two list fields update this sentence in place when the choice
         changes, so the explanation follows the selection without a re-render
         that would move the operator's focus. */
      '<p class="field-help"' + (helpId ? ' id="' + helpId + '"' : '') + '>' + esc(help) + '</p>' +
      (error ? '<p class="form-error" role="alert">' + esc(error) + '</p>' : '') +
      '</div>';
  }

  function inputAttrs(name, extra) {
    const error = state.form.errors[name] || '';
    return ' id="source' + name.charAt(0).toUpperCase() + name.slice(1) + '"' +
      ' name="' + name + '" data-source-field="' + name + '"' +
      (error ? ' aria-invalid="true"' : '') + (extra || '');
  }

  function optionList(values, current, copyFor) {
    return values.map(function (value) {
      const copy = copyFor ? copyFor(value) : { label: value };
      return '<option value="' + esc(value) + '"' + (value === current ? ' selected' : '') + '>' +
        esc(copy.label) + '</option>';
    }).join('');
  }

  function sourceFormMarkup() {
    const f = state.form;
    const v = f.values;
    const type = D.dealSourceTypeCopy(v.sourceType);
    const status = D.dealSourceStatusCopy(v.status);

    return '<div class="admin-panel panel">' +
      '<h3>' + (f.mode === 'edit' ? 'Edit source' : 'New source') + '</h3>' +
      '<p class="panel-text">A source is an agreement and an address, not a fetcher: saving one here ' +
      'connects PickVanta to nothing and starts no job. Credentials do not belong in this form — a key ' +
      'or token goes in the server environment, and the database refuses one that is pasted here.</p>' +
      (f.message ? '<p class="form-error" role="alert">' + esc(f.message) + '</p>' : '') +
      '<form class="admin-source-form" novalidate>' +
      sourceField('name', 'Name', 'What this source is called in the panel.',
        '<input type="text" maxlength="120"' + inputAttrs('name',
          ' value="' + esc(v.name) + '" autocomplete="off"') + ' />') +
      sourceField('sourceType', 'Source type', type.blurb,
        '<select' + inputAttrs('sourceType') + '>' +
        optionList(D.DEAL_SOURCE_TYPES, v.sourceType, D.dealSourceTypeCopy) + '</select>', 'sourceTypeHelp') +
      sourceField('providerName', 'Provider or network', 'The marketplace, network or merchant this comes from. Blank is allowed.',
        '<input type="text" maxlength="120"' + inputAttrs('providerName',
          ' value="' + esc(v.providerName) + '" autocomplete="off"') + ' />') +
      sourceField('marketCountry', 'Market country', 'Two letters, such as GB or KE. Blank means not recorded.',
        '<input type="text" maxlength="2"' + inputAttrs('marketCountry',
          ' value="' + esc(v.marketCountry) + '" autocomplete="off" spellcheck="false"') + ' />') +
      sourceField('endpointUrl', 'Endpoint', 'Where the source is read from. Nothing on this page opens it.',
        '<input type="text" maxlength="400"' + inputAttrs('endpointUrl',
          ' value="' + esc(v.endpointUrl) + '" autocomplete="off" spellcheck="false"') + ' />') +
      sourceField('status', 'State', status.blurb,
        '<select' + inputAttrs('status') + '>' +
        optionList(D.DEAL_SOURCE_STATUS, v.status, D.dealSourceStatusCopy) + '</select>', 'statusHelp') +
      sourceField('configText', 'Configuration', 'A JSON object of non-secret settings, such as {"market": "GB", "page_limit": 50}. Leave it empty if there is none.',
        '<textarea rows="4" spellcheck="false"' + inputAttrs('configText') + '>' + esc(v.configText) + '</textarea>') +
      '<div class="admin-actions">' +
      '<button type="submit" class="btn-primary"' + (f.busy ? ' disabled' : '') + '>' +
      (f.mode === 'edit' ? 'Save changes' : 'Add source') + '</button>' +
      '<button type="button" class="btn-secondary" data-cancel-source-form="1"' + (f.busy ? ' disabled' : '') + '>' +
      'Cancel</button>' +
      '</div>' +
      '</form></div>';
  }

  function sourcesView() {
    if (state.form) return sourceFormMarkup();

    if (state.sourcesError) {
      return '<div class="admin-panel panel">' +
        '<h3>Sources could not be read</h3>' +
        '<p class="panel-text">' + esc(state.sourcesError) + '</p>' +
        '<div class="admin-actions"><button type="button" class="btn-primary" data-retry-sources="1">Try again</button></div>' +
        '</div>';
    }
    if (!state.sourcesLoaded) {
      return PV.card.loading({ title: 'Reading sources…', text: 'Fetching the Deal Engine sources from the database.' });
    }

    const head =
      '<div class="admin-panel panel">' +
      '<h3>Where imported deals will come from</h3>' +
      '<p class="panel-text">A source is an agreement and a place to read from — a marketplace feed, ' +
      'an affiliate network feed, a merchant API, a merchant product feed, or a source PickVanta is ' +
      'permitted to read. This page lists them; it does not contact them.</p>' +
      '<p class="panel-note">Nothing is imported yet. There is no connector, no scraper and no schedule ' +
      'in this build, and an imported record could never be published automatically: it would wait in a ' +
      'review queue for an administrator.</p>' +
      '<p class="panel-note">A source row never carries a credential: an agreement’s key or token belongs ' +
      'in the server environment. The configuration column holds non-secret settings only — a market, a ' +
      'page limit — and the database refuses a credential-shaped key or value in it, so there is nothing ' +
      'secret here to read or to leak.</p>' +
      '<div class="admin-actions"><button type="button" class="btn-primary" data-new-source="1">New source</button></div>' +
      '</div>';

    if (!state.sources.length) {
      return head +
        '<div class="admin-panel panel">' +
        '<h3>No sources are configured</h3>' +
        '<p class="panel-text">None is recorded in the database, so there is nothing to list. Add one ' +
        'with the button above when an agreement exists — adding it connects nothing and starts nothing.</p>' +
        '</div>' + pipelineStrip();
    }

    return head +
      '<table class="admin-table">' +
      '<caption class="visually-hidden">Deal Engine sources, by name</caption>' +
      '<thead><tr>' +
      '<th scope="col">Source</th><th scope="col">Type</th><th scope="col">Provider</th>' +
      '<th scope="col">Market</th><th scope="col">Endpoint</th><th scope="col">State</th>' +
      '<th scope="col">Configuration</th><th scope="col">Added</th>' +
      '<th scope="col"><span class="visually-hidden">Actions</span></th>' +
      '</tr></thead><tbody>' +
      state.sources.map(function (source) {
        const type = D.dealSourceTypeCopy(source.sourceType);
        const status = D.dealSourceStatusCopy(source.status);
        return '<tr>' +
          '<td data-label="Source"><strong>' + esc(source.name) + '</strong></td>' +
          '<td data-label="Type">' + esc(type.label) + '</td>' +
          '<td data-label="Provider">' + (source.providerName ? esc(source.providerName)
            : '<span class="admin-muted">Not recorded</span>') + '</td>' +
          '<td data-label="Market">' + (source.marketCountry ? esc(source.marketCountry)
            : '<span class="admin-muted">Not recorded</span>') + '</td>' +
          '<td data-label="Endpoint">' + endpointCell(source.endpointUrl) + '</td>' +
          '<td data-label="State"><span class="status-pill status-' + esc(status.tone) + '">' +
            esc(status.label) + '</span></td>' +
          '<td data-label="Configuration">' + configCell(source.config) + '</td>' +
          '<td data-label="Added">' + esc(formatDateTime(source.createdAt)) + '</td>' +
          '<td data-label="Actions"><button type="button" class="admin-row-action" data-edit-source="' +
            esc(source.id) + '">Edit</button></td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>' +
      '<p class="admin-table-foot">' + state.sources.length + ' source' +
      (state.sources.length === 1 ? '' : 's') + ' recorded. Imported deals are a later stage — the ' +
      'records and their history are already modelled in the database, and no interface reads them yet.</p>' +
      pipelineStrip();
  }

  /* ---------------------------------------------------- Deal Engine: jobs --
     One run of one task. Nothing in this build creates a row here: there is no
     worker and no schedule, so an empty list is the truth and this page says
     so. Progress, statistics and errors are the database's own values, shown
     as they were recorded — nothing animates, polls or advances them.
     ------------------------------------------------------------------------ */

  function jobSourceName(job) {
    if (!job.sourceId) return '';
    const found = state.sources.filter(function (source) { return source.id === job.sourceId; })[0];
    return found ? found.name : '';
  }

  function jobProgressText(job) {
    if (typeof job.progress !== 'number') return 'Not recorded';
    return job.progress + '%';
  }

  function jobStatsText(stats) {
    const keys = stats && typeof stats === 'object' ? Object.keys(stats) : [];
    if (!keys.length) return '';
    return '<code class="admin-job-stats">' + esc(JSON.stringify(stats)) + '</code>';
  }

  function importedTotalText() {
    if (typeof state.importedTotal === 'number') return String(state.importedTotal);
    return 'Not available';
  }

  function jobsView() {
    if (state.jobsError) {
      return '<div class="admin-panel panel">' +
        '<h3>Jobs could not be read</h3>' +
        '<p class="panel-text">' + esc(state.jobsError) + '</p>' +
        '<div class="admin-actions"><button type="button" class="btn-primary" data-retry-jobs="1">Try again</button></div>' +
        '</div>';
    }
    if (!state.jobsLoaded) {
      return PV.card.loading({ title: 'Reading jobs…', text: 'Fetching the Deal Engine job records from the database.' });
    }

    const head =
      '<div class="admin-panel panel">' +
      '<h3>Runs the engine has recorded</h3>' +
      '<p class="panel-text">A job is one run of one task — reading a feed, checking a price, looking ' +
      'at a link. <strong>Nothing in this build runs one.</strong> There is no worker, no scheduler and ' +
      'no connector, so a job row can only appear when a later step creates it, and this page will ' +
      'report exactly what that run recorded.</p>' +
      '<p class="panel-note">Progress, statistics and errors below are the database’s own values. ' +
      'Nothing here advances a percentage, retries a job or reports a success that was not recorded.</p>' +
      '</div>';

    if (!state.jobs.length) {
      return head +
        '<div class="admin-panel panel">' +
        '<h3>No jobs have been recorded</h3>' +
        '<p class="panel-text">Nothing has ever run, which is what this build does. When a connector ' +
        'and a worker exist, their runs will be listed here: what ran, against which source, how far it ' +
        'got, and what it reported if it failed.</p>' +
        '</div>' + jobSummary();
    }

    return head +
      '<table class="admin-table">' +
      '<caption class="visually-hidden">Deal Engine jobs, newest first</caption>' +
      '<thead><tr>' +
      '<th scope="col">Job</th><th scope="col">Source</th><th scope="col">Type</th>' +
      '<th scope="col">Status</th><th scope="col">Progress</th><th scope="col">Reported</th>' +
      '<th scope="col">Started</th><th scope="col">Finished</th>' +
      '</tr></thead><tbody>' +
      state.jobs.map(function (job) {
        const status = D.dealJobStatusCopy(job.status);
        const type = D.dealJobTypeCopy(job.jobType);
        const name = jobSourceName(job);
        const reported = (job.detail ? '<span class="admin-job-detail">' + esc(job.detail) + '</span>' : '') +
          (job.error ? '<span class="admin-job-error">' + esc(job.error) + '</span>' : '') +
          jobStatsText(job.stats);
        return '<tr>' +
          '<td data-label="Job"><code class="admin-job-id">' + esc(String(job.id).slice(0, 8)) + '</code></td>' +
          '<td data-label="Source">' + (name ? esc(name)
            : (job.sourceId ? '<span class="admin-muted">A source no longer listed</span>'
              : '<span class="admin-muted">No source</span>')) + '</td>' +
          '<td data-label="Type">' + esc(type.label) + '</td>' +
          '<td data-label="Status"><span class="status-pill status-' + esc(status.tone) + '">' +
            esc(status.label) + '</span></td>' +
          '<td data-label="Progress">' + esc(jobProgressText(job)) + '</td>' +
          '<td data-label="Reported">' + (reported || '<span class="admin-muted">Nothing recorded</span>') + '</td>' +
          '<td data-label="Started">' + (job.startedAt ? esc(formatDateTime(job.startedAt))
            : '<span class="admin-muted">Not started</span>') + '</td>' +
          '<td data-label="Finished">' + (job.finishedAt ? esc(formatDateTime(job.finishedAt))
            : '<span class="admin-muted">Not finished</span>') + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>' + jobSummary();
  }

  function jobSummary() {
    return '<p class="admin-table-foot">' + state.jobs.length + ' job' +
      (state.jobs.length === 1 ? '' : 's') + ' recorded. Imported records recorded so far: ' +
      esc(importedTotalText()) + '. The review queue for those records is a later step, so none of them ' +
      'is shown yet.</p>';
  }

  /* ------------------------------------------ catalogue: the canonical layer
     Product, Variant and Merchant Offer — what a reviewed imported record
     becomes. This is deliberately NOT a product editor. It exists to prove the
     model is real and readable by an administrator: how many canonical records
     there are, what the most recent ones are, what state they are in, and which
     merchant and source an offer came from. There is no create, no edit, no
     approve, no publish, no import and no connector on this page — and no
     button that suggests one. A canonical record is made by a reviewed
     conversion, which an administrator performs in the Review Queue; this page
     only reads what that decision produced.
     ------------------------------------------------------------------------ */

  const merchantById = (id) => state.catalogueMerchants.filter((m) => m.id === id)[0] || null;
  const sourceById = (id) => state.catalogueSources.filter((s) => s.id === id)[0] || null;

  function merchantCell(id) {
    const merchant = id ? merchantById(id) : null;
    if (merchant) return esc(merchant.name);
    return '<span class="admin-muted">' + (id ? 'A merchant not in this list' : 'No merchant recorded') + '</span>';
  }

  function sourceCell(id) {
    const source = id ? sourceById(id) : null;
    if (source) return esc(source.name);
    return '<span class="admin-muted">' + (id ? 'A source not in this list' : 'No source recorded') + '</span>';
  }

  /**
   * An offer's price, and the compare-at price only when it can be supported.
   *
   * Two recorded prices are not on their own a comparison: without a recorded
   * currency, and with a compare-at below what is being asked, there is nothing
   * to compare and the cell says which of the two is the case. The amount is
   * never converted, never rounded into a claim and never given a currency the
   * source did not state.
   */
  function offerPriceCell(offer) {
    const price = D.merchantOfferPriceText(offer);
    if (!price) return '<span class="admin-muted">No price recorded</span>';
    const amount = esc(price) + (offer.currency ? '' : ' <span class="admin-muted">(currency not recorded)</span>');
    if (!D.merchantOfferComparisonSupported(offer)) {
      return '<span class="admin-offer-price">' + amount + '</span>';
    }
    const original = D.merchantOfferPriceText({ priceAmount: offer.originalPrice, currency: offer.currency });
    return '<span class="admin-offer-price">' + amount + '</span>' +
      '<span class="admin-offer-was">Compare-at ' + esc(original) + '</span>';
  }

  function offerObservedCell(offer) {
    if (offer.lastObservedAt) return esc(formatDateTime(offer.lastObservedAt));
    if (offer.importedAt) {
      return '<span class="admin-muted">Not observed since import (' +
        esc(formatDateTime(offer.importedAt)) + ')</span>';
    }
    return '<span class="admin-muted">Not observed</span>';
  }

  function productRows() {
    return state.catalogueProducts.map(function (product) {
      const status = product.statusCopy;
      return '<tr>' +
        '<td data-label="Product"><strong>' + esc(product.name) + '</strong></td>' +
        '<td data-label="Brand">' + (product.brand || '<span class="admin-muted">Not recorded</span>') + '</td>' +
        '<td data-label="Model">' + (product.modelNumber
          ? '<code class="admin-job-id">' + esc(product.modelNumber) + '</code>'
          : '<span class="admin-muted">Not recorded</span>') + '</td>' +
        '<td data-label="Identity key">' + (product.identityKey
          ? '<code class="admin-job-id">' + esc(product.identityKey) + '</code>'
          : '<span class="admin-muted">No identity signals</span>') + '</td>' +
        '<td data-label="Status"><span class="status-pill status-' + esc(status.tone) + '">' +
          esc(status.label) + '</span></td>' +
        '<td data-label="Recorded">' + (product.createdAt ? esc(formatDateTime(product.createdAt))
          : '<span class="admin-muted">Not recorded</span>') + '</td>' +
        '</tr>';
    }).join('');
  }

  function offerRows() {
    return state.catalogueOffers.map(function (offer) {
      const status = offer.statusCopy;
      return '<tr>' +
        '<td data-label="Merchant">' + merchantCell(offer.merchantId) + '</td>' +
        '<td data-label="Source">' + sourceCell(offer.sourceId) + '</td>' +
        '<td data-label="Merchant’s own title">' + (offer.merchantTitle
          ? esc(offer.merchantTitle)
          : '<span class="admin-muted">Nothing recorded</span>') + '</td>' +
        '<td data-label="Price">' + offerPriceCell(offer) + '</td>' +
        '<td data-label="Status"><span class="status-pill status-' + esc(status.tone) + '">' +
          esc(status.label) + '</span></td>' +
        '<td data-label="Observed">' + offerObservedCell(offer) + '</td>' +
        '</tr>';
    }).join('');
  }

  function listFoot(shown, total, noun) {
    const database = typeof total === 'number'
      ? 'The database counts ' + total + ' ' + (total === 1 ? noun : noun + 's') + ' in total.'
      : 'The database did not return a total, so none is shown.';
    return '<p class="admin-table-foot">Showing the ' + shown + ' most recent' +
      (shown === 1 ? '' : '') + '. ' + database + '</p>';
  }

  function productsView() {
    if (state.catalogueError) {
      return '<div class="admin-panel panel">' +
        '<h3>The canonical records could not be read</h3>' +
        '<p class="panel-text">' + esc(state.catalogueError) + '</p>' +
        '<div class="admin-actions"><button type="button" class="btn-primary" data-retry-catalogue="1">Try again</button></div>' +
        '</div>';
    }
    if (!state.catalogueLoaded) {
      return PV.card.loading({ title: 'Reading the canonical layer…',
        text: 'Counting products, variants and merchant offers, and fetching the most recent.' });
    }

    const c = state.catalogueCounts || {};
    const head =
      '<div class="admin-panel panel">' +
      '<h3>The canonical catalogue, read-only</h3>' +
      '<p class="panel-text">Three separate records, and keeping them separate is the point: a ' +
      '<strong>product</strong> is what the thing is, independent of who sells it — no seller, no price ' +
      'and no location; a <strong>variant</strong> is one purchasable configuration of a product, and only ' +
      'exists for products sold in more than one; a <strong>merchant offer</strong> is one merchant’s offer ' +
      'through one source, with the merchant’s own title, price, links and observed time. An offer is never ' +
      'the canonical product, and a merchant’s title never replaces a canonical name.</p>' +
      '<p class="panel-note">Nothing on this page can be changed. There is no editor, no approval and no ' +
      'publish control here: a canonical record is produced by a reviewed conversion, which an administrator ' +
      'performs deliberately in the Review Queue — never automatically, and never from this list. No connector ' +
      'reads a source, and the public catalogue does not read these tables.</p>' +
      '</div>' +

      '<h3 class="admin-subhead">Records</h3>' +
      '<ul class="admin-stat-grid">' +
      statCard('Products', c.products, 'Canonical identities. Not listings, and not anyone’s account.') +
      statCard('Variants', c.variants, 'Configurations of a product. Optional: a single-configuration product has none.') +
      statCard('Merchant offers', c.offers, 'Offers by an external merchant through a source. Read-only here.') +
      '</ul>' +

      '<h3 class="admin-subhead">Recent products</h3>';

    const products = state.catalogueProducts.length
      ? '<table class="admin-table">' +
        '<caption class="visually-hidden">The most recently recorded canonical products</caption>' +
        '<thead><tr><th scope="col">Product</th><th scope="col">Brand</th><th scope="col">Model</th>' +
        '<th scope="col">Identity key</th><th scope="col">Status</th><th scope="col">Recorded</th>' +
        '</tr></thead><tbody>' + productRows() + '</tbody></table>' +
        listFoot(state.catalogueProducts.length, c.products, 'product')
      : '<div class="admin-panel panel">' +
        '<h3>No products have been recorded</h3>' +
        '<p class="panel-text">The canonical layer exists and is empty. That is the honest state while no ' +
        'record has been reviewed: a product is created only by an administrator converting an imported record ' +
        'in the Review Queue — never automatically. Once one is converted it is listed here, with the merchant ' +
        'title it came from kept beside the canonical name, not instead of it.</p>' +
        '</div>';

    const offersHead = '<h3 class="admin-subhead">Recent merchant offers</h3>' +
      '<p class="admin-subhead-note">Each offer shows the merchant it is from, the source it was supplied ' +
      'through, and the merchant’s own title. Prices are shown exactly as recorded: no conversion, and no ' +
      'currency supplied by this page.</p>';

    const offers = state.catalogueOffers.length
      ? '<table class="admin-table">' +
        '<caption class="visually-hidden">The most recently recorded merchant offers</caption>' +
        '<thead><tr><th scope="col">Merchant</th><th scope="col">Source</th>' +
        '<th scope="col">Merchant’s own title</th><th scope="col">Price</th><th scope="col">Status</th>' +
        '<th scope="col">Observed</th></tr></thead><tbody>' + offerRows() + '</tbody></table>' +
        listFoot(state.catalogueOffers.length, c.offers, 'offer')
      : '<div class="admin-panel panel">' +
        '<h3>No merchant offers have been recorded</h3>' +
        '<p class="panel-text">An offer is written by the reviewed conversion of an imported record, and by ' +
        'nothing else: there is no connector feeding this layer and no automatic conversion. An empty list is ' +
        'the honest state of it rather than a failure.</p>' +
        '</div>';

    return head + products + offersHead + offers +
      '<div class="admin-note">' +
      '<p><strong>An unavailable offer is not an unavailable product.</strong> An offer’s state says what ' +
      'that merchant was offering when it was last observed; the product it points at keeps its own state, ' +
      'because a shelf being empty is not the same as the catalogue being empty.</p>' +
      '<p><strong>Merchants and sources here are provenance.</strong> An external merchant is not a ' +
      'PickVanta seller or provider and never becomes one; the source is where the record came from. Neither ' +
      'can be assigned, claimed or edited from this panel, by an administrator or by anyone else.</p>' +
      '</div>';
  }

  /* ------------------------------------------------------------- queue --- */
  function filterTabs() {
    const counts = state.counts && state.counts.applications ? state.counts.applications : null;
    return (
      '<div class="admin-tabs" role="group" aria-label="Filter applications by status">' +
      FILTERS.map(function (filter) {
        const current = state.filter === filter.id;
        const value = counts && filter.id !== 'all' ? counts[filter.id] : null;
        const badge = (typeof value === 'number' && isFinite(value)) ? ' <span class="admin-tab-count">' + value + '</span>' : '';
        return '<button type="button" class="admin-tab' + (current ? ' is-current' : '') + '"' +
          ' data-admin-filter="' + esc(filter.id) + '"' +
          (current ? ' aria-current="true"' : '') + '>' +
          esc(filter.label) + badge + '</button>';
      }).join('') +
      '</div>'
    );
  }

  function queueView() {
    if (state.queueError) {
      return filterTabs() +
        '<div class="admin-panel panel">' +
        '<h3>Applications could not be read</h3>' +
        '<p class="panel-text">' + esc(state.queueError) + '</p>' +
        '<div class="admin-actions"><button type="button" class="btn-primary" data-retry-queue="1">Try again</button></div>' +
        '</div>';
    }
    if (!state.queueLoaded) {
      return PV.card.loading({ title: 'Reading applications…', text: 'Fetching the queue from the database.' });
    }
    if (!state.queue.length) {
      const label = (FILTERS.filter((f) => f.id === state.filter)[0] || {}).label || 'this view';
      const pending = state.filter === 'pending';
      return filterTabs() +
        '<div class="admin-panel panel">' +
        '<h3>' + (pending ? 'Nothing is waiting for review' : 'No applications in ' + esc(label.toLowerCase())) + '</h3>' +
        '<p class="panel-text">' + (pending
          ? 'Every application has been reviewed. New ones appear here as soon as somebody applies.'
          : 'There is nothing with that status today. Try another filter, or open Pending to see what is waiting.') +
        '</p></div>';
    }

    return filterTabs() +
      '<table class="admin-table">' +
      '<caption class="visually-hidden">Seller and provider applications, newest first</caption>' +
      '<thead><tr>' +
      '<th scope="col">Business</th><th scope="col">Type</th><th scope="col">Status</th>' +
      '<th scope="col">Location</th><th scope="col">Submitted</th><th scope="col"><span class="visually-hidden">Actions</span></th>' +
      '</tr></thead><tbody>' +
      state.queue.map(function (account) {
        const where = [account.location.city, account.location.county].filter(Boolean).join(', ');
        return '<tr>' +
          '<td data-label="Business"><strong>' + esc(account.businessName) + '</strong></td>' +
          '<td data-label="Type">' + esc(account.accountTypeLabel) + '</td>' +
          '<td data-label="Status">' + statusPill(account) + '</td>' +
          '<td data-label="Location">' + (where ? esc(where) : '<span class="admin-muted">Not given</span>') + '</td>' +
          '<td data-label="Submitted">' + esc(formatDateTime(account.createdAt)) + '</td>' +
          '<td data-label="Action"><button type="button" class="btn-secondary btn-small" data-admin-open="' +
            esc(account.id) + '">Review</button></td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>' +
      '<p class="admin-table-foot">' +
      (state.queueMore
        ? 'Showing the ' + QUEUE_PAGE + ' newest applications. There are more — paging arrives in a later stage.'
        : 'Showing all ' + state.queue.length + ' application' + (state.queue.length === 1 ? '' : 's') + ' in this view.') +
      '</p>';
  }

  /* ------------------------------------------------------------ detail --- */
  function row(label, value) {
    return '<div class="admin-field"><dt>' + esc(label) + '</dt><dd>' +
      (value || '<span class="admin-muted">Not given</span>') + '</dd></div>';
  }

  function detailView() {
    if (state.detailError) {
      return '<div class="admin-actions"><button type="button" class="link-btn" data-back-to-queue="1">← Back to the queue</button></div>' +
        '<div class="admin-panel panel"><h3>That application could not be read</h3>' +
        '<p class="panel-text">' + esc(state.detailError) + '</p>' +
        '<div class="admin-actions"><button type="button" class="btn-primary" data-retry-detail="1">Try again</button></div></div>';
    }
    if (!state.detailLoaded) {
      return PV.card.loading({ title: 'Reading the application…', text: 'Fetching the record from the database.' });
    }
    if (!state.detail) {
      return '<div class="admin-actions"><button type="button" class="link-btn" data-back-to-queue="1">← Back to the queue</button></div>' +
        '<div class="admin-panel panel"><h3>No application with that reference</h3>' +
        '<p class="panel-text">The database has no application with that id. It may have been removed, or the ' +
        'link may be from somewhere else. Nothing was changed.</p></div>';
    }

    const account = state.detail;
    const copy = D.adminAccountTypeCopy(account.accountType);
    const typeLine = copy.label + ' — ' + copy.blurb;
    const where = [account.location.area, account.location.city, account.location.county, account.location.country]
      .filter(Boolean).join(', ');
    const actions = D.adminReviewActionsFor(account.status);
    const confirming = state.action;

    return (
      '<div class="admin-actions admin-detail-top">' +
      '<button type="button" class="link-btn" data-back-to-queue="1">← Back to the queue</button>' +
      '</div>' +

      '<article class="admin-detail panel">' +
      '<header class="admin-detail-head">' +
      '<div>' +
      '<span class="admin-detail-type">' + esc(typeLine) + '</span>' +
      '<h3>' + esc(account.businessName) + '</h3>' +
      '</div>' +
      statusPill(account) +
      '</header>' +

      '<dl class="admin-fields">' +
      row('Business or practice name', esc(account.businessName)) +
      row('Account type', esc(account.accountTypeLabel)) +
      row('Description', account.description ? esc(account.description) : '') +
      '</dl>' +

      '<h4 class="admin-subhead">Contact details</h4>' +
      '<p class="admin-subhead-note">Visible to administrators only. Nothing here is shown on the public site.</p>' +
      '<dl class="admin-fields">' +
      row('Contact email', account.contactEmail
        ? '<a href="mailto:' + esc(account.contactEmail) + '">' + esc(account.contactEmail) + '</a>' : '') +
      row('Contact phone', account.contactPhone ? esc(account.contactPhone) : '') +
      row('Website', account.website
        ? '<a href="' + esc(account.website) + '" rel="noopener noreferrer nofollow" target="_blank">' +
          esc(account.website) + '</a>' : '') +
      '</dl>' +

      '<h4 class="admin-subhead">Location</h4>' +
      '<dl class="admin-fields">' +
      row('Country', esc(account.location.country)) +
      row('County', esc(account.location.county)) +
      row('City or town', esc(account.location.city)) +
      row('Area', esc(account.location.area)) +
      row('As entered', where ? esc(where) : '') +
      '</dl>' +

      '<h4 class="admin-subhead">Review</h4>' +
      '<dl class="admin-fields">' +
      row('Submitted', esc(formatDateTime(account.createdAt))) +
      row('Current status', statusPill(account)) +
      row('Last reviewed', account.reviewedAt ? esc(formatDateTime(account.reviewedAt)) : 'Not reviewed yet') +
      row('Review note', account.reviewNote ? esc(account.reviewNote) : '') +
      row('Reviewer (account id)', account.reviewedBy
        ? '<code class="admin-code">' + esc(account.reviewedBy) + '</code>' : '') +
      row('Catalogue record', account.sellerId
        ? '<code class="admin-code">' + esc(account.sellerId) + '</code>'
        : 'Not linked to a catalogue record') +
      '</dl>' +

      (actions.length && !confirming
        ? '<h4 class="admin-subhead">Actions</h4>' +
          '<p class="admin-subhead-note">Each action is performed by the database’s own review function, which ' +
          'checks that you are an administrator and records who changed what, and when.</p>' +
          '<div class="admin-actions">' +
          actions.map(function (action) {
            return '<button type="button" class="btn-' + (action.tone === 'warning' ? 'secondary' : 'primary') + '"' +
              ' data-review-action="' + esc(action.status) + '">' + esc(action.label) + '</button>';
          }).join('') +
          '</div>'
        : '') +

      (confirming ? confirmPanel(account, confirming) : '') +
      '</article>'
    );
  }

  function confirmPanel(account, action) {
    return (
      '<div class="admin-confirm" role="group" aria-labelledby="admin-confirm-title">' +
      '<h4 id="admin-confirm-title">' + esc(action.heading) + '</h4>' +
      '<p class="admin-confirm-text">' + esc(action.blurb) + '</p>' +
      '<p class="admin-confirm-target">Application: <strong>' + esc(account.businessName) + '</strong> · ' +
      'currently ' + esc(D.adminStatusCopy(account.status).label) + ' → would become ' +
      esc(D.adminStatusCopy(action.status).label) + '.</p>' +
      '<div class="field">' +
      '<label for="reviewNote">' + esc(action.noteLabel) + '</label>' +
      '<textarea id="reviewNote" maxlength="' + D.REVIEW_NOTE_MAX + '" rows="3"' +
      ' aria-describedby="reviewNoteHelp"' + (state.noteError ? ' aria-invalid="true"' : '') + '>' +
      esc(state.note) + '</textarea>' +
      '<p class="field-help" id="reviewNoteHelp">Up to ' + D.REVIEW_NOTE_MAX + ' characters. It is stored with ' +
      'the application and shown to the applicant.</p>' +
      (state.noteError ? '<p class="form-error" id="reviewNoteError" role="alert">' + esc(state.noteError) + '</p>' : '') +
      '</div>' +
      '<div class="admin-actions">' +
      '<button type="button" class="btn-primary" data-confirm-action="1"' + (state.busy ? ' disabled' : '') + '>' +
      esc(action.label) + ' account</button>' +
      '<button type="button" class="btn-secondary" data-cancel-action="1"' + (state.busy ? ' disabled' : '') + '>' +
      'Cancel</button>' +
      '</div></div>'
    );
  }

  /* ------------------------------------------------------------- render -- */
  function render() {
    const snap = auth && typeof auth.state === 'function' ? auth.state() : null;

    if (!PV.store.admin.available()) { root.innerHTML = accessView('offline'); return; }
    if (!snap) { root.innerHTML = accessView('loading'); return; }
    if (!snap.available) { root.innerHTML = accessView('offline'); return; }
    if (!snap.checked) { root.innerHTML = accessView('loading'); return; }
    if (!snap.user) { root.innerHTML = accessView('signed-out'); return; }
    if (!isAdmin()) { root.innerHTML = accessView('denied', snap.user.email); return; }

    let main;
    if (state.section === 'sellers') {
      main = state.selectedId ? detailView() : queueView();
    } else if (state.section === 'products') {
      main = productsView();
    } else if (state.section === 'sources') {
      main = sourcesView();
    } else if (state.section === 'jobs') {
      main = jobsView();
    } else if (state.section === 'imports') {
      main = importsView();
    } else if (state.section === 'review') {
      main = state.selectedId ? reviewRecordView() : reviewQueueView();
    } else {
      main = dashboardView();
    }
    root.innerHTML = shell(main);

    /* Focus moves where the operator's attention did: the note field when a
       confirmation opens, the heading of a view they just opened. */
    if (focusAfterRender) {
      const target = U.$(focusAfterRender);
      focusAfterRender = '';
      if (target) target.focus();
    }
  }

  /* -------------------------------------------------------------- load --- */
  function loadCounts() {
    const s = session();
    if (!s) return Promise.resolve();
    state.countsError = '';
    return PV.store.admin.counts(s).then(function (counts) {
      state.counts = counts;
      render();
    }).catch(function (err) {
      state.counts = null;
      state.countsError = messageFor(err);
      render();
    });
  }

  function loadQueue() {
    const s = session();
    if (!s) return Promise.resolve();
    state.queueError = '';
    state.queueLoaded = false;
    return PV.store.admin.accounts(s, {
      status: state.filter === 'all' ? '' : state.filter,
      limit: QUEUE_PAGE + 1
    }).then(function (result) {
      const rows = result.accounts || [];
      state.queueMore = rows.length > QUEUE_PAGE;
      state.queue = state.queueMore ? rows.slice(0, QUEUE_PAGE) : rows;
      state.queueLoaded = true;
      render();
    }).catch(function (err) {
      state.queue = [];
      state.queueLoaded = true;
      state.queueError = messageFor(err);
      render();
    });
  }

  function loadDetail() {
    const s = session();
    if (!s || !state.selectedId) return Promise.resolve();
    state.detailError = '';
    state.detailLoaded = false;
    return PV.store.admin.account(s, state.selectedId).then(function (account) {
      state.detail = account;
      state.detailLoaded = true;
      render();
    }).catch(function (err) {
      state.detail = null;
      state.detailLoaded = true;
      state.detailError = messageFor(err);
      render();
    });
  }

  function loadSources() {
    const s = session();
    if (!s) return Promise.resolve();
    state.sourcesError = '';
    state.sourcesLoaded = false;
    return PV.store.dealEngine.sources(s).then(function (result) {
      state.sources = result.sources || [];
      state.sourcesLoaded = true;
      render();
    }).catch(function (err) {
      state.sources = [];
      state.sourcesLoaded = true;
      state.sourcesError = messageFor(err);
      render();
    });
  }

  function loadJobs() {
    const s = session();
    if (!s) return Promise.resolve();
    state.jobsError = '';
    state.jobsLoaded = false;
    /* Three reads, all of them the database's: the jobs, the sources (so a job
       can name where it ran) and the count of imported records. Nothing polls
       and nothing ticks: a job's state changes when the database says so, and
       this view shows what it said the last time it was asked. */
    return Promise.all([
      PV.store.dealEngine.jobs(s),
      PV.store.dealEngine.sources(s),
      PV.store.dealEngine.importedDeals(s, { limit: 1 })
    ]).then(function (results) {
      state.jobs = (results[0] && results[0].jobs) || [];
      state.sources = (results[1] && results[1].sources) || [];
      state.sourcesLoaded = true;
      state.importedTotal = results[2] ? results[2].total : null;
      state.jobsLoaded = true;
      render();
    }).catch(function (err) {
      state.jobs = [];
      state.jobsLoaded = true;
      state.jobsError = messageFor(err);
      render();
    });
  }

  /**
   * The canonical layer, read.
   *
   * Five reads, all of them the database's, issued together: the three counts,
   * the most recent products, the most recent merchant offers, and — so that an
   * offer can name who supplied it and through which source — the external
   * merchants and the sources those offers point at. Nothing here is a join
   * this layer composes into a new record: each list is shown as it came back,
   * and a name that is not in the list says so rather than being guessed.
   *
   * One failure fails the section. A page that showed three of five reads and
   * silently left the others blank would be reporting a partial catalogue as
   * though it were the whole of one.
   */
  function loadCatalogue() {
    const s = session();
    if (!s) return Promise.resolve();
    state.catalogueError = '';
    state.catalogueLoaded = false;
    return Promise.all([
      PV.store.canonical.counts(s),
      PV.store.canonical.products(s, { limit: CATALOGUE_PREVIEW }),
      PV.store.canonical.offers(s, { limit: CATALOGUE_PREVIEW }),
      PV.store.dealEngine.merchants(s),
      PV.store.dealEngine.sources(s)
    ]).then(function (results) {
      state.catalogueCounts = results[0];
      state.catalogueProducts = (results[1] && results[1].products) || [];
      state.catalogueOffers = (results[2] && results[2].offers) || [];
      state.catalogueMerchants = (results[3] && results[3].merchants) || [];
      state.catalogueSources = (results[4] && results[4].sources) || [];
      state.catalogueLoaded = true;
      render();
    }).catch(function (err) {
      state.catalogueCounts = null;
      state.catalogueProducts = [];
      state.catalogueOffers = [];
      state.catalogueMerchants = [];
      state.catalogueSources = [];
      state.catalogueLoaded = true;
      state.catalogueError = messageFor(err);
      render();
    });
  }

  function loadForSection() {
    if (!isAdmin()) return Promise.resolve();
    if (state.section === 'sellers') {
      return Promise.all([loadCounts(), state.selectedId ? loadDetail() : loadQueue()]);
    }
    if (state.section === 'products') return loadCatalogue();
    if (state.section === 'sources') return loadSources();
    if (state.section === 'jobs') return loadJobs();
    if (state.section === 'imports') return loadImports();
    if (state.section === 'review') {
      return Promise.all([loadCounts(), state.selectedId ? loadReviewRecord() : loadReviewQueue()]);
    }
    return loadCounts();
  }

  /* ----------------------------------------------------------- actions --- */
  function goToSection(id, options) {
    const o = options || {};
    state.section = SECTIONS.indexOf(id) !== -1 ? id : 'dashboard';
    state.message = '';
    /* An open form belongs to the section it was opened in. */
    state.form = null;
    state.action = null;
    state.note = '';
    state.noteError = '';
    state.conversion = null;
    state.conversionErrors = {};
    state.conversionConfirm = false;
    state.conversionResult = null;
    if (o.filter) state.filter = o.filter;
    if (!o.keepSelection) state.selectedId = '';
    writeAddress();
    focusAfterRender = state.section === 'sellers' ? '[data-admin-filter="' + state.filter + '"]' : '';
    render();
    return loadForSection();
  }

  function openApplication(id) {
    if (!UUID.test(String(id))) return;
    state.selectedId = id;
    state.action = null;
    state.note = '';
    state.message = '';
    writeAddress();
    render();
    return loadDetail();
  }

  function backToQueue() {
    state.selectedId = '';
    state.action = null;
    state.note = '';
    writeAddress();
    render();
    return loadQueue();
  }

  function beginAction(status) {
    const account = state.detail;
    if (!account) return;
    const action = D.adminReviewActionsFor(account.status).filter((a) => a.status === status)[0];
    if (!action) return;
    state.action = action;
    state.note = '';
    state.noteError = '';
    state.message = '';
    /* Set before rendering: a re-render may replace the element, and the focus
       has to be applied to the new one. */
    focusAfterRender = '#reviewNote';
    render();
  }

  /* Cancelling returns focus to the action the operator declined, so the
     keyboard position is where it was. */
  function cancelAction() {
    const declined = state.action ? state.action : null;
    state.action = null;
    state.note = '';
    state.noteError = '';
    if (declined) focusAfterRender = '[data-review-action="' + declined.status + '"]';
    render();
  }

  /**
   * The review itself. The database confirms before anything is reported:
   * the record is re-read afterwards, and the page states the status the
   * database returned — never the one that was requested.
   */
  /* A refusal is announced and focused, so a keyboard or screen-reader user
     knows that nothing happened — the same treatment a success gets. */
  function announceFailure() {
    focusAfterRender = '#adminMessage';
    render();
    if (state.message) PV.ui.announce(state.message);
  }

  function confirmAction() {
    if (!state.action || state.busy) return;
    const s = session();
    if (!s) { state.message = 'Your session has expired. Sign in again to continue.'; state.messageTone = 'warning'; render(); return; }

    const action = state.action;
    if (state.note.length > D.REVIEW_NOTE_MAX) {
      state.noteError = 'That note is longer than ' + D.REVIEW_NOTE_MAX + ' characters.';
      focusAfterRender = '#reviewNote';
      render();
      return;
    }

    state.busy = true;
    state.noteError = '';
    state.message = '';
    render();

    PV.store.admin.review(s, state.selectedId, action.status, state.note).then(function (updated) {
      if (!updated) {
        state.busy = false;
        state.action = null;
        state.message = 'The database did not confirm that change, so nothing is reported as done. Reload and try again.';
        state.messageTone = 'warning';
        announceFailure();
        return null;
      }
      /* Read it back: what the database holds is what is displayed. */
      return PV.store.admin.account(s, state.selectedId).then(function (fresh) {
        state.busy = false;
        state.action = null;
        state.note = '';
        state.detail = fresh || updated;
        state.detailLoaded = true;
        const now = D.adminStatusCopy(state.detail.status).label;
        state.message = state.detail.businessName + ' is now ' + now + '.';
        if (state.detail.status !== action.status) {
          state.message = 'The database returned a different status than requested: ' + now + '. That is what is shown.';
          state.messageTone = 'warning';
          focusAfterRender = '#adminMessage';
        } else {
          state.messageTone = 'good';
        }
        PV.ui.announce(state.message);
        PV.ui.toast(state.message);
        render();
        /* The counts and the queue both moved, so both are re-read. */
        return Promise.all([loadCounts(), loadQueue()]);
      });
    }).catch(function (err) {
      state.busy = false;
      state.action = null;
      state.message = messageFor(err);
      state.messageTone = 'warning';
      announceFailure();
    });
  }

  /* ------------------------------------------------- sources: the write ---
     Everything below is the source form's behaviour: what it sends, what it
     refuses to send, and what it reports afterwards. The request itself is one
     call into the store, which calls one database function.
     ------------------------------------------------------------------------ */

  function sourceFormValues(source) {
    const src = source || {};
    const config = src.config && typeof src.config === 'object' ? src.config : {};
    return {
      name: src.name || '',
      sourceType: src.sourceType || D.DEAL_SOURCE_TYPES[0],
      providerName: src.providerName || '',
      marketCountry: src.marketCountry || '',
      endpointUrl: src.endpointUrl || '',
      status: src.status || 'paused',
      /* Formatted for a person to read and correct; parsed back on save. */
      configText: Object.keys(config).length ? JSON.stringify(config, null, 2) : ''
    };
  }

  /** The configuration as the operator typed it. Invalid JSON never leaves. */
  function parseConfigText(text) {
    const raw = String(text === undefined || text === null ? '' : text).trim();
    if (!raw) return { ok: true, value: {} };
    let value;
    try {
      value = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: 'That is not valid JSON. Use an object such as {"market": "GB"}, or leave it empty.' };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Configuration has to be a JSON object, such as {"market": "GB"}.' };
    }
    return { ok: true, value: value };
  }

  function fieldSelector(name) {
    return '#source' + String(name).charAt(0).toUpperCase() + String(name).slice(1);
  }

  function openSourceForm(mode, source) {
    state.form = {
      mode: mode === 'edit' ? 'edit' : 'create',
      id: source ? source.id : '',
      values: sourceFormValues(source),
      errors: {},
      message: '',
      busy: false
    };
    state.message = '';
    focusAfterRender = '#sourceName';
    render();
  }

  function cancelSourceForm() {
    const wasEditing = state.form && state.form.mode === 'edit' ? state.form.id : '';
    state.form = null;
    focusAfterRender = wasEditing ? '[data-edit-source="' + wasEditing + '"]' : '[data-new-source]';
    render();
  }

  /* A refusal is answered in plain words — the database's own sentence is not
     shown to an operator, and nothing is ever reported as saved unless the
     database returned the saved row. */
  function sourceFormMessage(err) {
    const code = err && err.code ? err.code : '';
    if (code === 'api-400') {
      return 'The database refused those values, so nothing was saved. Check the form and try again.';
    }
    if (code === 'api-403') {
      return 'Only an administrator can change a Deal Engine source, and the database decides that — not this page.';
    }
    if (code === 'api-401') return 'Your session has expired. Sign in again to continue.';
    if (code === 'api-404') return 'That source is no longer in the database. Cancel and reload the list.';
    if (code === 'api-409') return 'That source was changed by someone else a moment ago. Cancel and reload the list.';
    if (code === 'api-unreachable') return 'We could not reach the database. Check your connection and try again.';
    if (code === 'not-signed-in') return 'Sign in again to continue.';
    if (code === 'api-not-configured') {
      return 'The admin panel needs the live database connection. This build is running on the bundled demonstration catalogue.';
    }
    return 'That did not go through and nothing was changed. Try again in a moment.';
  }

  function saveSource() {
    if (!state.form || state.form.busy) return;
    const s = session();
    if (!s) {
      state.form.message = 'Your session has expired. Sign in again to continue.';
      render();
      return;
    }
    const values = state.form.values;
    const parsed = parseConfigText(values.configText);
    if (!parsed.ok) {
      state.form.errors = { configText: parsed.error };
      state.form.message = '';
      focusAfterRender = fieldSelector('configText');
      render();
      return;
    }

    const candidate = {
      name: values.name,
      sourceType: values.sourceType,
      providerName: values.providerName,
      marketCountry: values.marketCountry,
      endpointUrl: values.endpointUrl,
      status: values.status,
      config: parsed.value
    };
    const check = D.validateDealSource(candidate);
    if (!check.valid) {
      state.form.errors = check.fields;
      state.form.message = 'Correct the highlighted fields. Nothing was sent.';
      const first = Object.keys(check.fields)[0];
      focusAfterRender = first ? fieldSelector(first) : '#sourceName';
      render();
      return;
    }

    /* What is sent is what the database will store: trimmed, and a country
       code in the case the column requires. */
    candidate.name = D.trim(values.name);
    candidate.providerName = D.trim(values.providerName);
    candidate.marketCountry = D.trim(values.marketCountry).toUpperCase();
    candidate.endpointUrl = D.trim(values.endpointUrl);

    const editing = state.form.mode === 'edit';
    const id = state.form.id;
    const asked = candidate.status;
    state.form.busy = true;
    state.form.errors = {};
    state.form.message = '';
    render();

    const call = editing
      ? PV.store.dealEngine.updateSource(s, id, candidate)
      : PV.store.dealEngine.createSource(s, candidate);

    call.then(function (saved) {
      if (!state.form) return null;
      if (!saved) {
        state.form.busy = false;
        state.form.message = 'The database did not confirm that change, so nothing is reported as saved. Try again.';
        render();
        return null;
      }
      /* The list is re-read from the database; what is displayed is what it
         holds, not what the form asked for. */
      const label = D.dealSourceStatusCopy(saved.status).label.toLowerCase();
      state.form = null;
      state.message = '“' + saved.name + '” is recorded as ' + label + '.';
      state.messageTone = 'good';
      if (saved.status !== asked) {
        state.message = 'The database returned a different state than the form asked for: ' + label +
          '. That is what is shown.';
        state.messageTone = 'warning';
        focusAfterRender = '#adminMessage';
      }
      PV.ui.announce(state.message);
      PV.ui.toast(state.message);
      return loadSources();
    }).catch(function (err) {
      if (!state.form) return;
      state.form.busy = false;
      state.form.message = sourceFormMessage(err);
      render();
    });
  }

  /* ------------------------------------------------- import deals (17B) ----
     The imported records themselves, and nothing else.

     This section answers one question — what has been imported, and where is
     each record now? — by reading one bounded page of them, newest first, and
     drawing the columns the database returned. It is read-only in the strict
     sense: no form, no button that writes, no decision offered. The Deal
     Engine's one deliberate action — converting a single record into canonical
     records — stays in the Review Queue, which shows only the records that are
     waiting for that decision.

     The read is the store's own Import Deals boundary
     (`PV.store.dealEngine.importedDeals`): it asks the database for a bounded
     number of rows with `count=exact`, and returns the database's own count of
     the whole table alongside them. A count that did not arrive is shown as
     unavailable — it is never replaced by the size of the page that did.
     ------------------------------------------------------------------------ */

  /** What the processing steps recorded, one labelled line each. A step that
      recorded nothing is not shown as a status, and a recorded error is shown
      as what it is — the text the database holds, escaped like everything
      else that arrived from a source. */
  function importsProcessingCell(record) {
    const lines = [
      record.validationStatus ? 'Validation: ' + record.validationStatus : '',
      record.normalizationStatus ? 'Normalization: ' + record.normalizationStatus : '',
      record.deduplicationStatus ? 'Deduplication: ' + record.deduplicationStatus : '',
      record.dedupMatchClass ? 'Dedup match class: ' + record.dedupMatchClass : ''
    ].filter(Boolean);
    let cell = lines.length
      ? lines.map(function (line) { return '<div class="admin-muted">' + esc(line) + '</div>'; }).join('')
      : '<span class="admin-muted">Not recorded</span>';
    if (record.error) {
      cell += '<div><strong>Error</strong> <span class="admin-muted">' + esc(record.error) + '</span></div>';
    }
    return cell;
  }

  /** What a reviewer recorded, when one did. Who reviewed is a person's
      identifier and is deliberately not shown: this table reports the record's
      state, not people. */
  function importsReviewCell(record) {
    const lines = [];
    if (record.reviewedAt) lines.push('Reviewed ' + formatDateTime(record.reviewedAt));
    if (record.reviewNote) lines.push(record.reviewNote);
    if (!lines.length) return '<span class="admin-muted">Not recorded</span>';
    return lines.map(function (line) { return '<div class="admin-muted">' + esc(line) + '</div>'; }).join('');
  }

  /** The recorded amount alone — the recorded currency has its own column, and
      nothing is converted, symbolised or guessed here. */
  function importsPriceText(value) {
    return typeof value === 'number' && isFinite(value)
      ? value.toLocaleString('en-US', { maximumFractionDigits: value % 1 ? 2 : 0 })
      : '';
  }

  /** Where a record came from: the source's own id and the address it recorded.
      No source name is joined in — this read does not fetch the sources list,
      and a name taken from another screen's list would not be a value this page
      holds. The id is labelled as the technical reference it is. */
  function importsSourceCell(record) {
    const reference = record.sourceId
      ? '<code class="admin-code">' + esc(record.sourceId) + '</code>'
      : '<span class="admin-muted">Not recorded</span>';
    return '<div><span class="admin-muted">Source ID </span>' + reference + '</div>' +
      '<div><span class="admin-muted">Source URL </span>' + safeUrlCell(record.sourceUrl) + '</div>';
  }

  /** The count sentence. The database's own number decides which one is true; a
      count that did not arrive says so instead of borrowing the page's size. */
  function importsFoot() {
    const total = state.importsTotal;
    if (total === null) {
      return 'The database did not return a count of the imported deal records, so only the ' +
        state.imports.length + ' returned here are shown, and no total is claimed.';
    }
    if (total === 0) return 'No imported deal records to display.';
    if (total <= IMPORTS_PAGE) return 'Showing all ' + total + ' imported deal records.';
    return 'Showing the ' + IMPORTS_PAGE + ' most recent of ' + total + ' imported deal records.';
  }

  /**
   * One bounded read of the imported records, through the store's own Import
   * Deals boundary — the same method the Jobs section uses for its count and
   * the Review Queue uses for its filtered list. Nothing here asks for the
   * whole table: the store clamps the limit, and the database's own count comes
   * back with the rows.
   */
  function loadImports() {
    const s = session();
    if (!s) return Promise.resolve();
    state.importsError = '';
    state.importsLoaded = false;
    return PV.store.dealEngine.importedDeals(s, { limit: IMPORTS_PAGE }).then(function (result) {
      state.imports = (result && result.records) || [];
      const total = result && typeof result.total === 'number' && isFinite(result.total) ? result.total : null;
      state.importsTotal = total;
      /* Recorded for the paging a later step may add; nothing in this build
         draws a page control from it. */
      state.importsMore = total !== null && total > state.imports.length;
      state.importsLoaded = true;
      render();
    }).catch(function (err) {
      state.imports = [];
      state.importsTotal = null;
      state.importsMore = false;
      state.importsLoaded = true;
      state.importsError = messageFor(err);
      render();
    });
  }

  function importsView() {
    if (state.importsError) {
      return '<div class="admin-panel panel">' +
        '<h3 id="importsTitle">The imported records could not be read</h3>' +
        '<p class="panel-text">' + esc(state.importsError) + '</p>' +
        '<div class="admin-actions"><button type="button" class="btn-primary" data-retry-imports="1">Try again</button></div></div>';
    }
    if (!state.importsLoaded) {
      return PV.card.loading({
        title: 'Reading the imported records…',
        text: 'Asking the database for the most recent imported deal records.'
      });
    }
    if (!state.imports.length) {
      return '<div class="admin-panel panel">' +
        '<h3 id="importsTitle">No imported records to show</h3>' +
        '<p class="panel-text">There are no imported deal records to display. This page shows what the ' +
        'database returns from the Deal Engine’s imported deals table; it is a read-only view and imports ' +
        'nothing itself. So an empty list means the database returned no imported deal records — it is not ' +
        'a queue waiting to fill, and nothing here is scheduled to arrive later.</p></div>';
    }
    const rows = state.imports.map(function (record) {
      const price = importsPriceText(record.imported.price);
      return '<tr>' +
        '<td data-label="Imported title"><strong>' + importedCell(record.imported.title, 'No title recorded') + '</strong>' +
          (record.imported.category
            ? '<div class="admin-muted">Source category: ' + esc(record.imported.category) + '</div>'
            : '') + '</td>' +
        '<td data-label="Merchant">' + importedCell(record.merchantName, 'Not named') + '</td>' +
        '<td data-label="Source">' + importsSourceCell(record) + '</td>' +
        '<td data-label="External product ID">' + importedCell(record.externalProductId, 'Not recorded') + '</td>' +
        '<td data-label="Merchant reference">' + importedCell(record.merchantRef, 'Not recorded') + '</td>' +
        '<td data-label="Recorded price">' + (price
          ? esc(price)
          : '<span class="admin-muted">No price recorded</span>') + '</td>' +
        '<td data-label="Currency">' + importedCell(record.imported.currency, 'Not recorded') + '</td>' +
        '<td data-label="Recorded availability">' + importedCell(record.imported.availability, 'Not recorded') + '</td>' +
        '<td data-label="Processing">' + importsProcessingCell(record) + '</td>' +
        '<td data-label="Pipeline status">' + importedCell(record.pipelineStatus, 'Not recorded') + '</td>' +
        '<td data-label="Review status">' + importedCell(record.reviewStatus, 'Not recorded') + '</td>' +
        '<td data-label="Review record">' + importsReviewCell(record) + '</td>' +
        '<td data-label="Imported">' + importedCell(formatDateTime(record.importedAt), 'Not recorded') + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="admin-panel panel">' +
      '<h3 id="importsTitle">Imported records</h3>' +
      '<p class="panel-text">Every row is one imported deal record, exactly as the database returned it. ' +
      'This view is read-only: nothing here changes a record, and nothing changes one by itself. Turning a ' +
      'record into canonical records is the Deal Engine’s one deliberate action, offered in the Review ' +
      'Queue to the records waiting for that decision.</p>' +
      '<p class="panel-note">One bounded page is read — the most recent records, newest first, up to ' +
      IMPORTS_PAGE + '. There is no paging in this build; the count below is the database’s own count of ' +
      'the whole table, so it says how many more exist beyond this page.</p>' +
      '<table class="admin-table">' +
      '<caption class="visually-hidden">Imported deal records</caption>' +
      '<thead><tr>' +
      '<th scope="col">Imported title</th><th scope="col">Merchant</th><th scope="col">Source</th>' +
      '<th scope="col">External product ID</th><th scope="col">Merchant reference</th>' +
      '<th scope="col">Recorded price</th><th scope="col">Currency</th>' +
      '<th scope="col">Recorded availability</th><th scope="col">Processing</th>' +
      '<th scope="col">Pipeline status</th><th scope="col">Review status</th>' +
      '<th scope="col">Review record</th><th scope="col">Imported</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="admin-table-foot">' + esc(importsFoot()) + '</p>' +
      '<p class="admin-table-foot">Pipeline and review status are the values the database recorded, shown ' +
      'as text — this page cannot change them.</p></div>';
  }

  /* ------------------------------------------------ review queue (17A) ----
     Imported records waiting for an administrator, and the conversion of one of
     them into canonical records.

     Everything here is a decision carried to the database and an answer carried
     back. The page never decides that a record may be converted, never matches a
     product or a variant, never fills a canonical field from what the source
     said, and never reports a conversion the database did not confirm. The
     conversion itself is public.imported_deal_convert() — it checks is_admin()
     for itself, validates every value, writes every record and returns what the
     database now holds.
     ------------------------------------------------------------------------ */

  const REVIEW_QUEUE_PAGE = 50;
  const CONVERSION_PRODUCT_PAGE = 50;

  function reviewSourceName(id) {
    const found = state.reviewSources.filter(function (source) { return source.id === id; })[0];
    return found ? found.name : '';
  }

  /** The recorded amount and the recorded currency, exactly as stored. */
  function importedRecordPriceText(record) {
    return D.merchantOfferPriceText({ priceAmount: record.imported.price, currency: record.imported.currency });
  }

  function importedCell(value, whenEmpty) {
    return value ? esc(value) : '<span class="admin-muted">' + esc(whenEmpty) + '</span>';
  }

  /** A URL becomes a link only when the validator accepts it. */
  function safeUrlCell(url) {
    const value = String(url || '').trim();
    if (!value) return '<span class="admin-muted">Not recorded</span>';
    if (!D.isSafeHttpUrl(value)) {
      return '<span class="admin-muted">' + esc(value) + ' — shown as text: it is not an http/https address.</span>';
    }
    return '<a class="admin-source-link" href="' + esc(value) + '" target="_blank" ' +
      'rel="noopener noreferrer">' + esc(value) + '</a>';
  }

  /**
   * The only state this page can convert, and the only state it offers a form
   * for. 0010 refuses everything else; this is the same rule, read from the
   * record the database returned.
   */
  function recordEligibleForReview(record) {
    return !!record && record.pipelineStatus === 'pending-review' && record.reviewStatus === 'pending';
  }

  /**
   * A blank decision. Nothing is carried over from the evidence, from the
   * previous record, or from a previous attempt: every canonical value is the
   * reviewer's own, typed here.
   */
  function blankConversion() {
    return {
      productMode: 'create',
      name: '', slug: '', brand: '', modelNumber: '', mpn: '', gtin: '',
      categoryId: '', subcategoryId: '',
      productId: '',
      variantMode: 'none',
      variantName: '', variantSlug: '', variantSku: '', variantGtin: '', optionValuesText: '',
      variantId: '',
      reviewNote: '', normalizationNote: ''
    };
  }

  /* ------------------------------------------------------------- loading -- */

  function loadReviewQueue() {
    const s = session();
    if (!s) return Promise.resolve();
    state.reviewQueueError = '';
    state.reviewQueueLoaded = false;
    return PV.store.dealEngine.reviewQueue(s, { limit: REVIEW_QUEUE_PAGE }).then(function (result) {
      state.reviewQueue = (result && result.records) || [];
      state.reviewQueueTotal = result && typeof result.total === 'number' ? result.total : null;
      state.reviewQueueMore = !!(result && result.more);
      state.reviewQueueLoaded = true;
      render();
    }).catch(function (err) {
      state.reviewQueue = [];
      state.reviewQueueTotal = null;
      state.reviewQueueMore = false;
      state.reviewQueueLoaded = true;
      state.reviewQueueError = messageFor(err);
      render();
    });
  }

  /**
   * The reference lists the decision form chooses from: the published taxonomy,
   * the newest canonical products, and the sources (so a record's provenance can
   * name where it came from). Read separately from the record itself, so a
   * failure here cannot hide the evidence being reviewed.
   */
  function loadReviewReferences() {
    const s = session();
    if (!s) return Promise.resolve();
    state.reviewRefsError = '';
    return Promise.all([
      PV.store.reference.categoryOptions(s),
      PV.store.canonical.products(s, { limit: CONVERSION_PRODUCT_PAGE }),
      PV.store.dealEngine.sources(s)
    ]).then(function (results) {
      state.reviewTaxonomy = results[0] || [];
      state.reviewTaxonomyLoaded = true;
      state.reviewProducts = (results[1] && results[1].products) || [];
      state.reviewProductsTotal = results[1] && typeof results[1].total === 'number' ? results[1].total : null;
      state.reviewSources = (results[2] && results[2].sources) || [];
      render();
    }).catch(function (err) {
      state.reviewTaxonomy = [];
      state.reviewTaxonomyLoaded = false;
      state.reviewProducts = [];
      state.reviewProductsTotal = null;
      state.reviewRefsError = messageFor(err);
      render();
    });
  }

  /**
   * Read the record and its history back from the database.
   *
   * `keepDecision` is for the read that follows a conversion: what the
   * administrator just did is shown until they leave the record, so the result
   * of the decision is not erased by the act of confirming it in the database.
   * Opening a record afresh starts from a blank decision, as it should.
   */
  function loadReviewRecord(keepDecision) {
    const s = session();
    if (!s || !state.selectedId) return Promise.resolve();
    state.reviewRecordError = '';
    state.reviewRecordLoaded = false;
    state.reviewEventsLoaded = false;
    state.reviewRecord = null;
    state.reviewEvents = [];
    if (!state.reviewTaxonomyLoaded) loadReviewReferences();
    return Promise.all([
      PV.store.dealEngine.importedDeal(s, state.selectedId),
      PV.store.dealEngine.importedDealEvents(s, state.selectedId)
    ]).then(function (results) {
      state.reviewRecord = results[0] || null;
      state.reviewEvents = results[1] || [];
      state.reviewEventsLoaded = true;
      state.reviewRecordLoaded = true;
      if (!keepDecision) {
        state.conversion = blankConversion();
        state.conversionErrors = {};
        state.conversionConfirm = false;
        state.conversionResult = null;
      }
      render();
    }).catch(function (err) {
      state.reviewRecord = null;
      state.reviewEvents = [];
      state.reviewEventsLoaded = true;
      state.reviewRecordLoaded = true;
      state.reviewRecordError = messageFor(err);
      render();
    });
  }

  /** The variants of one existing product, and only after it was chosen. */
  function loadReviewVariants(productId) {
    const s = session();
    if (!s || !productId) return Promise.resolve();
    state.reviewVariantsFor = productId;
    state.reviewVariantsLoaded = false;
    state.reviewVariants = [];
    return PV.store.canonical.variants(s, productId)
      .then(function (result) {
        state.reviewVariants = (result && result.variants) || [];
        state.reviewVariantsLoaded = true;
        render();
      }).catch(function (err) {
        state.reviewVariants = [];
        state.reviewVariantsLoaded = true;
        state.reviewRefsError = messageFor(err);
        render();
      });
  }

  /* ------------------------------------------------------- the queue view -- */

  function reviewQueueView() {
    if (state.reviewQueueError) {
      return '<div class="admin-panel panel">' +
        '<h3 id="reviewQueueTitle">The review queue could not be read</h3>' +
        '<p class="panel-text">' + esc(state.reviewQueueError) + '</p>' +
        '<div class="admin-actions"><button type="button" class="btn-primary" data-retry-review-queue="1">Try again</button></div></div>';
    }
    if (!state.reviewQueueLoaded) {
      return PV.card.loading({
        title: 'Reading the review queue…',
        text: 'Asking the database for the imported records that are at pending review.'
      });
    }
    if (!state.reviewQueue.length) {
      return '<div class="admin-panel panel">' +
        '<h3 id="reviewQueueTitle">Nothing is waiting for review</h3>' +
        '<p class="panel-text">No imported record is at pipeline status <code>pending-review</code> with review ' +
        'status <code>pending</code> — the only state this page can convert. Nothing in this build advances a ' +
        'record into that state by itself: there is no connector, no processor, no schedule and no automatic ' +
        'conversion, so the queue is set deliberately, and an empty queue is the honest state of the pipeline ' +
        'rather than a failure.</p>' +
        '<p class="panel-text">Records that are not waiting for review are not shown here at all: the database ' +
        'returns only the ones this page may act on.</p></div>';
    }
    const total = state.reviewQueueTotal;
    const foot = typeof total === 'number'
      ? 'The database counts ' + total + ' record' + (total === 1 ? '' : 's') + ' waiting for review. ' +
        (state.reviewQueueMore
          ? 'Showing the ' + state.reviewQueue.length + ' most recent, so this is not all of them.'
          : 'All of them are shown.')
      : 'The database did not return a total, so none is shown.';
    return '<div class="admin-panel panel">' +
      '<h3 id="reviewQueueTitle">Waiting for an administrator</h3>' +
      '<p class="panel-text">Each of these records is in the only state a conversion accepts. Opening one shows ' +
      'what the source recorded, and lets you record what it becomes: a canonical product, optionally a variant, ' +
      'and one merchant offer. The conversion is performed by the database\'s own function, which confirms that ' +
      'you are an administrator and validates everything before it writes.</p>' +
      '<table class="admin-table">' +
      '<caption class="visually-hidden">Imported records waiting for review</caption>' +
      '<thead><tr><th scope="col">Imported title</th><th scope="col">Merchant</th><th scope="col">Source</th>' +
      '<th scope="col">Recorded price</th><th scope="col">Recorded availability</th><th scope="col">Imported</th>' +
      '<th scope="col">Action</th></tr></thead><tbody>' +
      state.reviewQueue.map(function (record) {
        const price = importedRecordPriceText(record);
        return '<tr>' +
          '<td data-label="Imported title"><strong>' + importedCell(record.imported.title, 'No title recorded') + '</strong></td>' +
          '<td data-label="Merchant">' + importedCell(record.merchantName, 'Not named') + '</td>' +
          '<td data-label="Source">' + importedCell(reviewSourceName(record.sourceId), 'Not in the loaded list') + '</td>' +
          '<td data-label="Recorded price">' + (price
            ? esc(price) + (record.imported.currency ? '' : ' <span class="admin-muted">(currency not recorded)</span>')
            : '<span class="admin-muted">No price recorded</span>') + '</td>' +
          '<td data-label="Recorded availability">' + importedCell(record.imported.availability, 'Not recorded') + '</td>' +
          '<td data-label="Imported">' + esc(formatDateTime(record.importedAt)) + '</td>' +
          '<td data-label="Action"><button type="button" class="btn-secondary" data-admin-open-review="' +
            esc(record.id) + '">Review</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="admin-table-foot">' + esc(foot) + '</p>' +
      '<p class="admin-table-foot">Availability above is the text the source recorded. It is not a PickVanta ' +
      'availability state, and the conversion does not turn it into one.</p></div>';
  }

  /* ----------------------------------------------- the record's evidence -- */

  function reviewEvidencePanel(record) {
    const normalized = record.normalized || {};
    const proposed = [
      normalized.name ? row('Normalized name (proposed)', esc(normalized.name)) : '',
      normalized.brand ? row('Normalized brand (proposed)', esc(normalized.brand)) : '',
      normalized.categoryId ? row('Normalized category (proposed)', esc(normalized.categoryId)) : '',
      normalized.availability ? row('Normalized availability (proposed)', esc(normalized.availability)) : '',
      normalized.modelNumber ? row('Normalized model number (proposed)', esc(normalized.modelNumber)) : '',
      normalized.gtin ? row('Normalized GTIN (proposed)', esc(normalized.gtin)) : ''
    ].join('');
    const metadata = Object.keys(record.imported.metadata || {}).length
      ? '<pre class="admin-metadata">' + esc(JSON.stringify(record.imported.metadata, null, 2)) + '</pre>'
      : '<span class="admin-muted">Nothing recorded</span>';
    const price = importedRecordPriceText(record);
    return '<section class="admin-panel panel" aria-labelledby="reviewEvidenceTitle">' +
      '<h4 class="admin-subhead" id="reviewEvidenceTitle">Source evidence</h4>' +
      '<p class="panel-note">What the source recorded, kept exactly as it arrived. None of it becomes canonical ' +
      'data on its own: the conversion writes only what you enter below, and nothing on this page copies these ' +
      'values into it.</p>' +
      '<dl class="admin-fields">' +
      row('Imported title', importedCell(record.imported.title, 'Not recorded')) +
      row('Imported description', importedCell(record.imported.description, 'Not recorded')) +
      row('Merchant', importedCell(record.merchantName, 'Not named')) +
      row('Merchant reference', importedCell(record.merchantRef, 'Not recorded')) +
      row('External product id', importedCell(record.externalProductId, 'Not recorded')) +
      row('Source', importedCell(reviewSourceName(record.sourceId), 'Not in the loaded list')) +
      row('Source URL', safeUrlCell(record.sourceUrl)) +
      '<div class="admin-field"><dt>Affiliate URL</dt><dd>' +
        (record.affiliateUrl
          ? '<span class="admin-muted">' + esc(record.affiliateUrl) + ' — recorded by the source. The conversion ' +
            'does not copy it: the merchant offer it creates has an empty affiliate URL.</span>'
          : '<span class="admin-muted">Not set</span>') + '</dd></div>' +
      row('Recorded price', price
        ? esc(price) + (record.imported.currency ? '' : ' <span class="admin-muted">(currency not recorded)</span>')
        : '<span class="admin-muted">No price recorded</span>') +
      row('Recorded currency', importedCell(record.imported.currency, 'Not recorded')) +
      row('Recorded availability', importedCell(record.imported.availability, 'Not recorded')) +
      row('Imported category text', importedCell(record.imported.category, 'Not recorded')) +
      row('Imported at', importedCell(record.importedAt, 'Not recorded')) +
      row('Pipeline status', esc(record.pipelineStatus || 'Not recorded')) +
      row('Review status', esc(record.reviewStatus || 'Not recorded')) +
      '</dl>' +
      (proposed
        ? '<dl class="admin-fields">' +
          '<div class="admin-field"><dt>Recorded by the pipeline as proposals</dt><dd>' +
          '<span class="admin-muted">These are what an earlier stage recorded. They are evidence too: none of ' +
          'them is written to the canonical record unless you type it yourself.</span></dd></div>' + proposed + '</dl>'
        : '') +
      '<dl class="admin-fields"><div class="admin-field"><dt>Imported metadata</dt><dd>' + metadata + '</dd></div></dl>' +
      '</section>';
  }

  function reviewEventsPanel() {
    let body;
    if (!state.reviewEventsLoaded) {
      body = '<p class="panel-text">Reading this record\'s history…</p>';
    } else if (!state.reviewEvents.length) {
      body = '<p class="panel-text">No events recorded. Nothing has happened to this record since it was imported.</p>';
    } else {
      body = '<ol class="admin-events">' + state.reviewEvents.map(function (event) {
        const data = event.data || {};
        return '<li class="admin-event">' +
          '<p class="admin-event-head"><strong>' + esc(event.stage || 'Event') + '</strong>' +
          (event.outcome ? ' · ' + esc(event.outcome) : '') +
          '<span class="admin-muted"> · ' + esc(formatDateTime(event.createdAt)) + '</span></p>' +
          (event.detail ? '<p class="admin-event-detail">' + esc(event.detail) + '</p>' : '') +
          (Object.keys(data).length
            ? '<p class="admin-event-data"><code>' + esc(JSON.stringify(data)) + '</code></p>' : '') +
          '</li>';
      }).join('') + '</ol>';
    }
    return '<section class="admin-panel panel" aria-labelledby="reviewEventsTitle">' +
      '<h4 class="admin-subhead" id="reviewEventsTitle">Event history</h4>' +
      '<p class="panel-note">Append-only, oldest first. An event records what happened; nothing on this page ' +
      'writes one.</p>' + body + '</section>';
  }

  /* --------------------------------------------------- the decision form -- */

  /** The ids a control is described by — its help, its error, or both. */
  function describedBy(name, hasHelp) {
    const ids = [];
    if (hasHelp) ids.push('conv' + name + 'Help');
    if (state.conversionErrors[name]) ids.push('conv' + name + 'Error');
    return ids.length ? ' aria-describedby="' + ids.join(' ') + '"' : '';
  }

  function convField(name, label, value, options) {
    const o = options || {};
    const help = o.help ? describedBy(name, true) : describedBy(name, false);
    return '<div class="field">' +
      '<label for="conv' + name + '">' + esc(label) + (o.required ? ' (required)' : '') + '</label>' +
      '<input type="text" id="conv' + name + '" data-conversion-field="' + name + '"' +
      ' value="' + esc(value) + '"' +
      (state.conversionErrors[name] ? ' aria-invalid="true"' : '') + help + ' />' +
      (o.help ? '<p class="field-help" id="conv' + name + 'Help">' + esc(o.help) + '</p>' : '') +
      (state.conversionErrors[name]
        ? '<p class="form-error" id="conv' + name + 'Error" role="alert">' + esc(state.conversionErrors[name]) + '</p>'
        : '') +
      '</div>';
  }

  /* `max` is the column's own limit, and is only set where a column has one:
     a field with no recorded limit is not given an invented one. */
  function convTextarea(name, label, value, max, help) {
    return '<div class="field">' +
      '<label for="conv' + name + '">' + esc(label) + ' (optional)</label>' +
      '<textarea id="conv' + name + '" data-conversion-field="' + name + '" rows="3"' +
      (max ? ' maxlength="' + max + '"' : '') +
      ' aria-describedby="conv' + name + 'Help"' +
      (state.conversionErrors[name] ? ' aria-invalid="true"' : '') + '>' + esc(value) + '</textarea>' +
      '<p class="field-help" id="conv' + name + 'Help">' + esc(help) + '</p>' +
      (state.conversionErrors[name]
        ? '<p class="form-error" id="conv' + name + 'Error" role="alert">' + esc(state.conversionErrors[name]) + '</p>'
        : '') +
      '</div>';
  }

  function convSelect(name, label, value, options, help, required) {
    return '<div class="field">' +
      '<label for="conv' + name + '">' + esc(label) + (required ? ' (required)' : '') + '</label>' +
      '<select id="conv' + name + '" data-conversion-field="' + name + '"' +
      (state.conversionErrors[name] ? ' aria-invalid="true"' : '') + describedBy(name, !!help) + '>' +
      options.map(function (option) {
        return '<option value="' + esc(option.id) + '"' + (option.id === value ? ' selected' : '') + '>' +
          esc(option.label) + '</option>';
      }).join('') + '</select>' +
      (help ? '<p class="field-help" id="conv' + name + 'Help">' + esc(help) + '</p>' : '') +
      (state.conversionErrors[name]
        ? '<p class="form-error" id="conv' + name + 'Error" role="alert">' + esc(state.conversionErrors[name]) + '</p>'
        : '') +
      '</div>';
  }

  function selectedProduct() {
    const wanted = state.conversion ? D.trim(state.conversion.productId) : '';
    if (!wanted) return null;
    return state.reviewProducts.filter(function (product) { return product.id === wanted; })[0] || null;
  }

  function selectedVariant() {
    const wanted = state.conversion ? D.trim(state.conversion.variantId) : '';
    if (!wanted) return null;
    return state.reviewVariants.filter(function (variant) { return variant.id === wanted })[0] || null;
  }

  function productPicker() {
    if (state.reviewRefsError) {
      return '<p class="panel-text">The canonical products could not be read: ' + esc(state.reviewRefsError) +
        ' <button type="button" class="link-btn" data-retry-review-references="1">Try again</button></p>';
    }
    const total = state.reviewProductsTotal;
    const options = [{ id: '', label: 'Choose a product…' }].concat(state.reviewProducts.map(function (product) {
      return { id: product.id, label: product.name + (product.brand ? ' · ' + product.brand : '') +
        (product.slug ? ' (' + product.slug + ')' : '') };
    }));
    const chosen = selectedProduct();
    const details = chosen
      ? '<dl class="admin-fields">' +
        row('Id', '<code class="admin-code">' + esc(chosen.id) + '</code>') +
        row('Slug', esc(chosen.slug)) +
        row('Name', esc(chosen.name)) +
        row('Brand', chosen.brand ? esc(chosen.brand) : '<span class="admin-muted">Not recorded</span>') +
        row('Model number', chosen.modelNumber ? esc(chosen.modelNumber) : '<span class="admin-muted">Not recorded</span>') +
        row('GTIN', chosen.gtin ? esc(chosen.gtin) : '<span class="admin-muted">None</span>') +
        row('Status', esc(chosen.statusCopy ? chosen.statusCopy.label : chosen.status)) +
        row('Recorded', esc(formatDateTime(chosen.createdAt))) +
        '</dl>' +
        (chosen.gtin
          ? '<p class="panel-note">This product already carries a GTIN, so it is a single-configuration product: ' +
            'the database refuses a variant for it. Convert it with no variant.</p>'
          : '')
      : '';
    return convSelect('productId', 'Existing product', state.conversion.productId, options,
      'The newest ' + CONVERSION_PRODUCT_PAGE + ' canonical products are listed. The database decides what exists; ' +
      'nothing here searches, suggests or matches.', true) + details +
      '<p class="field-help">' + esc(typeof total === 'number'
        ? 'The database counts ' + total + ' product' + (total === 1 ? '' : 's') + ' in total' +
          (total > state.reviewProducts.length ? ', so this list shows the most recent only.' : '.')
        : 'The database did not return a total, so none is shown.') + '</p>';
  }

  function variantPicker() {
    if (!state.conversion.productId) {
      return '<p class="panel-text">Choose the existing product first: a variant belongs to one product, and only ' +
        'that product\'s variants can be chosen.</p>';
    }
    if (!state.reviewVariantsLoaded && state.reviewVariantsFor !== state.conversion.productId) {
      return '<p class="panel-text">Reading this product\'s variants…</p>';
    }
    if (!state.reviewVariants.length) {
      return '<p class="panel-text">This product has no variants recorded, so there is nothing to choose. Create a ' +
        'variant, or convert the record without one.</p>';
    }
    const options = [{ id: '', label: 'Choose a variant…' }].concat(state.reviewVariants.map(function (variant) {
      return { id: variant.id, label: variant.name + (variant.slug ? ' (' + variant.slug + ')' : '') };
    }));
    const chosen = selectedVariant();
    const details = chosen
      ? '<dl class="admin-fields">' +
        row('Id', '<code class="admin-code">' + esc(chosen.id) + '</code>') +
        row('Slug', esc(chosen.slug)) +
        row('Name', esc(chosen.name)) +
        row('Options', Object.keys(chosen.optionValues || {}).length
          ? '<code class="admin-code">' + esc(JSON.stringify(chosen.optionValues)) + '</code>'
          : '<span class="admin-muted">None recorded</span>') +
        row('SKU', chosen.sku ? esc(chosen.sku) : '<span class="admin-muted">Not recorded</span>') +
        row('GTIN', chosen.gtin ? esc(chosen.gtin) : '<span class="admin-muted">None</span>') +
        row('Status', esc(chosen.statusCopy ? chosen.statusCopy.label : chosen.status)) +
        '</dl>' +
        '<p class="panel-note">Choosing an existing variant never edits it: the conversion adds an offer that ' +
        'names it, and nothing else.</p>'
      : '';
    return convSelect('variantId', 'Existing variant', state.conversion.variantId, options,
      'Only the variants of the product you chose are offered.', true) + details;
  }

  function decisionPanel() {
    const c = state.conversion || blankConversion();
    const categories = state.reviewTaxonomy.map(function (category) {
      return { id: category.id, label: category.label };
    });
    const chosenCategory = state.reviewTaxonomy.filter(function (category) {
      return category.id === c.categoryId;
    })[0] || null;
    const subcategories = chosenCategory ? chosenCategory.subcategories.map(function (sub) {
      return { id: sub.id, label: sub.label };
    }) : [];
    const productBlock = c.productMode === 'create'
      ? convField('name', 'Canonical name', c.name, { required: true,
          help: 'The name PickVanta will use. It is never taken from the merchant\'s title automatically.' }) +
        convField('slug', 'Slug', c.slug, { required: true,
          help: 'Lower-case words separated by single hyphens (for example demo-phone-8-128).' }) +
        convField('brand', 'Brand', c.brand, {}) +
        convField('modelNumber', 'Model number', c.modelNumber, {}) +
        convField('mpn', 'MPN', c.mpn, {}) +
        (c.variantMode === 'none'
          ? convField('gtin', 'GTIN', c.gtin, { help: '8 to 14 digits, or empty. One product may carry a GTIN, and a product with variants may not.' })
          : '<p class="panel-note">No product GTIN is offered here: this conversion names a variant, and a GTIN ' +
            'belongs on the variant. The database refuses both at once.</p>') +
        convSelect('categoryId', 'Category', c.categoryId,
          [{ id: '', label: 'Not chosen yet' }].concat(categories),
          'Published categories only — the same list a visitor\'s page reads. The database checks that the category exists.') +
        (chosenCategory
          ? convSelect('subcategoryId', 'Subcategory', c.subcategoryId,
              [{ id: '', label: 'Not chosen yet' }].concat(subcategories),
              'Only this category\'s subcategories are offered. The database checks the pair.')
          : '')
      : productPicker();

    const variantBlock = c.variantMode === 'none'
      ? '<p class="panel-text">No variant: the offer is about the product as a whole.</p>'
      : (c.variantMode === 'create'
        ? convField('variantName', 'Variant name', c.variantName, { required: true }) +
          convField('variantSlug', 'Variant slug', c.variantSlug, { required: true,
            help: 'Unique inside this product.' }) +
          convField('variantSku', 'Variant SKU', c.variantSku, {}) +
          convField('variantGtin', 'Variant GTIN', c.variantGtin, { help: '8 to 14 digits, or empty. It must not already exist.' }) +
          convTextarea('optionValuesText', 'Options (JSON object)',
            c.optionValuesText, '',
            'Optional. A JSON object of option names and values, such as {"storage": "128GB"}. ' +
            'The database records them as the offer\'s variant options.')
        : variantPicker());

    return '<section class="admin-panel panel" aria-labelledby="reviewDecisionTitle">' +
      '<h4 class="admin-subhead" id="reviewDecisionTitle">Reviewer decision</h4>' +
      '<p class="panel-note">Nothing here is filled in from the evidence above. The database validates every value ' +
      'again — a slug that is taken, a GTIN that is already recorded, a category that does not exist — and its ' +
      'refusal is what this page reports.</p>' +
      (state.reviewRefsError
        ? '<p class="form-error" role="alert">Some reference lists could not be read: ' + esc(state.reviewRefsError) +
          ' <button type="button" class="link-btn" data-retry-review-references="1">Try again</button></p>'
        : '') +
      '<div class="field">' +
      '<label for="convProductMode">Product</label>' +
      '<select id="convProductMode" data-conversion-field="productMode">' +
      '<option value="create"' + (c.productMode === 'create' ? ' selected' : '') + '>Create a new canonical product</option>' +
      '<option value="existing"' + (c.productMode === 'existing' ? ' selected' : '') + '>Use an existing product</option>' +
      '</select></div>' +
      productBlock +
      '<div class="field">' +
      '<label for="convVariantMode">Variant</label>' +
      '<select id="convVariantMode" data-conversion-field="variantMode">' +
      '<option value="none"' + (c.variantMode === 'none' ? ' selected' : '') + '>No variant — the offer is about the product</option>' +
      '<option value="create"' + (c.variantMode === 'create' ? ' selected' : '') + '>Create a variant</option>' +
      '<option value="existing"' + (c.variantMode === 'existing' ? ' selected' : '') + '>Use an existing variant</option>' +
      '</select></div>' +
      variantBlock +
      convTextarea('reviewNote', 'Review note', c.reviewNote, D.REVIEW_NOTE_MAX,
        'Up to ' + D.REVIEW_NOTE_MAX + ' characters. Stored with the imported record as the reviewer\'s note.') +
      convTextarea('normalizationNote', 'Normalization note', c.normalizationNote, D.NORMALIZATION_NOTE_MAX,
        'Up to ' + D.NORMALIZATION_NOTE_MAX + ' characters. Stored with the conversion: what changed between what ' +
        'the source said and what the canonical record says.') +
      '<div class="admin-actions">' +
      '<button type="button" class="btn-primary" data-conversion-review="1"' + (state.busy ? ' disabled' : '') +
      '>Review this conversion</button></div>' +
      '</section>';
  }

  function conversionConfirmPanel(record) {
    const c = state.conversion || blankConversion();
    const product = c.productMode === 'existing'
      ? 'Use the existing product ' + (D.trim(c.productId) || '(not chosen)')
      : 'Create a product named "' + (D.trim(c.name) || '(no name)') + '" with the slug ' +
        (D.trim(c.slug) || '(no slug)');
    const variant = c.variantMode === 'none'
      ? 'No variant: the offer is about the product'
      : (c.variantMode === 'existing'
        ? 'Use the existing variant ' + (D.trim(c.variantId) || '(not chosen)')
        : 'Create a variant named "' + (D.trim(c.variantName) || '(no name)') + '" with the slug ' +
          (D.trim(c.variantSlug) || '(no slug)'));
    return '<div class="admin-confirm" role="group" aria-labelledby="conversion-confirm-title">' +
      '<h4 id="conversion-confirm-title">Convert this imported record?</h4>' +
      '<p class="admin-confirm-text">The database will write the canonical records below — creating the product ' +
      'and the variant when that is what was chosen — record this decision, move the imported record to approved, ' +
      'and append one event. Nothing is published, no listing and no public deal is created, and no affiliate link ' +
      'is generated.</p>' +
      '<p class="admin-confirm-target">Record: <strong>' +
        esc(record.imported.title || record.id) + '</strong></p>' +
      '<ul class="admin-confirm-list">' +
      '<li>Product: ' + esc(product) + '</li>' +
      '<li>Variant: ' + esc(variant) + '</li>' +
      '<li>Review note: ' + (D.trim(c.reviewNote) ? 'included' : 'none') + '</li>' +
      '<li>Normalization note: ' + (D.trim(c.normalizationNote) ? 'included' : 'none') + '</li>' +
      '</ul>' +
      '<div class="admin-actions">' +
      '<button type="button" class="btn-primary" data-conversion-confirm="1"' + (state.busy ? ' disabled' : '') +
      '>Convert this record</button>' +
      '<button type="button" class="btn-secondary" data-conversion-cancel="1"' + (state.busy ? ' disabled' : '') +
      '>Cancel</button></div></div>';
  }

  function conversionResultPanel() {
    const r = state.conversionResult;
    if (!r) return '';
    return '<section class="admin-panel panel" aria-labelledby="reviewResultTitle">' +
      '<h4 class="admin-subhead" id="reviewResultTitle">This record was converted</h4>' +
      '<dl class="admin-fields">' +
      row('Conversion id', '<code class="admin-code">' + esc(r.conversionId) + '</code>') +
      row('Product', '<code class="admin-code">' + esc(r.productId) + '</code> · ' + esc(r.productMode)) +
      row('Variant', r.variantMode === 'none'
        ? '<span class="admin-muted">None</span>'
        : '<code class="admin-code">' + esc(r.variantId) + '</code> · ' + esc(r.variantMode)) +
      row('Merchant offer', '<code class="admin-code">' + esc(r.offerId) + '</code>') +
      row('Record state now', esc(r.pipelineStatus + ' / ' + r.reviewStatus)) +
      '</dl></section>';
  }

  function reviewRecordView() {
    const back = '<div class="admin-actions admin-detail-top">' +
      '<button type="button" class="link-btn" data-back-to-review-queue="1">← Back to the review queue</button></div>';
    if (state.reviewRecordError) {
      return back + '<div class="admin-panel panel">' +
        '<h3 id="reviewRecordTitle">That record could not be read</h3>' +
        '<p class="panel-text">' + esc(state.reviewRecordError) + '</p>' +
        '<div class="admin-actions"><button type="button" class="btn-primary" data-retry-review-record="1">Try again</button></div></div>';
    }
    if (!state.reviewRecordLoaded) {
      return back + PV.card.loading({
        title: 'Reading the imported record…',
        text: 'Asking the database for what the source recorded, and for this record\'s history.'
      });
    }
    const record = state.reviewRecord;
    if (!record) {
      return back + '<div class="admin-panel panel">' +
        '<h3 id="reviewRecordTitle">No such imported record</h3>' +
        '<p class="panel-text">The database returned no record with that id. It may have been removed, or the ' +
        'address may name something else.</p></div>';
    }
    const eligible = recordEligibleForReview(record);
    return back +
      '<article class="admin-detail panel">' +
      '<header class="admin-detail-head">' +
      '<h3 id="reviewRecordTitle">' + esc(record.imported.title || 'Imported record') + '</h3>' +
      '<span class="admin-detail-type">' + esc(record.id) + '</span>' +
      '</header>' +
      '<p class="panel-text">At pipeline status <code>' + esc(record.pipelineStatus) + '</code> and review status ' +
      '<code>' + esc(record.reviewStatus) + '</code>.</p>' +
      '</article>' +
      reviewEvidencePanel(record) +
      reviewEventsPanel() +
      conversionResultPanel() +
      (eligible
        ? (state.busy ? '<p class="admin-working" role="status">Converting…</p>' : '') +
          decisionPanel() +
          (state.conversionConfirm ? conversionConfirmPanel(record) : '')
        : '<section class="admin-panel panel"><h4 class="admin-subhead">No conversion is offered</h4>' +
          '<p class="panel-text">This record is no longer at <code>pending-review</code> with review status ' +
          '<code>pending</code>, so the database would refuse a conversion and this page does not offer one. ' +
          'The record above is shown read-only, exactly as the database holds it.</p></section>');
  }

  /* -------------------------------------------------- the conversion --- */

  /** Options have to be a JSON object, or they are not sent at all. */
  function parseOptionValues(text) {
    const raw = String(text === undefined || text === null ? '' : text).trim();
    if (!raw) return { ok: true, value: {} };
    let value;
    try {
      value = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: 'That is not valid JSON. Use an object such as {"storage": "128GB"}, or leave it empty.' };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'Options have to be a JSON object, such as {"storage": "128GB"}.' };
    }
    return { ok: true, value: value };
  }

  /**
   * What the form itself must have before it is worth sending: the fields the
   * chosen mode needs, notes within their recorded limits, and options that
   * parse. Everything else — whether a slug is free, whether a GTIN is already
   * recorded, whether a category exists — is the database's, and its answer is
   * what is reported.
   */
  function validateConversion() {
    const c = state.conversion || blankConversion();
    const errors = {};
    if (c.productMode === 'create') {
      if (!D.trim(c.name)) errors.name = 'A new canonical product needs a name.';
      if (!D.trim(c.slug)) errors.slug = 'A new canonical product needs a slug.';
    } else if (!D.trim(c.productId)) {
      errors.productId = 'Choose the existing product this record is about.';
    }
    if (c.variantMode === 'create') {
      if (!D.trim(c.variantName)) errors.variantName = 'A new variant needs a name.';
      if (!D.trim(c.variantSlug)) errors.variantSlug = 'A new variant needs a slug.';
    } else if (c.variantMode === 'existing' && !D.trim(c.variantId)) {
      errors.variantId = 'Choose the existing variant this offer is for.';
    }
    if (String(c.reviewNote).length > D.REVIEW_NOTE_MAX) {
      errors.reviewNote = 'That note is longer than ' + D.REVIEW_NOTE_MAX + ' characters.';
    }
    if (String(c.normalizationNote).length > D.NORMALIZATION_NOTE_MAX) {
      errors.normalizationNote = 'That note is longer than ' + D.NORMALIZATION_NOTE_MAX + ' characters.';
    }
    const options = parseOptionValues(c.optionValuesText);
    if (c.variantMode === 'create' && !options.ok) errors.optionValuesText = options.error;
    return { errors: errors, optionValues: options.ok ? options.value : {} };
  }

  function openConversionConfirm() {
    if (state.busy) return;
    const checked = validateConversion();
    state.conversionErrors = checked.errors;
    if (Object.keys(checked.errors).length) {
      const first = Object.keys(checked.errors)[0];
      state.message = 'Some fields need attention before this can be sent.';
      state.messageTone = 'warning';
      focusAfterRender = '[data-conversion-field="' + first + '"]';
      render();
      return;
    }
    state.message = '';
    state.conversionConfirm = true;
    focusAfterRender = '[data-conversion-confirm]';
    render();
  }

  function cancelConversionConfirm() {
    state.conversionConfirm = false;
    focusAfterRender = '[data-conversion-review]';
    render();
  }

  /**
   * The database's own refusal, in the database's own words.
   *
   * 0010's messages were written for the person doing the review — a slug
   * another product already uses, a GTIN that belongs on the variant, a record
   * that is not at pending review — so they are exactly what belongs here. They
   * are escaped before they are rendered, never treated as markup, and the
   * seller flow's wording ("someone else changed it", "that application is no
   * longer in the database") is never used for this call.
   */
  function conversionMessageFor(err) {
    const dbCode = err && err.dbCode ? String(err.dbCode) : '';
    const dbMessage = err && typeof err.dbMessage === 'string' ? err.dbMessage : '';
    if (dbCode === '42501') {
      return dbMessage || 'The database refused this: only an administrator can convert an imported record.';
    }
    if (dbCode === '22023' || dbCode === '23505' || dbCode === 'P0002' || dbCode === '22001') {
      if (dbMessage) return dbMessage;
    }
    const code = err && err.code ? err.code : '';
    if (code === 'api-not-configured') {
      return 'The admin panel needs the live database connection. This build is running on the bundled demonstration catalogue.';
    }
    if (code === 'not-signed-in') return 'Sign in again to continue.';
    if (code === 'api-401' || code === 'api-403') {
      return dbMessage || 'The database refused this: only an administrator can convert an imported record.';
    }
    if (code === 'api-unreachable') return 'We could not reach the database. Check your connection and try again.';
    if (dbMessage) return dbMessage;
    return 'The conversion did not go through and nothing was changed. Try again in a moment.';
  }

  function submitConversion() {
    /* One conversion per record: a second click carries no second decision, so
       it is dropped before a request is built, whatever a browser does with a
       disabled button. */
    if (state.busy) return;
    const s = session();
    const record = state.reviewRecord;
    if (!s || !record) return;
    const checked = validateConversion();
    state.conversionErrors = checked.errors;
    if (Object.keys(checked.errors).length) {
      const first = Object.keys(checked.errors)[0];
      state.conversionConfirm = false;
      state.message = 'Some fields need attention before this can be sent.';
      state.messageTone = 'warning';
      focusAfterRender = '[data-conversion-field="' + first + '"]';
      render();
      return;
    }
    const input = Object.assign({}, state.conversion, { optionValues: checked.optionValues });
    state.busy = true;
    state.message = '';
    render();
    PV.store.dealEngine.convert(s, record.id, input).then(function (result) {
      state.busy = false;
      state.conversionConfirm = false;
      if (!result) {
        /* The request came back without 0010's whole answer. Nothing is
           reported as done, and the typed values stay exactly where they are. */
        state.message = 'The database did not return a complete conversion result, so nothing is reported as ' +
          'done. Reload this record before deciding anything again.';
        state.messageTone = 'warning';
        announceFailure();
        return null;
      }
      state.conversionResult = result;
      state.message = 'Converted. Product ' + result.productId + ' (' + result.productMode + ')' +
        (result.variantMode === 'none'
          ? ', no variant'
          : ', variant ' + result.variantId + ' (' + result.variantMode + ')') +
        ', merchant offer ' + result.offerId + '. The database reports this record as ' +
        result.pipelineStatus + ' / ' + result.reviewStatus + '.';
      state.messageTone = 'good';
      PV.ui.announce(state.message);
      PV.ui.toast(state.message);
      /* Read it all back: what the database holds is what is shown. The
         decision stays on screen while that happens — it is what was just
         recorded, not a stale copy of it. */
      return Promise.all([loadReviewRecord(true), loadReviewQueue(), loadCounts()]).then(function () {
        const fresh = state.reviewRecord;
        if (recordEligibleForReview(fresh)) {
          state.message = state.message + ' The database still reports this record as pending review, so it ' +
            'remains in the queue.';
          state.messageTone = 'warning';
        }
        render();
      });
    }).catch(function (err) {
      state.busy = false;
      state.conversionConfirm = false;
      state.message = conversionMessageFor(err);
      state.messageTone = 'warning';
      announceFailure();
    });
  }

  function openReviewRecord(id) {
    /* The id comes from a record the database returned, and it is still checked
       against the same shape the address is: what cannot be an id is not sent
       as one. */
    if (!UUID.test(String(id || ''))) return;
    state.selectedId = id;
    state.message = '';
    state.messageTone = 'neutral';
    state.reviewRecord = null;
    state.reviewRecordLoaded = false;
    state.reviewRecordError = '';
    state.reviewEvents = [];
    state.reviewEventsLoaded = false;
    state.reviewVariants = [];
    state.reviewVariantsFor = '';
    state.reviewVariantsLoaded = false;
    state.conversion = null;
    state.conversionErrors = {};
    state.conversionConfirm = false;
    state.conversionResult = null;
    writeAddress();
    focusAfterRender = '#reviewRecordTitle';
    render();
    loadReviewRecord();
  }

  function backToReviewQueue() {
    state.selectedId = '';
    state.reviewRecord = null;
    state.reviewRecordLoaded = false;
    state.reviewRecordError = '';
    state.reviewEvents = [];
    state.reviewEventsLoaded = false;
    state.reviewVariants = [];
    state.reviewVariantsFor = '';
    state.reviewVariantsLoaded = false;
    state.conversion = null;
    state.conversionErrors = {};
    state.conversionConfirm = false;
    state.conversionResult = null;
    writeAddress();
    focusAfterRender = '#reviewQueueTitle';
    render();
    loadReviewQueue();
  }

  /**
   * Keystrokes are kept, and the form is redrawn only when the choice changes
   * which fields exist at all — a redraw takes the cursor with it, so the field
   * that caused it is focused again.
   */
  function onConversionField(e) {
    const field = e.target.closest('[data-conversion-field]');
    if (!field || !state.conversion) return;
    const name = field.getAttribute('data-conversion-field');
    const hadError = !!state.conversionErrors[name];
    state.conversion[name] = field.value;
    if (hadError) {
      delete state.conversionErrors[name];
      render();
      return;
    }
    if (name !== 'productMode' && name !== 'variantMode' && name !== 'categoryId' && name !== 'productId') return;
    if (name === 'productMode' || name === 'variantMode' || name === 'categoryId') {
      if (name === 'categoryId') state.conversion.subcategoryId = '';
      focusAfterRender = '[data-conversion-field="' + name + '"]';
      render();
      /* Choosing "existing" after the product is already chosen still needs
         that product's variants, and there is no reason to make the reviewer
         reselect the same product to get them. */
      if (name === 'variantMode' && state.conversion.variantMode === 'existing' &&
          D.trim(state.conversion.productId) &&
          (!state.reviewVariantsLoaded || state.reviewVariantsFor !== D.trim(state.conversion.productId))) {
        loadReviewVariants(D.trim(state.conversion.productId));
      }
      return;
    }
    /* A different product means a different set of variants, and the variant
       that was chosen belonged to the previous one. */
    state.conversion.variantId = '';
    state.reviewVariants = [];
    state.reviewVariantsLoaded = false;
    state.reviewVariantsFor = '';
    focusAfterRender = '[data-conversion-field="productId"]';
    render();
    if (state.conversion.variantMode === 'existing' && D.trim(state.conversion.productId)) {
      loadReviewVariants(D.trim(state.conversion.productId));
    }
  }

  /* ------------------------------------------------------------- wiring -- */
  root.addEventListener('click', function (e) {
    const target = e.target;

    const nav = target.closest('[data-admin-nav]');
    if (nav) {
      const goPending = nav.hasAttribute('data-go-pending');
      goToSection(nav.getAttribute('data-admin-nav'), goPending ? { filter: 'pending' } : {});
      return;
    }
    const tab = target.closest('[data-admin-filter]');
    if (tab) {
      state.filter = tab.getAttribute('data-admin-filter');
      state.selectedId = '';
      state.message = '';
      writeAddress();
      render();
      loadQueue();
      return;
    }
    const open = target.closest('[data-admin-open]');
    if (open) { openApplication(open.getAttribute('data-admin-open')); return; }
    if (target.closest('[data-back-to-queue]')) { backToQueue(); return; }
    const review = target.closest('[data-review-action]');
    if (review) { beginAction(review.getAttribute('data-review-action')); return; }
    if (target.closest('[data-cancel-action]')) { cancelAction(); return; }
    if (target.closest('[data-confirm-action]')) { confirmAction(); return; }
    if (target.closest('[data-new-source]')) { openSourceForm('create'); return; }
    const edit = target.closest('[data-edit-source]');
    if (edit) {
      const wanted = edit.getAttribute('data-edit-source');
      const found = state.sources.filter((source) => source.id === wanted)[0];
      if (found) openSourceForm('edit', found);
      return;
    }
    if (target.closest('[data-cancel-source-form]')) { cancelSourceForm(); return; }
    if (target.closest('[data-retry-jobs]')) { loadJobs(); return; }
    if (target.closest('[data-retry-catalogue]')) { loadCatalogue(); return; }
    if (target.closest('[data-retry-counts]')) { loadCounts(); return; }
    if (target.closest('[data-retry-sources]')) { loadSources(); return; }
    if (target.closest('[data-retry-queue]')) { loadQueue(); return; }
    if (target.closest('[data-retry-detail]')) { loadDetail(); return; }
    if (target.closest('[data-retry-access]')) { render(); return; }

    /* Import Deals (Step 17B). */
    if (target.closest('[data-retry-imports]')) { loadImports(); return; }
    /* The review queue (Step 17A). */
    const openReview = target.closest('[data-admin-open-review]');
    if (openReview) { openReviewRecord(openReview.getAttribute('data-admin-open-review')); return; }
    if (target.closest('[data-back-to-review-queue]')) { backToReviewQueue(); return; }
    if (target.closest('[data-retry-review-queue]')) { loadReviewQueue(); return; }
    if (target.closest('[data-retry-review-record]')) { loadReviewRecord(); return; }
    if (target.closest('[data-retry-review-references]')) { loadReviewReferences(); return; }
    if (target.closest('[data-conversion-review]')) { openConversionConfirm(); return; }
    if (target.closest('[data-conversion-cancel]')) { cancelConversionConfirm(); return; }
    if (target.closest('[data-conversion-confirm]')) { submitConversion(); return; }
  });

  /* Keystrokes in the note field are kept, so a re-render never loses them. */
  root.addEventListener('input', function (e) {
    if (e.target.id === 'reviewNote') {
      state.note = e.target.value;
      state.noteError = '';
    }
  });

  /**
   * The source form's fields. Every keystroke is kept in the state, and the
   * view is *not* re-rendered while the operator types — a re-render would
   * take the cursor with it. What does change in place: the explanation under
   * the type and state lists, and an error message for a field being corrected.
   */
  function onSourceField(e) {
    const field = e.target.closest('[data-source-field]');
    if (!field || !state.form) return;
    const name = field.getAttribute('data-source-field');
    state.form.values[name] = field.value;

    if (name === 'sourceType' || name === 'status') {
      const help = U.$('#' + name + 'Help');
      const copy = name === 'sourceType' ? D.dealSourceTypeCopy(field.value) : D.dealSourceStatusCopy(field.value);
      if (help) help.textContent = copy.blurb;
    }

    if (state.form.errors[name]) {
      delete state.form.errors[name];
      field.removeAttribute('aria-invalid');
      const box = field.parentNode ? field.parentNode.querySelector('.form-error') : null;
      if (box) box.remove();
    }
  }
  root.addEventListener('input', onSourceField);
  root.addEventListener('change', onSourceField);
  root.addEventListener('input', onConversionField);
  root.addEventListener('change', onConversionField);

  root.addEventListener('submit', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('admin-source-form')) {
      e.preventDefault();
      saveSource();
    }
  });

  /* The session is the only thing that can change what this page may show.
     When the person changes — arriving from a restored session, signing in, or
     signing out — everything read for the previous person is dropped.

     What is NOT dropped: the section, the filter and the application id from
     the address. Those are the operator's intent, they are validated when they
     are read, and they reveal nothing: if the id is not one this session may
     see, the detail view says there is no such application. */
  let lastUser = null;
  let loadedFor = null;

  function forgetData() {
    state.counts = null;
    state.countsError = '';
    state.sources = [];
    state.sourcesLoaded = false;
    state.sourcesError = '';
    state.form = null;
    state.jobs = [];
    state.jobsLoaded = false;
    state.jobsError = '';
    state.importedTotal = null;
    state.imports = [];
    state.importsTotal = null;
    state.importsMore = false;
    state.importsLoaded = false;
    state.importsError = '';
    state.queue = [];
    state.queueLoaded = false;
    state.queueMore = false;
    state.queueError = '';
    state.detail = null;
    state.detailLoaded = false;
    state.detailError = '';
    state.action = null;
    state.note = '';
    state.noteError = '';
    state.reviewQueue = [];
    state.reviewQueueTotal = null;
    state.reviewQueueMore = false;
    state.reviewQueueLoaded = false;
    state.reviewQueueError = '';
    state.reviewRecord = null;
    state.reviewRecordLoaded = false;
    state.reviewRecordError = '';
    state.reviewEvents = [];
    state.reviewEventsLoaded = false;
    state.reviewTaxonomyLoaded = false;
    state.reviewTaxonomy = [];
    state.reviewProducts = [];
    state.reviewProductsTotal = null;
    state.reviewVariants = [];
    state.reviewVariantsFor = '';
    state.reviewVariantsLoaded = false;
    state.conversion = null;
    state.conversionErrors = {};
    state.conversionConfirm = false;
    state.conversionResult = null;
    state.message = '';
  }

  auth.onChange(function (snap) {
    const userId = snap && snap.user ? snap.user.id : null;
    if (userId !== lastUser) {
      lastUser = userId;
      loadedFor = null;
      forgetData();
    }
    render();
    /* Load once the database has confirmed an administrator: the role may
       arrive after the user does, so this cannot be keyed on the user alone. */
    if (userId && isAdmin() && loadedFor !== userId) {
      loadedFor = userId;
      loadForSection();
    }
  });

  /* An administrator signing in elsewhere in the tab, or a role read that
     arrives late, must be able to open the panel without a reload. */
  function start() {
    /* The same header and footer as every other PickVanta page: the admin
       panel is the operational side of this site, not a separate product. */
    PV.ui.mountChrome('admin');
    readAddress();
    render();
    if (isAdmin()) {
      loadedFor = lastUser;
      loadForSection();
    }
  }

  return {
    start: start,
    /* exposed for the page and for verification */
    state: state,
    messageFor: messageFor
  };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { PV.admin.start(); });
} else {
  PV.admin.start();
}
