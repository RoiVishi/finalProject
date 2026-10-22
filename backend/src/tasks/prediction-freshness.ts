import { Task } from './task.entity';

/**
 * TASK-5: can the cached prediction be shown as current?
 *
 * - 'current'   - the last attempt stored this number, and nothing it was
 *                 computed from has changed since.
 * - 'stale'     - KAN-26: the activity's planned dates or dependencies changed
 *                 after predictedAt. The number describes a plan that no longer
 *                 exists; show it only as "last known, being recalculated".
 * - 'abstained' - KAN-127: the last attempt was withheld by the AI service; any
 *                 number on the row is an older one and must be shown with its
 *                 own predictedAt, never as fresh.
 * - 'none'      - no prediction has ever been stored.
 */
export type PredictionFreshness = 'current' | 'stale' | 'abstained' | 'none';

export function predictionFreshness(
  task: Pick<Task, 'predictedAt' | 'lastPredictionOutcome'>
    & Partial<Pick<Task, 'predictionInputsChangedAt'>>,
): PredictionFreshness {
  if (task.lastPredictionOutcome === 'abstained') return 'abstained';
  if (!task.predictedAt) return 'none';
  const changed = task.predictionInputsChangedAt;
  if (changed && new Date(changed).getTime() > new Date(task.predictedAt).getTime()) {
    return 'stale';
  }
  return 'current';
}
