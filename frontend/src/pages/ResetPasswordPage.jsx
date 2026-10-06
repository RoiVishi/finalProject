import React from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { validateNewPassword } from '../auth/validation.js';
import { he } from '../i18n/he.js';
import { Link, navigate } from '../router.jsx';
import { Alert, AuthLayout, Field, SubmitButton, useAuthForm } from './AuthLayout.jsx';

/**
 * AUTH-7 confirm: opened from the e-mailed link /reset-password?token=…
 * An invalid, expired or already-used link gets the backend's single message.
 */
export default function ResetPasswordPage({ search }) {
  const auth = useAuth();
  const token = new URLSearchParams(search).get('token');

  const f = useAuthForm({ password: '', confirm: '' }, validateNewPassword, async ({ password }) => {
    await auth.confirmPasswordReset(token, password);
    navigate('/login?reset=done', { replace: true });
  });

  const t = he.reset;
  return (
    <AuthLayout title={t.title} footer={<Link to="/login">{he.common.backToLogin}</Link>}>
      {!token ? (
        <>
          <Alert messages={[t.missingToken]} />
          <Link to="/forgot-password">{he.forgot.title}</Link>
        </>
      ) : (
        <form className="auth-form" onSubmit={f.submit} noValidate>
          <Field id="password" type="password" label={t.newPassword} autoComplete="new-password"
                 hint={he.register.passwordHint} error={f.errors.password} {...f.bind('password')} />
          <Field id="confirm" type="password" label={t.confirm} autoComplete="new-password"
                 error={f.errors.confirm} {...f.bind('confirm')} />
          <Alert messages={f.serverErrors} />
          <SubmitButton busy={f.busy}>{t.submit}</SubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
