begin;

-- 1. Remove the stray 6-argument pma_voice_session_close_v1 (created outside this repo).
--    It was executable by anon/authenticated (default PUBLIC grant), had no service-role check,
--    and referenced a column that does not exist (pma_voice_sessions.session_id), so it could
--    never succeed. Worse, its name collided with the real 5-argument function: PostgREST could
--    not choose between them (HTTP 300, PGRST203) and every close_session call failed, leaving
--    voice sessions open. Dropping it restores the protected 5-argument version.
drop function if exists public.pma_voice_session_close_v1(uuid, uuid, uuid, text, text, jsonb);

-- 2. stellar_create_support_intake (from the CUSTOMER-ENGAGEMENT-OPERATIONS-CENTER repo) was
--    meant for authenticated and service_role only, but Postgres grants EXECUTE to PUBLIC by
--    default and that was never revoked, so signed-out callers with the publishable key could
--    look up or create contacts in any tenant. Keep authenticated and service_role.
revoke execute on function public.stellar_create_support_intake(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.stellar_create_support_intake(uuid, text, text, text, text, text, text, text, text, text, text) to authenticated, service_role;

commit;
