import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeToken, isExpired } from './token.js';
import { invitationToken, isPublicPath, safeNext } from './redirect.js';
import { PROFESSIONS, validateLogin, validateNewPassword, validateRegister } from './validation.js';

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

test('decodeToken reads the backend claims (sub, email, role, profession, exp)', () => {
  const c = decodeToken(jwt({ sub: 'u1', email: 'a@b.co', role: 'user', profession: 'engineer', exp: 2000000000 }));
  assert.deepEqual(c, { userId: 'u1', email: 'a@b.co', role: 'user', profession: 'engineer', exp: 2000000000 });
});

test('decodeToken handles UTF-8 payloads and rejects malformed tokens', () => {
  assert.equal(decodeToken(jwt({ sub: 'u', email: 'שירה@דוגמה.co' })).email, 'שירה@דוגמה.co');
  for (const bad of [null, '', 'a.b', 'x.y.z', jwt({ email: 'no-sub' })]) assert.equal(decodeToken(bad), null);
});

test('isExpired honours exp with clock skew', () => {
  const now = 1_700_000_000_000;
  assert.equal(isExpired({ exp: now / 1000 + 3600 }, now), false);
  assert.equal(isExpired({ exp: now / 1000 + 10 }, now), true); // inside the 30 s skew
  assert.equal(isExpired({ exp: now / 1000 - 1 }, now), true);
  assert.equal(isExpired(null, now), true);
});

test('safeNext blocks open redirects', () => {
  assert.equal(safeNext('/projects/1?tab=risk'), '/projects/1?tab=risk');
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', null, undefined]) {
    assert.equal(safeNext(bad), '/');
  }
});

test('public paths and invitation links', () => {
  assert.ok(isPublicPath('/login') && isPublicPath('/reset-password'));
  assert.equal(isPublicPath('/'), false);
  assert.equal(invitationToken('/invitations/abc123'), 'abc123');
  assert.equal(invitationToken('/invitations/'), null);
  assert.equal(invitationToken('/invitations/a/b'), null);
});

test('register validation mirrors the backend DTO rules', () => {
  const ok = { email: 'a@b.co', password: 'abcd1234', fullName: 'רועי', phone: '050-1234567', profession: 'engineer' };
  assert.deepEqual(validateRegister(ok), {});
  assert.deepEqual(validateRegister({ ...ok, phone: '0501234567' }), {});
  const e = validateRegister({ email: 'x', password: 'abcdefgh', fullName: 'a', phone: '12345', profession: 'boss' });
  assert.deepEqual(Object.keys(e).sort(), ['email', 'fullName', 'password', 'phone', 'profession']);
});

test('profession list matches the backend enum', () => {
  assert.deepEqual(PROFESSIONS, ['main_contractor', 'project_manager', 'engineer', 'subcontractor', 'inspector']);
});

test('login and new-password validation', () => {
  assert.deepEqual(validateLogin({ email: 'a@b.co', password: 'x' }), {});
  assert.ok(validateLogin({ email: '', password: '' }).password);
  assert.ok(validateNewPassword({ password: 'abcd1234', confirm: 'abcd1235' }).confirm);
  assert.ok(validateNewPassword({ password: 'short1', confirm: 'short1' }).password);
  assert.deepEqual(validateNewPassword({ password: 'abcd1234', confirm: 'abcd1234' }), {});
});
