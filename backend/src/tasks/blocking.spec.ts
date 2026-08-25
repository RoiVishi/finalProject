import { blockingState, formatDueDate, predecessorBlockers, summarize } from './blocking';
import { TaskStatus } from './task.entity';

const predecessor = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'שלד קומה 3',
  status: TaskStatus.IN_PROGRESS,
  zone: 'floor-3/zone-1',
  plannedEnd: '2026-09-12',
  assignee: { fullName: 'א.ב. בנייה' },
  ...over,
}) as never;

describe('TASK-4 — named blockers', () => {
  describe('formatDueDate', () => {
    it('reads a date the way a site does', () => {
      expect(formatDueDate('2026-09-12')).toBe('12.09.2026');
    });

    it('returns null when there is no planned finish to promise', () => {
      expect(formatDueDate(null)).toBeNull();
      expect(formatDueDate('not a date')).toBeNull();
    });
  });

  describe('predecessorBlockers', () => {
    it('names the blocker with its zone, owner and expected finish', () => {
      expect(predecessorBlockers([predecessor()])).toEqual([{
        kind: 'predecessor',
        id: 'p1',
        label: 'שלד קומה 3 (floor-3/zone-1)',
        detail: 'א.ב. בנייה, צפי סיום 12.09.2026',
      }]);
    });

    it('ignores completed predecessors — they block nothing', () => {
      expect(predecessorBlockers([predecessor({ status: TaskStatus.COMPLETED })])).toEqual([]);
    });

    it('still names an unassigned blocker, with what it does know', () => {
      const [blocker] = predecessorBlockers([predecessor({ assignee: null })]);

      expect(blocker.detail).toBe('צפי סיום 12.09.2026');
    });

    it('carries no detail at all rather than an empty one', () => {
      const [blocker] = predecessorBlockers([
        predecessor({ assignee: null, plannedEnd: null, zone: null }),
      ]);

      expect(blocker).toEqual({ kind: 'predecessor', id: 'p1', label: 'שלד קומה 3', detail: undefined });
    });

    it('keeps the order of the activity\'s own predecessor list', () => {
      const ids = predecessorBlockers([
        predecessor({ id: 'a', name: 'שלד' }),
        predecessor({ id: 'b', name: 'חשמל' }),
      ]).map((b) => b.id);

      expect(ids).toEqual(['a', 'b']);
    });
  });

  describe('summarize — the sentence the requirement asks for', () => {
    it('lists what the activity waits for', () => {
      expect(summarize(predecessorBlockers([predecessor()])))
        .toBe('חסום על ידי: שלד קומה 3 (floor-3/zone-1) — א.ב. בנייה, צפי סיום 12.09.2026');
    });

    it('separates several blockers', () => {
      const summary = summarize(predecessorBlockers([
        predecessor({ id: 'a', name: 'שלד', zone: null, assignee: null, plannedEnd: null }),
        predecessor({ id: 'b', name: 'חשמל', zone: null, assignee: null, plannedEnd: null }),
      ]));

      expect(summary).toBe('חסום על ידי: שלד; חשמל');
    });

    it('renders the document half when DOC-4 supplies one', () => {
      const summary = summarize([
        { kind: 'predecessor', id: 'a', label: 'שלד' },
        { kind: 'document', id: 'd1', label: 'אישור קונסטרוקטור' },
      ]);

      expect(summary).toBe('חסום על ידי: שלד · ממתין לאישור: אישור קונסטרוקטור');
    });

    it('prints only the half that has content', () => {
      expect(summarize([{ kind: 'document', id: 'd1', label: 'אישור קונסטרוקטור' }]))
        .toBe('ממתין לאישור: אישור קונסטרוקטור');
    });

    it('says nothing when nothing blocks', () => {
      expect(summarize([])).toBe('');
    });
  });

  describe('blockingState', () => {
    it('is the whole verdict for one activity', () => {
      const state = blockingState([predecessor()]);

      expect(state.blocked).toBe(true);
      expect(state.blockers).toHaveLength(1);
      expect(state.blockingTasks).toEqual(['שלד קומה 3 (floor-3/zone-1)']);
      expect(state.summary).toContain('חסום על ידי');
    });

    it('reports a free activity as unblocked, with an empty sentence', () => {
      expect(blockingState([])).toEqual({
        blocked: false, blockers: [], summary: '', blockingTasks: [],
      });
    });

    it('merges document blockers passed in by DOC-4 without reordering the rest', () => {
      const state = blockingState(
        [predecessor()],
        [{ kind: 'document', id: 'd1', label: 'אישור קונסטרוקטור' }],
      );

      expect(state.blockers.map((b) => b.kind)).toEqual(['predecessor', 'document']);
      expect(state.blockingTasks).toHaveLength(1); // documents are not tasks
    });
  });
});
