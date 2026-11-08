import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

// Sessions live in the device keychain/keystore on iOS and Android; Expo web falls back
// to the library's default browser storage (development only).
// SecureStore values over ~2 KB can fail to save on Android, and a Supabase session is usually
// larger, so the app silently lost its sign-in and asked for a new code (2026-11-08). Store the
// session in chunks that each fit, plus a chunk count, all inside the secure keystore.
const CHUNK = 1800;
const countKey = (key: string) => key + '.n';
const partKey = (key: string, i: number) => key + '.' + i;
async function removeChunks(key: string) {
  const n = Number(await SecureStore.getItemAsync(countKey(key))) || 0;
  for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(partKey(key, i));
  await SecureStore.deleteItemAsync(countKey(key));
}
export const secureStorage = {
  async getItem(key: string) {
    const n = Number(await SecureStore.getItemAsync(countKey(key))) || 0;
    if (!n) return SecureStore.getItemAsync(key); // a value saved before chunking
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = await SecureStore.getItemAsync(partKey(key, i));
      if (p == null) return null;
      parts.push(p);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string) {
    await removeChunks(key);
    await SecureStore.deleteItemAsync(key);
    const n = Math.max(1, Math.ceil(value.length / CHUNK));
    for (let i = 0; i < n; i++) await SecureStore.setItemAsync(partKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(countKey(key), String(n));
  },
  async removeItem(key: string) {
    await removeChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', state => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
