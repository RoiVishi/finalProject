// Requirements Document (English, LTR)
const docx = require('docx');
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, HeadingLevel, AlignmentType, ShadingType, LevelFormat, PageBreak,
} = docx;

const FONT = 'Calibri';
const NAVY = '1F3864';
const ACCENT = '2E5FA3';

const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: o.size || 21, bold: !!o.bold, color: o.color, italics: !!o.italics });
const p = (t, o = {}) => new Paragraph({ spacing: { after: o.after ?? 120, line: 288 }, children: Array.isArray(t) ? t : [run(t, o)] });
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 140 }, children: [run(t, { bold: true, size: 28, color: NAVY })] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 110 }, children: [run(t, { bold: true, size: 24, color: ACCENT })] });
const bullets = (items) => items.map((t) => new Paragraph({
  numbering: { reference: 'bul', level: 0 }, spacing: { after: 70, line: 288 },
  children: Array.isArray(t) ? t : [run(t)],
}));

function mkTable(headers, rows, widths) {
  const cellP = (txt, o = {}) => new Paragraph({ spacing: { after: 30, line: 264 }, children: [run(String(txt), { size: 19, ...o })] });
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    margins: { top: 70, bottom: 70, left: 100, right: 100 },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: NAVY },
          children: [cellP(h, { bold: true, color: 'FFFFFF' })],
        })),
      }),
      ...rows.map((r, ri) => new TableRow({
        children: r.map((c, i) => new TableCell({
          width: { size: widths[i], type: WidthType.DXA },
          shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: 'F2F5FA' } : undefined,
          children: [cellP(c)],
        })),
      })),
    ],
  });
}

// FR table helper: ID | Requirement | Priority | Acceptance criteria
const frT = (rows) => mkTable(['ID', 'Requirement', 'Pri.', 'Acceptance criteria'], rows, [850, 3800, 550, 4300]);

const V = '✓', X = '—';
const ch = [];

// ── Title ──
ch.push(
  new Paragraph({ spacing: { before: 700, after: 160 }, alignment: AlignmentType.CENTER, children: [run('Requirements Document', { bold: true, size: 44, color: NAVY })] }),
  new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.CENTER, children: [run('An AI-Powered Construction Management Platform with Task-Level Delay Prediction and a Schematic Digital Twin', { size: 24, color: ACCENT })] }),
  new Paragraph({ spacing: { after: 80 }, alignment: AlignmentType.CENTER, children: [run('Final-Year Project — Software Engineering, AI Track · SCE', { size: 21 })] }),
  new Paragraph({ spacing: { after: 300 }, alignment: AlignmentType.CENTER, children: [run('Version 1.8 · August 2026 · Students: Roi Wishengrad + partner · Advisor: [TODO]', { size: 20, color: '666666' })] }),
  p([run('Derived from the System Characterization Document (Hebrew, v1.0, July 2026) and aligned with SRS v1.1. This document shares the SRS requirement ID space and extends it where the characterization introduced detail not yet captured (AUTH-7..9, TASK-7..10, DASH-5..7). The draft was verified by three independent review passes — coverage vs. the characterization, consistency vs. the SRS, and testability/scope — and all findings were folded in. Priorities: ', { italics: true, size: 20 }), run('M', { bold: true, size: 20 }), run(' = Mandatory (defines the graded product), ', { italics: true, size: 20 }), run('O', { bold: true, size: 20 }), run(' = Optional (bonus, attempted only after all M are green). Each requirement maps to one Jira story; each module is a Jira epic.', { italics: true, size: 20 })]),
);

// ── 1 ──
ch.push(
  h1('1. Purpose, scope and change control'),
  p([run('This is the department-checklist "requirements document linked to Jira". It restates the product in verifiable form: user requirements, functional requirements per module with acceptance criteria, non-functional requirements, data requirements, and traceability back to the characterization chapters and to the SRS. '), run('Jira board: https://roi24100-1785071624170.atlassian.net/browse/KAN', { bold: true }), run(' (project KAN — every requirement ID below is one story; epics per module).')]),
  p('Out of scope (unchanged): full BIM/IFC import, native mobile app, integration with regulatory authorities, OCR/NLP over scanned documents.'),
  p([run('Scope management. ', { bold: true }), run('The Mandatory set was deliberately trimmed during review: heavy or non-differentiating items were demoted to Optional (email-OTP 2FA and backup codes, Gantt view, expiry alerts, project channel/DMs, risk trend, delay-escalation engine, photorealistic Twin). If mid-year velocity requires further cuts, the pre-agreed candidates are TASK-8 (advanced filters), DASH-6 (activity feed) and AUTH-6 (TOTP 2FA) — any such change requires advisor approval, a Jira comment, and a version bump of this document and the SRS.')]),
);

