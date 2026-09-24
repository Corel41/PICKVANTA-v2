/* ==========================================================================
   PickVanta — shared authentication layer (js/auth.js)
   --------------------------------------------------------------------------
   One module owns everything to do with *who is signed in*:

     • the Supabase Auth client interaction (sign-up, sign-in, sign-out,
       session refresh, current user)
     • the session: where it is kept, when it is refreshed, when it is dropped
     • the current profile row (email, display name, role) read through RLS
     • auth-state changes, so the header and the account page stay in step

   Pages and controllers consume this module. They must not talk to Supabase
   Auth themselves, and they must not keep their own copy of the session —
   that is how duplicated, drifting authentication logic happens.

   How this talks to Supabase
     Supabase Auth is a plain HTTP API, like the PostgREST endpoint that
     js/store.js already uses. This module calls it directly with fetch and the
     project's public anon key, so the site stays dependency-free and static:
     no SDK bundle, no build step, no new runtime.

   Providers
     Email + password and Google both go through Supabase Auth — there is one
     account system, not two, and one profile row per person either way.

       email/password   POST /auth/v1/token?grant_type=password
       Google           GET  /auth/v1/authorize?provider=google&redirect_to=…
                        → Google → Supabase /auth/v1/callback → back to this app
                        with the session in the URL fragment
       both             GET  /auth/v1/user  confirms the session before it is
                        trusted, and public.profiles is read with that token

     The provider list is data, not code paths: adding Apple later is one more
     entry in PROVIDERS, because starting an OAuth sign-in is the same request
     for every provider. What is provider-specific (a client id, a secret) lives
     in the Supabase project's own configuration — never in this repository and
     never in the browser.

   What is NOT here, on purpose
     • No OAuth client secret and no client id. The browser asks *our own
       Supabase project* to start the flow; Google's credentials live in that
       project's settings, which is the only place they are ever used.
     • No fake login. There is no code path that invents a user, and nothing is
       trusted because it sits in localStorage. The only signed-in state this
       module reports is one the Supabase Auth server has just confirmed.
     • No service-role key, no database password, no secret of any kind. The
       browser only ever holds the public anon key and the session token that
       the user's own sign-in produced.
     • No authorization decisions. `isAdmin()` exists so the interface can show
       or hide things; the database (see db/migrations/0002_auth_profiles.sql)
       is what actually allows or refuses anything.
     • No passwords are stored, logged or kept in memory after a request.

   The session token lives in localStorage for the same reason the Supabase SDK
   does it: a session has to survive a page refresh. It is a bearer token, not a
   password — it expires, it can be revoked by signing out, and every request
   that uses it is still checked against Row Level Security by the database.

   Load order: config.local.js → config.js → domain.js → store.js → auth.js →
   core.js → controller. core.js calls PV.auth.mount() to put the account
   controls in the shared header.
   ========================================================================== */
window.PV = window.PV || {};

