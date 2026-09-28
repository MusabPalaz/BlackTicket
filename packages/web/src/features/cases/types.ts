import type {
  CaseResolution,
  CaseStatus,
  ObservableType,
  Severity,
  TaskStatus,
  Tlp,
} from '@black-ticket/shared';

export interface PersonRef {
  id: string;
  username: string;
  fullName: string;
  /** Only present on /users/assignable, not on embedded reporter/assignee refs. */
  role?: string;
}

export interface CategoryRef {
  id: string;
  slug: string;
  name: string;
  color: string;
}

export interface MitreRef {
  id: string;
  name: string;
  tactic: string;
  url: string;
}

/** The API returns the same shape for list rows and case detail. */
export interface CaseRecord {
  id: string;
  number: number;
  reference: string;
  title: string;
  description: string;
  status: CaseStatus;
  resolution: CaseResolution | null;
  severity: Severity;
  tlp: Tlp;
  pap: Tlp;
  category: CategoryRef | null;
  reporter: PersonRef;
  assignee: PersonRef | null;
  sourceSystem: string;
  sourceRef: string | null;
  occurredAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  slaDueAt: string | null;
  slaFirstResponseDueAt: string | null;
  slaBreached: boolean;
  summary: string | null;
  tags: string[];
  mitre: MitreRef[];
  taskCount: number;
  observableCount: number;
  /** Detail responses only; the case list does not carry it. */
  relatedCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CaseTask {
  id: string;
  caseId: string;
  title: string;
  description: string;
  status: TaskStatus;
  sortOrder: number;
  assignee: PersonRef | null;
  createdBy: PersonRef;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  logCount: number;
  /** Set when the task came from a playbook rather than being typed by hand. */
  templateItemId?: string | null;
  /** The analyst's answers, carried with the task so they read in place. */
  answers: TaskLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskLogEntry {
  id: string;
  body: string;
  author: PersonRef;
  createdAt: string;
}

export interface TimelineEvent {
  kind: 'audit' | 'task' | 'note';
  at: string;
  action: string;
  actor: PersonRef | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  taskId?: string;
  title?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface CaseSummaryCounters {
  open: number;
  mine: number;
  unassigned: number;
  dueSoon: number;
  bySeverity: Record<Severity, number>;
}

// --- Phase 3: observables and correlation ---------------------------------

export interface ObservableRef {
  id: string;
  type: ObservableType;
  value: string;
  normalized: string;
  sightingCount: number;
  isNoisy: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface CaseObservable {
  id: string;
  caseId: string;
  isIoc: boolean;
  tlp: Tlp;
  description: string | null;
  addedBy: PersonRef;
  addedAt: string;
  observable: ObservableRef;
}

export interface CorrelationHit {
  caseId: string;
  reference: string;
  title: string;
  status: CaseStatus;
  severity: Severity;
  observable: { id: string; type: ObservableType; value: string; normalized: string };
}

export interface AddObservablesResult {
  added: CaseObservable[];
  duplicates: { type: string; value: string }[];
  rejected: { type: string; value: string; reason: string }[];
  correlations: CorrelationHit[];
}

export interface RelatedCase {
  case: {
    id: string;
    reference: string;
    title: string;
    status: CaseStatus;
    severity: Severity;
    resolution: CaseResolution | null;
  };
  linkType: string;
  isAutomatic: boolean;
  sharedObservables: { id: string; type: string; value: string }[];
  manualReasons: { reason: string; by: string | null; linkId: string }[];
}

export interface ObservableSearchRow extends ObservableRef {
  isIoc: boolean;
  cases: {
    id: string;
    reference: string;
    title: string;
    status: CaseStatus;
    severity: Severity;
    isIoc: boolean;
  }[];
}

export interface WhitelistRuleRow {
  id: string;
  type: ObservableType;
  pattern: string;
  isCidr: boolean;
  reason: string | null;
  createdAt: string;
}
