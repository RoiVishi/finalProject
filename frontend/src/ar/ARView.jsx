/**
 * AR mode entry point.
 *
 * Requirements: AR-1 (entry point and capability detection) and AR-7
 * (isolation — the error boundary below is what guarantees that a broken AR
 * session cannot take the 2D Twin down with it).
 *
 * Note on where the UI lives. Everything the user sees *during* a session is an
 * object in the 3D scene (ARPanel.jsx), not HTML. On the Meta Quest 3S the page
 * DOM is not composited into an immersive session at all, and `dom-overlay` —
 * which would solve this on a phone — is not available there. Using in-scene
 * panels on both devices keeps one code path for the headset (AR-9) and the
 * department tablet (AR-6).
 *
 * Leaving the session is therefore the browser's job: the Meta Browser and
 * mobile Chrome both provide their own exit control, and the `end` event below
 * brings us back to the Twin.
 */
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { AR_REASONS_HE, requestArSession, useArSupport } from './arSupport.js';

const ARScene = React.lazy(() => import('./ARScene.jsx'));

/* ------------------------------------------------------------------ */
/* AR-7: nothing that happens in here escapes                          */
/* ------------------------------------------------------------------ */

class ARErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // Console only: the Twin behind us keeps working and the user gets one
    // quiet line, not a stack trace.
    console.warn('[AR] contained failure:', error);
  }

  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

/* ------------------------------------------------------------------ */

const cardStyle = {
  pointerEvents: 'auto',
  background: 'rgba(17,24,32,0.86)',
  color: '#fff',
  borderRadius: 14,
  padding: '14px 16px',
  fontSize: 13,
  lineHeight: 1.55,
  backdropFilter: 'blur(8px)',
  maxWidth: 360,
  direction: 'rtl',
};

const buttonStyle = {
  background: '#2e7d32',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '9px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

export default function ARView({ spec, selected, onSelect, onExit, scale = 0.02 }) {
  const support = useArSupport();
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('');
  const [, setPlaced] = useState(false); // AR-2 placement flag, kept for the status copy
  const [failed, setFailed] = useState(null);

  const start = useCallback(async () => {
    setFailed(null);
    try {
      const s = await requestArSession();
      setSession(s);
      setPlaced(false);
      setStatus('מאתר משטח…');
    } catch (err) {
      setFailed(
        err?.name === 'NotAllowedError'
          ? 'ההרשאה נדחתה. אפשר לאשר ולנסות שוב.'
          : `לא ניתן להתחיל מפגש AR (${err?.name ?? 'שגיאה'}).`,
      );
    }
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    const handleEnd = () => {
      setSession(null);
      setPlaced(false);
      setStatus('');
      onExit?.();
    };
    session.addEventListener('end', handleEnd);
    return () => session.removeEventListener('end', handleEnd);
  }, [session, onExit]);

  // Never leave a session running behind us.
  useEffect(
    () => () => {
      try {
        session?.end?.();
      } catch {
        /* already gone */
      }
    },
    [session],
  );

  if (support.status === 'checking') return null;

  if (support.status === 'unsupported') {
    return (
      <div style={{ ...cardStyle, position: 'absolute', bottom: 16, insetInlineStart: 16, zIndex: 6 }}>
        {AR_REASONS_HE[support.reason] ?? AR_REASONS_HE.error}
        <div style={{ marginTop: 10 }}>
          <button onClick={onExit} style={buttonStyle}>
            חזרה לתאום הדו-ממדי
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6 }}>
      {session && (
        <ARErrorBoundary
          fallback={
            <div style={{ ...cardStyle, position: 'absolute', top: 16, insetInlineStart: 16 }}>
              תצוגת ה-AR נעצרה. התאום הדו-ממדי ממשיך לעבוד כרגיל.
            </div>
          }
        >
          <Suspense fallback={null}>
            <ARScene
              session={session}
              spec={spec}
              scale={scale}
              selected={selected}
              onSelect={onSelect}
              onPlaced={setPlaced}
              onStatus={setStatus}
              status={status}
            />
          </Suspense>
        </ARErrorBoundary>
      )}

      {/* Pre-session screen. Once the session starts the page DOM is no longer
          visible, and everything moves into the scene. */}
      {!session && (
        <div style={{ position: 'absolute', bottom: 18, insetInlineStart: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {failed && <div style={{ ...cardStyle, borderInlineStart: '3px solid #f44336' }}>{failed}</div>}
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>תצוגת מציאות רבודה</div>
            <div style={{ opacity: 0.85, marginBottom: 10 }}>
              הרכיבו את המשקפיים, כוונו אל הרצפה או אל שולחן ולחצו על ההדק כדי להניח את הבניין.
              קומות שהושלמו יופיעו אטומות והקומות המתוכננות בשקיפות, צבועות לפי סיכון העיכוב החזוי.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={start} style={buttonStyle}>
                התחלת AR
              </button>
              <button
                onClick={onExit}
                style={{ ...buttonStyle, background: 'transparent', border: '1px solid rgba(255,255,255,0.35)' }}
              >
                חזרה
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