/* One namespace, like PV.domain and PV.store: nothing else is touched. */
window.PV.auth = (function () {
  'use strict';

  const SESSION_KEY = 'pickvanta.auth.session.v1';
  /* Set while an OAuth flow is away at the provider, so the return trip knows
     whether an empty-handed callback is a cancellation or just a plain visit.
     Per-tab and deliberately short-lived: it is a note, not a session. */
  const OAUTH_PENDING_KEY = 'pickvanta.auth.oauth.pending.v1';
  const REQUEST_TIMEOUT_MS = 15000;
  const EXPIRY_SKEW_MS = 60 * 1000;

  /* The providers this layer can start a sign-in with. Data, not logic: the
     flow below is identical for every one of them, so a future provider is an
     entry here (plus its configuration in the Supabase project). */
  const PROVIDERS = [
    { id: 'google', label: 'Google', verb: 'Continue with Google' }
  ];

  /* ------------------------------------------------------------- config --- */
  /* The same public configuration the catalogue uses. Nothing here is secret:
     mode + project URL + anon key, and the anon key is protected by RLS. */
  const CONFIG = (function () {
    const raw = window.PV_CONFIG || {};
    const supabase = raw.supabase || {};
    return {
      mode: raw.mode === 'api' ? 'api' : 'demo',
      url: String(supabase.url || '').trim().replace(/\/+$/, ''),
      anonKey: String(supabase.anonKey || '').trim()
    };
  })();

  /** Accounts need a real project behind them: a live mode and both values. */
  const available = CONFIG.mode === 'api' && !!CONFIG.url && !!CONFIG.anonKey;

  /* --------------------------------------------------------------- state -- */
  /* 'signed-out'   no session, or a session the server did not confirm
     'signed-in'    a session the Supabase Auth server confirmed
     'error'        the account service could not be reached (never a fake
                    signed-in state: status stays 'signed-out' with a reason) */
  let state = {
    available: available,
    status: 'signed-out',
    user: null,
    profile: null,
    role: null,
    error: null,
    message: '',
    /* 'oauth' while a provider redirect is being completed, so the interface
       can say what is happening instead of showing a sign-in form again. */
    redirecting: '',
    /* True once this page has been handed redirect parameters — a return from a
       provider. Views use it to keep that outcome on screen, since it is not
       something the person triggered from a form they can look at. */
    fromProvider: false,
    /* { google: true } once /auth/v1/settings has answered. null until then:
       unknown is not the same as disabled. */
    providers: null,
    checkedAt: 0
  };

  const listeners = [];
  let readyPromise = null;

  function snapshot() {
    return {
      available: state.available,
      status: state.status,
      redirecting: state.redirecting,
      fromProvider: state.fromProvider,
      providers: state.providers ? Object.assign({}, state.providers) : null,
      user: state.user ? { id: state.user.id, email: state.user.email } : null,
      profile: state.profile ? Object.assign({}, state.profile) : null,
      role: state.role,
      error: state.error,
      message: state.message,
      /* False until the stored session has actually been checked with the
         server, so a view can hold off painting a "signed out" form that may
         be about to change. */
      checked: state.checkedAt > 0
    };
  }

  function emit() {
    const snap = snapshot();
    listeners.forEach((fn) => {
      try { fn(snap); } catch (err) { /* a listener must never break a page */ }
    });
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    fn(snapshot());
    return function () {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    };
  }

  /* ------------------------------------------------------------- storage -- */
  function readStored() {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeStored(session) {
    try {
      if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else window.localStorage.removeItem(SESSION_KEY);
    } catch (err) {
      /* private mode / storage disabled: the session simply lasts one page */
    }
  }

  /* -------------------------------------------------------------- errors -- */
  /** Every failure becomes a small, comparable object — never a raw response. */
  function fail(kind, detail) {
    const err = new Error(detail || kind);
    err.authKind = kind;
    err.detail = detail || '';
    return err;
  }

  /**
   * Turns any failure into something worth showing a person. Raw Supabase or
   * network text never reaches the interface.
   */
  function errorMessage(err) {
    const kind = (err && err.authKind) || 'unknown';
    const detail = String((err && (err.detail || err.message)) || '').toLowerCase();

    if (kind === 'unavailable') {
      return 'Signing in needs the live catalogue connection. This build is running in demonstration mode, so accounts are switched off.';
    }
    if (kind === 'network') {
      return 'We could not reach the account service. Check your connection and try again.';
    }
    if (kind === 'invalid-email') {
      return 'That does not look like a valid email address.';
    }
    if (kind === 'weak-password' || /password should be at least|weak.?password/.test(detail)) {
      return 'Choose a longer password — at least 8 characters.';
    }
    if (kind === 'password-mismatch') {
      return 'The two passwords do not match.';
    }
    if (/invalid login credentials|invalid_grant/.test(detail)) {
      return 'That email and password do not match an account.';
    }
    if (/email not confirmed|not confirmed/.test(detail)) {
      return 'This account still needs its email address confirmed. Open the link we sent you, then sign in.';
    }
    if (/already registered|already exists|user_already_exists/.test(detail)) {
      return 'An account already exists for that email address. Sign in instead.';
    }
    if (/rate.?limit|too many/.test(detail)) {
      return 'Too many attempts just now. Wait a minute and try again.';
    }
    if (/signups? (not allowed|disabled)|signup_disabled/.test(detail)) {
      return 'New accounts are currently switched off for this project.';
    }
    if (kind === 'session') {
      return 'That session has expired. Sign in again to continue.';
    }
    if (kind === 'oauth-cancelled') {
      return 'Google sign-in was cancelled. Nothing was changed — you can try again, or sign in with your email address.';
    }
    if (kind === 'oauth-provider') {
      return 'Google sign-in is not switched on for this PickVanta project yet. You can still sign in with your email address.';
    }
    if (kind === 'oauth-config') {
      return 'Google sign-in could not be completed because this deployment is not fully configured for it. Signing in with your email address still works.';
    }
    if (kind === 'oauth-expired') {
      return 'That Google sign-in took too long and is no longer valid. Please start again.';
    }
    if (kind === 'oauth') {
      return 'We could not finish signing you in with Google. Please try again, or use your email address.';
    }
    if (kind === 'profile') {
      return 'Your account is signed in, but its profile could not be read. Try again in a moment.';
    }
    return 'Something went wrong while signing you in. Please try again.';
  }

  /* --------------------------------------------------------------- HTTP --- */
  async function call(path, options) {
    const o = options || {};
    if (!available) throw fail('unavailable');
    if (typeof window.fetch !== 'function') throw fail('network');

    const headers = Object.assign({ apikey: CONFIG.anonKey }, o.headers || {});
    if (o.body) headers['Content-Type'] = 'application/json';

    let timer = null;
    let controller = null;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    }

    let response;
    try {
      response = await window.fetch(CONFIG.url + path, {
        method: o.method || 'GET',
        headers: headers,
        body: o.body ? JSON.stringify(o.body) : undefined,
        signal: controller ? controller.signal : undefined
      });
    } catch (err) {
      /* Abort, DNS failure, offline, blocked request — all the same to a user. */
      throw fail('network');
    } finally {
      if (timer) clearTimeout(timer);
    }

    let data = null;
    const text = await response.text().catch(() => '');
    if (text) {
      try { data = JSON.parse(text); } catch (err) { data = { message: text.slice(0, 200) }; }
    }

    if (!response.ok) {
      const detail = (data && (data.error_description || data.msg || data.message || data.error)) || ('HTTP ' + response.status);
      const error = fail(response.status === 400 || response.status === 401 ? 'credentials' : 'server', detail);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  const authHeaders = (token) => ({ Authorization: 'Bearer ' + token });

  /* ------------------------------------------------------------- session -- */
  function sessionFrom(response, previous) {
    const user = response && response.user ? response.user : (previous && previous.user) || null;
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token || (previous && previous.refreshToken) || '',
      expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000,
      tokenType: response.token_type || 'bearer',
      user: user ? { id: user.id, email: user.email || '' } : null,
      storedAt: Date.now()
    };
  }

  const isFresh = (session) =>
    !!session && !!session.accessToken && Number(session.expiresAt || 0) - EXPIRY_SKEW_MS > Date.now();

  function adopt(session) {
    writeStored(session);
    state.user = session.user;
    state.role = null;
    state.status = 'signed-in';
    state.error = null;
    state.message = '';
    state.checkedAt = Date.now();
  }

  function clear(reason) {
    writeStored(null);
    state.user = null;
    state.profile = null;
    state.role = null;
    state.status = 'signed-out';
    state.error = reason || null;
    state.message = reason ? errorMessage(reason) : '';
    state.checkedAt = Date.now();
  }

  /** The stored session, refreshed if its access token has expired. */
  async function currentSession() {
    const stored = readStored();
    if (!stored) return null;
    if (isFresh(stored)) return stored;

    if (!stored.refreshToken) {
      clear(fail('session'));
      return null;
    }
    try {
      const refreshed = await call('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token: stored.refreshToken }
      });
      const next = sessionFrom(refreshed, stored);
      writeStored(next);
      return next;
    } catch (err) {
      /* A refused refresh token means the session is genuinely over: drop it.
         A network failure does not — keep it so a later reload can retry, but
         never report a signed-in state we could not confirm. */
      if (err.authKind === 'network') {
        state.error = err;
        state.message = errorMessage(err);
        return null;
      }
      clear(fail('session'));
      return null;
    }
  }

  /* ------------------------------------------------------------- profile -- */
  /* The profile is read with the user's own token, so RLS applies: this can
     only ever return the caller's own row. */
  const PROFILE_COLUMNS = 'id,email,display_name,role,created_at,updated_at';

  async function fetchProfile(session) {
    const rows = await call('/rest/v1/profiles?id=eq.' + encodeURIComponent(session.user.id) +
      '&select=' + PROFILE_COLUMNS + '&limit=1', {
      headers: authHeaders(session.accessToken)
    });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  /* An account created before this migration was applied has no profile row.
     The database allows a signed-in user to create exactly one row — their own,
     with role 'user' (see the 0002 policies). Nothing here can ask for more. */
  async function createOwnProfile(session) {
    const rows = await call('/rest/v1/profiles?select=' + PROFILE_COLUMNS, {
      method: 'POST',
      headers: Object.assign({ Prefer: 'return=representation' }, authHeaders(session.accessToken)),
      body: [{ id: session.user.id, email: session.user.email || '' }]
    });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function loadProfile(session) {
    let profile = null;
    try {
      profile = await fetchProfile(session);
      if (!profile) profile = await createOwnProfile(session);
    } catch (err) {
      state.profile = null;
      state.role = null;
      state.error = err.authKind === 'network' ? err : fail('profile', err.detail || '');
      state.message = errorMessage(state.error);
      return null;
    }
    state.profile = profile;
    /* The role is whatever the database returned for this row — never a value
       the browser chose, and never a default we invented. */
    state.role = profile && typeof profile.role === 'string' ? profile.role : null;
    state.error = null;
    state.message = '';
    return profile;
  }

  /* ------------------------------------------------------------ providers -- */
  /**
   * Which providers this project actually offers. `/auth/v1/settings` is a
   * public endpoint (apikey only, no session) and is the authority — the
   * interface must not offer a button that cannot work. Until it answers,
   * `providers` stays null and the interface keeps the button visible: an
   * unreachable settings call is not proof that Google is switched off.
   */
  function loadProviders() {
    if (!available || state.providers) return Promise.resolve(state.providers);
    return call('/auth/v1/settings').then((data) => {
      const external = (data && data.external) || {};
      const map = {};
      PROVIDERS.forEach((provider) => { map[provider.id] = external[provider.id] === true; });
      state.providers = map;
      emit();
      return map;
    }).catch(() => {
      /* Leave it unknown rather than guessing: the button stays, and if the
         provider really is off, Supabase says so when the flow starts. */
      return null;
    });
  }

  /** What the interface needs to render one provider's control. */
  function provider(name) {
    const known = PROVIDERS.filter((p) => p.id === name)[0];
    if (!known) return null;
    return {
      id: known.id,
      label: known.label,
      verb: known.verb,
      /* enabled === false only when the server explicitly said so. */
      enabled: state.providers ? state.providers[known.id] === true : null,
      available: available
    };
  }

  const providers = () => PROVIDERS.map((p) => provider(p.id));

  /** Where the provider sends the person back to. No query, no fragment: the
   *  project appends its own parameters and a query string in the redirect
   *  target is what breaks Supabase's error redirects. */
  function returnUrl() {
    try {
      const loc = window.location;
      if (!loc || !loc.origin || loc.origin === 'null') return '';
      return loc.origin + loc.pathname;
    } catch (err) {
      return '';
    }
  }

  /* ------------------------------------------------------- OAuth (Google) -- */
  function markPending(providerId) {
    state.redirecting = providerId;
    try { window.sessionStorage.setItem(OAUTH_PENDING_KEY, providerId); } catch (err) { /* one-page memory is fine */ }
  }

  function clearPending() {
    state.redirecting = '';
    try { window.sessionStorage.removeItem(OAUTH_PENDING_KEY); } catch (err) { /* nothing to clear */ }
  }

  function pendingProvider() {
    try { return window.sessionStorage.getItem(OAUTH_PENDING_KEY) || ''; } catch (err) { return ''; }
  }

  /**
   * Start an OAuth sign-in. This is a navigation, not a request: the browser
   * leaves for the provider and comes back to this same page with the session
   * in the URL fragment (see handleRedirect, which runs on the way back in).
   * Only the provider name and our own return address are sent — this project's
   * Supabase URL is public, and the client secret never leaves Supabase.
   */
  function signInWithProvider(name, options) {
    const known = PROVIDERS.filter((p) => p.id === name)[0];
    if (!known) return { ok: false, message: 'That sign-in method is not available.' };
    if (!available) return { ok: false, message: errorMessage(fail('unavailable')) };
    if (state.providers && state.providers[known.id] !== true) {
      return { ok: false, message: errorMessage(fail('oauth-provider')) };
    }

    const target = (options && options.redirectTo) || returnUrl();
    let url;
    try {
      url = new URL(CONFIG.url + '/auth/v1/authorize');
      url.searchParams.set('provider', known.id);
      if (target) url.searchParams.set('redirect_to', target);
    } catch (err) {
      return { ok: false, message: errorMessage(fail('oauth-config')) };
    }

    markPending(known.id);
    emit();
    if (!window.location || typeof window.location.assign !== 'function') {
      clearPending();
      return { ok: false, message: errorMessage(fail('oauth-config')) };
    }
    try {
      window.location.assign(url.toString());
    } catch (err) {
      clearPending();
      return { ok: false, message: errorMessage(fail('oauth-config')) };
    }
    return { ok: true, message: 'Taking you to ' + known.label + '…', url: url.toString() };
  }

  /* The parameters GoTrue puts in the fragment on success, and in the fragment
     or the query string when the provider refuses. */
  const OAUTH_KEYS = ['access_token', 'refresh_token', 'expires_in', 'token_type', 'type', 'error', 'error_code', 'error_description'];

  function readParams(source) {
    const out = {};
    const raw = String(source || '').replace(/^[#?]/, '');
    if (!raw) return out;
    raw.split('&').forEach((pair) => {
      if (!pair) return;
      const at = pair.indexOf('=');
      const key = decodeURIComponent(at === -1 ? pair : pair.slice(0, at));
      if (OAUTH_KEYS.indexOf(key) === -1) return;
      out[key] = decodeURIComponent((at === -1 ? '' : pair.slice(at + 1)).replace(/\+/g, ' '));
    });
    return out;
  }

  /** The redirect parameters this page came back with, if any. */
  function redirectParams() {
    let hash = '';
    let search = '';
    try {
      hash = window.location.hash || '';
      search = window.location.search || '';
    } catch (err) { /* nothing to read */ }
    const fromHash = readParams(hash);
    /* Some failures come back as a query string instead of a fragment. */
    return Object.keys(fromHash).length ? fromHash : readParams(search);
  }

  /** Turns a provider refusal into the same small error object used everywhere. */
  function oauthFailure(params) {
    const code = String(params.error || '');
    const detail = String(params.error_description || '');
    const text = (code + ' ' + detail).toLowerCase();
    if (code === 'access_denied' || /denied|cancell?ed|user.*refus/.test(text)) return fail('oauth-cancelled');
    if (/provider is not enabled|not enabled|unsupported provider/.test(text)) return fail('oauth-provider');
    if (/redirect_uri_mismatch|invalid.*redirect|invalid client|client_id/.test(text)) return fail('oauth-config');
    if (/expired|invalid.*state|state.*invalid|otp_expired/.test(text)) return fail('oauth-expired');
    return fail('oauth', detail || code);
  }

  /**
   * Removes the session (or the error) from the address bar. A token in a URL
   * is a token that can be copied, bookmarked or left in a browser history, so
   * it is cleared as soon as it has been read — the real session lives in
   * localStorage and is confirmed with the server before it is trusted.
   */
  function cleanUrl() {
    try {
      const loc = window.location;
      if (!loc || !window.history || typeof window.history.replaceState !== 'function') return;
      if (!loc.hash && !/[?&](error|code)=/.test(loc.search || '')) return;
      window.history.replaceState({}, document.title, loc.pathname + (loc.search || '').replace(/[?&](error|error_code|error_description)=[^&]*/g, '').replace(/^&/, '?').replace(/\?$/, ''));
    } catch (err) { /* a URL that cannot be tidied is not worth breaking over */ }
  }

  /**
   * Completes a return from an OAuth provider. Called by init(); also usable on
   * its own. Returns { handled, ok, message } so a caller can react, and never
   * throws.
   *
   * Nothing here trusts the URL on its own: the tokens are used to build a
   * session and then confirmed against /auth/v1/user, exactly like a session
   * restored from storage. A callback cannot sign anybody in on its say-so.
   */
  async function handleRedirect() {
    const params = redirectParams();
    if (!params || !Object.keys(params).length) {
      /* No parameters at all. If we had left for a provider, this is the person
         coming back having changed their mind. */
      if (pendingProvider()) {
        clearPending();
        const cancelled = fail('oauth-cancelled');
        state.error = cancelled;
        state.message = errorMessage(cancelled);
        /* Still an outcome of a provider flow — one this page should report,
           not silently forget. */
        state.fromProvider = true;
        state.checkedAt = Date.now();
        emit();
        return { handled: true, ok: false, message: state.message };
      }
      return { handled: false, ok: false, message: '' };
    }

    state.redirecting = pendingProvider() || 'google';
    state.fromProvider = true;
    state.checkedAt = 0;
    emit();

    if (params.error) {
      const problem = oauthFailure(params);
      clearPending();
      cleanUrl();
      state.redirecting = '';
      state.error = problem;
      state.message = errorMessage(problem);
      state.checkedAt = Date.now();
      emit();
      return { handled: true, ok: false, message: state.message };
    }

    if (!params.access_token) {
      clearPending();
      cleanUrl();
      state.redirecting = '';
      return { handled: false, ok: false, message: '' };
    }

    try {
      const session = sessionFrom({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
        expires_in: params.expires_in,
        token_type: params.token_type
      }, null);
      /* Confirm before trusting — same rule as a restored session. */
      const confirmed = await call('/auth/v1/user', { headers: authHeaders(session.accessToken) });
      if (!confirmed || !confirmed.id) throw fail('oauth');
      session.user = { id: confirmed.id, email: confirmed.email || '' };
      writeStored(session);
      adopt(session);
      await loadProfile(session);
      clearPending();
      cleanUrl();
      state.redirecting = '';
      emit();
      return { handled: true, ok: true, message: 'Signed in.' };
    } catch (err) {
      clearPending();
      cleanUrl();
      state.redirecting = '';
      const problem = err.authKind === 'network' ? err : (err.status === 401 || err.status === 403 ? fail('oauth-expired') : fail('oauth', err.detail || ''));
      clear(problem);
      emit();
      return { handled: true, ok: false, message: errorMessage(problem) };
    }
  }

  /* ----------------------------------------------------------------- API -- */
  /** Restores the session, confirms it with the server and loads the profile. */
  function init() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      if (!available) {
        /* Demonstration mode: no project, so no provider is on offer either. */
        state.status = 'signed-out';
        state.error = 'unavailable';
        state.message = errorMessage(fail('unavailable'));
        state.checkedAt = Date.now();
        emit();
        return snapshot();
      }

      /* A return from Google (or any future provider) is handled before
         anything else: the fragment carries a session that has not been
         confirmed yet. */
      let fromProvider = { handled: false, ok: false };
      try {
        fromProvider = await handleRedirect();
      } catch (err) {
        fromProvider = { handled: true, ok: false };
      }
      if (fromProvider.handled && fromProvider.ok) return snapshot();

      /* Fire and forget: the interface renders at once and the provider state
         fills in when the answer arrives. Asked for on every signed-out visit
         too — that is when the sign-in control is on screen. */
      loadProviders();

      let session = null;
      try {
        session = await currentSession();
        if (!session) {
          /* Nothing stored, or the stored session was refused. Either way the
             check is finished: a view may now paint the signed-out state. */
          state.status = 'signed-out';
          state.checkedAt = Date.now();
          emit();
          return snapshot();
        }
        /* Confirm the token with the auth server before trusting it: a stored
           token that has been revoked must not look like a signed-in user. */
        const confirmed = await call('/auth/v1/user', { headers: authHeaders(session.accessToken) });
        if (confirmed && confirmed.id) {
          session.user = { id: confirmed.id, email: confirmed.email || (session.user && session.user.email) || '' };
          writeStored(session);
        }
        adopt(session);
        await loadProfile(session);
      } catch (err) {
        if (err.status === 401 || err.status === 403) clear(fail('session'));
        else clear(err.authKind === 'network' ? err : fail('server', err.detail || ''));
      }
      emit();
      return snapshot();
    })();
    return readyPromise;
  }

  /**
   * Sign in with email and password.
   * Resolves to { ok: true } or { ok: false, message } — never throws, so a
   * caller can show the message without its own error handling.
   */
  async function signIn(email, password) {
    if (!available) return { ok: false, message: errorMessage(fail('unavailable')) };
    const problem = validate(email, password, null, true);
    if (problem) return { ok: false, message: problem };

    try {
      const response = await call('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: { email: String(email).trim(), password: String(password) }
      });
      if (!response || !response.access_token) throw fail('credentials', 'no session returned');
      const session = sessionFrom(response, null);
      adopt(session);
      await loadProfile(session);
      emit();
      return { ok: true, message: 'Signed in.' };
    } catch (err) {
      /* A failed sign-in leaves the previous (signed-out) state exactly as it
         was: no half-signed-in user. */
      if (state.status !== 'signed-in') {
        state.error = err;
        state.message = errorMessage(err);
      }
      emit();
      return { ok: false, message: errorMessage(err) };
    }
  }

  /**
   * Create an account. Supabase may or may not return a session, depending on
   * whether email confirmation is switched on for the project; both cases are
   * reported honestly.
   */
  async function signUp(email, password, confirmation) {
    if (!available) return { ok: false, message: errorMessage(fail('unavailable')) };
    const problem = validate(email, password, confirmation, false);
    if (problem) return { ok: false, message: problem };

    try {
      const response = await call('/auth/v1/signup', {
        method: 'POST',
        body: { email: String(email).trim(), password: String(password) }
      });
      if (response && response.access_token) {
        const session = sessionFrom(response, null);
        adopt(session);
        await loadProfile(session);
        emit();
        return { ok: true, message: 'Your account is ready.', confirmed: true };
      }
      emit();
      return {
        ok: true,
        confirmed: false,
        message: 'Account created. Check ' + String(email).trim() + ' for the confirmation link, then sign in.'
      };
    } catch (err) {
      emit();
      return { ok: false, message: errorMessage(err) };
    }
  }

  /** Sign out. The local session is always cleared, even if the server is gone. */
  async function signOut() {
    const stored = readStored();
    let message = '';
    if (stored && stored.accessToken && available) {
      try {
        await call('/auth/v1/logout', { method: 'POST', headers: authHeaders(stored.accessToken) });
      } catch (err) {
        /* The session is over for this browser either way; say so if the server
           could not be told, rather than pretending it succeeded. */
        message = 'Signed out on this device. We could not reach the account service to end the session everywhere.';
      }
    }
    clear(null);
    emit();
    return { ok: true, message: message };
  }

  /* ---------------------------------------------------------- validation -- */
  /**
   * Shared client-side validation. It exists to give a fast, clear message —
   * the Supabase project's own rules are still the authority, and its answer is
   * what finally decides whether an account can be created.
   */
  function emailProblem(email) {
    const value = String(email || '').trim();
    if (!value) return 'Enter your email address.';
    if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      return 'Enter a valid email address, for example you@example.com.';
    }
    return '';
  }

  function passwordProblem(password) {
    const value = String(password || '');
    if (!value) return 'Enter a password.';
    if (value.length < 8) return 'Use at least 8 characters.';
    if (value.length > 72) return 'Use at most 72 characters.';
    return '';
  }

  /** Returns '' when the values are usable, otherwise a message for the user. */
  function validate(email, password, confirmation, existingAccount) {
    const e = emailProblem(email);
    if (e) return e;
    const p = passwordProblem(password);
    if (p) return p;
    if (!existingAccount && confirmation !== null && confirmation !== undefined) {
      if (String(password) !== String(confirmation)) return 'The two passwords do not match.';
    }
    return '';
  }

  /* -------------------------------------------------------------- header -- */
  /* The account controls in the shared header. Rendered here, not in core.js,
     so there is exactly one place that knows what "signed in" looks like. */
  function controlsMarkup(compact) {
    const base = compact ? 'btn-secondary' : 'btn-secondary';
    if (!state.available) {
      return '<a class="' + base + '" href="account.html">Sign In</a>';
    }
    if (state.status === 'signed-in') {
      return '<a class="' + base + '" href="account.html">Account</a>' +
        '<button type="button" class="btn-ghost" data-auth-action="sign-out">Sign Out</button>';
    }
    return '<a class="' + base + '" href="account.html">Sign In</a>';
  }

  function renderControls() {
    ['#authControls', '#authControlsMobile'].forEach((selector) => {
      const host = document.querySelector(selector);
      if (!host) return;
      host.innerHTML = controlsMarkup(selector.indexOf('Mobile') !== -1);
    });
  }

  let mounted = false;
  /** Puts the account controls in the header and keeps them in step. */
  function mount() {
    renderControls();
    if (mounted) return;
    mounted = true;

    document.addEventListener('click', (e) => {
      const signOutBtn = e.target.closest('[data-auth-action="sign-out"]');
      if (!signOutBtn) return;
      e.preventDefault();
      signOutBtn.disabled = true;
      signOut().then((result) => {
        signOutBtn.disabled = false;
        const text = result.message || 'Signed out.';
        if (window.PV && PV.ui && PV.ui.toast) PV.ui.toast(text);
        /* The catalogue is public: signing out leaves the visitor exactly where
           they were. Pages that render account state (account.html) rerender
           themselves through onChange(). */
      });
    });

    onChange(renderControls);
    init();
  }

  /* Keep other tabs in step: signing out here should not leave a stale
     "Account" control open in another tab. */
  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY) return;
    if (e.newValue) {
      const stored = readStored();
      if (stored) { adopt(stored); loadProfile(stored).then(emit); }
    } else {
      clear(null);
      emit();
    }
  });

  return {
    init: init,
    available: () => state.available,
    state: snapshot,
    user: () => snapshot().user,
    profile: () => snapshot().profile,
    role: () => snapshot().role,
    isSignedIn: () => state.status === 'signed-in' && !!state.user,
    /* Convenience for the interface only. The database decides what an admin
       may actually do — see is_admin() in db/migrations/0002_auth_profiles.sql. */
    isAdmin: () => state.status === 'signed-in' && state.role === 'admin',
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    /* OAuth. Starting a flow is a navigation; finishing one is handled by
       init() automatically on the way back in. */
    signInWithProvider: signInWithProvider,
    handleRedirect: handleRedirect,
    providers: providers,
    provider: provider,
    onChange: onChange,
    errorMessage: errorMessage,
    validate: validate,
    emailProblem: emailProblem,
    passwordProblem: passwordProblem,
    mount: mount,
    /* Exposed for tests and for a deployment that needs to point the layer at
       the project it is actually configured for. */
    config: () => ({ available: available, mode: CONFIG.mode, url: CONFIG.url })
  };
})();
