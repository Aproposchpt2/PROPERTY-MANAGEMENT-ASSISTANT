// Remembers the resident's last few status links on this device, so they can reopen a case
// without finding the text again. Tokens are credentials, so they go in SecureStore.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'pma.recentCases.v1';
const MAX = 5;
export type RecentCase = { token: string; caseNumber: string; status: string; seenAt: string };

async function read(): Promise<RecentCase[]> {
  if (Platform.OS === 'web') return [];
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export const listRecent = read;

export async function rememberCase(entry: RecentCase) {
  if (Platform.OS === 'web') return;
  const list = (await read()).filter(x => x.token !== entry.token);
  list.unshift(entry);
  await SecureStore.setItemAsync(KEY, JSON.stringify(list.slice(0, MAX)));
}

export async function forgetCase(token: string) {
  if (Platform.OS === 'web') return;
  const list = (await read()).filter(x => x.token !== token);
  await SecureStore.setItemAsync(KEY, JSON.stringify(list));
}
