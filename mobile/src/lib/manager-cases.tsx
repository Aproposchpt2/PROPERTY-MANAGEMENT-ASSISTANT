import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { ApiError, listCases } from './api';
import type { CaseSummary } from './cases';
import { registerForPush, unregisterPush } from './push';
import { unregisterWebPush } from './webpush';
import { supabase } from './supabase';

function useCaseData() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const request = useRef<Promise<void> | null>(null);
  const registered = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = useCallback((): Promise<void> => {
    if (request.current) return request.current;
    setLoading(true);
    request.current = (async () => {
      try {
        const result = await listCases();
        if (!alive.current) return;
        setCases(result);
        setError(null);
        // Register only after the server has confirmed team access, as before.
        if (!registered.current && Platform.OS !== 'web') {
          registered.current = true;
          registerForPush().catch(() => {});
        }
      } catch (e) {
        if (!alive.current) return;
        setCases([]); // Do not leave stale case details or badges after access is lost.
        setError(e instanceof ApiError ? e : new ApiError(0, 'Could not load cases. Try again.'));
      } finally {
        if (alive.current) { setLoading(false); setLoaded(true); }
        request.current = null;
      }
    })();
    return request.current;
  }, []);
  const signOut = useCallback(async () => {
    await (Platform.OS === 'web' ? unregisterWebPush() : unregisterPush());
    registered.current = false;
    await supabase.auth.signOut();
  }, []);
  return { cases, loading, loaded, error, refresh, signOut };
}
const CaseContext = createContext<ReturnType<typeof useCaseData> | null>(null);
export function ManagerCasesProvider({ children }: { children: ReactNode }) {
  const value = useCaseData();
  return <CaseContext.Provider value={value}>{children}</CaseContext.Provider>;
}
export function useManagerCases() {
  const value = useContext(CaseContext);
  if (!value) throw new Error('ManagerCasesProvider is required');
  return value;
}
