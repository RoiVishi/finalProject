import { ProjectRole } from '../projects/project-member.entity';
import { Profession } from '../users/user.entity';
import {
  can, canCreateProject, PERMISSION_MATRIX, predictionScope, ProjectAction,
} from './permissions';

const { OWNER, PROJECT_MANAGER, ENGINEER, SUBCONTRACTOR, INSPECTOR } = ProjectRole;
const ALL_ROLES = [OWNER, PROJECT_MANAGER, ENGINEER, SUBCONTRACTOR, INSPECTOR];

describe('AUTH-2 — the §2 permission matrix', () => {
  it('covers every declared action', () => {
    for (const action of Object.values(ProjectAction)) {
      expect(PERMISSION_MATRIX[action]).toBeDefined();
    }
  });

  // One case per row of the document table, in document order.
  const rows: Array<[ProjectAction, ProjectRole[]]> = [
    [ProjectAction.DELETE_PROJECT, [OWNER]],
    [ProjectAction.MANAGE_MEMBERS, [OWNER, PROJECT_MANAGER]],
    [ProjectAction.GENERATE_INVITE_LINK, [OWNER]],
    [ProjectAction.EDIT_LAYOUT, [OWNER, PROJECT_MANAGER]],
    [ProjectAction.MANAGE_TASKS, [OWNER, PROJECT_MANAGER, ENGINEER]],
    [ProjectAction.REPORT_EXECUTION, [OWNER, PROJECT_MANAGER, ENGINEER, SUBCONTRACTOR]],
    [ProjectAction.UPLOAD_DOCUMENT, ALL_ROLES],
    [ProjectAction.APPROVE_DOCUMENT, [PROJECT_MANAGER, INSPECTOR]],
    [ProjectAction.VIEW_PREDICTIONS, ALL_ROLES],
    [ProjectAction.VIEW_PROJECT, ALL_ROLES],
  ];

  it.each(rows)('%s is allowed for exactly the documented roles', (action, allowed) => {
    for (const role of ALL_ROLES) {
      expect(can(role, action)).toBe(allowed.includes(role));
    }
  });

  it('excludes the owner from document approval, to keep review independent', () => {
    // §2 visibility note (2) — deliberate, not an oversight.
    expect(can(OWNER, ProjectAction.APPROVE_DOCUMENT)).toBe(false);
    expect(can(INSPECTOR, ProjectAction.APPROVE_DOCUMENT)).toBe(true);
  });
});

describe('AUTH-2 — subcontractor prediction scoping', () => {
  it('scopes the subcontractor to own tasks and no one else', () => {
    expect(predictionScope(SUBCONTRACTOR)).toBe('own');
    for (const role of ALL_ROLES.filter((r) => r !== SUBCONTRACTOR)) {
      expect(predictionScope(role)).toBe('all');
    }
  });
});

describe('AUTH-2 — project creation by profession (§2 note 3)', () => {
  it('allows a main contractor and a project manager', () => {
    expect(canCreateProject(Profession.MAIN_CONTRACTOR)).toBe(true);
    expect(canCreateProject(Profession.PROJECT_MANAGER)).toBe(true);
  });

  it('refuses everyone else', () => {
    expect(canCreateProject(Profession.ENGINEER)).toBe(false);
    expect(canCreateProject(Profession.SUBCONTRACTOR)).toBe(false);
    expect(canCreateProject(Profession.INSPECTOR)).toBe(false);
  });
});
