import React, { useMemo } from 'react';
import { projectsApi } from '../api/projects.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { he } from '../i18n/he.js';
import { Link } from '../router.jsx';
import { Alert } from './AuthLayout.jsx';
import { AppShell, formatDate, useApi } from './AppShell.jsx';

/**
 * Project page — first slice: details and layout from GET /projects/:id.
 * The activity list and detail (TASK-2/3/4/8, S8) will be added here.
 */
export default function ProjectPage({ id }) {
  const { client } = useAuth();
  const api = useMemo(() => projectsApi(client), [client]);
  const { data: p, error, loading, status } = useApi(() => api.get(id), [api, id]);
  const t = he.project;

  return (
    <AppShell>
      <Link to="/" className="crumb">→ {t.back}</Link>
      {loading && <div className="project-card skeleton" style={{ height: 160 }} />}
      {error && <Alert messages={status === 404 ? [t.notFound] : error} />}
      {p && (
        <div className="stack">
          <h1 className="page-title">{p.name}</h1>
          <div className="card">
            <div className="eyebrow">{t.details}</div>
            <dl className="project-facts wide">
              {p.address && <><dt>{t.address}</dt><dd>{p.address}</dd></>}
              {(p.plannedStart || p.plannedEnd) && (
                <><dt>{he.home.dates}</dt><dd>{formatDate(p.plannedStart)} – {formatDate(p.plannedEnd)}</dd></>
              )}
              {p.layout && (
                <>
                  <dt>{he.home.layout}</dt>
                  <dd>{he.home.floorsZones(p.layout.floors, p.layout.zonesPerFloor)}</dd>
                  <dt>{t.zones}</dt>
                  <dd>{p.layout.floors * p.layout.zonesPerFloor}</dd>
                </>
              )}
              {p.description && <><dt>{t.description}</dt><dd className="pre">{p.description}</dd></>}
            </dl>
          </div>
          <div className="card card-caption">{t.activitiesSoon}</div>
        </div>
      )}
    </AppShell>
  );
}
