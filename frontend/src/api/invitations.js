/**
 * Invitations addressed to the signed-in user (DASH-5 home screen) —
 * backend/src/projects/invitations.controller.ts.
 *   GET  /invitations/mine                 [{ id, project: { id, name }, role, trade|null, invitedBy: { fullName }|null, expiresAt }]
 *   POST /invitations/by-id/:id/accept     -> membership; 404 unless it is mine and still open; 409 already a member
 *   POST /invitations/by-id/:id/decline    -> 204
 */
export function invitationsApi(client) {
  const id = (x) => encodeURIComponent(x);
  return {
    mine: () => client.get('/invitations/mine'),
    accept: (invitationId) => client.post(`/invitations/by-id/${id(invitationId)}/accept`),
    decline: (invitationId) => client.post(`/invitations/by-id/${id(invitationId)}/decline`),
  };
}
