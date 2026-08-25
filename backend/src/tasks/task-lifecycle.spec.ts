import { BadRequestException } from '@nestjs/common';
import { ALLOWED_TRANSITIONS, assertTransition, canTransition } from './task-lifecycle';
import { TaskStatus } from './task.entity';

describe('TASK-2 — activity lifecycle', () => {
  it('walks planned → ready → in progress → completed', () => {
    expect(canTransition(TaskStatus.PLANNED, TaskStatus.READY)).toBe(true);
    expect(canTransition(TaskStatus.READY, TaskStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED)).toBe(true);
  });

  it('lets planning be undone, but only before work starts', () => {
    expect(canTransition(TaskStatus.READY, TaskStatus.PLANNED)).toBe(true);
    expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.READY)).toBe(false);
  });

  it.each([
    [TaskStatus.PLANNED, TaskStatus.IN_PROGRESS],
    [TaskStatus.PLANNED, TaskStatus.COMPLETED],
    [TaskStatus.READY, TaskStatus.COMPLETED],
    [TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS],
    [TaskStatus.COMPLETED, TaskStatus.PLANNED],
  ])('rejects %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(BadRequestException);
  });

  it('names the states that are reachable, so the client can show them', () => {
    expect(() => assertTransition(TaskStatus.PLANNED, TaskStatus.COMPLETED))
      .toThrow(/מוכנה להתחלה/);
  });

  it('rejects a no-op transition rather than pretending it happened', () => {
    expect(() => assertTransition(TaskStatus.READY, TaskStatus.READY))
      .toThrow(BadRequestException);
  });

  it('treats completed as terminal — re-opening belongs to execution reporting', () => {
    expect(ALLOWED_TRANSITIONS[TaskStatus.COMPLETED]).toEqual([]);
  });

  it('has no "blocked" state to transition into — blocking is computed', () => {
    expect(Object.values(TaskStatus)).not.toContain('blocked');
  });
});
