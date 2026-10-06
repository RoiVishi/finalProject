import React from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { PROFESSIONS, validateRegister } from '../auth/validation.js';
import { he } from '../i18n/he.js';
import { Link, navigate } from '../router.jsx';
import { Alert, AuthLayout, Field, SubmitButton, useAuthForm } from './AuthLayout.jsx';

/**
 * AUTH-1 registration (fields per RegisterDto). When opened from an invitation
 * link (?invite=<token>, AUTH-4) the token is sent along and the backend attaches
 * the new user to the project; an expired or revoked link fails before the
 * account is created, and its message is shown as-is.
 */
export default function RegisterPage({ search }) {
  const auth = useAuth();
  const inviteToken = new URLSearchParams(search).get('invite') || undefined;

  const f = useAuthForm(
    { fullName: '', email: '', phone: '', profession: '', password: '' },
    validateRegister,
    async (values) => {
      await auth.register({ ...values, inviteToken });
      navigate('/', { replace: true });
    },
  );

  // An invited person who already has an account logs in and returns to the invitation.
  const loginHref = inviteToken ? `/login?next=${encodeURIComponent(`/invitations/${inviteToken}`)}` : '/login';
  const t = he.register;
  return (
    <AuthLayout
      title={t.title}
      footer={<>{t.haveAccount} <Link to={loginHref}>{t.toLogin}</Link></>}
    >
      <Alert kind="info" messages={inviteToken ? [t.invited] : []} />
      <form className="auth-form" onSubmit={f.submit} noValidate>
        <Field id="fullName" label={t.fullName} autoComplete="name" error={f.errors.fullName} {...f.bind('fullName')} />
        <Field id="email" type="email" label={he.common.email} dir="ltr" autoComplete="email"
               error={f.errors.email} {...f.bind('email')} />
        <Field id="phone" type="tel" label={t.phone} dir="ltr" autoComplete="tel" placeholder="050-1234567"
               error={f.errors.phone} {...f.bind('phone')} />
        <div className="auth-field">
          <label htmlFor="profession">{t.profession}</label>
          <select id="profession" name="profession" aria-invalid={Boolean(f.errors.profession)}
                  aria-describedby={f.errors.profession ? 'profession-err' : undefined} {...f.bind('profession')}>
            <option value="" disabled>{t.chooseProfession}</option>
            {PROFESSIONS.map((p) => <option key={p} value={p}>{he.professions[p]}</option>)}
          </select>
          {f.errors.profession && <div id="profession-err" className="auth-field-error">{f.errors.profession}</div>}
        </div>
        <Field id="password" type="password" label={he.common.password} autoComplete="new-password"
               hint={t.passwordHint} error={f.errors.password} {...f.bind('password')} />
        <Alert messages={f.serverErrors} />
        <SubmitButton busy={f.busy}>{t.submit}</SubmitButton>
      </form>
    </AuthLayout>
  );
}
