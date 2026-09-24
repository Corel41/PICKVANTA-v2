/* ==========================================================================
   PickVanta — Account view (account.html)
   --------------------------------------------------------------------------
   A deliberately small surface: sign in, create an account, or — when already
   signed in — see the account the database knows about and sign out.

   Every authentication decision is made by js/auth.js. This controller only
   renders the state that layer reports and passes typed input to it, so there
   is no second copy of the authentication logic anywhere.
   ========================================================================== */
PV.util.ready(function () {
  PV.ui.mountChrome('account');

  const root = PV.util.$('#accountRoot');
  if (!root) return;

  const auth = PV.auth;
  /* Which form is on screen. Kept here because it is a view concern, not an
     authentication fact. */
  let view = 'sign-in';

  const esc = PV.util.esc;

  /* ------------------------------------------------------------------ view -- */

  /**
   * One labelled field, with a single help paragraph. `help` is the text for
   * that paragraph — passing it here is what keeps one element per id, which is
   * also what aria-describedby points at.
   */
  function field(id, label, type, autocomplete, extra, help) {
    return (
      '<div class="field">' +
      '<label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" name="' + id + '" type="' + type + '"' +
      ' autocomplete="' + autocomplete + '"' +
      ' aria-describedby="' + id + '-help"' +
      (extra || '') + ' />' +
      '<p class="field-help" id="' + id + '-help">' + esc(help || '') + '</p>' +
      '</div>'
    );
  }

  /* The Google mark, drawn inline: no third-party request, and no dependency.
     Google's own branding guidelines ask for the mark beside the wording, which
     is why it is here rather than an emoji or a letter. */
  const GOOGLE_MARK =
    '<svg class="provider-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">' +
    '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>' +
    '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>' +
    '<path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>' +
    '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>' +
    '</svg>';

  /**
   * The provider controls, above the email form. This is the same button for
   * signing in and for creating an account, because Google decides which of the
   * two it is: the first time the person uses it, an account is created.
   */
  function providerControls(snap) {
    const provider = auth.provider('google');
    if (!provider || !provider.available) return '';

    /* The project said Google is switched off: say so once, quietly, instead of
       offering a control that cannot work. */
    if (provider.enabled === false) {
      return '<div class="provider-block">' +
        '<p class="provider-note">Google sign-in is not enabled for this PickVanta project yet. ' +
        'Use your email address below, or see the README for the Google provider setup.</p>' +
        '</div>';
    }

    return '<div class="provider-block">' +
      '<button type="button" class="btn-provider btn-large" data-provider="google"' +
      (snap && snap.redirecting ? ' disabled' : '') + '>' +
      GOOGLE_MARK + '<span>' + (snap && snap.redirecting ? 'Taking you to Google…' : 'Continue with Google') + '</span>' +
      '</button>' +
      '<p class="provider-help">Google sign-in also creates your account the first time you use it. ' +
      'PickVanta never sees your Google password.</p>' +
      '<div class="provider-divider" role="separator" aria-hidden="true"><span>or</span></div>' +
      '</div>';
  }

  function signInForm() {
    return (
      '<div class="auth-panel panel">' +
      '<h2>Sign in</h2>' +
      '<p class="panel-text small">Use the email address and password you signed up with.</p>' +
      providerControls(auth.state()) +
      '<form id="signInForm" novalidate>' +
      field('signInEmail', 'Email', 'email', 'email', ' required') +
      field('signInPassword', 'Password', 'password', 'current-password', ' required') +
      '<p class="form-error" id="signInError" role="alert" hidden></p>' +
      '<div class="auth-actions">' +
      '<button type="submit" class="btn-primary btn-large" id="signInSubmit">Sign in</button>' +
      '<button type="button" class="btn-secondary btn-large" data-auth-view="sign-up">Create account</button>' +
      '</div>' +
      '</form>' +
      '</div>'
    );
  }

  function signUpForm() {
    return (
      '<div class="auth-panel panel">' +
      '<h2>Create account</h2>' +
      '<p class="panel-text small">An email address and a password is all we ask for.</p>' +
      providerControls(auth.state()) +
      '<form id="signUpForm" novalidate>' +
      field('signUpEmail', 'Email', 'email', 'email', ' required') +
      field('signUpPassword', 'Password', 'password', 'new-password',
        ' required minlength="8"', 'At least 8 characters — longer is better.') +
      field('signUpConfirm', 'Confirm password', 'password', 'new-password', ' required') +
      '<p class="form-error" id="signUpError" role="alert" hidden></p>' +
      '<div class="auth-actions">' +
      '<button type="submit" class="btn-primary btn-large" id="signUpSubmit">Create account</button>' +
      '<button type="button" class="btn-secondary btn-large" data-auth-view="sign-in">Return to sign in</button>' +
      '</div>' +
      '</form>' +
      '</div>'
    );
  }

  /** Demo mode has no project behind it, so accounts genuinely cannot work. */
  function unavailable() {
    return (
      '<div class="auth-wrap">' +
      '<div class="auth-panel panel">' +
      '<h2>Accounts need the live catalogue</h2>' +
      '<p class="panel-text">This build is running on the bundled demonstration catalogue, so there is no ' +
      'account service behind it and signing in is switched off. Nothing here pretends otherwise.</p>' +
      '<p class="panel-text small">Browsing does not need an account: the catalogue, Deals and Guides are ' +
      'fully available without one.</p>' +
      '<div class="auth-actions">' +
      '<a class="btn-primary btn-large" href="discover.html">Browse the catalogue</a>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  /* Shown only while the stored session is being confirmed, so the page never
     flashes a sign-in form at someone who is already signed in. */
  function loading(title, text) {
    return PV.card.loading({
      title: title || 'Checking your session…',
      text: text || 'Confirming your account with the account service.'
    });
  }

  function signedIn(snap) {
    const profile = snap.profile || null;
    const email = (profile && profile.email) || (snap.user && snap.user.email) || '';
    const name = (profile && profile.display_name) || '';
    /* The role shown here is the one the database returned with this user's own
       row. If the profile could not be read, say so rather than guessing. */
    const role = snap.role === 'admin' ? 'Administrator' : snap.role === 'user' ? 'Member' : '';

    const row = (label, value, note) =>
      '<div class="auth-fact"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong>' +
      (note ? '<small>' + esc(note) + '</small>' : '') + '</div>';

    return (
      '<div class="auth-wrap">' +
      '<div class="auth-panel panel">' +
      '<h2>You are signed in</h2>' +
      '<div class="auth-facts">' +
      (name ? row('Display name', name) : '') +
      row('Email', email || 'Not available') +
      row('Account status', 'Signed in') +
      (role
        ? row('Role', role)
        : row('Role', 'Not available', 'Your profile could not be read from the account service.')) +
      '</div>' +
      (snap.message && snap.error ? '<p class="form-error" role="alert">' + esc(snap.message) + '</p>' : '') +
      '<div class="auth-actions">' +
      '<a class="btn-secondary btn-large" href="discover.html">Browse the catalogue</a>' +
      '<button type="button" class="btn-primary btn-large" data-auth-action="sign-out">Sign out</button>' +
      '</div>' +
      '<p class="panel-note">Roles are assigned by PickVanta, not chosen here, and this page cannot change ' +
      'them. Signing out ends the session on this device.</p>' +
      '</div>' +
      '</div>'
    );
  }

  function signedOut() {
    return (
      '<div class="auth-wrap">' +
      '<div class="auth-switch">' +
      '<button type="button" class="small-btn' + (view === 'sign-in' ? ' is-on' : '') + '" data-auth-view="sign-in">Sign in</button>' +
      '<button type="button" class="small-btn' + (view === 'sign-up' ? ' is-on' : '') + '" data-auth-view="sign-up">Create account</button>' +
      '</div>' +
      (view === 'sign-in' ? signInForm() : signUpForm()) +
      '<p class="auth-note">Browsing the catalogue never needs an account. Sign in only when a feature ' +
      'belongs to you.</p>' +
      '</div>'
    );
  }

  /* ---------------------------------------------------------------- render -- */

  function render(snap) {
    if (!snap) { root.innerHTML = loading(); return; }
    if (!snap.available) { root.innerHTML = unavailable(); return; }
    /* Coming back from Google: say what is happening rather than showing a
       sign-in form to somebody who has just signed in. */
    if (snap.redirecting) {
      root.innerHTML = loading('Finishing your Google sign-in…',
        'Confirming the account with Google and the account service.');
      return;
    }
    if (!snap.checked) { root.innerHTML = loading(); return; }
    if (snap.status === 'signed-in') { root.innerHTML = signedIn(snap); return; }
    root.innerHTML = signedOut();
    /* A message carried across a rerender lands in whichever form is on
       screen. Only a return from a provider is carried from the shared layer:
       every other failure is reported by the form that caused it, and showing
       it here as well would say the same thing twice. */
    const text = pendingMessage || (snap.fromProvider ? snap.message : '');
    if (text) {
      const host = PV.util.$('#signInError') || PV.util.$('#signUpError');
      if (host) showError(host, text);
      pendingMessage = '';
    }
  }

  let pendingMessage = '';

  /**
   * The authentication layer emits on every change, and this view rerenders what
   * it reports — so a host captured before an await can be a detached node by
   * the time the answer arrives. Re-resolve it by id, or the message is written
   * into a node nobody can see.
   */
  function mountErrorHost(host) {
    if (!host) return null;
    if (host.id && !host.isConnected) return PV.util.$('#' + host.id);
    return host;
  }

  function showError(host, message) {
    const live = mountErrorHost(host);
    if (!live) return;
    live.textContent = message;
    live.hidden = false;
  }

  function clearError(host) {
    const live = mountErrorHost(host);
    if (!live) return;
    live.textContent = '';
    live.hidden = true;
  }

  /* Marks the field the message is about, so a screen reader (and the red
     border) point at the same input the visitor has to fix. */
  const FIELDS = {
    'sign-in': ['signInEmail', 'signInPassword'],
    'sign-up': ['signUpEmail', 'signUpPassword', 'signUpConfirm']
  };

  function markInvalid(viewName, fieldId) {
    FIELDS[viewName].forEach((id) => {
      const input = PV.util.$('#' + id);
      if (!input) return;
      if (id === fieldId) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    });
  }

  function clearInvalid(viewName) {
    FIELDS[viewName].forEach((id) => {
      const input = PV.util.$('#' + id);
      if (input) input.removeAttribute('aria-invalid');
    });
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = label || 'Working…';
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
    }
  }

  /* ---------------------------------------------------------------- actions -- */

  function readField(id) {
    const input = PV.util.$('#' + id);
    return input ? input.value : '';
  }

  async function submitSignIn(event) {
    event.preventDefault();
    const errorHost = PV.util.$('#signInError');
    clearError(errorHost);

    const email = readField('signInEmail');
    const password = readField('signInPassword');
    const problem = auth.validate(email, password, null, true);
    if (problem) {
      const field = auth.emailProblem(email) ? 'signInEmail' : 'signInPassword';
      showError(errorHost, problem);
      markInvalid('sign-in', field);
      focusField(field);
      return;
    }

    const button = PV.util.$('#signInSubmit');
    setBusy(button, true, 'Signing in…');
    const result = await auth.signIn(email, password);
    setBusy(button, false);

    if (!result.ok) {
      /* The account service refused: the password is the field to revisit. */
      showError(errorHost, result.message);
      markInvalid('sign-in', 'signInPassword');
      focusField('signInPassword');
      return;
    }
    clearInvalid('sign-in');
    PV.ui.announce('Signed in.');
    PV.ui.toast('Signed in.');
    render(auth.state());
  }

  async function submitSignUp(event) {
    event.preventDefault();
    const errorHost = PV.util.$('#signUpError');
    clearError(errorHost);

    const email = readField('signUpEmail');
    const password = readField('signUpPassword');
    const confirmation = readField('signUpConfirm');
    const problem = auth.validate(email, password, confirmation, false);
    if (problem) {
      const field = auth.emailProblem(email) ? 'signUpEmail'
        : auth.passwordProblem(password) ? 'signUpPassword'
          : 'signUpConfirm';
      showError(errorHost, problem);
      markInvalid('sign-up', field);
      focusField(field);
      return;
    }

    const button = PV.util.$('#signUpSubmit');
    setBusy(button, true, 'Creating your account…');
    const result = await auth.signUp(email, password, confirmation);
    setBusy(button, false);

    if (!result.ok) {
      showError(errorHost, result.message);
      markInvalid('sign-up', 'signUpEmail');
      return;
    }
    clearInvalid('sign-up');
    if (result.confirmed) {
      PV.ui.announce('Account created.');
      PV.ui.toast('Account created.');
      render(auth.state());
      return;
    }
    /* Email confirmation is switched on for this project: no session yet, so
       stay on the sign-in form and say exactly what to do next. */
    view = 'sign-in';
    pendingMessage = result.message;
    render(auth.state());
    PV.ui.announce(result.message);
  }

  function focusField(id) {
    const input = PV.util.$('#' + id);
    if (input) input.focus();
  }

  /* ------------------------------------------------------------------ wiring */

  root.addEventListener('submit', (e) => {
    if (e.target.id === 'signInForm') submitSignIn(e);
    if (e.target.id === 'signUpForm') submitSignUp(e);
  });

  /* Switching between the two forms, and signing out, both work from anywhere
     in this view — including on a control rendered after this listener. */
  root.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-auth-view]');
    if (viewBtn) {
      view = viewBtn.getAttribute('data-auth-view');
      pendingMessage = '';
      render(auth.state());
      const first = PV.util.$('#signUpEmail') || PV.util.$('#signInEmail');
      if (first) first.focus();
      return;
    }
    const providerBtn = e.target.closest('[data-provider]');
    if (providerBtn) {
      startProvider(providerBtn.getAttribute('data-provider'), providerBtn);
      return;
    }
    if (e.target.closest('[data-auth-action="sign-out"]')) {
      /* core.js owns the shared handler for this action; nothing to add here. */
      return;
    }
  });

  /**
   * Starts an OAuth sign-in through the shared layer. On success the browser is
   * already leaving for Google, so there is nothing to render; on failure the
   * reason goes into the panel's own message slot, like every other error here.
   */
  function startProvider(name, button) {
    const host = PV.util.$('#signInError') || PV.util.$('#signUpError');
    clearError(host);
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    const result = auth.signInWithProvider(name);
    if (result.ok) {
      PV.ui.announce('Taking you to Google to sign in.');
      return;
    }
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    pendingMessage = result.message;
    render(auth.state());
    PV.ui.announce(result.message);
  }

  /* Rerender whenever the shared layer reports a change (including the
     session restored on load, and a sign-out from the header). */
  auth.onChange((snap) => render(snap));

  if (typeof auth.init === 'function') auth.init();
});
