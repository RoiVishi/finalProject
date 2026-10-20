import React, { useEffect, useMemo, useState } from 'react';
import { projectsApi } from '../api/projects.js';
import { tasksApi } from '../api/tasks.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { he } from '../i18n/he.js';
import { Link } from '../router.jsx';
import TaskDetail from '../tasks/TaskDetail.jsx';
import TaskList from '../tasks/TaskList.jsx';
import { defaultView, myRoleIn } from '../tasks/taskView.js';
import { Alert } from './AuthLayout.jsx';
import { AppShell, formatDate, useApi } from './AppShell.jsx';

/**
 * Project page: details and layout from GET /projects/:id, then the project's
 * activities (TASK-8) with the detail panel for the selected one (TASK-2/3/4).
 *
 * The viewer's project role is not on GET /projects/:id; it comes from the
 * member list, which the assignee filter needs anyway. Until it arrives the
 * list waits, so a subcontractor never sees the whole-project view flash
 * before their "My tasks" default.
 */
export default function ProjectPage({ id }) {
  const { client, user } = useAuth();
  const api = useMemo(() => projectsApi(client), [client]);
  const tApi = useMemo(() => tasksApi(client), [client]);
  const project = useApi(() => api.get(id), [api, id]);
  const tasks = useApi(() => tApi.list(id), [tApi, id]);
  const zones = useApi(() => api.zones(id), [api, id]);
  const members = useApi(() => api.members(id), [api, id]);
  const t = he.project;
  const p = project.data;

  const role = myRoleIn(members.data, user?.userId);
  const viewer = useMemo(
    () => (members.data ? { userId: user?.userId, role } : null),
    [members.data, role, user?.userId],
  );

  const [view, setView] = useState(null); // { filters, sort } once the role is known
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => { if (viewer && !view) setView(defaultView(viewer.role)); }, [viewer, view]);

  const rows = tasks.data ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <AppShell>
      <Link to="/" className="crumb">→ {t.back}</Link>
      {project.loading && <div className="project-card skeleton" style={{ height: 160 }} />}
      {project.error && <Alert messages={project.status === 404 ? [t.notFound] : project.error} />}
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

          {(tasks.error || members.error) && (
            <div className="stack">
              <Alert messages={[he.tasks.loadError, ...(tasks.error ?? members.error)]} />
              <button className="back-btn" onClick={() => { tasks.reload(); members.reload(); }}>{he.home.retry}</button>
            </div>
          )}
          {!tasks.error && !members.error && (!tasks.data || !view) && (
            <div className="project-card skeleton" style={{ height: 220 }} />
          )}
          {tasks.data && view && (
            <div className={`tasks-layout${selected ? ' with-detail' : ''}`}>
              <TaskList
                tasks={rows}
                zones={zones.data}
                members={members.data}
                viewer={viewer}
                filters={view.filters}
                sort={view.sort}
                onFilters={(f) => setView(f ? { ...view, filters: f } : defaultView(viewer.role))}
                onSort={(s) => setView({ ...view, sort: s })}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              {selected && (
                <TaskDetail
                  key={selected.id}
                  task={selected}
                  tasks={rows}
                  zones={zones.data}
                  viewer={viewer}
                  api={tApi}
                  onChanged={tasks.reload}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
