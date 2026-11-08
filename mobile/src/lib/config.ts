// Public configuration only. EXPO_PUBLIC_ values are compiled into the app bundle,
// so a service-role key, database password or other secret must never appear here.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const API_BASE = (process.env.EXPO_PUBLIC_PMA_API_BASE ?? 'https://pma.stellaruc.com').replace(/\/+$/, '');
export const PMA_PHONE = process.env.EXPO_PUBLIC_PMA_PHONE ?? '+17252010584';

export function displayPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : e164;
}

// Phase 1 is the resident maintenance request. The manager screens are built but stay hidden
// until phase 2; set EXPO_PUBLIC_ENABLE_MANAGER=true to turn them on.
export const MANAGER_ENABLED = process.env.EXPO_PUBLIC_ENABLE_MANAGER === 'true';
