import {
  Column, Entity, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';

/**
 * TASK-2 lifecycle. 'blocked' is deliberately NOT a member: it is computed
 * from unfinished predecessors and unapproved required documents on every
 * read (see task-lifecycle.ts and TasksService.computeBlocked).
 */
export enum TaskStatus {
  PLANNED = 'planned',
  /** Every predecessor is completed — the crew may start. */
  READY = 'ready',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

/** מסמך האפיון §5.1: שלד / חשמל / אינסטלציה / גבס / מיזוג / גמר / אחר */
export enum TradeCategory {
  STRUCTURE = 'structure',
  ELECTRICAL = 'electrical',
  PLUMBING = 'plumbing',
  DRYWALL = 'drywall',
  HVAC = 'hvac',
  FINISHING = 'finishing',
  OTHER = 'other',
}

export const TRADE_LABELS: Record<TradeCategory, string> = {
  [TradeCategory.STRUCTURE]: 'שלד',
  [TradeCategory.ELECTRICAL]: 'חשמל',
  [TradeCategory.PLUMBING]: 'אינסטלציה',
  [TradeCategory.DRYWALL]: 'גבס',
  [TradeCategory.HVAC]: 'מיזוג',
  [TradeCategory.FINISHING]: 'גמר',
  [TradeCategory.OTHER]: 'אחר',
};

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ManyToOne(() => Project, (p) => p.tasks, { onDelete: 'CASCADE' })
  project: Project;

  /** Zone of the schematic Twin, e.g. "floor-3/zone-2" — validated against
   *  the project layout (TASK-1) so an activity can never point at a zone
   *  the building does not have. */
  @Column({ nullable: true })
  zone: string;

  @Column({ type: 'enum', enum: TradeCategory, default: TradeCategory.OTHER })
  trade: TradeCategory;

  /** Planned duration in working days, as estimated at planning time. */
  @Column({ type: 'int', nullable: true })
  estimatedDurationDays: number | null;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.PLANNED })
  status: TaskStatus;

  @Column({ type: 'date', nullable: true })
  plannedStart: string;

  @Column({ type: 'date', nullable: true })
  plannedEnd: string;

  @Column({ type: 'date', nullable: true })
  actualStart: string;

  @Column({ type: 'date', nullable: true })
  actualEnd: string;

  @ManyToOne(() => User, { nullable: true })
  assignee: User;

  /** P6-style finish-to-start dependencies: this task waits for `predecessors`. */
  @ManyToMany(() => Task)
  @JoinTable({
    name: 'task_dependencies',
    joinColumn: { name: 'task_id' },
    inverseJoinColumn: { name: 'predecessor_id' },
  })
  predecessors: Task[];

  /** Cached last prediction from the AI service (TASK-5 traceability). */
  @Column({ type: 'float', nullable: true })
  lateProbability: number;

  @Column({ nullable: true })
  riskLevel: 'low' | 'medium' | 'high';

  /** Which registry version produced the cached numbers (PRED-4/TASK-5). */
  @Column({ nullable: true })
  modelVersion: string;

  /** Cold-start gate verdict from the AI service: 'ok' | 'low_transfer_prior'. */
  @Column({ nullable: true })
  reliability: string;

  @Column({ type: 'timestamptz', nullable: true })
  predictedAt: Date;
}
