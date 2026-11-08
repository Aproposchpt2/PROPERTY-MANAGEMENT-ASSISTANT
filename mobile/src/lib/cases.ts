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

export const QUEUE_FILTERS = ['All', 'Urgent', 'New', 'Assigned', 'Scheduled', 'In Progress', 'Resolved'] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

export function filterCases(cases: readonly CaseSummary[], filter: QueueFilter): CaseSummary[] {
  switch (filter) {
    case 'All': return [...cases];
    case 'Resolved': return cases.filter(c => isResolved(c.status));
    case 'Urgent': return cases.filter(c => isUrgent(c.priority) && !isResolved(c.status));
    default: return cases.filter(c => c.status === filter);
  }
}

// Position of a status in the lifecycle, for the resident progress tracker. -1 if unknown.
export function statusStep(status: string): number {
  return (CASE_STATUSES as readonly string[]).indexOf(status);
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
  mgr_approval_response: 'Manager approval answered',
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
