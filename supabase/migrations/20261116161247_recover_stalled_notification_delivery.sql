-- Ensure a worker interrupted after SMTP DATA is surfaced for review even without new events.
create or replace function private.kick_notification_worker() returns void language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if not exists(select 1 from private.commerce_settings where singleton and email_enabled) then return;end if;
 if not exists(select 1 from private.notifications where
   (status in ('pending','retry') and next_attempt_at<=now()) or
   (status='sending' and claimed_at<now()-interval '10 minutes')) then return;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='chroma_notification_worker';
 if token is null then return;end if;
 perform net.http_post(url:='https://mbilemzzpoxdwujyswfk.supabase.co/functions/v1/chroma-notifications',
  headers:=jsonb_build_object('content-type','application/json','x-chroma-worker',token),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function private.kick_notification_worker() from public,anon,authenticated;
