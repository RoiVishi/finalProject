import React, { useMemo, useState } from 'react';
import { projectsApi } from '../api/projects.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { he } from '../i18n/he.js';
import {
  INVITABLE_ROLES, MAX_FLOORS, MAX_TEAM, MAX_ZONES_PER_FLOOR, buildCreatePayload, canCreateProject,
  defaultZoneName, emptyWizard, resolvedZoneNames, teamIsValid, validateDetails, validateLayout, validateTeam,
} from '../projects/wizard.js';
import { Link, navigate } from '../router.jsx';
import { Alert, Field } from './AuthLayout.jsx';
import { AppShell } from './AppShell.jsx';

/**
 * TASK-1: three screens for the user, one request for the server (see
 * CreateProjectDto). Step 3 is optional — "אפשר לדלג ולהזמין אחר כך".
 */
export default function WizardPage() {
  const { client, user } = useAuth();
  const api = useMemo(() => projectsApi(client), [client]);
  const [w, setW] = useState(emptyWizard);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [teamErrors, setTeamErrors] = useState({ rows: [] });
  const [serverErrors, setServerErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const t = he.wizard;

  if (!canCreateProject(user?.profession)) {
    // Heuristic only (§2 note 3) — the server would answer 403 anyway.
    return (
      <AppShell>
        <Alert messages={[t.notAllowed]} />
        <Link to="/">{t.toHome}</Link>
      </AppShell>
    );
  }

  const set = (section, key) => (e) => {
    const value = e.target.value;
    setW((s) => ({ ...s, [section]: { ...s[section], [key]: value } }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const next = () => {
    const e = step === 0 ? validateDetails(w.details) : validateLayout(w.layout);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep(step + 1);
  };

  const submit = async (withTeam) => {
    const team = withTeam ? w.team : [];
    const te = validateTeam(team, user?.email);
    setTeamErrors(te);
    if (!teamIsValid(te)) return;
    setBusy(true);
    setServerErrors([]);
    try {
      const created = await api.create(buildCreatePayload({ ...w, team }));
      setResult(created);
    } catch (e) {
      setServerErrors(e?.messages ?? [he.errors.generic]);
    } finally {
      setBusy(false);
    }
  };

  if (result) return <AppShell><Created result={result} /></AppShell>;

  return (
    <AppShell>
      <Link to="/" className="crumb">→ {he.project.back}</Link>
      <div className="wizard card">
        <h1 className="page-title">{t.title}</h1>
        <ol className="stepper" aria-label={t.stepOf(step + 1, 3)}>
          {t.steps.map((s, i) => (
            <li key={s} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="stepper-num">{i < step ? '✓' : i + 1}</span>{s}
            </li>
          ))}
        </ol>

        {step === 0 && <DetailsStep w={w} set={set} errors={errors} />}
        {step === 1 && <LayoutStep w={w} setW={setW} set={set} errors={errors} setErrors={setErrors} />}
        {step === 2 && <TeamStep w={w} setW={setW} errors={teamErrors} setErrors={setTeamErrors} />}

        <Alert messages={serverErrors} />

        <div className="wizard-actions">
          {step < 2 ? (
            <button className="cta" onClick={next}>{t.next}</button>
          ) : (
            <>
              <button className="cta" disabled={busy} aria-busy={busy} onClick={() => submit(true)}>
                {busy ? he.common.loading : t.create}
              </button>
              {w.team.length > 0 && (
                <button className="back-btn" disabled={busy} onClick={() => submit(false)}>{t.skip}</button>
              )}
            </>
          )}
          {step > 0 ? (
            <button className="back-btn" disabled={busy} onClick={() => { setErrors({}); setStep(step - 1); }}>{t.back}</button>
          ) : (
            <button className="back-btn" onClick={() => navigate('/')}>{t.cancel}</button>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function DetailsStep({ w, set, errors }) {
  const t = he.wizard;
  const d = w.details;
  return (
    <div className="auth-form">
      <Field id="name" label={t.name} value={d.name} onChange={set('details', 'name')} error={errors.name} maxLength={120} autoFocus />
      <Field id="address" label={t.address} value={d.address} onChange={set('details', 'address')} maxLength={200} />
      <div className="auth-field">
        <label htmlFor="description">{t.description}</label>
        <textarea id="description" rows={3} maxLength={2000} value={d.description} onChange={set('details', 'description')} />
      </div>
      <div className="two-col">
        <Field id="plannedStart" type="date" label={t.plannedStart} value={d.plannedStart} onChange={set('details', 'plannedStart')} />
        <Field id="plannedEnd" type="date" label={t.plannedEnd} value={d.plannedEnd} onChange={set('details', 'plannedEnd')}
               error={errors.plannedEnd} min={d.plannedStart || undefined} />
      </div>
    </div>
  );
}

function LayoutStep({ w, setW, set, errors, setErrors }) {
  const t = he.wizard;
  const L = w.layout;
  const f = Number(L.floors);
  const z = Number(L.zonesPerFloor);
  const ok = Number.isInteger(f) && f >= 1 && f <= MAX_FLOORS && Number.isInteger(z) && z >= 1 && z <= MAX_ZONES_PER_FLOOR;
  const names = resolvedZoneNames(L);
  const setName = (i) => (e) => {
    const value = e.target.value;
    setW((s) => {
      const zoneNames = Array.from({ length: z }, (_, k) => s.layout.zoneNames?.[k] ?? '');
      zoneNames[i] = value;
      return { ...s, layout: { ...s.layout, zoneNames } };
    });
    setErrors((er) => ({ ...er, zoneNames: undefined }));
  };
  return (
    <div className="auth-form">
      <div className="two-col">
        <Field id="floors" type="number" inputMode="numeric" min={1} max={MAX_FLOORS} label={t.floors}
               value={L.floors} onChange={set('layout', 'floors')} error={errors.floors} />
        <Field id="zonesPerFloor" type="number" inputMode="numeric" min={1} max={MAX_ZONES_PER_FLOOR} label={t.zonesPerFloor}
               value={L.zonesPerFloor} onChange={set('layout', 'zonesPerFloor')} error={errors.zonesPerFloor} />
      </div>

      {ok && (
        <>
          <fieldset className="zone-names">
            <legend>{t.zoneNames} <span className="auth-field-hint">· {t.zoneNamesHint}</span></legend>
            <div className="zone-names-grid">
              {names.map((_, i) => (
                <input key={i} aria-label={`${t.zoneNames} ${i + 1}`} placeholder={defaultZoneName(i + 1)}
                       value={L.zoneNames?.[i] ?? ''} onChange={setName(i)} maxLength={40} />
              ))}
            </div>
            {errors.zoneNames && <div className="auth-field-error">{errors.zoneNames}</div>}
          </fieldset>

          <div>
            <div className="eyebrow">{t.preview} · {t.zoneCount(f * z)}</div>
            <div className="building" style={{ '--z': z }} aria-hidden="true">
              {Array.from({ length: Math.min(f, 12) }, (_, k) => f - k).map((floor) => (
                <div key={floor} className="building-floor">
                  <span className="building-label">{floor}</span>
                  {names.map((n) => <span key={n} className="building-zone" title={`${floor} · ${n}`} />)}
                </div>
              ))}
              {f > 12 && <div className="building-more">{t.moreFloors(f - 12)}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TeamStep({ w, setW, errors, setErrors }) {
  const t = he.wizard;
  const update = (i, key) => (e) => {
    const value = e.target.value;
    setW((s) => ({ ...s, team: s.team.map((m, k) => (k === i ? { ...m, [key]: value } : m)) }));
    setErrors({ rows: [] });
  };
  const add = () => setW((s) => ({ ...s, team: [...s.team, { email: '', role: '', trade: '' }] }));
  const remove = (i) => () => { setW((s) => ({ ...s, team: s.team.filter((_, k) => k !== i) })); setErrors({ rows: [] }); };

  return (
    <div className="auth-form">
      <p className="auth-intro">{t.teamIntro}</p>
      {w.team.map((m, i) => {
        const er = errors.rows?.[i] ?? {};
        return (
          <div key={i} className="team-row">
            <Field id={`email-${i}`} type="email" dir="ltr" label={t.email} value={m.email} onChange={update(i, 'email')} error={er.email} />
            <div className="auth-field">
              <label htmlFor={`role-${i}`}>{t.role}</label>
              <select id={`role-${i}`} value={m.role} onChange={update(i, 'role')} aria-invalid={Boolean(er.role)}>
                <option value="" disabled>—</option>
                {INVITABLE_ROLES.map((r) => <option key={r} value={r}>{he.roles[r]}</option>)}
              </select>
              {er.role && <div className="auth-field-error">{er.role}</div>}
            </div>
            {m.role === 'subcontractor' ? (
              <Field id={`trade-${i}`} label={t.trade} placeholder={t.tradePlaceholder} value={m.trade} onChange={update(i, 'trade')} maxLength={60} />
            ) : <div />}
            <button type="button" className="icon-btn" onClick={remove(i)} aria-label={`${t.remove} ${i + 1}`}>✕</button>
          </div>
        );
      })}
      <Alert messages={errors.form ? [errors.form] : []} />
      {w.team.length < MAX_TEAM && (
        <button type="button" className="back-btn add-row" onClick={add}>＋ {t.addMember}</button>
      )}
    </div>
  );
}

function Created({ result }) {
  const t = he.wizard;
  const sent = (result.team ?? []).filter((x) => x.status === 'sent');
  const failed = (result.team ?? []).filter((x) => x.status === 'failed');
  return (
    <div className="wizard card stack">
      <div className="created-mark" aria-hidden="true">✓</div>
      <h1 className="page-title">{t.createdTitle}</h1>
      <p>{t.createdBody(result.name, result.zoneCount)}</p>
      {sent.length > 0 && <Alert kind="success" messages={[t.invitesSent(sent.length)]} />}
      {failed.length > 0 && (
        <div className="auth-alert error">
          {t.invitesFailed}
          <ul>{failed.map((x) => <li key={x.email}><span dir="ltr">{x.email}</span> — {x.reason}</li>)}</ul>
        </div>
      )}
      <div className="wizard-actions">
        <button className="cta" onClick={() => navigate(`/projects/${result.id}`, { replace: true })}>{t.toProject}</button>
        <button className="back-btn" onClick={() => navigate('/', { replace: true })}>{t.toHome}</button>
      </div>
    </div>
  );
}
