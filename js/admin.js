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
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SECTIONS = ['dashboard', 'sellers', 'sources'];

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
        { id: 'products', label: 'Products' },
        { id: 'categories', label: 'Categories' },
        { id: 'deals', label: 'Deals' }
      ]
    },
    {
      label: 'Deal Engine',
      items: [
        { id: 'sources', label: 'Sources', active: true },
        { id: 'imports', label: 'Import Deals' },
        { id: 'review', label: 'Review Queue' },
        { id: 'scans', label: 'Scheduled Scans' },
        { id: 'affiliates', label: 'Affiliate Links' },
        { id: 'history', label: 'Import History' }
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
      'None of them is built yet, and none of them is clickable. The Deal Engine is ' +
      'its foundation only: sources can be listed, and no connector reads one.</p>' +
      '</nav>'
    );
  }

  function activeSectionTitle() {
    if (state.section === 'sellers') return state.selectedId ? 'Application' : 'Seller & provider review';
    if (state.section === 'sources') return 'Sources';
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
     come from. It reads real rows, and says plainly that nothing imports
     anything yet — no connector, no scraper, no schedule, no affiliate
     network. Nothing on this page contacts an endpoint; a recorded URL is
     shown as a reference an operator may open, never fetched by the page.
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

  function sourcesView() {
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
      'review queue for an administrator. Configure a source in the database (see the README) until a ' +
      'connector exists.</p>' +
      '<p class="panel-note">A source row never carries a credential: an agreement’s key or token belongs ' +
      'in the server environment. This page does not even ask the database for a source’s configuration, ' +
      'so there is nothing here to leak.</p>' +
      '</div>';

    if (!state.sources.length) {
      return head +
        '<div class="admin-panel panel">' +
        '<h3>No sources are configured</h3>' +
        '<p class="panel-text">None is recorded in the database, so there is nothing to list. A source ' +
        'is added by an operator with SQL for now; the panel does not create them, and no credential is ' +
        'ever stored in a source row or in this page.</p>' +
        '</div>' + pipelineStrip();
    }

    return head +
      '<table class="admin-table">' +
      '<caption class="visually-hidden">Deal Engine sources, by name</caption>' +
      '<thead><tr>' +
      '<th scope="col">Source</th><th scope="col">Type</th><th scope="col">Provider</th>' +
      '<th scope="col">Market</th><th scope="col">Endpoint</th><th scope="col">Status</th>' +
      '<th scope="col">Added</th>' +
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
          '<td data-label="Status"><span class="status-pill status-' + esc(status.tone) + '">' +
            esc(status.label) + '</span></td>' +
          '<td data-label="Added">' + esc(formatDateTime(source.createdAt)) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>' +
      '<p class="admin-table-foot">' + state.sources.length + ' source' +
      (state.sources.length === 1 ? '' : 's') + ' recorded. Imported deals are a later stage — the ' +
      'records and their history are already modelled in the database, and no interface reads them yet.</p>' +
      pipelineStrip();
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
    } else if (state.section === 'sources') {
      main = sourcesView();
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

  function loadForSection() {
    if (!isAdmin()) return Promise.resolve();
    if (state.section === 'sellers') {
      return Promise.all([loadCounts(), state.selectedId ? loadDetail() : loadQueue()]);
    }
    if (state.section === 'sources') return loadSources();
    return loadCounts();
  }

  /* ----------------------------------------------------------- actions --- */
  function goToSection(id, options) {
    const o = options || {};
    state.section = SECTIONS.indexOf(id) !== -1 ? id : 'dashboard';
    state.message = '';
    state.action = null;
    state.note = '';
    state.noteError = '';
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
    if (target.closest('[data-retry-counts]')) { loadCounts(); return; }
    if (target.closest('[data-retry-sources]')) { loadSources(); return; }
    if (target.closest('[data-retry-queue]')) { loadQueue(); return; }
    if (target.closest('[data-retry-detail]')) { loadDetail(); return; }
    if (target.closest('[data-retry-access]')) { render(); return; }
  });

  /* Keystrokes in the note field are kept, so a re-render never loses them. */
  root.addEventListener('input', function (e) {
    if (e.target.id === 'reviewNote') {
      state.note = e.target.value;
      state.noteError = '';
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
