-- Rollback: drop follow-up contact functions and the cancelled filter on vendor actions.
drop function if exists public.pma_voice_followup_preference_v1(uuid,uuid,text,text,text,text,boolean);
drop function if exists public.pma_voice_followup_notify_result_v1(uuid,uuid,uuid,text,text,text);

do $$
declare fn text; d text;
begin
  foreach fn in array array['pma_vendor_decline_v1','pma_vendor_propose_window_v1','pma_vendor_post_status_v1','pma_vendor_request_nte_v1'] loop
    select pg_get_functiondef(x.oid) into d from pg_proc x join pg_namespace n on n.oid=x.pronamespace
      where n.nspname='public' and x.proname=fn;
    execute replace(d, 'WHERE va.status IS DISTINCT FROM ''cancelled'' AND va.vendor_id', 'WHERE va.vendor_id');
  end loop;
end $$;
