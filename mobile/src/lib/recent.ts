// Remembers the resident's last few status links on this device, so they can reopen a case
// without finding the text again. Phones keep them in SecureStore; the web app in this
// browser's storage (the same link is already in the resident's text or email).
import { getItem, setItem } from './storage';

const KEY = 'pma.recentCases.v1';
const MAX = 5;
export type RecentCase = { token: string; caseNumber: string; status: string; seenAt: string };

async function read(): Promise<RecentCase[]> {
  try {
    const raw = await getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export const listRecent = read;

export async function rememberCase(entry: RecentCase) {
  const list = (await read()).filter(x => x.token !== entry.token);
  list.unshift(entry);
  await setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export async function forgetCase(token: string) {
  const list = (await read()).filter(x => x.token !== token);
  await setItem(KEY, JSON.stringify(list));
}
