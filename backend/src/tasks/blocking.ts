import { TaskStatus } from './task.entity';

/**
 * TASK-4 — "חסימות אוטומטיות בשמות מלאים" (מסמך האפיון §5.4).
 *
 * The requirement is not that the system knows an activity is blocked; TASK-2
 * already computes that. It is that the answer is usable on site: when a
 * subcontractor asks "אפשר להתחיל?", "חסום" sends them to phone somebody,
 * while "חסום על ידי: שלד קומה 3 — א.ב. בנייה, צפי סיום 12.09.2026" tells them
 * who to call and when to come back.
 *
 * Everything here is pure. Blocking is derived on every read and never
 * persisted: a stored blocking flag is a flag that goes stale the moment a
 * predecessor is completed in another session.
 */

export type BlockerKind = 'predecessor' | 'document';

export interface Blocker {
  kind: BlockerKind;
  /** Id of the blocking entity — the activity, or later the document. */
  id: string;
  /** What it is, in the user's words: "שלד קומה 3". */
  label: string;
  /** Who owns it and when it is due: "א.ב. בנייה, צפי סיום 12.09.2026". */
  detail?: string;
}

export interface BlockingState {
  blocked: boolean;
  blockers: Blocker[];
  /** One sentence, ready to show. Empty when nothing blocks. */
  summary: string;
  /** Names only — what TASK-2's "ready" refusal and the Twin badge need. */
  blockingTasks: string[];
}

/** Minimal shape this module needs; the entity satisfies it. */
export interface PredecessorLike {
  id: string;
  name: string;
  status: TaskStatus;
  zone?: string | null;
  plannedEnd?: string | null;
  assignee?: { fullName?: string | null } | null;
}

/** "2026-09-12" → "12.09.2026" — how a date is read on a building site. */
export function formatDueDate(iso?: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function detailOf(predecessor: PredecessorLike): string | undefined {
  const parts: string[] = [];
  const owner = predecessor.assignee?.fullName?.trim();
  if (owner) parts.push(owner);

  const due = formatDueDate(predecessor.plannedEnd);
  if (due) parts.push(`צפי סיום ${due}`);

  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Every predecessor that has not been completed. Order follows the activity's
 * own predecessor list, so the answer does not reshuffle between requests.
 */
export function predecessorBlockers(predecessors: PredecessorLike[] = []): Blocker[] {
  return predecessors
    .filter((p) => p.status !== TaskStatus.COMPLETED)
    .map((p) => ({
      kind: 'predecessor' as const,
      id: p.id,
      label: p.zone ? `${p.name} (${p.zone})` : p.name,
      detail: detailOf(p),
    }));
}

const render = (b: Blocker) => (b.detail ? `${b.label} — ${b.detail}` : b.label);

/**
 * The sentence from the requirement: "blocked by: … ; missing: …". Both halves
 * appear only when they have content, so an activity waiting on documents
 * alone does not print an empty "חסום על ידי:".
 */
export function summarize(blockers: Blocker[]): string {
  const waiting = blockers.filter((b) => b.kind === 'predecessor').map(render);
  const missing = blockers.filter((b) => b.kind === 'document').map(render);

  const parts: string[] = [];
  if (waiting.length > 0) parts.push(`חסום על ידי: ${waiting.join('; ')}`);
  if (missing.length > 0) parts.push(`ממתין לאישור: ${missing.join('; ')}`);
  return parts.join(' · ');
}

/**
 * The whole verdict for one activity. `documentBlockers` is passed in rather
 * than computed here: DOC-4 owns the required-document gate, and when that
 * story lands it supplies the second list without this module changing.
 */
export function blockingState(
  predecessors: PredecessorLike[] = [],
  documentBlockers: Blocker[] = [],
): BlockingState {
  const blockers = [...predecessorBlockers(predecessors), ...documentBlockers];

  return {
    blocked: blockers.length > 0,
    blockers,
    summary: summarize(blockers),
    blockingTasks: blockers.filter((b) => b.kind === 'predecessor').map((b) => b.label),
  };
}
