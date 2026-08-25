import { Injectable, Logger } from '@nestjs/common';

/**
 * The notification seam. DASH-2 (KAN-49) will turn these calls into rows in
 * the notification centre with read/unread state and deep links; until then
 * they are visible log lines, which is what NFR-DEMO-2 asks for.
 *
 * TASK-2 needs exactly one of them: "assignee notified on assignment"
 * (מסמך האפיון §5.1 — "קבלן משנה רואה את המשימה מיד עם השיוך ומקבל התראה").
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  taskAssigned(input: {
    userId: string;
    taskId: string;
    taskName: string;
    projectId: string;
  }): void {
    // TODO (DASH-2): create an Alert row instead of logging.
    this.log.log(
      `[notify] שובצת למשימה "${input.taskName}" — user=${input.userId} `
      + `task=${input.taskId} project=${input.projectId}`,
    );
  }
}
