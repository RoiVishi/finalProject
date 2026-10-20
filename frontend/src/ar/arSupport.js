/**
 * WebXR capability detection — requirement AR-1.
 *
 * Acceptance criterion: on a browser that cannot do AR the Twin renders
 * unchanged and no AR error surfaces. So this module never throws: every
 * failure path returns a structured reason that the caller turns into a
 * single quiet line of Hebrew, or into hiding the control altogether.
 */
import { useEffect, useState } from 'react';

export const AR_REASONS_HE = {
  'no-webxr': 'הדפדפן הזה אינו תומך ב-WebXR. פתחו את המערכת בטאבלט או בטלפון תומך.',
  'insecure-context': 'תצוגת AR דורשת חיבור מאובטח (HTTPS) או localhost.',
  'no-immersive-ar': 'המכשיר הזה אינו תומך במפגש AR. התצוגה הדו-ממדית זמינה כרגיל.',
  error: 'לא ניתן לבדוק תמיכה ב-AR במכשיר הזה.',
};

/** Short form for the Twin's chip row: one line, in place of the AR button. */
export const AR_UNAVAILABLE_HE = {
  'no-webxr': 'AR לא נתמך בדפדפן זה',
  'insecure-context': 'AR דורש חיבור מאובטח',
  'no-immersive-ar': 'AR לא נתמך במכשיר זה',
  error: 'לא ניתן לבדוק תמיכה ב-AR',
};

/**
 * What the Twin shows in place of the AR entry point (AR-1: "offered only when
 * the device reports AR capability and otherwise hidden behind a one-line
 * explanation").
 *   checking    -> nothing, so the row does not flicker
 *   supported   -> the button
 *   unsupported -> a one-line note; the longer reason goes in its tooltip
 */
export function arEntryFor(support) {
  if (support?.status === 'supported') return { kind: 'button' };
  if (support?.status === 'unsupported') {
    const reason = AR_UNAVAILABLE_HE[support.reason] ? support.reason : 'error';
    return { kind: 'note', label: AR_UNAVAILABLE_HE[reason], detail: AR_REASONS_HE[reason] };
  }
  return { kind: 'none' };
}

/** @returns {Promise<{supported: boolean, reason?: string, detail?: string}>} */
export async function detectArSupport() {
  try {
    if (typeof navigator === 'undefined' || !navigator.xr) {
      return { supported: false, reason: 'no-webxr' };
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return { supported: false, reason: 'insecure-context' };
    }
    const ok = await navigator.xr.isSessionSupported('immersive-ar');
    return ok ? { supported: true } : { supported: false, reason: 'no-immersive-ar' };
  } catch (err) {
    return { supported: false, reason: 'error', detail: String(err) };
  }
}

/**
 * Hook form. Starts as `{ status: 'checking' }` so the UI can stay silent
 * until the answer is known — an AR button that flickers in and out is worse
 * than one that appears a beat late.
 */
export function useArSupport() {
  const [state, setState] = useState({ status: 'checking' });
  useEffect(() => {
    let alive = true;
    detectArSupport().then((r) => {
      if (alive) setState({ status: r.supported ? 'supported' : 'unsupported', ...r });
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/**
 * Requests the session.
 *
 * No `dom-overlay`: the target hardware is a Meta Quest 3S, where the page DOM
 * is not composited into an immersive session and dom-overlay is unavailable.
 * All in-session UI is drawn in the scene instead (ARPanel.jsx), which keeps a
 * single code path for the headset and the department tablet.
 *
 * `anchors` is optional — if the device grants it we can upgrade AR-2 from a
 * captured matrix to a real XRAnchor without touching the call site.
 */
export async function requestArSession() {
  return navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'local-floor'],
    optionalFeatures: ['anchors', 'hand-tracking'],
  });
}

/**
 * Ends a session without letting an error escape (AR-7).
 *
 * XRSession.end() returns a promise that rejects with InvalidStateError when
 * the session has already ended — which is the normal case when the user left
 * through the browser's own exit control and React then cleans up. A plain
 * try/catch does not see that rejection; it surfaced as "Uncaught (in promise)
 * InvalidStateError: XRSession has already ended" in the console.
 */
export function endSessionQuietly(session) {
  try {
    const pending = session?.end?.();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch {
    /* already gone */
  }
}
