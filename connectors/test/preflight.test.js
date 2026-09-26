'use strict';

/**
 * The runner's environment rules: fail closed, name what is missing, and never
 * print a secret.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const preflight = require('../lib/preflight');
const { fakeJwt } = require('./_helpers');

const SOURCE = { id: '11111111-1111-4111-8111-111111111111', requires_credential: true };

test('preflight: an empty environment is not ready and names both variables', () => {
  const readiness = preflight.inspectEnvironment({});
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.problems, ['SUPABASE_URL is not set', 'SUPABASE_SERVICE_ROLE_KEY is not set']);
  assert.equal(readiness.url.value, '');
});

test('preflight: a ready environment reports the role and masks the project reference', () => {
  const readiness = preflight.inspectEnvironment({
    SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: fakeJwt('service_role')
  });
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.problems, []);
  assert.equal(readiness.url.value, 'https://<project>.supabase.co');
  assert.equal(readiness.key.role, 'service_role');
  assert.ok(readiness.key.length > 0);
  assert.equal(readiness.key.present, true);
});

test('preflight: the anon key is refused with the reason it cannot write', () => {
  const readiness = preflight.inspectEnvironment({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: fakeJwt('anon')
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.key.role, 'anon');
  assert.match(readiness.problems.join(' '), /cannot write/);
});

test('preflight: a key that is not a JWT, and a URL that is not https, are both refused', () => {
  const notJwt = preflight.inspectEnvironment({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sk_live_abc' });
  assert.equal(notJwt.ready, false);
  assert.equal(notJwt.key.role, 'not-a-jwt');

  const notHttps = preflight.inspectEnvironment({ SUPABASE_URL: 'http://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: fakeJwt('service_role') });
  assert.equal(notHttps.ready, false);
  assert.match(notHttps.problems.join(' '), /must be an https URL/);
});

test('preflight: a source credential is looked up by convention, from the environment only', () => {
  const name = preflight.credentialEnvName(SOURCE.id);
  assert.equal(name, 'PV_SOURCE_111111111111_TOKEN');

  const missing = preflight.inspectEnvironment({}, SOURCE);
  assert.equal(missing.credential.present, false);
  assert.match(missing.problems.join(' '), new RegExp(name + ' is not set'));

  const present = preflight.inspectEnvironment({ [name]: 'a-source-credential' }, SOURCE);
  assert.equal(present.credential.present, true);
  assert.equal(JSON.stringify(present).includes('a-source-credential'), false, 'a credential value is never reported');
});

test('preflight: a jwt payload is decoded without being trusted, and garbage is not decoded', () => {
  assert.equal(preflight.jwtPayload(fakeJwt('service_role')).role, 'service_role');
  assert.equal(preflight.jwtPayload(''), null);
  assert.equal(preflight.jwtPayload('one.two'), null);
  assert.equal(preflight.jwtPayload('a.b.c'), null);
});
