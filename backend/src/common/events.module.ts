import { Module } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { NotificationsService } from './notifications.service';

/**
 * The two write-only seams every module reports through: what happened
 * (ActivityLogService → AUTH-3 audit log, DASH-6 feed) and who should hear
 * about it (NotificationsService → DASH-2 notification centre). Kept together
 * so a module that records an action also has the means to announce it.
 */
@Module({
  providers: [ActivityLogService, NotificationsService],
  exports: [ActivityLogService, NotificationsService],
})
export class EventsModule {}
