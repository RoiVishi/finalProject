import React, { useState } from 'react';
import { he } from '../i18n/he.js';
import './auth.css';

/** Shared frame for the four auth screens: brand header + one card. */
export function AuthLayout({ title, children, footer }) {
  return (
    <div className="auth-page" dir="rtl">
      <main className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="logo-mark" aria-hidden="true">🏗️</div>
          <div>
            <div className="app-title">{he.app.name}</div>
            <div className="app-subtitle">{he.app.tagline}</div>
          </div>
        </div>
        <h1 id="auth-title" className="auth-title">{title}</h1>
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </main>
    </div>
  );
}

/** Labelled input with an inline error; `dir` lets email/phone stay LTR inside an RTL form. */
export function Field({ id, label, error, hint, dir, ...input }) {
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} dir={dir} aria-invalid={Boolean(error)} aria-describedby={describedBy} {...input} />
      {error ? (
        <div id={`${id}-err`} className="auth-field-error">{error}</div>
      ) : hint ? (
        <div id={`${id}-hint`} className="auth-field-hint">{hint}</div>
      ) : null}
    </div>
  );
}

export function Alert({ kind = 'error', messages }) {
  if (!messages || messages.length === 0) return null;
  return (
    <div className={`auth-alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {messages.length === 1 ? messages[0] : <ul>{messages.map((m) => <li key={m}>{m}</li>)}</ul>}
    </div>
  );
}

export function SubmitButton({ busy, children }) {
  return (
    <button type="submit" className="cta auth-submit" disabled={busy} aria-busy={busy}>
      {busy ? he.common.loading : children}
    </button>
  );
}

/**
 * Form state helper: client-side validation first, then the server call.
 * Server messages (already Hebrew, from the Nest DTOs/services) are shown as-is.
 */
export function useAuthForm(initial, validate, onSubmit) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [serverErrors, setServerErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  const bind = (name) => ({
    value: values[name],
    onChange: (e) => {
      const value = e.target.value;
      setValues((v) => ({ ...v, [name]: value }));
      if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
    },
  });

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const found = validate(values);
    setErrors(found);
    setServerErrors([]);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setServerErrors(err?.messages ?? [he.errors.generic]);
    } finally {
      setBusy(false);
    }
  };

  return { values, errors, serverErrors, busy, bind, submit };
}
