import {
  Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { ProjectRole } from './project-member.entity';
import { Project } from './project.entity';

export enum InvitationType {
  /** Addressed to one e-mail address (owner or PM). */
  EMAIL = 'email',
  /** Shareable link, scoped to a role and trade (owner only). */
  LINK = 'link',
}

/**
 * EXPIRED is not stored: it is derived from expiresAt, so no scheduled job is
 * needed for an invitation to stop working. effectiveStatus() below is the
 * single place that decides.
 */
export enum InvitationStatus {
  SENT = 'sent',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

@Entity('invitations')
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE', eager: true })
  project: Project;

  @Column({ type: 'enum', enum: InvitationType })
  type: InvitationType;

  /** Null for link invitations — anyone holding the link may use it. */
  @Column({ nullable: true })
  invitedEmail: string;

  @Column({ type: 'enum', enum: ProjectRole })
  role: ProjectRole;

  @Column({ nullable: true })
  trade: string;

  /** SHA-256 of the token in the link. The raw token is never stored. */
  @Index({ unique: true })
  @Column()
  tokenHash: string;

  @Column({ type: 'enum', enum: InvitationStatus, default: InvitationStatus.SENT })
  status: InvitationStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @ManyToOne(() => User, { nullable: true, eager: true })
  invitedBy: User;

  @ManyToOne(() => User, { nullable: true, eager: true })
  acceptedBy: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;
}

/** The status a user should see: stored, unless the clock has overtaken it. */
export const effectiveStatus = (inv: Invitation): InvitationStatus =>
  inv.status === InvitationStatus.SENT && inv.expiresAt.getTime() < Date.now()
    ? InvitationStatus.EXPIRED
    : inv.status;
