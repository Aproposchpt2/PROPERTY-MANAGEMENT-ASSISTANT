// Pure checks for the maintenance request form. Limits match the server
// (netlify/functions/pma-app-api.js) and the database (pma_voice_incident_create_v1).

export const LIMITS = { name: 150, address: 300, unit: 80, description: 4000 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Details = { description: string; name: string; address: string; unit: string };

export function detailsError(d: Details): string | null {
  if (d.description.trim().length < 3) return 'Describe the problem.';
  if (d.name.trim().length < 2) return 'Enter your name.';
  if (d.address.trim().length < 5) return 'Enter the property address.';
  if (d.unit.trim().length < 1) return 'Enter your unit or apartment. Write "none" if there is no unit.';
  return null;
}

// US and Canada numbers, same rule as the server. Returns +1XXXXXXXXXX or null.
export function normalizePhone(input: string): string | null {
  let d = (input || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? '+1' + d : null;
}

export function contactError(phone: string, method: 'sms' | 'email', email: string, consent: boolean): string | null {
  if (!normalizePhone(phone)) return 'Enter a 10-digit US or Canadian mobile number.';
  if (method === 'email' && !EMAIL_RE.test(email.trim())) return 'Enter a valid email address.';
  if (!consent) return 'Agree to receive updates about this request.';
  return null;
}

export function statusTokenFrom(result: { statusToken: string | null }): string | null {
  return result.statusToken && /^[A-Za-z0-9_-]{16,200}$/.test(result.statusToken) ? result.statusToken : null;
}
