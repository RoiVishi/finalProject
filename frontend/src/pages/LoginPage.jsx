import React from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { safeNext } from '../auth/redirect.js';
import { validateLogin } from '../auth/validation.js';
import { he } from '../i18n/he.js';
import { Link, navigate } from '../router.jsx';
import { Alert, AuthLayout, Field, SubmitButton, useAuthForm } from './AuthLayout.jsx';

/** AUTH-1 login. One generic message for every failure comes from the backend. */
export default function LoginPage({ search }) {
  const auth = useAuth();
  const params = new URLSearchParams(search);
  const next = safeNext(params.get('next'));
  const notice = params.get('reset') === 'done' ? he.reset.done : auth.sessionExpired ? he.errors.sessionExpired : null;

  const f = useAuthForm({ email: '', password: '' }, validateLogin, async ({ email, password }) => {
    await auth.login(email, password);
    navigate(next, { replace: true });
  });

  const t = he.login;
  return (
    <AuthLayout
      title={t.title}
      footer={<>{t.noAccount} <Link to="/register">{t.toRegister}</Link></>}
    >
      <Alert kind={params.get('reset') === 'done' ? 'success' : 'info'} messages={notice ? [notice] : []} />
      <form className="auth-form" onSubmit={f.submit} noValidate>
        <Field id="email" type="email" label={he.common.email} dir="ltr" autoComplete="email"
               error={f.errors.email} {...f.bind('email')} />
        <Field id="password" type="password" label={he.common.password} autoComplete="current-password"
               error={f.errors.password} {...f.bind('password')} />
        <Alert messages={f.serverErrors} />
        <SubmitButton busy={f.busy}>{t.submit}</SubmitButton>
        <div className="auth-links">
          <Link to="/forgot-password">{t.forgot}</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
