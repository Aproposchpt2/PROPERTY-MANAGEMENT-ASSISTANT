// Remembers the resident's details on this device (or browser) so the next request is quicker.
import { getItem, setItem } from './storage';

const KEY = 'pma.residentProfile.v1';
export type ResidentProfile = {
  name: string;
  address: string;
  unit: string;
  phone: string;
  email: string;
  contactMethod: 'sms' | 'email';
  language: 'en' | 'es';
};

export async function loadProfile(): Promise<Partial<ResidentProfile>> {
  try {
    const raw = await getItem(KEY);
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export async function saveProfile(p: ResidentProfile) {
  await setItem(KEY, JSON.stringify(p));
}
