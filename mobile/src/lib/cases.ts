// Pure case helpers shared by the resident and manager screens.
// No React or Expo imports here, so the logic can be unit-tested with plain Node.

// The live PMA case lifecycle (pma_maintenance_requests.status), in order.
// These are the same values the web Management Dashboard offers.
export const CASE_STATUSES = ['New', 'Assigned', 'Scheduled', 'In Progress', 'Completed', 'Closed'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const RESOLVED_STATUSES: readonly string[] = ['Completed', 'Closed'];
const URGENT_PRIORITIES: readonly string[] = ['emergency', 'urgent', 'high'];

export type CaseSummary = {
  id: string;
  caseNumber: string | null;
  createdAt: string;
  updatedAt: string | null;
  priority: string | null;
  status: string;
  reportedName?: string | null;
  reportedAddress?: string | null;
  reportedUnit?: string | null;
  language?: string | null;
  vendorName?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  tenantUpdate?: string | null;
  nteAmount?: number | null;
  approvalState?: string | null;
};

export type TimelineEntry = {
  eventType: string;
  body?: string | null;
  actorUserId?: string | null;
  createdAt: string;
};

export type CaseDetail = CaseSummary & {
  category?: string | null;
  sourceChannel?: string | null;
  summary?: string | null;
  descriptionVerbatim?: string | null;
  isEmergency?: boolean;
  contactMethod?: string | null;
  contactDestinationMasked?: string | null;
  internalNotes?: string | null;
  completedAt?: string | null;
  resolutionNote?: string | null;
  workOrderRef?: string | null;
  vendorId?: string | null;
  timeline: TimelineEntry[];
};

// Resident portal view (pma_portal_case_view_v1): deliberately narrower than the manager view.
export type PortalCase = {
  caseNumber: string;
  createdAt: string;
  status: string;
  isEmergency: boolean;
  language: string;
  tenantUpdate: string | null;
  vendorName: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedAt: string | null;
  propertyTimezone: string;
  timeline: TimelineEntry[];
};

export function isResolved(status: string): boolean {
  return RESOLVED_STATUSES.includes(status);
}

export function isUrgent(priority: string | null | undefined): boolean {
  return !!priority && URGENT_PRIORITIES.includes(priority.toLowerCase());
}

// A provider's quote is over the pre-authorized limit and waits for a manager.
export function needsApproval(c: Pick<CaseSummary, 'approvalState'>): boolean {
  return c.approvalState === 'PENDING';
}

export function caseCounts(cases: readonly CaseSummary[]) {
  let active = 0, fresh = 0, urgent = 0, resolved = 0;
  for (const c of cases) {
    if (isResolved(c.status)) { resolved++; continue; }
    active++;
    if (c.status === 'New') fresh++;
    if (isUrgent(c.priority)) urgent++;
  }
  return { active, new: fresh, urgent, resolved };
}

export const QUEUE_FILTERS = ['All', 'Urgent', 'Approval', 'New', 'Assigned', 'Scheduled', 'In Progress', 'Resolved'] as const;
export const PHONE_FILTERS = ['Open', 'Emergency', 'Scheduled', 'Completed'] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number] | (typeof PHONE_FILTERS)[number];

export function filterCases(cases: readonly CaseSummary[], filter: QueueFilter): CaseSummary[] {
  switch (filter) {
    case 'All': return [...cases];
    case 'Open': return cases.filter(c => !isResolved(c.status));
    case 'Emergency': return cases.filter(c => isUrgent(c.priority) && !isResolved(c.status));
    case 'Completed': return cases.filter(c => isResolved(c.status));
    case 'Resolved': return cases.filter(c => isResolved(c.status));
    case 'Urgent': return cases.filter(c => isUrgent(c.priority) && !isResolved(c.status));
    case 'Approval': return cases.filter(needsApproval);
    default: return cases.filter(c => c.status === filter);
  }
}

