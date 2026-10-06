import { Task } from './task.entity';

/**
 * TASK-5 / KAN-127: can the cached prediction be shown as current?
 *
 * - 'current'   — the last attempt stored this number.
 * - 'abstained' — the last attempt was withheld by the AI service; any number
 *                 on the row is an older one and must be shown with its own
 *                 predictedAt, never as fresh ("no current prediction —
 *                 project history below threshold").
 * - 'none'      — no prediction has ever been stored.
 */
export type PredictionFreshness = 'current' | 'abstained' | 'none';

export function predictionFreshness(
  task: Pick<Task, 'predictedAt' | 'lastPredictionOutcome'>,
): PredictionFreshness {
  if (task.lastPredictionOutcome === 'abstained') return 'abstained';
  return task.predictedAt ? 'current' : 'none';
}