// ── 2 ──
ch.push(
  h1('2. Actors and permission matrix'),
  p('A user has one global role (Admin or regular) and a separate role in every project, held via ProjectMember. The same person may be Main Contractor in one project and Subcontractor in another.'),
  mkTable(['Actor', 'Description', 'Access scope'], [
    ['Admin', 'System administration, user management, audit-log view', 'Full (system)'],
    ['Main Contractor (project owner)', 'Opens and owns projects: layout, team invitations (email or link), tasks; also executes work', 'Full scope in own projects (excl. document approval)'],
    ['Project Manager (PM)', 'Plans tasks and dependencies, assigns work, consumes risk forecasts, resolves blockers, approves documents', 'Project-wide write'],
    ['Engineer', 'Plans activities/dependencies, updates technical status, reviews risk explanations', 'Project-wide write (technical)'],
    ['Subcontractor / Professional', 'Executes assigned tasks, reports execution, uploads documents', 'Own assigned tasks'],
    ['Inspector', 'Reviews and approves documents, monitors quality', 'Project-wide read + approval actions'],
  ], [1900, 4600, 3000]),
  p('Permission matrix (server-enforced on every route — AUTH-2):', { after: 60 }),
  mkTable(['Action', 'Owner', 'PM', 'Engineer', 'Subcontr.', 'Inspector'], [
    ['Create / delete project', V, V + ' (create)', X, X, X],
    ['Invite / remove team members', V, V + ' (email only)', X, X, X],
    ['Generate shareable invite link', V, X, X, X, X],
    ['Edit building layout', V, V, X, X, X],
    ['Create/edit tasks & dependencies', V, V, V, X, X],
    ['Report execution on assigned tasks', V, V, V, V, X],
    ['Upload documents', V, V, V, V, V],
    ['Approve / reject documents', X, V, X, X, V],
    ['View risk predictions & explanations', V, V, V, 'Own tasks only', V],
    ['View Twin & dashboard', V, V, V, V, V],
  ], [3200, 1250, 1450, 1250, 1300, 1050]),
  p([run('Visibility notes. ', { bold: true }), run('(1) Twin zone colors are an aggregate view visible to all members; per-task risk detail and SHAP explanations follow the matrix — a subcontractor opens them only for own tasks. (2) Document approval is deliberately excluded from the owner’s "full scope": approval authority rests with PM and Inspector to preserve independent review. (3) The "New project" home-screen button is a UI heuristic (shown when profession = main contractor / project management); authorization is enforced server-side regardless.')]),
);

// ── 3 ──
ch.push(
  h1('3. User requirements'),
  mkTable(['ID', 'As a…', 'I need…', 'So that…', 'Pri.'], [
    ['UR-1', 'Main Contractor', 'to open a project, define its layout and invite every professional myself (email or shareable link)', 'my whole team works in one shared space I control', 'M'],
    ['UR-2', 'Main Contractor', 'to edit team membership, roles and tasks at any time', 'the project reflects reality on site', 'M'],
    ['UR-3', 'Subcontractor', 'a clear answer to "may I start?" with named blockers', 'I don’t waste crew days on blocked work', 'M'],
    ['UR-4', 'Subcontractor', 'to upload approvals/photos from the field and see which documents are still required of me', 'my tasks can close without chasing paperwork', 'M'],
    ['UR-5', 'PM', 'early, explained warnings about which tasks will be late', 'I can re-plan before the delay cascades', 'M'],
    ['UR-6', 'Inspector', 'a queue of documents awaiting approval, with preview and mandatory-reason rejection', 'approvals are fast and documented', 'M'],
    ['UR-7', 'Any member', 'notifications on events that concern me (assignment, blocking, approvals, mentions, critical delays)', 'I never miss something that changes my work', 'M'],
    ['UR-8', 'Any member', 'to discuss tasks/documents in context with @mentions', 'decisions stay attached to the work item', 'M'],
    ['UR-9', 'Any user', 'secure sign-in with optional 2FA and password recovery', 'my account and project data are protected', 'M'],
    ['UR-10', 'Engineer', 'to model dependencies with immediate cycle errors', 'the schedule graph stays valid', 'M'],
    ['UR-11', 'Any member', 'a 3D schematic view colored by status/risk', 'I grasp project state at a glance', 'M'],
    ['UR-12', 'Admin', 'user administration and a viewable audit log', 'I can support and investigate the system', 'M'],
  ], [700, 1500, 3700, 3000, 600]),
);

