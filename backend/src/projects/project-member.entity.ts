import {
  Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from './project.entity';

/**
 * Role held INSIDE one project (Requirements §2). The same person can be
 * OWNER here and SUBCONTRACTOR there — which is exactly why this cannot
 * live on User.
 */
export enum ProjectRole {
  OWNER = 'owner',                    // Main Contractor — opens and owns the project
  PROJECT_MANAGER = 'project_manager',
  ENGINEER = 'engineer',
  SUBCONTRACTOR = 'subcontractor',
  INSPECTOR = 'inspector',
}

export enum MemberStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  /** Removed from the project. The row is KEPT — history is preserved (AUTH-5). */
  REMOVED = 'removed',
}

@Entity('project_members')
@Index(['project', 'user'])
export class ProjectMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE', eager: true })
  project: Project;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  user: User;

  @Column({ type: 'enum', enum: ProjectRole })
  role: ProjectRole;

  /** Trade scope, e.g. "electrical". Meaningful for subcontractors. */
  @Column({ nullable: true })
  trade: string;

  @Column({ type: 'enum', enum: MemberStatus, default: MemberStatus.ACTIVE })
  status: MemberStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  removedAt: Date | null;
}
