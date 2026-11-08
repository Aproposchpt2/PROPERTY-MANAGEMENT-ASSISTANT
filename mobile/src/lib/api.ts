// Calls the PMA site's existing APIs. The app never talks to the case tables directly:
// /api/manager/* checks the Supabase sign-in, the user's tenant_users role (OWNER, ADMIN,
// MANAGER) and property access on the server, and /api/portal/* serves the resident view
// for a status-link token. Authorization therefore stays server-side.
import { API_BASE } from './config';
import { supabase } from './supabase';
import type { CaseDetail, CaseSummary, PortalCase } from './cases';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new ApiError(401, 'Please sign in again.');
    headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  } catch {
    throw new ApiError(0, 'No connection. Check your network and try again.');
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const fallback =
      res.status === 401 ? 'Please sign in again.' :
      res.status === 403 ? 'This account does not have manager access.' :
      res.status === 404 ? 'Not found.' :
      res.status === 429 ? 'Too many requests. Wait a minute and try again.' :
      'Something went wrong. Try again.';
    throw new ApiError(res.status, fallback);
  }
  return body as T;
}

// Manager API (requires a signed-in manager)
export async function listCases(): Promise<CaseSummary[]> {
  const d = await request<{ success: boolean; cases: CaseSummary[] }>('/api/manager/cases', {}, true);
  return d?.cases ?? [];
}

export async function getCase(id: string): Promise<CaseDetail> {
  return request<CaseDetail>(`/api/manager/cases/${encodeURIComponent(id)}`, {}, true);
}

export type CasePatch = { status?: string; tenant_update?: string; internal_notes?: string };
export async function updateCase(id: string, patch: CasePatch) {
  return request<{ success: boolean; status: string; priority: string }>(
    `/api/manager/cases/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
    true,
  );
}

// Resident portal API (the status-link token is the credential)
export async function getPortalCase(token: string): Promise<PortalCase> {
  return request<PortalCase>(`/api/portal/case?t=${encodeURIComponent(token)}`);
}

// Maintenance request (the app's version of calling the Customer Care Center).
// Step 1 texts a code to the resident's phone; step 2 files the request with that code.
export type CodeResponse = { success: true; challenge: string; expiresAt: number; phoneLast4: string };
export type RequestPayload = {
  challenge: string;
  code: string;
  reportedName: string;
  reportedAddress: string;
  reportedUnit: string;
  description: string;
  language: 'en' | 'es';
  contactMethod: 'sms' | 'email';
  email?: string;
  consent: boolean;
};
export type RequestResult = {
  success: true;
  caseNumber: string;
  urgent: boolean;
  statusToken: string | null;
  notificationSent: boolean;
  notificationState: string;
};

// These endpoints return a resident-readable `error` and a `state`; surface both.
export class RequestError extends Error {
  constructor(public status: number, public state: string, message: string) {
    super(message);
  }
}

async function postApp<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new RequestError(0, 'OFFLINE', 'No connection. Check your network and try again, or call the property line.');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok || !data?.success) {
    throw new RequestError(res.status, data?.state ?? 'UNKNOWN', data?.error ?? 'Something went wrong. Try again, or call the property line.');
  }
  return data as T;
}

export const requestCode = (phone: string) => postApp<CodeResponse>('/api/app/verify', { phone });
export const submitRequest = (payload: RequestPayload) => postApp<RequestResult>('/api/app/request', payload);
