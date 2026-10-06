import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { validateEmailOnly } from '../auth/validation.js';
import { he } from '../i18n/he.js';
import { Link } from '../router.jsx';
import { Alert, AuthLayout, Field, SubmitButton, useAuthForm } from './AuthLayout.jsx';

/**
 * AUTH-7 request. The backend answers 202 whether or not the address exists,
 * and this screen shows the same neutral confirmation in both cases.
 * In the demo environment the link is printed to the backend log (NFR-DEMO-2).
 */
export default function ForgotPasswordPage() {
  const auth = useAuth();
  const [sent, setSent] = useState(false);
  const f = useAuthForm({ email: '' }, validateEmailOnly, async ({ email }) => {
    await auth.requestPasswordReset(email);
    setSent(true);
  });

  const t = he.forgot;
  return (
    <AuthLayout title={t.title} footer={<Link to="/login">{he.common.backToLogin}</Link>}>
      {sent ? (
        <Alert kind="success" messages={[t.sent]} />
      ) : (
        <form className="auth-form" onSubmit={f.submit} noValidate>
          <p className="auth-intro">{t.intro}</p>
          <Field id="email" type="email" label={he.common.email} dir="ltr" autoComplete="email"
                 error={f.errors.email} {...f.bind('email')} />
          <Alert messages={f.serverErrors} />
          <SubmitButton busy={f.busy}>{t.submit}</SubmitButton>
        </form>
      )}
    </AuthLayout>
  );
}
