import { predictionScope } from '../auth/permissions';
import { ProjectRole } from '../projects/project-member.entity';

/**
 * AUTH-2 row-level rule (KAN-128): "subcontractors see risk predictions and
 * explanations for own tasks only". The permission matrix answers "may this
 * role see the project's tasks" (yes); this file answers "which prediction
 * fields may this viewer see on each task".
 */

/** Every field on a task that carries or describes a cached prediction. */
export const PREDICTION_FIELDS = [
  'lateProbability',
  'riskLevel',
  'reliability',
  'predictionBasis',
  'modelVersion',
  'predictedAt',
  'lastPredictionAttemptAt',
  'lastPredictionOutcome',
] as const;

export interface TaskViewer {
  userId: string;
  role: ProjectRole;
}

interface ScopableTask {
  assignee?: { id: string } | null;
  predecessors?: ScopableTask[];
}

/** May this viewer see the prediction of this task? */
export function canSeePrediction(task: ScopableTask, viewer: TaskViewer): boolean {
  if (predictionScope(viewer.role) === 'all') return true;
  // 'own': only tasks assigned to the viewer. A task whose assignee was not
  // loaded is treated as not theirs — the rule fails closed.
  return task.assignee?.id === viewer.userId;
}

/**
 * Response copy of a task for this viewer: prediction fields removed when the
 * viewer may not see them, on the task itself and on every embedded
 * predecessor (each judged by its own assignee). The entity is never mutated.
 * The task itself stays visible — only its prediction is withheld.
 */
export function scopeTaskForViewer<T extends ScopableTask>(task: T, viewer: TaskViewer): T {
  const copy = { ...task } as Record<string, unknown>;
  if (!canSeePrediction(task, viewer)) {
    for (const field of PREDICTION_FIELDS) delete copy[field];
  }
  if (Array.isArray(task.predecessors)) {
    copy.predecessors = task.predecessors.map((p) => scopeTaskForViewer(p, viewer));
  }
  return copy as T;
}
