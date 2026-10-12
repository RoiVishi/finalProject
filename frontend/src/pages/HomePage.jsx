import React, { useMemo } from 'react';
import { projectsApi } from '../api/projects.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { he } from '../i18n/he.js';
import { canCreateProject } from '../projects/wizard.js';
import { Link } from '../router.jsx';
import { Alert } from './AuthLayout.jsx';
import { AppShell, formatDate, useApi } from './AppShell.jsx';

/**
 * DASH-5 home screen — first slice. Shows what GET /projects returns today.
 * The card also renders myRole / riskIndex / blockedCount as soon as the API
 * provides them (requested from the backend in a separate issue); nothing is
 * computed in the browser, so card values always equal API values.
 * Pending invitations need GET /invitations/mine — not rendered until it exists.
 */
export default function HomePage() {
  const { client, user } = useAuth();
  const api = useMemo(() => projectsApi(client), [client]);
  const { data, error, loading, reload } = useApi(() => api.list(), [api]);
  const creator = canCreateProject(user?.profession);
  const t = he.home;

  const newBtn = creator && <Link to="/projects/new" className="cta shell-cta">＋ {t.newProject}</Link>;

  return (
    <AppShell>
      <div className="page-head">
        <h1 className="page-title">{t.title}</h1>
        {newBtn}
      </div>

      {loading && <div className="skeleton-grid">{[0, 1, 2].map((i) => <div key={i} className="project-card skeleton" />)}</div>}

      {error && (
        <div className="stack">
          <Alert messages={[t.loadError, ...error]} />
          <button className="back-btn" onClick={reload}>{t.retry}</button>
        </div>
      )}

      {data && data.length === 0 && (
        <div className="empty card">
          <div className="card-title">{t.empty}</div>
          <p className="card-caption">{creator ? t.emptyCreator : t.emptyMember}</p>
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="project-grid">
          {data.map((p) => <ProjectCard key={p.id} p={p} />)}
        </ul>
      )}
    </AppShell>
  );
}

function ProjectCard({ p }) {
  const t = he.home;
  const has = (k) => p[k] !== undefined && p[k] !== null;
  return (
    <li>
      <Link to={`/projects/${p.id}`} className="project-card">
        <div className="project-card-title">{p.name}</div>
        {p.address && <div className="card-caption">{p.address}</div>}
        <dl className="project-facts">
          {p.layout && (
            <><dt>{t.layout}</dt><dd>{t.floorsZones(p.layout.floors, p.layout.zonesPerFloor)}</dd></>
          )}
          {(p.plannedStart || p.plannedEnd) && (
            <><dt>{t.dates}</dt><dd>{formatDate(p.plannedStart)} – {formatDate(p.plannedEnd)}</dd></>
          )}
          {has('myRole') && <><dt>{t.myRole}</dt><dd>{he.roles[p.myRole] ?? p.myRole}</dd></>}
          {has('riskIndex') && <><dt>{t.riskIndex}</dt><dd>{(p.riskIndex * 100).toFixed(1)}%</dd></>}
          {has('blockedCount') && <><dt>{t.blocked}</dt><dd>{p.blockedCount}</dd></>}
        </dl>
      </Link>
    </li>
  );
}