// ── 4 ──
ch.push(
  h1('4. Functional requirements'),
  h2('4.1 FR-AUTH — Users, access, invitations (Epic: Auth)'),
  frT([
    ['AUTH-1', 'Registration (full name, unique email, password ≥8 chars incl. letter+digit, phone, profession from fixed list); login issues 12h JWT', 'M', 'bcrypt salted hashes; uniform "wrong credentials" error; client+server validation; token expiry returns to login preserving the original destination (redirect after re-login)'],
    ['AUTH-2', 'Role-based authorization: the §2 permission matrix enforced server-side on every route; subcontractors see risk predictions/explanations for own tasks only', 'M', 'Non-member gets 403/404 on any project resource; attempted-bypass tests; per-role visibility tests incl. subcontractor risk scoping'],
    ['AUTH-3', 'Admin user administration (global role change, account disable) and an Admin audit-log view', 'M', 'Audit entry per change (actor, before/after, timestamp); audit screen filterable by user, action and date range'],
    ['AUTH-4', 'Project invitations: by email (owner or PM) or shareable role+trade-scoped link (owner only; 14-day validity; revoke/renew; regeneration invalidates the old link; optional owner final-approval for link joins)', 'M', 'Existing user accepts in-app; new user auto-attached after signup via link; statuses sent/accepted/declined/expired/revoked; an expired or revoked link shows an explicit error and creates no membership; inviting a current member is rejected'],
    ['AUTH-5', 'Project membership (ProjectMember): role + trade per project, join date, active/suspended; owner may change a member’s role or remove them; removal revokes access immediately, history preserved', 'M', 'Guards resolve membership per request; role changes and removals audited and visible in the activity feed'],
    ['AUTH-6', '2FA via TOTP authenticator app, per-user opt-in (suggested at first login for Admin/owner); 5 failed attempts → 15-min lockout', 'M', '2FA challenge after valid password when enabled; QR enrollment; lockouts audited'],
    ['AUTH-7', 'Password reset via one-time emailed link (1h validity)', 'M', 'Used or superseded links invalidated; outbound mail per NFR-DEMO-2'],
    ['AUTH-8', 'Personal profile: edit name, phone, profession, optional photo; upload personal professional certificates (license, insurance) with expiry dates, reusable across projects', 'M', 'Certificates visible to owner and inspector of every project the professional joined; no re-upload needed per project'],
    ['AUTH-9', 'Email-OTP as 2FA alternative; backup codes', 'O', 'Valid backup code logs in, is consumed, and is audited; with none left, recovery requires Admin action'],
  ]),
  h2('4.2 FR-TASK — Projects, activities, dependencies (Epic: Tasks)'),
  frT([
    ['TASK-1', 'Project CRUD incl. schematic layout via a 3-step wizard (details → floors×zones layout → initial team); creator becomes project owner', 'M', 'Main Contractor or PM creates; a project with F floors × Z zones renders exactly F×Z clickable Twin zones with no code change'],
    ['TASK-2', 'Activity CRUD (name, description, trade category, zone, planned dates, assignee, estimated duration) with lifecycle planned → ready → in-progress → completed; "blocked" is computed, never set manually', 'M', 'Validated payloads; assignee notified on assignment; plan-date edits after execution start audited; illegal state transitions rejected'],
    ['TASK-3', 'Finish-to-start dependencies; cycles rejected showing the cyclic path', 'M', 'Per-activity predecessor and dependent lists visible'],
    ['TASK-4', 'Automatic blocking with named blockers, computed live from unfinished predecessors and unapproved required documents', 'M', 'Response names blocking items ("blocked by: electrical rough-in — Zerem Ltd; missing: structural-engineer approval")'],
    ['TASK-5', 'Latest risk prediction cached per activity; refreshed on schedule/dependency/document change and on demand; prediction flagged stale when the activity’s dates, dependencies or required documents changed after predictedAt; bulk changes de-duplicated to at most one refresh per activity per cycle', 'M', 'lateProbability/riskLevel persisted with predictedAt and model version; refresh of an affected set completes within the NFR-PERF-1 batch bound; full prediction history retained per PRED-16'],
    ['TASK-6', 'Withdrawn — superseded by epic FR-DOC (§4.3); no Jira story generated', '—', '—'],
    ['TASK-7', 'Project lifecycle: setup → active → frozen (read-only) → completed → archived; owner-only transitions', 'M', 'Any write on a frozen/archived project returns 403 for every role incl. owner (tested); archived projects hidden from home, fully retained'],
    ['TASK-8', 'Task views: filter by status/category/floor/assignee/risk; sort by date/risk; "My tasks" default view for subcontractors with blockers and required documents first', 'M', 'Filters combine; subcontractor default view verified in tests'],
    ['TASK-9', 'Simple read-only Gantt view of the dependency timeline', 'O', 'Renders the dependency graph on a time axis'],
    ['TASK-10', 'Execution reporting by the assignee: actual start/finish dates, free-text notes, attached field photos/documents', 'M', 'Completion blocked by the DOC-4 gate; each execution update triggers prediction refresh of dependent activities within one refresh cycle'],
  ]),
  h2('4.3 FR-DOC — Documents and approvals (Epic: Documents)'),
  frT([
    ['DOC-1', 'Upload at project or activity level (PDF/images/Office, ≤20MB) with metadata (title, type, description); uploader/date/version auto-recorded; browsable version history; project document library filterable by type, approval status, task and uploader, with text search', 'M', 'Oversize → 413; disallowed type → 415 listing allowed types; non-member → 403; no orphan file or metadata persisted on failure; downloads member-only, enforced server-side'],
    ['DOC-2', 'Taxonomy: permit / approval-certificate / plan / protocol-report / site photo; expiry date on permits and certificates (incl. profile certificates per AUTH-8)', 'M', 'Expiry stored and queryable'],
    ['DOC-3', 'Approval workflow for permit and approval-certificate types only: uploaded → pending → approved / rejected (mandatory reason) by Inspector or PM; other types need no approval', 'M', 'Decision, decider, timestamp recorded; uploader notified; a rejected document is re-uploadable as a new version'],
    ['DOC-4', 'Required-document gate: an activity with an unapproved required document cannot be completed and is included in blocking computation', 'M', 'Completion attempt blocked with a message naming the missing approval; feeds TASK-4'],
    ['DOC-5', 'Expiry alerts: 30 days before permit/certificate expiry → uploader, owner and inspector', 'O', 'Alert created on schedule (window configurable per NFR-DEMO-1)'],
  ]),
  h2('4.4 FR-COMM — Communication (Epic: Communication)'),
  frT([
    ['COMM-1', 'Text comment threads on activities and documents with @mentions; deletion only by author or owner (audited)', 'M', '@mention creates a direct notification; comments appear in the activity feed'],
    ['COMM-2', 'Image attachments in comments; project-wide channel; 1:1 direct messages; unread counters', 'O', 'Messages persisted server-side, synced across devices'],
  ]),
  h2('4.5 FR-PRED — Prediction service (Epic: AI Service)'),
  p('Expanded in v1.2 (merge of the partner-review expansion proposal, trimmed for single-student scope). IDs PRED-1..7 keep their v1.1 meaning so existing Jira stories stay valid; PRED-8..21 are new. The quality-gate floors in the table after this section are proposed from the July 2026 scenario-B run and are pending advisor approval.'),
  frT([
    ['PRED-1', 'REST single + batch predictions: calibrated late probability, binary label per the PRED-12 threshold, risk band, estimated delay days, model version and feature-schema version in every response', 'M', 'Batch preserves input order and length 1:1; malformed/unknown field → 422 naming accepted fields; empty batch → 400; plan-time features only'],
    ['PRED-2', 'Health and readiness: /health reports process liveness plus model availability, version and schema-match status; orchestration waits on readiness', 'M', 'Readiness false until a valid artifact is loaded; docker compose and CI wait on it'],
    ['PRED-3', 'Local SHAP explanation for any prediction via the explanation endpoint, rendered in domain language through a committed dictionary (Hebrew + English) covering every schema feature', 'M', 'Top-k signed contributions sorted by magnitude; dictionary completeness enforced by lint (with NFR-I18N-1); no raw feature name or bare score reaches the UI'],
    ['PRED-4', 'Model registry: every trained candidate recorded with version, git commit, dataset snapshot, seed, hyperparameters, calibration method, training-range percentiles and full metrics for both RR-4 scenarios', 'M', 'Artifact reproducible from recorded commit + seed (NFR-REPRO-1); served responses name their model version'],
    ['PRED-5', 'Graceful degradation when the model or service is unavailable, degraded or abstaining', 'M', '503 with actionable message; UI shows last known prediction with predictedAt and a stale badge, never an error page; no write path blocks on the AI service; kill-container E2E (NFR-REL-1)'],
    ['PRED-6', 'Champion quality gate anchored on RR-4 scenario B (the deployment claim): absolute floors (table below) AND relative margins over dummy and logistic-regression baselines; scenario A reported for every candidate but not gated; if no candidate passes, the product ships in abstention mode (PRED-10) rather than serving an unusable score', 'M', 'Gate evaluated in CI against committed metrics.json; failing candidate cannot be promoted (pipeline fails, not warns); gate outcome reproduced in the project book'],
    ['PRED-7', 'What-if analysis: preview updated risk for a hypothetical plan change (dates/dependency) without saving it', 'O', 'Preview returns within NFR-PERF-1 bounds; no Prediction row written'],
    ['PRED-8', 'Feature contract: the model’s feature set defined in one committed, versioned schema file (name, dtype, unit, nullability, semantic definition), shared by the training pipeline and the service', 'M', 'Service refuses at startup an artifact whose schema version differs from the running schema; test asserts identical feature order and dtypes at train and serve time; featureSchemaVersion returned in responses'],
    ['PRED-9', 'Feature adapter: a documented, tested transformation from platform entities (Project, Activity, Dependency) to the PRED-8 feature vector for projects created in the platform (never imported from P6) — including the float question: either a CPM pass derives total/free float from the dependency graph, or the model is retrained without float (advisor decision, §1)', 'M', 'Every schema feature has exactly one named derivation rule; E2E test: a project created via the TASK-1 wizard yields a valid feature vector and a served prediction'],
    ['PRED-10', 'Minimum-input policy and abstention: when the required-feature subset cannot be satisfied the service abstains — risk band "unknown" with a reason code — instead of returning a score; unseen categorical values treated as missing', 'M', 'UI shows an explicit "not enough data" state, never a number; abstained activities excluded from the DASH-5 index and counted separately; one test per abstention reason'],
    ['PRED-11', 'Delay-days regression served from its own versioned artifact, only while it clears its gate row; shown only for activities predicted late and never without its error magnitude (MAE)', 'M', 'Regressor absent or gate-failing → classification still served with estimatedDelayDays = null and the UI omits the field (tested)'],
    ['PRED-12', 'Risk bands and decision threshold as explicit configuration selected by a documented protocol (validation-set quantiles, or a cost-weighted operating point from a practitioner interview), not constants in code; one source drives Twin colouring, DASH-4 escalation and the DASH-5 index', 'M', 'Boundaries injected by configuration and echoed in responses; protocol and chosen values recorded in metrics.json and the project book; changing one boundary propagates everywhere (tested)'],
    ['PRED-13', 'Probability calibration (Platt or isotonic) fitted on a dedicated held-out split, so lateProbability reads as a frequency and DASH-5 may average it', 'M', 'Brier score and reliability curve reported calibrated vs uncalibrated for both scenarios; calibration artifact versioned with the model; never fitted on the test split'],
    ['PRED-14', 'Leakage prevention as an explicit CI control: plan-time whitelist equals the PRED-8 schema; named blacklist of post-hoc fields (actual dates, realised delay) checked against the training frame; documented as-of rule for scenario B', 'M', 'CI fails on any blacklisted column; as-of rule unit-tested on a case where a later event must not be visible earlier'],
    ['PRED-15', 'Global explainability: mean absolute SHAP ranking for the deployed model, served for the dashboard and the project book', 'M', 'Regenerated with every promoted champion; the book figure is generated from this data, not drawn by hand'],
    ['PRED-16', 'Prediction persistence and outcome capture: every served prediction stored (activity, versions, features used, probability, band, delay days, explanation, predictedAt, reliability flags) and joined to the realised outcome on activity completion', 'M', 'Predictions never overwritten in place — history retained, feeding TASK-5 staleness and PRED-17; outcome back-fill runs on completion'],
    ['PRED-17', 'Live accuracy report: realised performance on the platform’s own data (confusion matrix, P/R/F1, calibration drift, MAE) computed from PRED-16 records', 'O', 'On demand per project or across projects; labelled observational, distinct from RR-1..4; sample-size caveats stated'],
    ['PRED-18', 'Out-of-range input flag: numeric features compared at prediction time to training-range percentiles stored in the artifact; out-of-range predictions marked reduced-reliability, naming the offending features', 'O', 'Flag exposed in API and UI; tested with a deliberately extreme input; addresses the distribution-shift threat from the literature survey'],
    ['PRED-19', 'Input drift monitoring: served-feature distribution compared periodically to the training distribution; material drift raises an Admin alert', 'O', 'Drift measure and threshold documented; alert visible in Admin screen'],
    ['PRED-20', 'Controlled deployment and rollback: promoting a champion is an explicit, audited action; the previous champion stays restorable without a rebuild', 'O', 'Promotion/rollback audited (actor, from, to, reason); running version visible in /model/info and Admin screen'],
    ['PRED-21', 'Retraining procedure: one command / one CI job from an updated dataset to a registry-ready candidate, running the full RR-4 evaluation and the PRED-6 gate', 'O', 'Produces a PRED-4-conformant artifact'],
  ]),
  p([run('Quality-gate floors (PRED-6) — proposed from the dedup-hardened August 2026 scenario-B run (11 projects, 3,108 test activities; registry v4), pending advisor approval. ', { bold: true }), run('Floors are absolute; the relative margin over baselines is additional. Scenario A is reported, never gated — the project’s own baselines show all models are near-random cross-project (a documented research finding, RR-4), so gating on it would make the product unshippable. Until the floors are ratified, the binding gate is the relative one (beat dummy and LogReg on scenario B), enforced in CI by quality_gate.py.')]),
  mkTable(['Metric (scenario B)', 'Proposed floor', 'Achieved (v4, audit-hardened)', 'Relative requirement'], [
    ['ROC-AUC', '≥ 0.70', '0.751 uncalibrated / 0.723 served-calibrated (XGBoost)', '≥ LogReg + 0.01 (LogReg: 0.600)'],
    ['F1, late class', '≥ 0.45', '0.500 (calibrated)', '> dummy'],
    ['Recall, late class', '≥ 0.55', '0.608 (served, calibrated)', 'Prioritised over precision — a missed late activity costs more than a false alarm'],
    ['Precision, late class', '≥ 0.35', '0.425 (served, calibrated)', 'Floor prevents an alert stream users learn to ignore'],
    ['Brier score', '≤ 0.20 (proposed — see note)', '0.207, CI95 [0.200, 0.215] — the 0.20 floor lies INSIDE the CI (unmeasurable); beats the deployable constant baseline (0.223) with P=0.9998, statistically tied with the oracle base-rate constant (0.209)', 'Calibrated ≤ uncalibrated ✓ (0.207 < 0.234, enforced in CI); floor derivation = advisor discussion item'],
    ['MAE, delay days', 'decided by data', 'Regression auto-gated OFF (PRED-11): RF-reg 28.92 ≥ dummy 28.81 on the clean corpus; service ships classification-only, estimatedDelayDays = null', 'Regressor artifact simply not deployed until it beats the dummy'],
  ], [2100, 1700, 2500, 3200]),
  h2('4.6 FR-TWIN — Digital Twin (Epic: Twin)'),
  frT([
    ['TWIN-1', 'Schematic 3D building view; zones colored by status or predicted risk (toggle), fixed legend', 'M', 'Every zone clickable; colors follow the risk scale'],
    ['TWIN-2', 'Zone panel: activities, statuses, blockers with names, risk + explanation, linked documents', 'M', 'Blocked items badged; risk detail follows AUTH-2 visibility rules'],
    ['TWIN-3', 'Live data from backend and AI service; no demo constants in production build', 'M', 'E2E test covers the flow'],
    ['TWIN-4', 'Photorealistic model generated from a building photo (image-to-3D); schematic/realistic toggle', 'O', 'GLB auto-fitted to layout dimensions'],
    ['TWIN-5', '360° room navigation with AI-generated panoramas and smooth transitions', 'O', 'Enter/exit room, crossfade, floor/wing navigation'],
  ]),
  h2('4.7 FR-DASH — Dashboards, alerts, home, feed (Epic: Dashboards)'),
  frT([
    ['DASH-1', 'Role-adapted dashboards. Owner/PM: status distribution, top-5 riskiest tasks with explanations, blocked list, documents pending approval, schedule variance. Engineer: own-discipline tasks, open blockers in dependency chains, recently changed predictions. Subcontractor: my tasks by urgency, my blockers with reasons, documents I must upload, recent alerts. Inspector: pending-approvals queue, rejected-not-resubmitted, expiring certificates, overall status', 'M', 'Logging in as each role shows exactly its listed widgets and none of another role’s (tested)'],
    ['DASH-2', 'Alert engine + notification center. Triggers: invitation, assignment, block/unblock, risk escalation, document pending/approved/rejected, team change, @mention', 'M', 'Alert row created ≤60s after the trigger (polling); center lists chronologically with read/unread and deep links to the entity'],
    ['DASH-3', 'Risk trend per project over time; PNG export', 'O', 'History of mean risk plotted'],
    ['DASH-4', 'Critical-delay alerts: detect overdue activities (past planned finish, not completed) and critical delays (actual or predicted delay on an activity with dependents); risk escalation defined as an upward band transition per PRED-12 (low/medium → high), not an unspecified score change; alert assignee, owner and PM; cascade alert names impacted activities and trades', 'M', 'Overdue detection ≤60s (polling); cascade alert lists impacted activities; shown red in dashboard and Twin'],
    ['DASH-5', 'Home screen: "my projects" cards (status, my role, risk index, blocked count) + pending invitations + "New project" (visibility per §2 note 3). Risk index = mean calibrated lateProbability (PRED-13) over non-completed, non-abstained activities, one decimal; abstained count reported beside it', 'M', 'Card values equal API values in test'],
    ['DASH-6', 'Project activity feed: chronological rendering of audited member actions (tasks, documents, approvals, team, prediction refreshes), visible to all members', 'M', 'One feed entry per audited action'],
    ['DASH-7', 'Delay escalation: a critical delay unhandled for 48h creates a recurring reminder to the owner; affected assignees receive their new expected start', 'O', 'Escalation window configurable (NFR-DEMO-1); reminder repeats until acknowledged'],
  ]),
  h2('4.8 FR-DATA — Data pipeline (Epic: Data)'),
  p('DATA-1…DATA-5 (P6 ingest, dedup, delay labeling, plan-time + dependency-network features, EDA report) — all M, all Done; inherited unchanged from SRS v1.1 and restated only for Jira-mapping completeness.'),
  h2('4.9 RR — Research requirements, AI track (Epic: Research)'),
  p('These requirements define the scientific core of the project and are graded alongside the product. They are the substance behind FR-PRED: PRED-1..7 expose to users what RR-1..8 must first establish scientifically. Restated in full from SRS §5 with priorities.'),
  frT([
    ['RR-1', 'Binary classification of activity lateness with a full metric suite', 'M', 'Accuracy, Precision, Recall, F1, ROC-AUC reported per model'],
    ['RR-2', 'Regression of delay days', 'M', 'MAE and RMSE vs a dummy baseline'],
    ['RR-3', 'Model comparison: Logistic Regression (baseline), Random Forest, XGBoost, MLP', 'M', 'One table, identical splits and seeds for all models'],
    ['RR-4', 'Two leakage-aware evaluation scenarios: (A) cross-project GroupSplit; (B) within-project temporal split with history features', 'M', 'Both reported; scenario B is the primary deployment claim'],
    ['RR-5', 'Hyperparameter tuning with cross-validation', 'M', 'Search space and selection protocol documented'],
    ['RR-6', 'SHAP explainability: global feature importance + local explanations surfaced in the product', 'M', 'Figures in the project book; /explain endpoint live (PRED-3)'],
    ['RR-7', 'Ethics chapter: privacy, bias and generalization limits, decision-support framing, no worker surveillance', 'M', 'Chapter in the project book'],
    ['RR-8', 'External validation on NYC Open Data (project-level transfer)', 'M', 'Executed 17.8 on dataset 95tx-snak (3,661 NYC capital projects, 10 tri-annual snapshots): 61.8% of projects slip >30 days vs their first observed forecast (48% in the clean new-project cohort; median slip 183 days); late rate among actually-finished projects 42.7% — strikingly close to our corpus (41.3%). Plan-time features scored on UNSEEN agencies (GroupKFold by agency): AUC 0.60 (slippage) / 0.68 (actual lateness) — a real but modest signal, far below within-project scenario B (0.75). Confirms the pre-declared thesis: cross-context transfer is weak, value lives in within-project history; limitations reported explicitly'],
    ['RR-9', 'NLP activity categorization from task names as an additional feature', 'O', 'Category-feature ablation reported'],
    ['RR-10', 'GNN over the dependency graph vs hand-crafted graph features', 'O', 'Comparison, or a reasoned descoping decision, documented'],
    ['RR-11', 'Within-project learning curve: model performance as a function of available project history — the scenario-B protocol repeated at history cuts of 10%..70% (per-project rel_position percentiles) against a fixed test set (each project’s latest 30%), answering "from what point in a project do predictions become usable"', 'M', 'AUC/F1 curve over ≥6 cut points, fixed test set, same seed and tuned champion; a data-derived usability threshold (e.g., first cut where AUC ≥ 0.70) feeds the PRED-10 abstention policy; figure reproduced in the project book'],
    ['RR-12', 'Value beyond domain knowledge: the champion compared, on identical splits, against (a) itself without float features and (b) the engineer’s CPM heuristic ("late if total_float < X", X chosen on train) — answering "does the ML add anything over what the scheduler already knows?"', 'M', 'AUC/F1 deltas reported for all three; result informs the PRED-9 float/CPM decision; reproduced in the book'],
    ['RR-13', 'Scenario-A stability: cross-project transfer evaluated over ≥20 repeated group splits (all models, tuned params) plus leave-one-project-out for the champion — answering "how noisy is a single cross-project split, and what would a brand-new project actually experience?"', 'M', 'Mean/std/range of AUC per model over ≥20 splits + per-project LOPO AUC for the champion; executed 16.8: all models mean 0.55–0.60 with std 0.13–0.19 (range 0.18–0.88), LOPO median 0.66 with per-project range 0.0–0.92 — single-split scenario-A numbers are never quoted alone; confirms history-based framing and PRED-10 abstention'],
  ]),
);

