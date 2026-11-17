-- 2026-11-17 audit FIX 1.2: close_session returned UNKNOWN on every call since at least Nov 1.
-- Production held two overloads of pma_voice_session_close_v1. The webhook calls it with five
-- named arguments, which matches both (the second has transcript DEFAULT), so PostgREST cannot
-- choose one and the RPC errors. The 6-argument overload was never in a migration and could not
-- run anyway (it qualifies parameters with "close_v1." and filters on a session_id column).
-- Drop it; the 5-argument version from 20261027050000 stays as the only one.
drop function if exists public.pma_voice_session_close_v1(uuid, uuid, uuid, text, text, jsonb);
