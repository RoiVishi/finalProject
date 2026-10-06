import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, createApiClient } from './client.js';
import { authApi } from './auth.js';
import { he } from '../i18n/he.js';

/** fetch double: records calls, answers with a canned status/body. */
function fakeFetch(status, body, { throws = false } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (throws) throw new TypeError('Failed to fetch');
    return { status, ok: status >= 200 && status < 300, text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { impl, calls };
}

test('login posts trimmed credentials to /auth/login and returns the token body', async () => {
  const f = fakeFetch(201, { access_token: 'abc' });
  const api = authApi(createApiClient({ baseUrl: '/api', fetchImpl: f.impl }));
  const out = await api.login('  a@b.co ', 'pw12345678');
  assert.deepEqual(out, { access_token: 'abc' });
  assert.equal(f.calls[0].url, '/api/auth/login');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { email: 'a@b.co', password: 'pw12345678' });
  assert.equal(f.calls[0].init.headers.Authorization, undefined);
});

test('bearer token is attached when present', async () => {
  const f = fakeFetch(200, []);
  const c = createApiClient({ fetchImpl: f.impl, getToken: () => 'T' });
  await c.get('/projects');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer T');
  assert.equal(f.calls[0].init.body, undefined);
});

test('Nest validation array becomes ApiError.messages (server text shown as-is)', async () => {
  const f = fakeFetch(400, { statusCode: 400, message: ['מספר טלפון לא תקין', 'יש לבחור מקצוע מהרשימה'], error: 'Bad Request' });
  const c = createApiClient({ fetchImpl: f.impl });
  await assert.rejects(c.post('/auth/register', {}), (e) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 400);
    assert.deepEqual(e.messages, ['מספר טלפון לא תקין', 'יש לבחור מקצוע מהרשימה']);
    return true;
  });
});

test('401 on login (no token) does not trigger logout; 401 with a token does', async () => {
  let loggedOut = 0;
  const f = fakeFetch(401, { statusCode: 401, message: 'שם משתמש או סיסמה שגויים' });
  const anon = createApiClient({ fetchImpl: f.impl, onUnauthorized: () => loggedOut++ });
  await assert.rejects(anon.post('/auth/login', {}), (e) => e.messages[0] === 'שם משתמש או סיסמה שגויים');
  assert.equal(loggedOut, 0);
  const authed = createApiClient({ fetchImpl: f.impl, getToken: () => 'T', onUnauthorized: () => loggedOut++ });
  await assert.rejects(authed.get('/projects'));
  assert.equal(loggedOut, 1);
});

test('network failure and proxy 502 map to the "server unavailable" message', async () => {
  const down = createApiClient({ fetchImpl: fakeFetch(0, null, { throws: true }).impl });
  await assert.rejects(down.get('/x'), (e) => e.status === 0 && e.messages[0] === he.errors.network);
  const proxy = createApiClient({ fetchImpl: fakeFetch(502, '<html>Bad Gateway</html>').impl });
  await assert.rejects(proxy.get('/x'), (e) => e.status === 502 && e.messages[0] === he.errors.network);
});

test('202 / 204 with empty bodies resolve to null (password-reset endpoints)', async () => {
  const req = authApi(createApiClient({ fetchImpl: fakeFetch(202, undefined).impl }));
  assert.equal(await req.requestPasswordReset('a@b.co'), null);
  const f = fakeFetch(204, undefined);
  const conf = authApi(createApiClient({ fetchImpl: f.impl }));
  assert.equal(await conf.confirmPasswordReset('tok', 'abcd1234'), null);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { token: 'tok', password: 'abcd1234' });
});

test('register sends inviteToken only when present', async () => {
  const f = fakeFetch(201, { access_token: 'x' });
  const api = authApi(createApiClient({ fetchImpl: f.impl }));
  const base = { email: 'a@b.co', password: 'abcd1234', fullName: ' רועי ', phone: '050-1234567', profession: 'engineer' };
  await api.register(base);
  await api.register({ ...base, inviteToken: 'inv' });
  assert.equal('inviteToken' in JSON.parse(f.calls[0].init.body), false);
  assert.equal(JSON.parse(f.calls[1].init.body).inviteToken, 'inv');
  assert.equal(JSON.parse(f.calls[0].init.body).fullName, 'רועי');
});

test('unknown error body falls back to the generic message', async () => {
  const c = createApiClient({ fetchImpl: fakeFetch(500, 'oops').impl });
  await assert.rejects(c.get('/x'), (e) => e.status === 500 && e.messages[0] === he.errors.generic);
});
