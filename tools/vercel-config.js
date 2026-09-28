#!/usr/bin/env node
/* ============================================================================
   PickVanta — Vercel build step (tools/vercel-config.js)
   ----------------------------------------------------------------------------
   A static site cannot read Vercel Environment Variables at runtime: Vercel
   injects them into build processes and functions, never into files served to a
   browser. This script is the build process. It turns the project's two PUBLIC
   environment variables into the same, git-ignored override file that local
   development uses:

       SUPABASE_URL       →  window.PV_CONFIG_OVERRIDE.supabase.url
       SUPABASE_ANON_KEY  →  window.PV_CONFIG_OVERRIDE.supabase.anonKey

   It writes js/config.local.js — the file every page already loads immediately
   before js/config.js — and nothing else. The deployed site stays plain static
   HTML/CSS/JS: no framework, no bundler, no runtime, no dependencies.

   Rules
     • Only SUPABASE_URL and SUPABASE_ANON_KEY are read. Any other variable in
       the project (including SUPABASE_SERVICE_ROLE_KEY) is ignored.
     • If either variable is missing or blank, the deployment is left in demo
       mode: nothing is written and the build exits successfully (0).
     • If a value looks privileged — sb_secret_…, a service-role key, a
       service-role JWT or a PostgreSQL connection string — the build fails
       loudly (1) instead of shipping it to a browser.
     • The public anon/publishable key is the only key this project ever uses.
       Row Level Security, not secrecy, protects the data.

   Run locally to check the wiring:  node tools/vercel-config.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'js', 'config.local.js');
const URL_VAR = 'SUPABASE_URL';
const KEY_VAR = 'SUPABASE_ANON_KEY';

const log = (msg) => console.log('[vercel-config] ' + msg);
const fail = (msg) => {
  console.error('[vercel-config] BUILD REFUSED: ' + msg);
  process.exit(1);
};

const readVar = (name) => String(process.env[name] || '').trim();

/* --------------------------------------------------------------- key audit -- */

/** The `role` claim of a JWT, or null when the value is not a JWT. */
function jwtRole(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return typeof payload.role === 'string' ? payload.role : null;
  } catch (err) {
    return null;
  }
}

/** Why this value must never reach a browser, or null when it is fine. */
function privilegedReason(value) {
  if (!value) return null;
  if (/^sb_secret_/i.test(value)) return 'a secret key (sb_secret_…)';
  if (/postgres(ql)?:\/\//i.test(value)) return 'a PostgreSQL connection string';
  if (/service[_-]?role/i.test(value)) return 'a service-role key';
  if (/^https?:\/\/[^\s]*db\.[a-z0-9-]+\.supabase\./i.test(value)) return 'a direct database address';
  if (jwtRole(value) === 'service_role') return 'a service-role JWT';
  if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(value) && jwtRole(value) === 'service_role') {
    return 'a service-role JWT';
  }
  return null;
}

/* ------------------------------------------------------------- rendering --- */

function configSource(url, anonKey) {
  return `/* ============================================================================
   PickVanta — runtime configuration (js/config.local.js)
   ----------------------------------------------------------------------------
   GENERATED FILE — written by tools/vercel-config.js at build time from the
   project's SUPABASE_URL and SUPABASE_ANON_KEY environment variables, and
   git-ignored so it is never committed. Do not edit by hand: edit the Vercel
   environment variables (or, locally, replace this file with your own copy).

   It contains the PUBLIC project URL and the publishable/anon key only — values
   that are shipped to browsers by design. Row Level Security, not secrecy, is
   what protects the data. A service-role key, database password, connection
   string or access token must never appear here.

   Loaded by every page immediately before js/config.js, which merges these
   values over its committed demo defaults.
   ========================================================================== */
window.PV_CONFIG_OVERRIDE = {
  mode: 'api',
  supabase: {
    url: ${JSON.stringify(url)},
    anonKey: ${JSON.stringify(anonKey)}
  },
  onFailure: 'error',
  poolLimit: 60
};
`;
}

/* ------------------------------------------------------------------ build --- */

function build() {
  const url = readVar(URL_VAR);
  const key = readVar(KEY_VAR);

  /* Nothing configured: stay in the labelled demonstration mode. This is the
     default state of the repository, and it is not an error. */
  if (!url && !key) {
    log('neither ' + URL_VAR + ' nor ' + KEY_VAR + ' is set — the deployment stays in demo mode.');
    return 0;
  }
  if (!url || !key) {
    const missing = !url ? URL_VAR : KEY_VAR;
    log('incomplete configuration (' + missing + ' is empty) — the deployment stays in demo mode.');
    return 0;
  }

  const urlProblem = privilegedReason(url);
  if (urlProblem) fail(URL_VAR + ' looks like ' + urlProblem + '. Use the project URL (https://<ref>.supabase.co).');
  if (!/^https:\/\//i.test(url)) {
    fail(URL_VAR + ' must be an https:// URL, e.g. https://<project-ref>.supabase.co');
  }

  const keyProblem = privilegedReason(key);
  if (keyProblem) {
    fail(KEY_VAR + ' looks like ' + keyProblem + '. Only the public publishable/anon key may be shipped to a browser.');
  }

  const host = url.replace(/^https:\/\//i, '').split('/')[0];
  if (!/\.supabase\.(co|in)$/i.test(host) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host)) {
    fail(URL_VAR + ' does not look like a project URL: ' + host);
  }
  if (!/\.supabase\.(co|in)$/i.test(host)) {
    log('note: ' + host + ' is not a *.supabase.co host — continuing (a custom domain is allowed).');
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, configSource(url, key));
  log('wrote ' + path.relative(ROOT, TARGET) + ' — the deployment will read the published catalogue from ' + host + '.');
  return 0;
}

if (require.main === module) process.exit(build());

module.exports = { build: build, configSource: configSource, privilegedReason: privilegedReason, jwtRole: jwtRole, TARGET: TARGET };
