import React, { useMemo, useState } from 'react';
import { invitationsApi } from '../api/invitations.js';
import { projectsApi } from '../api/projects.js';
import { RISK_COLORS } from '../ar/riskBands.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { he } from '../i18n/he.js';
import { riskView, roleView } from '../projects/card.js';
import { canCreateProject } from '../projects/wizard.js';
import { Link } from '../router.jsx';
import { Alert } from './AuthLayout.jsx';
import { AppShell, formatDate, useApi } from './AppShell.jsx';

/**
 * DASH-5 home screen: pending invitations, "my projects" cards and the
 * "New project" button. Every number on a card is the value GET /projects
 * returns (myRole, riskIndex + riskScope, blockedCount) — nothing is computed
 * in the browser, so card values equal API values.
 */
export default function HomePage() {
  const { client, user } = useAuth();
  const api = useMemo(() => projectsApi(client), [client]);
  const inv = useMemo(() => invitationsApi(client), [client]);
  const projects = useApi(() => api.list(), [api]);
  const invites = useApi(() => inv.mine(), [inv]);
  const creator = canCreateProject(user?.profession);
  const t = he.home;

  return (
    <AppShell>
      <div className="page-head">
        <h1 className="page-title">{t.title}</h1>
        {creator && <Link to="/projects/new" className="cta shell-cta">＋ {t.newProject}</Link>}
      </div>

      {invites.data && invites.data.length > 0 && (
        <PendingInvitations
          items={invites.data}
          api={inv}
          onAccepted={() => { invites.reload(); projects.reload(); }}
          onDeclined={invites.reload}
        />
      )}

      {projects.loading && (
        <div className="skeleton-grid">{[0, 1, 2].map((i) => <div key={i} className="project-card skeleton" />)}</div>
      )}

      {projects.error && (
        <div className="stack">
          <Alert messages={[t.loadError, ...projects.error]} />
          <button className="back-btn" onClick={projects.reload}>{t.retry}</button>
        </div>
      )}

      {projects.data && projects.data.length === 0 && (
        <div className="empty card">
          <div className="card-title">{t.empty}</div>
          <p className="card-caption">{creator ? t.emptyCreator : t.emptyMember}</p>
        </div>
      )}

      {projects.data && projects.data.length > 0 && (
        <ul className="project-grid">
          {projects.data.map((p) => <ProjectCard key={p.id} p={p} />)}
        </ul>
      )}
    </AppShell>
  );
}

function PendingInvitations({ items, api, onAccepted, onDeclined }) {
  const t = he.home;
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});

  const act = async (id, action) => {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: undefined }));
    try {
      await api[action](id);
      (action === 'accept' ? onAccepted : onDeclined)();
    } catch (e) {
      setErrors((er) => ({ ...er, [id]: e?.messages ?? [he.errors.generic] }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card invites" aria-labelledby="invites-title">
      <h2 id="invites-title" className="card-title">{t.invitesTitle} ({items.length})</h2>
      <ul className="invite-list">
        {items.map((i) => (
          <li key={i.id} className="invite">
            <div className="invite-text">
              <div className="invite-project">{i.project.name}</div>
              <div className="card-caption">
                {roleView(i.role, i.trade)}
                {i.invitedBy?.fullName && <> · {t.invitedBy(i.invitedBy.fullName)}</>}
                {' · '}{t.expires(formatDate(i.expiresAt))}
              </div>
              <Alert messages={errors[i.id]} />
            </div>
            <div className="invite-actions">
              <button className="cta" disabled={busy !== null} aria-busy={busy === i.id} onClick={() => act(i.id, 'accept')}>
                {busy === i.id ? he.common.loading : t.accept}
              </button>
              <button className="back-btn" disabled={busy !== null} onClick={() => act(i.id, 'decline')}>{t.decline}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProjectCard({ p }) {
  const t = he.home;
  const risk = 'riskIndex' in p ? riskView(p.riskIndex, p.riskScope) : null;
  return (
    <li>
      <Link to={`/projects/${p.id}`} className="project-card">
        <div className="project-card-title">{p.name}</div>
        {p.address && <div className="card-caption">{p.address}</div>}
        {risk && (
          <div className="card-risk" style={{ '--risk': RISK_COLORS[risk.band] }}>
            <span className="card-risk-label">{risk.label}</span>
            <span className={`card-risk-value ${risk.value === null ? 'muted' : ''}`}>{risk.text}</span>
          </div>
        )}
        <dl className="project-facts">
          {p.myRole && <><dt>{t.myRole}</dt><dd>{roleView(p.myRole)}</dd></>}
          {typeof p.blockedCount === 'number' && (
            <><dt>{t.blocked}</dt><dd className={p.blockedCount > 0 ? 'warn' : ''}>{p.blockedCount}</dd></>
          )}
          {p.layout && <><dt>{t.layout}</dt><dd>{t.floorsZones(p.layout.floors, p.layout.zonesPerFloor)}</dd></>}
          {(p.plannedStart || p.plannedEnd) && (
            <><dt>{t.dates}</dt><dd>{formatDate(p.plannedStart)} – {formatDate(p.plannedEnd)}</dd></>
          )}
        </dl>
      </Link>
    </li>
  );
}
