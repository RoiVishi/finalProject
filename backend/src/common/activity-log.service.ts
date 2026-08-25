import { Injectable, Logger } from '@nestjs/common';

/**
 * One audited action. Three requirements consume the same stream:
 * TASK-2 (plan-date edits after execution start), AUTH-3 (admin audit log)
 * and DASH-6 (project activity feed).
 */
export interface ActivityEvent {
  projectId: string;
  actorId: string;
  entity: 'project' | 'task' | 'member' | 'document';
  entityId: string;
  action: string;
  /** Only the fields that changed, so the entry stays readable in the feed. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * The seam, not the storage. Callers record events through this service from
 * today; AUTH-3 (KAN-15) replaces the body with an AuditLog row and every
 * caller keeps working. Introduced here because TASK-2 has an acceptance
 * criterion that cannot be tested against a log line scattered inline —
 * "plan-date edits after execution start are audited" needs something a test
 * can assert was called.
 */
@Injectable()
export class ActivityLogService {
  private readonly log = new Logger(ActivityLogService.name);

  record(event: ActivityEvent): void {
    // TODO (AUTH-3): persist as an AuditLog row; keep this log for demos.
    this.log.log(
      `[audit] ${event.action} ${event.entity}=${event.entityId} `
      + `project=${event.projectId} actor=${event.actorId}`
      + (event.before ? ` before=${JSON.stringify(event.before)}` : '')
      + (event.after ? ` after=${JSON.stringify(event.after)}` : ''),
    );
  }
}
