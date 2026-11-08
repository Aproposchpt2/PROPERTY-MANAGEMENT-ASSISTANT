// Remembers the resident's details on this device so the next request is quicker.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

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
  if (Platform.OS === 'web') return {};
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

export async function saveProfile(p: ResidentProfile) {
  if (Platform.OS === 'web') return;
  try { await SecureStore.setItemAsync(KEY, JSON.stringify(p)); } catch { /* convenience only */ }
}
