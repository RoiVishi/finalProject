/**
 * Client-side mirrors of the backend rules (backend/src/auth/dto/register.dto.ts).
 * They only give early feedback — the server's ValidationPipe stays the source of
 * truth, and its messages are shown as-is when it rejects a request.
 */
import { he } from '../i18n/he.js';

export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
export const PHONE_RULE = /^0\d{1,2}-?\d{7}$/;
// Deliberately loose: the server's IsEmail decides; this only catches typos.
export const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PROFESSIONS = Object.keys(he.professions);

const v = he.validation;

/** Each validator returns { field: message } for the fields that fail. */
export function validateLogin({ email = '', password = '' }) {
  const e = {};
  if (!EMAIL_RULE.test(email.trim())) e.email = v.email;
  if (!password) e.password = v.passwordRequired;
  return e;
}

export function validateRegister({ email = '', password = '', fullName = '', phone = '', profession = '' }) {
  const e = {};
  if (!EMAIL_RULE.test(email.trim())) e.email = v.email;
  if (!PASSWORD_RULE.test(password)) e.password = v.password;
  if (fullName.trim().length < 2) e.fullName = v.fullName;
  if (!PHONE_RULE.test(phone.trim())) e.phone = v.phone;
  if (!PROFESSIONS.includes(profession)) e.profession = v.profession;
  return e;
}

export function validateEmailOnly({ email = '' }) {
  return EMAIL_RULE.test(email.trim()) ? {} : { email: v.email };
}

export function validateNewPassword({ password = '', confirm = '' }) {
  const e = {};
  if (!PASSWORD_RULE.test(password)) e.password = v.password;
  else if (password !== confirm) e.confirm = v.mismatch;
  return e;
}
