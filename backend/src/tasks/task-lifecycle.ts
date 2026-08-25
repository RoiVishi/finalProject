import { BadRequestException } from '@nestjs/common';
import { TaskStatus } from './task.entity';

/**
 * TASK-2 — "lifecycle planned → ready → in-progress → completed; 'blocked' is
 * computed, never set manually" (מסמך האפיון §5.2).
 *
 * Blocked is absent from TaskStatus on purpose: a status column that can hold
 * 'blocked' is a status column someone will eventually set by hand, and then
 * the Twin shows a colour that no dependency justifies. Blocking is derived
 * from unfinished predecessors (and, from TASK-4/DOC-4, from unapproved
 * required documents) every time a task is read.
 */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  // Planning is reversible right up to the moment work starts...
  [TaskStatus.PLANNED]: [TaskStatus.READY],
  [TaskStatus.READY]: [TaskStatus.PLANNED, TaskStatus.IN_PROGRESS],

  // ...and stops being reversible once it has. An activity that started and
  // then "un-started" would silently drop its actual start date, which is the
  // one number the plan-vs-execution comparison of the project book rests on.
  [TaskStatus.IN_PROGRESS]: [TaskStatus.COMPLETED],

  // Terminal here. Re-opening a completed activity is execution reporting
  // (TASK-10) and needs its own audit trail, not a quiet status flip.
  [TaskStatus.COMPLETED]: [],
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.PLANNED]: 'מתוכננת',
  [TaskStatus.READY]: 'מוכנה להתחלה',
  [TaskStatus.IN_PROGRESS]: 'בביצוע',
  [TaskStatus.COMPLETED]: 'הושלמה',
};

export const canTransition = (from: TaskStatus, to: TaskStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to);

/** Rejects an illegal transition with the states that ARE reachable from here. */
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) {
    throw new BadRequestException(`המשימה כבר במצב "${STATUS_LABELS[to]}"`);
  }
  if (!canTransition(from, to)) {
    const allowed = ALLOWED_TRANSITIONS[from].map((s) => `"${STATUS_LABELS[s]}"`);
    const target = allowed.length ? allowed.join(' או ') : 'אף מצב';
    throw new BadRequestException(
      `לא ניתן לעבור מ"${STATUS_LABELS[from]}" ל"${STATUS_LABELS[to]}" — מכאן אפשר לעבור ל${target}`,
    );
  }
}
