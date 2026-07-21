import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Roles reflect real construction-site stakeholders (drives RBAC + dashboards). */
export enum UserRole {
  ADMIN = 'admin',
  PROJECT_MANAGER = 'project_manager',
  ENGINEER = 'engineer',
  CONTRACTOR = 'contractor',
  SUBCONTRACTOR = 'subcontractor',
  INSPECTOR = 'inspector',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column()
  fullName: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.SUBCONTRACTOR })
  role: UserRole;
}
