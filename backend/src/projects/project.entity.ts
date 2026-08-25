import {
  Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Task } from '../tasks/task.entity';
import { ProjectLayout } from './layout';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ---- step 1 of the wizard: project details (מסמך האפיון §4.1) ----------

  @Column()
  name: string;

  @Column({ nullable: true })
  address: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  /** Planned start / finish of the project as a whole, not of any activity. */
  @Column({ type: 'date', nullable: true })
  plannedStart: string | null;

  @Column({ type: 'date', nullable: true })
  plannedEnd: string | null;

  // ---- step 2: schematic layout for the Digital Twin (TASK-1 / TWIN-1) ---

  /**
   * F floors × Z zones. Stored as the two numbers plus their labels; the
   * F×Z zone list is derived by expandZones() and never persisted, so a
   * layout edit cannot leave a stale copy behind.
   */
  @Column({ type: 'jsonb', nullable: true })
  layout: ProjectLayout | null;

  @OneToMany(() => Task, (t) => t.project)
  tasks: Task[];

  // ---- lifecycle --------------------------------------------------------

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  /**
   * Soft delete (TASK-1 "CRUD"): the row is kept so that activities,
   * documents and audit entries that point at it stay readable. A deleted
   * project is invisible to every read path.
   * TASK-7 will subsume this into the setup → active → frozen → completed →
   * archived state machine; until that story lands this single stamp is the
   * whole lifecycle, which is why it is a timestamp and not a boolean.
   */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
