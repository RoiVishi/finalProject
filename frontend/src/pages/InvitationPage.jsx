import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { he } from '../i18n/he.js';
import { navigate } from '../router.jsx';
import { Alert, AuthLayout } from './AuthLayout.jsx';

/**
 * AUTH-4 landing for a signed-in user who opens /invitations/<token>.
 * (A signed-out user is sent to registration with the token instead — see Root.)
 * Minimal on purpose: the full invitations UX is KAN-16 (S7).
 */
export default function InvitationPage({ token }) {
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);
  const t = he.invitation;

  const act = async (action) => {
    setBusy(true);
    setErrors([]);
    try {
      await client.post(`/invitations/${encodeURIComponent(token)}/${action}`);
      navigate('/', { replace: true });
    } catch (e) {
      setErrors(e.messages ?? [he.errors.generic]);
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t.title}>
      <p className="auth-intro">{t.intro}</p>
      <Alert messages={errors} />
      <div className="auth-form">
        <button className="cta auth-submit" disabled={busy} onClick={() => act('accept')}>{t.accept}</button>
        <button className="back-btn" disabled={busy} onClick={() => act('decline')}>{t.decline}</button>
      </div>
    </AuthLayout>
  );
}
