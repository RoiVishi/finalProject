import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Global system role — ONLY these two exist at user level.
 * Site roles (main contractor, PM, engineer, subcontractor, inspector) are held
 * PER PROJECT via ProjectMember (AUTH-5), because the same person can be a main
 * contractor in one project and a subcontractor in another.
 * Source: Requirements Document §2 (actors and permission matrix).
 */
export enum SystemRole {
  ADMIN = 'admin',
  USER = 'user',
}

/**
 * Fixed profession list (AUTH-1): what the person does for a living.
 * Distinct from the role they hold inside a given project.
 * TODO: verify this list against מסמך האפיון §3 with the advisor before AUTH-8.
 */
export enum Profession {
  MAIN_CONTRACTOR = 'main_contractor',
  PROJECT_MANAGER = 'project_manager',
  ENGINEER = 'engineer',
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

  @Column()
  phone: string;

  @Column({ type: 'enum', enum: Profession })
  profession: Profession;

  @Column({ type: 'enum', enum: SystemRole, default: SystemRole.USER })
  role: SystemRole;
}
