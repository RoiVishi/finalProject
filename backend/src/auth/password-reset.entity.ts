import {
  Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * AUTH-7: one-time password-reset link.
 * The raw token is e-mailed and NEVER stored — only its SHA-256 hash, so a
 * database leak cannot be replayed into account takeover.
 */
@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  user: User;

  @Index({ unique: true })
  @Column()
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Set when the link is used, or when a newer request supersedes it. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
