// Staff choices only: waiting states are not sequential resident progress milestones.
export const MANAGER_STATUSES = [
  'New', 'Assigned', 'Scheduled', 'In Progress', 'Waiting on Parts',
  'Waiting on Tenant Access', 'On Hold', 'Completed', 'Closed',
] as const;

export const TENANT_UPDATE_PRESETS = [
  'We received your request and are reviewing it.',
  'A technician has been assigned to your request.',
  "Your service visit has been scheduled. We'll confirm the time shortly.",
  'The technician is on the way.',
  "Parts have been ordered. We'll update you when they arrive.",
  'We need access to your unit. Please contact us to arrange a time.',
  'The repair is complete. Please let us know if anything else is needed.',
] as const;

export const INTERNAL_NOTE_PRESETS = [
  'Called tenant, no answer, left voicemail.',
  'Vendor contacted, awaiting confirmation.',
  'Quote requested from vendor.',
  'Quote approved.',
  'Follow-up needed.',
  'Duplicate of another case.',
] as const;
