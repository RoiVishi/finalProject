import React, { Suspense, useEffect } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { invitationToken, isPublicPath, safeNext } from './auth/redirect.js';
import { he } from './i18n/he.js';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import HomePage from './pages/HomePage.jsx';
import ProjectPage from './pages/ProjectPage.jsx';
import WizardPage from './pages/WizardPage.jsx';
import InvitationPage from './pages/InvitationPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import { Link, navigate, useLocation } from './router.jsx';
import { matchAppRoute } from './routes.js';

/**
 * Top-level routing and the session gate. Signed-in routes are in routes.js:
 * home (/), project wizard, project page, and /twin, where App.jsx (Twin + AR)
 * is rendered unchanged — so this file never touches what the AR work changes.
 *
 * Dev-only escape hatch: `VITE_DEV_SKIP_AUTH=1 npm run dev` opens the app
 * without a backend (e.g. for AR work on an emulator). It is compiled out of
 * production builds because import.meta.env.DEV is false there.
 */
// The Twin (three.js) is a large chunk; the auth screens should not wait for it.
const App = React.lazy(() => import('./App.jsx'));

const SKIP_AUTH = import.meta.env.DEV && import.meta.env.VITE_DEV_SKIP_AUTH === '1';

function Redirect({ to }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function SessionChip() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <div className="session-chip" dir="rtl">
      <Link to="/" className="session-home">{he.home.title}</Link>
      <span dir="ltr">{user.email}</span>
      <button onClick={() => { logout(); navigate('/login', { replace: true }); }}>{he.common.logout}</button>
    </div>
  );
}

function Routes() {
  const { pathname, search } = useLocation();
  const { isAuthenticated } = useAuth();

  if (SKIP_AUTH) return <App />;

  const invite = invitationToken(pathname);
  if (invite && !isAuthenticated) return <Redirect to={`/register?invite=${invite}`} />;
  if (invite) return <InvitationPage token={invite} />;

  if (isPublicPath(pathname)) {
    // Reset links must work even for someone who is still signed in on this device.
    if (pathname === '/reset-password') return <ResetPasswordPage search={search} />;
    if (isAuthenticated) return <Redirect to={safeNext(new URLSearchParams(search).get('next'))} />;
    if (pathname === '/login') return <LoginPage search={search} />;
    if (pathname === '/register') return <RegisterPage search={search} />;
    return <ForgotPasswordPage />;
  }

  if (!isAuthenticated) {
    const next = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return <Redirect to={`/login${next}`} />;
  }

  const route = matchAppRoute(pathname);
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'wizard') return <WizardPage />;
  if (route.name === 'project') return <ProjectPage id={route.id} />;
  if (route.name === 'notFound') return <Redirect to="/" />;
  return (
    <>
      <SessionChip />
      <App />
    </>
  );
}

export default function Root() {
  return (
    <AuthProvider>
      <Suspense fallback={null}>
        <Routes />
      </Suspense>
    </AuthProvider>
  );
}
