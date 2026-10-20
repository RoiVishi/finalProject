/**
 * Tasks endpoints — backend/src/tasks/tasks.controller.ts (all require a JWT and project membership).
 *   GET    /tasks?projectId=                    the project's activities, each with its blocking verdict
 *                                               (blocked, blockers, summary) and the viewer-scoped prediction
 *   GET    /tasks/:id                           one activity, same shape
 *   POST   /tasks/:id/status { status }         TASK-2 lifecycle move (MANAGE_TASKS); 409 + named
 *                                               blockers when "ready" is refused (TASK-4)
 *   POST   /tasks/:id/dependencies { predecessorId }    TASK-3 (MANAGE_TASKS); cycles refused
 *   DELETE /tasks/:id/dependencies/:predecessorId       TASK-3 (MANAGE_TASKS)
 */
export function tasksApi(client) {
  const id = (x) => encodeURIComponent(x);
  return {
    list: (projectId) => client.get(`/tasks?projectId=${id(projectId)}`),
    get: (taskId) => client.get(`/tasks/${id(taskId)}`),
    changeStatus: (taskId, status) => client.post(`/tasks/${id(taskId)}/status`, { status }),
    addDependency: (taskId, predecessorId) =>
      client.post(`/tasks/${id(taskId)}/dependencies`, { predecessorId }),
    removeDependency: (taskId, predecessorId) =>
      client.del(`/tasks/${id(taskId)}/dependencies/${id(predecessorId)}`),
  };
}
