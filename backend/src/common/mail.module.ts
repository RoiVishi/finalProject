import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Shared by AuthModule (password reset) and ProjectsModule (invitations). */
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
