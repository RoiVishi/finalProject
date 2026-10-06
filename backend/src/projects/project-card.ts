import { blockingState, PredecessorLike } from '../tasks/blocking';
import { canSeePrediction, TaskViewer } from '../tasks/prediction-scope';
import { predictionFreshness } from '../tasks/prediction-freshness';
import { TaskStatus } from '../tasks/task.entity';

/**
 * DASH-5 home-screen card numbers for one project, computed from its tasks.
 *
 * riskIndex   mean lateProbability over the activities that are not completed
 *             and hold a CURRENT prediction. Abstained activities are left
 *             out (PRED-10: "abstained activities excluded from the DASH-5
 *             index"). null when no activity qualifies.
 * riskScope   'project' for every role except a subcontractor, who sees
 *             predictions of their own tasks only (AUTH-2, KAN-128) - for them
 *             the index is the mean over their own tasks and the scope is
 *             'own', so the card can say so instead of implying project risk.
 * blockedCount activities not completed whose blocking state is "blocked",
 *             from the same blockingState() that answers GET /tasks/:id/blocked.
 */
export interface ProjectCardNumbers {
  riskIndex: number | null;
  riskScope: 'project' | 'own';
  blockedCount: number;
}

export interface CardTask {
  status: TaskStatus;
  lateProbability?: number | null;
  predictedAt?: Date | null;
  lastPredictionOutcome?: 'stored' | 'abstained' | null;
  assignee?: { id: string } | null;
  predecessors?: PredecessorLike[];
}

export function projectCardNumbers(tasks: CardTask[], viewer: TaskViewer): ProjectCardNumbers {
  const open = tasks.filter((t) => t.status !== TaskStatus.COMPLETED);

  const probabilities = open
    .filter((t) => canSeePrediction({ assignee: t.assignee }, viewer))
    .filter((t) => predictionFreshness(t as never) === 'current')
    .map((t) => t.lateProbability)
    .filter((p): p is number => typeof p === 'number');

  const riskIndex = probabilities.length
    ? probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length
    : null;

  const blockedCount = open.filter((t) => blockingState(t.predecessors ?? []).blocked).length;

  return {
    riskIndex,
    riskScope: canSeePrediction({ assignee: null }, viewer) ? 'project' : 'own',
    blockedCount,
  };
}