// ── 5 ──
ch.push(
  h1('5. Non-functional requirements'),
  mkTable(['ID', 'Requirement', 'Verification'], [
    ['NFR-PERF-1', 'Single prediction ≤500ms including explanation computation; 1,000-activity batch ≤10s on the deployment server', 'Timed CI integration test'],
    ['NFR-PERF-2', 'Twin ≥30 FPS on the department tablet for a 20-floor building', 'Manual measurement on device'],
    ['NFR-SEC-1', 'Salted hashing; JWT expiry; role matrix enforced server-side on every route', 'Auth test suite, attempted-bypass tests'],
    ['NFR-SEC-2', 'No secrets in repo; env-var configuration', 'CI secret scan'],
    ['NFR-SEC-3', 'Uploaded files: type and size validation, member-only download, no public URLs', 'Upload test suite'],
    ['NFR-SEC-4', 'Auth events (logins, 2FA, lockouts, resets) audited', 'Auth test suite'],
    ['NFR-SEC-5', 'AI service reachable from the backend only (shared secret via environment); not publicly exposed; no secret in the repository', 'Unauthenticated request → 401 (tested); deployment exposes only the backend'],
    ['NFR-REL-1', 'Fully usable with the AI service down (degraded predictions)', 'Kill-container E2E test'],
    ['NFR-USE-1', 'Every displayed risk includes a human-readable explanation; no bare scores', 'UI review vs SHAP output'],
    ['NFR-I18N-1', 'Hebrew-first RTL UI; all strings centralized for localization', 'String-catalog lint'],
    ['NFR-DEMO-1', 'All time windows (link expiry, escalation, expiry alerts) configurable via env vars; tests and demo use injected short values', 'Config test'],
    ['NFR-DEMO-2', 'In demo/test environments all outbound email (OTP, invitations, reset links) is written to a visible log or MailHog inbox', 'Demo smoke test'],
    ['NFR-PORT-1', 'Full stack starts with a single docker compose up on a clean machine', 'Fresh-VM smoke test'],
    ['NFR-MAIN-1', 'CI green per merge: lint, unit tests, builds of all four components', 'GitHub Actions status'],
    ['NFR-REPRO-1', 'Every reported ML result reproducible from committed config and seed', 'metrics.json rerun matches'],
  ], [1350, 5350, 2800]),
);

