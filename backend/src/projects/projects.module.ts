import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../common/mail.module';
import { UsersModule } from '../users/users.module';
import { Invitation } from './invitation.entity';
import {
  InvitationsController, ProjectInvitationsController,
} from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { ProjectMember } from './project-member.entity';
import { ProjectMembersController } from './project-members.controller';
import { ProjectMembersService } from './project-members.service';
import { Project } from './project.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, ProjectMember, Invitation]),
    UsersModule,
    MailModule,
  ],
  controllers: [
    ProjectsController,
    ProjectMembersController,
    ProjectInvitationsController,
    InvitationsController,
  ],
  providers: [ProjectsService, ProjectMembersService, InvitationsService],
  exports: [ProjectsService, ProjectMembersService, InvitationsService],
})
export class ProjectsModule {}
