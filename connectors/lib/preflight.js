'use strict';

/**
 * Environment readiness — the runner's own preflight, and the only place a
 * secret is read.
 *
 * Rules (17C-A §6.4, decision D2):
 *   • the Supabase URL and the runner's key come from the environment only;
 *   • the runner refuses to start a write run with a key that is not the
 *     service-role key, because the browser-safe anon key cannot write and a
 *     silent failure there would look like an empty result;
 *   • a secret is never printed — only whether it is present, its length and
 *     the role it claims.
 *
 * There is no write path in 17C-B, so this module is exercised by `--check-env`
 * and by the tests. It is what 17C-C will call before its first write.
 */

const ENV_URL = 'SUPABASE_URL';
const ENV_SERVICE_KEY = 'SUPABASE_SERVICE_ROLE_KEY';

/**
 * The name of the environment variable that holds a source's own credential.
 * Derived from the source id by convention so that no credential — and no
 * credential-shaped key — ever has to be stored in a `deal_sources` row or in a
 * configuration file. The value itself is never read from anywhere but the
 * environment. 17C-D is the first step that needs one.
 */
function credentialEnvName(sourceId) {
  const compact = String(sourceId || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return 'PV_SOURCE_' + compact.slice(0, 12) + '_TOKEN';
}

/** Decodes a JWT payload without verifying it: a local guard, not a security control. */
function jwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch (error) {
    return null;
  }
}

/** `https://abcdefgh.supabase.co` -> `https://<project>.supabase.co` */
function maskUrl(value) {
  const text = String(value || '');
  if (text === '') return '';
  try {
    const url = new URL(text);
    const labels = url.hostname.split('.');
    const masked = labels.length > 1 ? ['<project>'].concat(labels.slice(1)).join('.') : '<project>';
    return url.protocol + '//' + masked + (url.port ? ':' + url.port : '');
  } catch (error) {
    return '<not a url>';
  }
}

/**
 * @param {object} env           defaults to process.env
 * @param {object} [source]      optional source manifest, for the credential line
 * @returns {{ready: boolean, problems: string[], url: object, key: object, credential: object|null}}
 */
function inspectEnvironment(env, source) {
  const environment = env || {};
  const problems = [];

  const url = String(environment[ENV_URL] || '').trim();
  const urlReport = { variable: ENV_URL, present: url !== '', value: maskUrl(url) };
  if (url === '') problems.push(ENV_URL + ' is not set');
  else if (!/^https:\/\/\S+$/i.test(url)) problems.push(ENV_URL + ' must be an https URL');

  const key = String(environment[ENV_SERVICE_KEY] || '').trim();
  const keyReport = { variable: ENV_SERVICE_KEY, present: key !== '', length: key.length, role: 'missing' };
  if (key === '') {
    problems.push(ENV_SERVICE_KEY + ' is not set');
  } else {
    const payload = jwtPayload(key);
    if (!payload || typeof payload.role !== 'string') {
      keyReport.role = 'not-a-jwt';
      problems.push(ENV_SERVICE_KEY + ' is not a Supabase JWT');
    } else {
      keyReport.role = payload.role;
      if (payload.role !== 'service_role') {
        problems.push(ENV_SERVICE_KEY + ' belongs to role "' + payload.role + '", not "service_role" — the browser-safe anon key cannot write');
      }
    }
  }

  let credential = null;
  if (source && source.requires_credential) {
    const name = credentialEnvName(source.id);
    const present = String(environment[name] || '').trim() !== '';
    credential = { variable: name, present: present };
    if (!present) problems.push(name + ' is not set (the source declares that it needs a credential)');
  }

  return {
    ready: problems.length === 0,
    problems: problems,
    url: urlReport,
    key: keyReport,
    credential: credential
  };
}

module.exports = {
  ENV_URL: ENV_URL,
  ENV_SERVICE_KEY: ENV_SERVICE_KEY,
  credentialEnvName: credentialEnvName,
  jwtPayload: jwtPayload,
  maskUrl: maskUrl,
  inspectEnvironment: inspectEnvironment
};
