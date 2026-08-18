import {
  Column, Entity, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';

export enum TaskStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  BLOCKED = 'blocked', // computed: a predecessor is not completed
  COMPLETED = 'completed',
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToOne(() => Project, (p) => p.tasks, { onDelete: 'CASCADE' })
  project: Project;

  /** Zone in the schematic Digital Twin (e.g. "floor-3/east") */
  @Column({ nullable: true })
  zone: string;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.NOT_STARTED })
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
