/**
 * TASK-3 — finish-to-start dependencies. "אי אפשר לרצף עד שסיימו חשמל בקומה"
 * (מסמך האפיון §5.3): an edge means the successor waits for the predecessor
 * to finish.
 *
 * The graph lives in the join table `task_dependencies`; this module holds the
 * only thing that is genuinely graph logic — deciding whether a proposed edge
 * closes a loop, and if so, which loop. Kept pure so the interesting case can
 * be tested without a database.
 */

/** taskId → ids of the activities it waits for. */
export type WaitsFor = Map<string, string[]>;

/**
 * Builds the adjacency map from rows the repository already loaded.
 * Anything missing a predecessor list is treated as waiting for nothing,
 * which is the same thing an empty relation means.
 */
export function buildWaitsFor(
  tasks: { id: string; predecessors?: { id: string }[] }[],
): WaitsFor {
  return new Map(tasks.map((t) => [t.id, (t.predecessors ?? []).map((p) => p.id)]));
}

/**
 * Depth-first search along "waits for" edges. Returns the path from `start` to
 * `target` inclusive, or null when `target` is unreachable.
 *
 * Iterative rather than recursive: a deep chain of activities is entirely
 * plausible on a real schedule, and a stack overflow is a poor way to learn
 * that a project has 5,000 sequential tasks.
 */
export function findPath(graph: WaitsFor, start: string, target: string): string[] | null {
  const stack: string[][] = [[start]];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const path = stack.pop() as string[];
    const node = path[path.length - 1];

    if (node === target && path.length > 1) return path;
    if (visited.has(node)) continue;
    visited.add(node);

    for (const next of graph.get(node) ?? []) {
      if (next === target) return [...path, next];
      if (!visited.has(next)) stack.push([...path, next]);
    }
  }
  return null;
}

/**
 * Would "successor waits for predecessor" close a loop?
 *
 * It would exactly when the predecessor already waits — directly or through a
 * chain — for the successor. The returned path starts and ends at the
 * successor, which is what the user needs to see: the whole ring, not just the
 * word "cycle".
 */
export function cyclePathFor(
  graph: WaitsFor,
  successorId: string,
  predecessorId: string,
): string[] | null {
  if (successorId === predecessorId) return [successorId, successorId];

  const existing = findPath(graph, predecessorId, successorId);
  return existing ? [successorId, ...existing] : null;
}

/** Renders a cycle as names for the error message, e.g. "ריצוף ← חשמל ← ריצוף". */
export const describePath = (path: string[], names: Map<string, string>): string =>
  path.map((id) => names.get(id) ?? id).join(' ← ');