// Staff "waiting" statuses (allowed by the database since 20261112090000). To the resident they
// are still "In Progress".
const IN_PROGRESS_ALIASES: readonly string[] = ['Waiting on Parts', 'Waiting on Tenant Access', 'On Hold'];

// Position of a status in the lifecycle, for the resident progress tracker. -1 if unknown.
export function statusStep(status: string): number {
  const s = IN_PROGRESS_ALIASES.includes(status) ? 'In Progress' : status;
  return (CASE_STATUSES as readonly string[]).indexOf(s);
}

// Residents receive links like https://pma.stellaruc.com/status?t=TOKEN (or pma://status?t=TOKEN).
// Accept the whole link or the bare token; return null if neither looks valid.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,200}$/;
export function parseStatusToken(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  const m = raw.match(/[?&]t=([^&#\s]+)/);
  let token = m ? m[1] : raw;
  try { token = decodeURIComponent(token); } catch { return null; }
  return TOKEN_RE.test(token) ? token : null;
}

const EVENT_LABELS: Record<string, string> = {
  case_updated: 'Case updated',
  vendor_assigned: 'Service provider assigned',
  vendor_accepted: 'Service provider confirmed',
  vendor_declined: 'Service provider unavailable',
  vendor_status_update: 'Service provider update',
  nte_approval_requested: 'Cost approval requested',
  nte_approval_response: 'Cost approval answered',
  nte_auto_approved: 'Work pre-approved',
  mgr_approval_response: 'Approval answered by the team',
  resident_update_sent: 'Update sent to resident',
};
export function eventLabel(eventType: string): string {
  if (EVENT_LABELS[eventType]) return EVENT_LABELS[eventType];
  const words = (eventType || 'update').replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatWhen(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) });
  } catch {
    return d.toLocaleString();
  }
}

// Visit scheduling for the assign screen: the next 7 days and 2-hour windows from 8am to 6pm,
// in the manager's local time (as the web dashboard does).
export const VISIT_WINDOWS = [8, 10, 12, 14, 16] as const;

export function nextDays(now: Date, count = 7): Date[] {
  return Array.from({ length: count }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
}

export function visitWindow(day: Date, startHour: number, hours = 2): { start: string; end: string } {
  const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour);
  const e = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour + hours);
  return { start: s.toISOString(), end: e.toISOString() };
}

// A window that has already ended cannot be booked.
export function windowAvailable(day: Date, startHour: number, now: Date, hours = 2): boolean {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour + hours).getTime() > now.getTime();
}

export function hourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'pm' : 'am'}`;
}

// The case a manager's push notification points to (data.requestId, a UUID). Anything else is ignored.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function notificationCaseId(data: unknown): string | null {
  const id = data && typeof data === 'object' ? (data as { requestId?: unknown }).requestId : null;
  return typeof id === 'string' && UUID_RE.test(id) ? id : null;
}

// What the manager is told after saving, including whether the resident was messaged.
export function savedMessage(updatedResidentText: boolean, notification?: { state: string; method?: string | null }): string {
  if (!updatedResidentText) return 'Case updated.';
  const page = 'The resident sees your update on their status page.';
  if (!notification) return `Case updated. ${page}`;
  const how = notification.method === 'email' ? 'email' : 'text';
  switch (notification.state) {
    case 'SENT': return `Case updated. The resident was also sent your update by ${how}.`;
    case 'OPTED_OUT': return `Case updated. ${page} They have opted out of texts, so no text was sent.`;
    case 'DISABLED': return `Case updated. ${page} Resident messages are turned off, so nothing was sent.`;
    case 'NO_PREFERENCE': return `Case updated. ${page} They didn't choose text or email, so nothing was sent.`;
    default: return `Case updated. ${page} The ${how} to the resident could not be sent.`;
  }
}

export function formatMoney(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '' : `$${n.toFixed(2)}`;
}
