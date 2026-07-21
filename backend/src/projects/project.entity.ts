import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Task } from '../tasks/task.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  address: string;

  /** Schematic building layout for the Digital Twin: floors x zones. */
  @Column({ type: 'jsonb', nullable: true })
  layout: { floors: number; zonesPerFloor: string[] };

  @OneToMany(() => Task, (t) => t.project)
  tasks: Task[];
}
