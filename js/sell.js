/* ==========================================================================
   PickVanta — Seller / provider application (sell.html)
   --------------------------------------------------------------------------
   A person who is signed in can apply to sell products or provide services.
   The application is written to the database as a 'pending' account and stays
   that way until a PickVanta administrator reviews it.

   What this controller does NOT do, on purpose:
     • it never chooses a status, an owner or a catalogue link — it does not
       send those fields at all, and the database would refuse them;
     • it never publishes a listing;
     • it never decides whether an application is approved.

   Every request goes through js/store.js (the only module that talks to the
   data source) with the person's own session, so Row Level Security is what
   actually allows or refuses the write. This page can only ask.
   ========================================================================== */
PV.util.ready(function () {
  PV.ui.mountChrome('sell');

  const U = PV.util;
  const D = PV.domain;
  const auth = PV.auth;
  const root = U.$('#sellRoot');
  if (!root) return;

  /* Which account type the form is for. A view concern, not an account fact:
     nothing is written until the person submits. */
  let choice = '';
  /* An application being edited (its id), or '' when submitting a new one. */
  let editing = '';
  /* Something the person must read that is not about a single field — an
     update the database refused, for instance. The form's error slot does not
     exist once the page is back on the list of applications, so a message of
     that kind needs a home of its own. */
  let notice = '';
  let accounts = [];
  let loaded = false;
  let loadError = '';

  const esc = U.esc;

  /* ------------------------------------------------------------------ view -- */
  function field(id, label, type, autocomplete, extra, help, value) {
    return (
      '<div class="field">' +
      '<label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" name="' + id + '" type="' + type + '"' +
      ' autocomplete="' + autocomplete + '"' +
      ' aria-describedby="' + id + '-help"' +
      (extra || '') +
      ' value="' + esc(value || '') + '" />' +
      '<p class="field-help" id="' + id + '-help">' + esc(help || '') + '</p>' +
      '</div>'
    );
  }

  function textArea(id, label, extra, help, value) {
    return (
      '<div class="field">' +
      '<label for="' + id + '">' + esc(label) + '</label>' +
      '<textarea id="' + id + '" name="' + id + '" rows="4" aria-describedby="' + id + '-help"' + (extra || '') + '>' +
      esc(value || '') +
      '</textarea>' +
      '<p class="field-help" id="' + id + '-help">' + esc(help || '') + '</p>' +
      '</div>'
    );
  }

  /** The two ways a person can participate, as a real radio group. */
  function choiceStep() {
    const types = D.SELLER_ACCOUNT_TYPES;
    return (
      '<div class="sell-step">' +
      '<h2 class="sell-step-title">How would you like to join?</h2>' +
      '<p class="sell-step-lead">PickVanta lists products and services. The account works the same way; ' +
      'the wording and the details we ask for change with your answer.</p>' +
      '<fieldset class="choice-set">' +
      '<legend class="visually-hidden">Choose whether you sell products or provide services</legend>' +
      '<div class="choice-grid">' +
      types.map(function (type) {
        const copy = D.sellerAccountCopy(type);
        const id = 'accountType-' + type;
        return '<label class="choice-card' + (choice === type ? ' is-on' : '') + '" for="' + id + '">' +
          '<input type="radio" id="' + id + '" name="accountType" value="' + esc(type) + '"' +
          (choice === type ? ' checked' : '') + ' data-account-type />' +
          '<span class="choice-icon" aria-hidden="true">' + (type === 'seller' ? '🏬' : '🛠️') + '</span>' +
          '<strong>' + esc(copy.title) + '</strong>' +
          '<span class="choice-blurb">' + esc(copy.blurb) + '</span>' +
          '</label>';
      }).join('') +
      '</div>' +
      '</fieldset>' +
      '</div>'
    );
  }

  /** The business details. Labels and prompts follow the account type. */
  function detailsStep(account) {
    const copy = D.sellerAccountCopy(account.accountType) || D.sellerAccountCopy(choice) || D.sellerAccountCopy('seller');
    const a = account || {};
    const loc = a.location || {};
    const suffix = account.accountType || choice || 'seller';
    return (
      '<div class="sell-step">' +
      '<h2 class="sell-step-title">' + (account.id ? 'Edit your application' : 'Tell us about your business') + '</h2>' +
      '<p class="sell-step-lead">Required fields are the name and the type. Everything else helps the review ' +
      'go faster, and you can add it later while the application is pending.</p>' +
      '<form id="sellForm" novalidate>' +
      '<div class="form-row">' +
      field('businessName', copy.nameLabel, 'text', 'organization',
        ' required maxlength="120"', copy.namePlaceholder ? 'For example: ' + copy.namePlaceholder.replace(/^e\.g\.\s*/, '') + '.' : '',
        a.businessName) +
      '</div>' +
      textArea('businessDescription', copy.descriptionLabel, ' maxlength="2000"',
        'A sentence or two. This is for the review — it is not published by this page.',
        a.description) +
      '<div class="form-row">' +
      field('contactEmail', 'Contact email', 'email', 'email', ' maxlength="254"',
        'How PickVanta reaches you. Not shown publicly.', a.contactEmail) +
      field('contactPhone', 'Contact phone', 'tel', 'tel', ' maxlength="40"',
        'Optional. Not shown publicly.', a.contactPhone) +
      '</div>' +
      field('website', 'Website', 'url', 'url', ' maxlength="300"',
        'Optional, and it must start with http:// or https://', a.website) +
      '<h3 class="sell-subhead">Where you operate</h3>' +
      '<p class="sell-sublead">The same location structure the catalogue uses, so an approved account can be listed without retyping anything.</p>' +
      '<div class="form-row">' +
      field('country', 'Country', 'text', 'country-name', ' maxlength="80"', '', loc.country || D.DEFAULT_COUNTRY) +
      field('county', 'County or region', 'text', 'address-level1', ' maxlength="80"', '', loc.county) +
      '</div>' +
      '<div class="form-row">' +
      field('city', 'City or town', 'text', 'address-level2', ' maxlength="80"', '', loc.city) +
      field('area', 'Area or neighbourhood', 'text', 'address-level3', ' maxlength="80"', 'Optional.', loc.area) +
      '</div>' +
      '<p class="form-error" id="sellError" role="alert" hidden></p>' +
      '<div class="sell-actions">' +
      '<button type="submit" class="btn-primary btn-large" id="sellSubmit">' +
      (account.id ? 'Save changes' : 'Submit application') + '</button>' +
      '</div>' +
      '<p class="sell-note">Submitting does not publish anything and does not grant any special access. ' +
      'Your application is marked <strong>pending review</strong> until a PickVanta administrator looks at it.</p>' +
      '</form>' +
      '</div>' +
      '<span class="visually-hidden" data-sell-type="' + esc(suffix) + '"></span>'
    );
  }

  /** A status block: what state the account is in, in plain words. */
  function statusBlock(account) {
    const status = account.statusCopy;
    return (
      '<div class="sell-status status-' + esc(status.tone) + '">' +
      '<span class="status-pill status-' + esc(status.tone) + '">' + esc(status.label) + '</span>' +
      '<p>' + esc(status.message) + '</p>' +
      (account.reviewNote
        ? '<p class="status-note"><strong>Note from PickVanta:</strong> ' + esc(account.reviewNote) + '</p>'
        : '') +
      '</div>'
    );
  }

  /** The list of applications this person already has. */
  function accountsView() {
    return (
      '<div class="sell-stack">' +
      (notice ? '<p class="form-error sell-notice" role="alert">' + esc(notice) + '</p>' : '') +
      accounts.map(function (account) {
        const copy = D.sellerAccountCopy(account.accountType);
        const where = [account.location.city, account.location.county]
          .filter(Boolean).join(', ');
        return (
          '<article class="sell-card panel">' +
          '<header class="sell-card-head">' +
          '<div>' +
          '<span class="sell-card-type">' + esc(account.accountTypeLabel) + '</span>' +
          '<h2>' + esc(account.businessName) + '</h2>' +
          (where ? '<p class="sell-card-where">' + esc(where) + '</p>' : '') +
          '</div>' +
          '<span class="status-pill status-' + esc(account.statusCopy.tone) + '">' + esc(account.statusCopy.label) + '</span>' +
          '</header>' +
          statusBlock(account) +
          (account.status === 'pending'
            ? '<div class="sell-card-actions">' +
              '<button type="button" class="btn-secondary" data-edit-account="' + esc(account.id) + '">Edit details</button>' +
              '</div>'
            : '') +
          (account.status === 'active'
            ? '<p class="sell-card-foot">Listing tools are a later stage. Nothing is published from this page yet.</p>'
            : '') +
          '</article>'
        );
      }).join('') +
      '<div class="sell-add">' +
      '<p>Have another business to add? You can hold more than one PickVanta account.</p>' +
      '<button type="button" class="btn-secondary" data-new-account="1">Start another application</button>' +
      '</div>' +
      '</div>'
    );
  }

  function loading(title, text) {
    return PV.card.loading({
      title: title || 'Checking your application…',
      text: text || 'Confirming your account with the account service.'
    });
  }

  /* Shown when nobody is signed in: the catalogue never needs an account, but
     applying does. */
  function needSignIn() {
    return (
      '<div class="sell-panel panel">' +
      '<h2>Sign in to apply</h2>' +
      '<p class="panel-text">Applying to sell or provide needs a PickVanta account, so we know who the ' +
      'application belongs to. Browsing, searching and comparing never need one.</p>' +
      '<div class="auth-actions">' +
      '<a class="btn-primary btn-large" href="account.html">Sign in or create an account</a>' +
      '<a class="btn-secondary btn-large" href="discover.html">Browse the catalogue instead</a>' +
      '</div>' +
      '</div>'
    );
  }

  /** Demonstration mode has no project: applications genuinely cannot work. */
  function unavailable() {
    return (
      '<div class="sell-panel panel">' +
      '<h2>Applications need the live catalogue</h2>' +
      '<p class="panel-text">This build is running on the bundled demonstration catalogue, so there is no ' +
      'account service to receive an application. Nothing here pretends otherwise.</p>' +
      '<p class="panel-text small">The catalogue, Deals and Guides are fully available without an account.</p>' +
      '<div class="auth-actions">' +
      '<a class="btn-primary btn-large" href="discover.html">Browse the catalogue</a>' +
      '</div>' +
      '</div>'
    );
  }

  function loadFailure() {
    return (
      '<div class="sell-panel panel">' +
      '<h2>We could not load your applications</h2>' +
      '<p class="panel-text">' + esc(loadError || 'The account service could not be reached just now.') + '</p>' +
      '<div class="auth-actions">' +
      '<button type="button" class="btn-primary btn-large" data-retry="1">Try again</button>' +
      '</div>' +
      '</div>'
    );
  }

  /* ---------------------------------------------------------------- render -- */

  function render(snap) {
    if (!snap) { root.innerHTML = loading(); return; }

    if (!snap.available) { root.innerHTML = unavailable(); return; }

    if (!snap.checked) { root.innerHTML = loading(); return; }

    if (!snap.user) { root.innerHTML = needSignIn(); return; }

    if (!loaded) {
      /* An application form for a project that cannot store it would be a lie. */
      if (!PV.store.sellerAccounts.available()) { root.innerHTML = unavailable(); return; }
      root.innerHTML = loading('Loading your applications…', 'Reading your applications from the account service.');
      return;
    }

    if (loadError) { root.innerHTML = loadFailure(); return; }

    /* Editing an existing application, or a fresh one. */
    const editingAccount = editing ? accounts.filter((a) => a.id === editing)[0] : null;
    if (editingAccount || choice) {
      const account = editingAccount || { accountType: choice, id: '' };
      root.innerHTML =
        '<div class="sell-shell">' +
        (account.id
          ? '<div class="sell-back"><button type="button" class="link-btn" data-cancel-edit="1">← Back to your applications</button></div>'
          : '<div class="sell-back"><button type="button" class="link-btn" data-cancel-choice="1">← Choose a different option</button></div>') +
        detailsStep(account) +
        '</div>';
      return;
    }

    if (accounts.length) { root.innerHTML = accountsView(); return; }

    root.innerHTML = '<div class="sell-shell">' + choiceStep() + '</div>';
  }

  /* --------------------------------------------------------------- actions -- */

  async function loadAccounts(toastMessage) {
    loadError = '';
    const session = auth.session();
    if (!session) {
      loaded = true;
      render(auth.state());
      return;
    }
    try {
      accounts = await PV.store.sellerAccounts.mine(session);
      loaded = true;
      loadError = '';
      render(auth.state());
      if (toastMessage) PV.ui.toast(toastMessage);
    } catch (err) {
      loaded = true;
      /* A store failure is never dressed up as "no applications yet": that
         would invite somebody to apply twice. */
      loadError = 'We could not reach the account service. Check your connection and try again.';
      if (err && err.code === 'api-not-configured') loadError = '';
      render(auth.state());
    }
  }

  function readValue(id) {
    const input = U.$('#' + id);
    return input ? input.value : '';
  }

  function collect() {
    return {
      accountType: (U.$('input[name="accountType"]:checked') || {}).value || (accounts.filter((a) => a.id === editing)[0] || {}).accountType || choice,
      businessName: readValue('businessName'),
      description: readValue('businessDescription'),
      contactEmail: readValue('contactEmail'),
      contactPhone: readValue('contactPhone'),
      website: readValue('website'),
      location: {
        country: readValue('country'),
        county: readValue('county'),
        city: readValue('city'),
        area: readValue('area')
      }
    };
  }

  function showError(message) {
    const host = U.$('#sellError');
    if (!host) return;
    host.textContent = message;
    host.hidden = false;
  }

  function clearError() {
    const host = U.$('#sellError');
    if (!host) return;
    host.textContent = '';
    host.hidden = true;
  }

  /* Marks the field the message is about, so a screen reader and the border
     point at the same input. */
  const FIELD_FOR_ISSUE = {
    'account-type-invalid': 'accountType-seller',
    'account-name-missing': 'businessName',
    'account-name-too-long': 'businessName',
    'account-description-too-long': 'businessDescription',
    'account-email-invalid': 'contactEmail',
    'account-phone-too-long': 'contactPhone',
    'account-website-invalid': 'website',
    'account-country-too-long': 'country',
    'account-county-too-long': 'county',
    'account-city-too-long': 'city',
    'account-area-too-long': 'area'
  };

  function markInvalid(fieldId) {
    ['businessName', 'businessDescription', 'contactEmail', 'contactPhone', 'website',
      'country', 'county', 'city', 'area'].forEach(function (id) {
      const input = U.$('#' + id);
      if (!input) return;
      if (id === fieldId) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    });
  }

  function focusField(id) {
    const input = U.$('#' + id);
    if (input) input.focus();
  }

  function setBusy(busy) {
    const button = U.$('#sellSubmit');
    if (!button) return;
    button.disabled = busy;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = editing ? 'Saving…' : 'Submitting…';
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
    }
  }

  async function submit(event) {
    event.preventDefault();
    clearError();

    const input = collect();
    const check = D.validateSellerAccount(input);
    if (!check.valid) {
      const first = check.issues.filter((i) => i.severity !== 'warning')[0] || check.issues[0];
      const fieldId = FIELD_FOR_ISSUE[first.code] || 'businessName';
      showError(first.message);
      markInvalid(fieldId);
      focusField(fieldId);
      PV.ui.announce(first.message);
      return;
    }

    const session = auth.session();
    if (!session) {
      /* The session ended while the form was open: say so rather than losing
         the text silently. */
      showError('Your session has ended. Sign in again and submit the application.');
      return;
    }

    setBusy(true);
    try {
      if (editing) {
        /* The update names the caller's own row and filters on it, so an empty
           answer means the row was not editable any more — approved, suspended
           or gone. Saying "updated" then would be a claim the database did not
           make, so the page reports what actually happened instead. */
        const updated = await PV.store.sellerAccounts.update(session, editing, input);
        if (!updated) {
          notice = 'That application could not be updated — it may have been reviewed or changed ' +
            'since this page was opened. It is shown below with its current status.';
          setBusy(false);
          editing = '';
          choice = '';
          PV.ui.announce(notice);
          PV.ui.toast(notice);
          await loadAccounts();
          return;
        }
        PV.ui.announce('Application updated.');
        PV.ui.toast('Your application was updated. It is still pending review.');
      } else {
        await PV.store.sellerAccounts.create(session, input);
        PV.ui.announce('Application submitted for review.');
        PV.ui.toast('Application submitted. It is now pending review.');
      }
      editing = '';
      choice = '';
      setBusy(false);
      await loadAccounts();
    } catch (err) {
      setBusy(false);
      showError(messageFor(err));
      PV.ui.announce(messageFor(err));
    }
  }

  /** Every failure becomes one sentence; nothing raw reaches the screen. */
  function messageFor(err) {
    const code = String((err && err.code) || '');
    if (code === 'not-signed-in') return 'Sign in again to submit your application.';
    if (code === 'api-not-configured') return 'Applications need the live catalogue connection.';
    if (code === 'api-401' || code === 'api-403') {
      return 'The account service did not accept that request. Sign in again and try once more.';
    }
    if (code === 'api-409') return 'An application for this account already exists.';
    if (code === 'api-unreachable') {
      return 'We could not reach the account service. Check your connection and try again.';
    }
    return 'We could not submit your application just now. Please try again in a moment.';
  }

  /* --------------------------------------------------------------- wiring -- */

  root.addEventListener('change', (e) => {
    const radio = e.target.closest('[data-account-type]');
    if (!radio) return;
    choice = radio.value;
    editing = '';
    render(auth.state());
    /* Move focus to the first field of the next step so a keyboard user is not
       left at the bottom of the page. */
    const first = U.$('#businessName');
    if (first) first.focus();
  });

  root.addEventListener('submit', (e) => {
    if (e.target.id === 'sellForm') submit(e);
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) { loadAccounts(); return; }
    const editBtn = e.target.closest('[data-edit-account]');
    if (editBtn) {
      notice = '';
      editing = editBtn.getAttribute('data-edit-account');
      choice = '';
      render(auth.state());
      const first = U.$('#businessName');
      if (first) first.focus();
      return;
    }
    if (e.target.closest('[data-new-account]')) {
      notice = '';
      editing = '';
      choice = '';
      render(auth.state());
      return;
    }
    if (e.target.closest('[data-cancel-edit]')) {
      editing = '';
      render(auth.state());
      return;
    }
    if (e.target.closest('[data-cancel-choice]')) {
      choice = '';
      render(auth.state());
    }
  });

  /* Re-read when the session changes: signing in here, or signing out in
     another tab, must not leave a stale application on screen. */
  let lastUser = null;
  auth.onChange(function (snap) {
    const userId = snap && snap.user ? snap.user.id : null;
    if (userId !== lastUser) {
      lastUser = userId;
      accounts = [];
      loaded = false;
      editing = '';
      choice = '';
      if (userId && snap.checked && snap.available) loadAccounts();
    }
    render(snap);
  });

  if (typeof auth.init === 'function') auth.init();
});
