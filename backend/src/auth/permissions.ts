import { ProjectRole } from '../projects/project-member.entity';
import { Profession } from '../users/user.entity';

/**
 * AUTH-2 — the permission matrix of Requirements Document §2, transcribed
 * as data rather than scattered through controllers. One table, one place
 * to audit against the document, one place to change.
 */
export enum ProjectAction {
  VIEW_PROJECT = 'view_project',
  DELETE_PROJECT = 'delete_project',
  MANAGE_MEMBERS = 'manage_members',
  GENERATE_INVITE_LINK = 'generate_invite_link',
  EDIT_LAYOUT = 'edit_layout',
  MANAGE_TASKS = 'manage_tasks',
  REPORT_EXECUTION = 'report_execution',
  UPLOAD_DOCUMENT = 'upload_document',
  APPROVE_DOCUMENT = 'approve_document',
  VIEW_PREDICTIONS = 'view_predictions',
}

const { OWNER, PROJECT_MANAGER, ENGINEER, SUBCONTRACTOR, INSPECTOR } = ProjectRole;

/** Each row is one line of the §2 table. Order matches the document. */
export const PERMISSION_MATRIX: Record<ProjectAction, ProjectRole[]> = {
  // "Create / delete project": delete is owner-only. Creation has no project
  // to be a member of yet — see canCreateProject below.
  [ProjectAction.DELETE_PROJECT]: [OWNER],

  // "Invite / remove team members" — PM by e-mail only; the link is AUTH-4.
  [ProjectAction.MANAGE_MEMBERS]: [OWNER, PROJECT_MANAGER],
  [ProjectAction.GENERATE_INVITE_LINK]: [OWNER],

  [ProjectAction.EDIT_LAYOUT]: [OWNER, PROJECT_MANAGER],
  [ProjectAction.MANAGE_TASKS]: [OWNER, PROJECT_MANAGER, ENGINEER],
  [ProjectAction.REPORT_EXECUTION]: [OWNER, PROJECT_MANAGER, ENGINEER, SUBCONTRACTOR],
  [ProjectAction.UPLOAD_DOCUMENT]: [OWNER, PROJECT_MANAGER, ENGINEER, SUBCONTRACTOR, INSPECTOR],

  // Deliberately excludes the owner: approval authority rests with PM and
  // Inspector to preserve independent review (§2, visibility note 2).
  [ProjectAction.APPROVE_DOCUMENT]: [PROJECT_MANAGER, INSPECTOR],

  // Every member may view predictions; the subcontractor is scoped to own
  // tasks by predictionScope() below, not by exclusion from this row.
  [ProjectAction.VIEW_PREDICTIONS]: [OWNER, PROJECT_MANAGER, ENGINEER, SUBCONTRACTOR, INSPECTOR],

  [ProjectAction.VIEW_PROJECT]: [OWNER, PROJECT_MANAGER, ENGINEER, SUBCONTRACTOR, INSPECTOR],
};

export const can = (role: ProjectRole, action: ProjectAction): boolean =>
  PERMISSION_MATRIX[action].includes(role);

/**
 * "Subcontractors see risk predictions and explanations for own tasks only"
 * (AUTH-2). Kept separate from the matrix because it is a row-level scope,
 * not a yes/no permission.
 */
export type PredictionScope = 'all' | 'own';

export const predictionScope = (role: ProjectRole): PredictionScope =>
  role === ProjectRole.SUBCONTRACTOR ? 'own' : 'all';

/**
 * Project creation cannot be a membership check — the project does not exist
 * yet. §2 note (3) says the "New project" button is shown by profession and
 * that authorization is enforced server-side regardless; this is the
 * server-side reading of that note.
 * OPEN QUESTION for the advisor: confirm this is the intended rule.
 */
export const canCreateProject = (profession: Profession): boolean =>
  profession === Profession.MAIN_CONTRACTOR ||
  profession === Profession.PROJECT_MANAGER;
