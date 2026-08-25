import { buildWaitsFor, cyclePathFor, describePath, findPath } from './dependency-graph';

/** "b waits for a" — the finish-to-start direction of TASK-3. */
const graph = (edges: Record<string, string[]>) =>
  buildWaitsFor(
    Object.entries(edges).map(([id, preds]) => ({ id, predecessors: preds.map((p) => ({ id: p })) })),
  );

describe('TASK-3 — dependency graph', () => {
  describe('findPath', () => {
    it('follows a chain of waits-for edges', () => {
      const g = graph({ c: ['b'], b: ['a'], a: [] });

      expect(findPath(g, 'c', 'a')).toEqual(['c', 'b', 'a']);
    });

    it('returns null when the target is not upstream', () => {
      const g = graph({ c: ['b'], b: [], a: [] });

      expect(findPath(g, 'c', 'a')).toBeNull();
    });

    it('survives an activity that is not in the map at all', () => {
      expect(findPath(graph({}), 'ghost', 'a')).toBeNull();
    });

    it('terminates on a graph that already contains a loop', () => {
      const g = graph({ a: ['b'], b: ['a'] });

      expect(findPath(g, 'a', 'c')).toBeNull();
    });
  });

  describe('cyclePathFor — the check before an edge is written', () => {
    it('allows an edge that only deepens a chain', () => {
      const g = graph({ b: ['a'], a: [], c: [] });

      expect(cyclePathFor(g, 'c', 'b')).toBeNull();
    });

    it('allows two activities to share the same predecessor', () => {
      const g = graph({ b: ['a'], c: [], a: [] });

      expect(cyclePathFor(g, 'c', 'a')).toBeNull();
    });

    it('rejects an activity waiting for itself', () => {
      expect(cyclePathFor(graph({ a: [] }), 'a', 'a')).toEqual(['a', 'a']);
    });

    it('rejects the two-activity ring and returns it whole', () => {
      const g = graph({ b: ['a'], a: [] });

      expect(cyclePathFor(g, 'a', 'b')).toEqual(['a', 'b', 'a']);
    });

    it('rejects a ring that closes only through a long chain', () => {
      const g = graph({ b: ['a'], c: ['b'], d: ['c'], a: [] });

      expect(cyclePathFor(g, 'a', 'd')).toEqual(['a', 'd', 'c', 'b', 'a']);
    });
  });

  describe('describePath', () => {
    it('renders the ring with the names a user recognises', () => {
      const names = new Map([['a', 'שלד'], ['b', 'חשמל']]);

      expect(describePath(['a', 'b', 'a'], names)).toBe('שלד ← חשמל ← שלד');
    });

    it('falls back to the id when a name is missing', () => {
      expect(describePath(['x'], new Map())).toBe('x');
    });
  });
});
