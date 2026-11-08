// Public configuration only. EXPO_PUBLIC_ values are compiled into the app bundle,
// so a service-role key, database password or other secret must never appear here.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
import { Platform } from 'react-native';

// The phone app calls the PMA site; the web app is served from that same site (/app), so it uses
// relative URLs (no cross-origin requests; works on Netlify deploy previews too).
// EXPO_PUBLIC_PMA_API_BASE_WEB overrides this for local web development.
export const API_BASE = (Platform.OS === 'web'
  ? process.env.EXPO_PUBLIC_PMA_API_BASE_WEB ?? ''
  : process.env.EXPO_PUBLIC_PMA_API_BASE ?? 'https://pma.stellaruc.com').replace(/\/+$/, '');
export const PMA_PHONE = process.env.EXPO_PUBLIC_PMA_PHONE ?? '+17252010584';

export function displayPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : e164;
}

// Manager screens. On for the web app delivered with the package (netlify.toml); a phone build
// can still leave them off.
export const MANAGER_ENABLED = process.env.EXPO_PUBLIC_ENABLE_MANAGER === 'true';
