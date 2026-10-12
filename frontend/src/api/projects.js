/**
 * Projects endpoints — backend/src/projects/projects.controller.ts (all require a JWT).
 *   GET  /projects             live projects the user is an active member of
 *   GET  /projects/:id         404 for non-members (AUTH-2: no existence leak)
 *   GET  /projects/:id/zones   F×Z zone list for the Twin (TWIN-1)
 *   POST /projects             TASK-1 wizard, one payload { details, layout, team? }
 *                              -> project + zoneCount + team: [{ email, status: 'sent'|'failed', reason? }]
 *                              403 when the profession may not open projects (§2 note 3)
 */
export function projectsApi(client) {
  const id = (x) => encodeURIComponent(x);
  return {
    list: () => client.get('/projects'),
    get: (projectId) => client.get(`/projects/${id(projectId)}`),
    zones: (projectId) => client.get(`/projects/${id(projectId)}/zones`),
    create: (payload) => client.post('/projects', payload),
  };
}