// ── 6-7 ──
ch.push(
  h1('6. Data requirements'),
  p('Entities (fields and relations per characterization §13): User, Project, ProjectMember, Invitation, Activity, Dependency, Document, DocumentApproval, Comment, Prediction, Alert, AuditLog. Prediction is extended per PRED-16: feature values used, feature-schema version, calibration version, reliability flags, realised outcome and its recording date; rows are append-only.'),
  h1('7. Traceability'),
  mkTable(['Characterization chapter', 'Requirements', 'Jira epic'], [
    ['3 — Account, auth, profile, home', 'AUTH-1, 2, 3, 6, 7, 8, 9; DASH-5', 'Auth / Dashboards'],
    ['4 — Project, team, invitations', 'TASK-1, TASK-7; AUTH-4, AUTH-5', 'Tasks / Auth'],
    ['5 — Tasks and dependencies', 'TASK-2–5, TASK-8–10', 'Tasks'],
    ['6 — Documents and approvals', 'DOC-1–5 (profile certificates also §3.5)', 'Documents'],
    ['7 — Communication', 'COMM-1, COMM-2', 'Communication'],
    ['8 — AI predictions', 'PRED-1–21', 'AI Service'],
    ['9 — Digital Twin', 'TWIN-1–5', 'Twin'],
    ['10 — Dashboards, alerts, feed', 'DASH-1–4, DASH-6, DASH-7', 'Dashboards'],
    ['13 — Data model', '§6 above', '—'],
    ['Research (SRS §5)', 'RR-1…RR-13 (§4.9)', 'Research'],
  ], [3300, 3800, 2400]),
  p([run('Source note. ', { bold: true }), run('DATA-1–5, PRED-2, and the numeric NFR thresholds (500ms, 30 FPS, compose-up, CI, reproducibility) originate in SRS v1.1 rather than the characterization, and are restated here so this document is the single Jira source. An SRS v1.2 pass aligning PRED-1 (estimated delay days), TWIN-1 (status/risk toggle) and the TASK-6 withdrawal is pending; until then this document is authoritative where the two diverge.')]),
  p([run('Change control. ', { bold: true }), run('Any change to an M requirement requires advisor approval, a Jira comment referencing the decision, and a version bump of this document and the SRS.')]),
  mkTable(['Version', 'Date', 'Changes'], [
    ['1.0', 'July 2026', 'Initial requirements document derived from the characterization v1.0; verified by three independent review passes (coverage, consistency, testability/scope)'],
    ['1.1', 'July 2026', 'AI core strengthened: research requirements RR-1..10 restated in full as §4.9 with priorities; PRED-6 model quality gate (M) and PRED-7 what-if analysis (O) added'],
    ['1.2', 'July 2026', 'FR-PRED expanded to PRED-1..21 (merge of partner-review expansion proposal, trimmed): feature contract + adapter, abstention, banding protocol, calibration, leakage CI control, persistence + outcome capture; gate re-anchored on scenario B with proposed absolute floors (pending advisor); consequential edits to TASK-5, DASH-4/5, NFR-PERF-1, NFR-SEC-5, §6'],
    ['1.3', 'July 2026', 'Numbers synchronised to the widened scenario-B run (Sprint 2, registry v2): 13 projects / 3,428 test; calibrated champion AUC 0.768, F1 0.560, recall 0.682, Brier 0.190; MAE floor moved to explicit advisor decision (0.45-day margin). Jira board link inserted. No requirement text changed'],
    ['1.4', 'July 2026', 'RR-11 added (M): within-project learning curve — performance vs available history, closing the cold-start question raised during product review; its usability threshold feeds PRED-10. Additive change; no existing requirement modified'],
    ['1.5', 'July 2026', 'Corpus integrity fix (DATA-2 hardening): containment dedup found one schedule family present 3× (Enppi ⊂ MERGE PROJECTS ⊂/≈ hela-2l) — duplicates removed, labeled corpus 11,705→10,609, 17→15 projects. All results re-derived: champion now XGBoost (registry v3), regression auto-gated OFF per PRED-11 (loses to dummy on clean data), RR-11 usability threshold unchanged (40%). RR-12 added and executed: ML beats the CPM heuristic by ΔAUC +0.26; float features contribute ΔAUC 0.0015 → PRED-9 CPM-for-model question effectively resolved (retrain-without-float is viable). Gate table updated to v3 numbers; Brier floor flagged for re-derivation'],
    ['1.6', 'August 2026', 'Internal audit round (registry v4): (a) scenario-A calibration Brier removed from artifacts — the A test set overlaps the B train side, so those figures were leakage-contaminated; calibration is now evaluated on scenario B only. (b) Served-vs-selection metrics made explicit everywhere: selection fit AUC 0.751, served calibrated pipeline AUC 0.723 / F1 0.500 / Brier 0.207 — the served numbers are the headline. (c) Champion tie disclosed: XGBoost vs RF ΔAUC 0.0004, bootstrap CI [−0.010, +0.012] — statistically tied, decided by the pre-registered rule. (d) Bootstrap CIs added for the Brier claim (CI95 [0.200, 0.215]); the fixed 0.20 floor is inside the CI — floor derivation moved to advisor discussion. (e) Quality gate now runs BEFORE registry publication; scenario-A rule gated on AUC only. (f) Containment dedup round 2 (code+name fingerprints): 6 more unlabeled duplicate families excluded — corpus statistics corrected to 122,057 activities / 51 projects (no model metric changed). (g) Alert-band quantiles re-derived on train-side data: t1=0.68, t2=0.76. All numbers now generated from outputs/numbers.json'],
    ['1.7', 'August 2026', 'RR-13 added and executed (scenario-A stability: 20 repeated splits + LOPO — transfer weak AND unstable for every model; product framing confirmed). PRED-8 extended with serving-time sanity ranges (KAN-103): schema-listed numeric bounds enforced per request (422 on gross unit/nonsense errors); feature_schema gains range metadata without a version bump. PRED-9 platform_source notes updated post-RR-12'],
    ['1.8', 'August 2026', 'RR-8 executed (external validation, NYC Open Data 95tx-snak): delay is the norm in an independent public portfolio (61.8% slip >30d, median 183d); base-rate echo across corpora (42.7% vs our 41.3%); plan-time features on unseen agencies AUC 0.60–0.68 — cross-context transfer confirmed weak, as declared in advance. Requirement row updated from planned to executed; raw CSV + rr8_nyc.py committed for reproducibility'],
  ], [1100, 1300, 7100]),
);

const doc = new Document({
  numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 200 } }, run: { font: FONT } } }] }] },
  styles: { default: { document: { run: { font: FONT, size: 21 } } } },
  sections: [{ properties: {}, children: ch }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync('/home/claude/afyon/Requirements Document.docx', buf);
  console.log('OK', buf.length);
});
