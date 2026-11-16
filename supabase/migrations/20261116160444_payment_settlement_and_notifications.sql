-- Test captures remain isolated. Live settlement requires both server and database approval.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table private.commerce_settings (
 singleton boolean primary key default true check(singleton),
 live_enabled boolean not null default false,
 revoke_partial_refund boolean,
 email_enabled boolean not null default false,
 email_test_mode boolean not null default true,
 worker_token_hash text
);
insert into private.commerce_settings(singleton) values(true);
-- Owner-selected policy: a partial refund preserves existing STL access.
update private.commerce_settings set revoke_partial_refund=false where singleton;
alter table private.commerce_settings enable row level security;
revoke all on private.commerce_settings from public,anon,authenticated;

alter table private.test_payment_captures add column refunded_minor bigint not null default 0 check(refunded_minor between 0 and amount_minor);
alter table private.payments add column refunded_minor bigint not null default 0 check(refunded_minor between 0 and amount_minor);
alter table public.orders drop constraint orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check check(payment_status in ('unpaid','verified','partially_refunded','refunded'));

create table private.gateway_refunds (
 mode text not null check(mode in ('test','live')), refund_id text not null, payment_id text not null,
 amount_minor bigint not null check(amount_minor>0), currency text not null check(currency='INR'),
 captured_minor bigint not null check(captured_minor>=amount_minor),
 provider_total_minor bigint not null check(provider_total_minor between amount_minor and captured_minor),
 created_at timestamptz not null default now(), primary key(mode,refund_id)
);
create index gateway_refund_payment on private.gateway_refunds(mode,payment_id);
create table private.gateway_failures (
 mode text not null check(mode in ('test','live')), payment_id text not null,
 amount_minor bigint not null check(amount_minor>0), currency text not null check(currency='INR'),
 created_at timestamptz not null default now(), primary key(mode,payment_id)
);
create table private.payment_reviews (
 order_id uuid not null references public.orders, mode text not null check(mode in ('test','live')),
 payment_id text not null, amount_minor bigint not null, currency text not null,
 reason text not null check(reason in ('cancelled_order','amount_mismatch')), created_at timestamptz not null default now(),
 primary key(mode,payment_id)
);
alter table private.gateway_refunds enable row level security;
alter table private.gateway_failures enable row level security;
alter table private.payment_reviews enable row level security;
revoke all on private.gateway_refunds,private.gateway_failures,private.payment_reviews from public,anon,authenticated;

-- Historic placeholder events are retained without sending old notifications.
alter table private.notifications add column status text not null default 'skipped'
 check(status in ('pending','sending','delivered','retry','failed','unknown','skipped'));
alter table private.notifications alter column status set default 'pending';
alter table private.notifications add column recipient text;
alter table private.notifications add column payload jsonb not null default '{}';
alter table private.notifications add column mode text check(mode in ('test','live'));
alter table private.notifications add column dedupe_key text unique;
alter table private.notifications add column attempts integer not null default 0;
alter table private.notifications add column next_attempt_at timestamptz not null default now();
alter table private.notifications add column lease_id uuid;
alter table private.notifications add column claimed_at timestamptz;
alter table private.notifications add column last_error text;
create index notification_delivery_queue on private.notifications(status,next_attempt_at) where status in ('pending','retry');

create function private.prepare_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.orders; r public.requests; test_delivery boolean;
begin
 select email_test_mode into test_delivery from private.commerce_settings where singleton;
 new.mode:=coalesce(new.mode,case when test_delivery then 'test' else 'live' end);
 if new.event like 'order.%' or new.event like 'payment.%' then
  select * into o from public.orders where id=new.entity_id;
  if not found then new.status:='skipped';new.last_error:='MISSING_ORDER';return new;end if;
  new.recipient:=case when new.event='payment.review_required' then 'chromazen.zen@gmail.com' else o.email end;
  new.payload:=jsonb_build_object('name',o.name,'kind','order','status',o.status,'payment_status',o.payment_status,
   'amount_minor',o.total_minor,'currency',o.currency,'customer_account',o.owner_id is not null,
   'refunded_minor',case when new.mode='test' then coalesce((select refunded_minor from private.test_payment_captures where order_id=o.id),0)
     else coalesce((select refunded_minor from private.payments where order_id=o.id),0) end,
   'items',coalesce((select jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity,'format',i.format)) from public.order_items i where i.order_id=o.id),'[]'::jsonb));
 elsif new.event like 'print.%' or new.event like 'studio.%' then
  select * into r from public.requests where id=new.entity_id;
  if not found then new.status:='skipped';new.last_error:='MISSING_REQUEST';return new;end if;
  new.recipient:=r.email;
  new.payload:=jsonb_build_object('name',r.name,'kind',r.kind,'title',r.title,'status',r.status,
    'amount_minor',r.quote_minor,'currency','INR','customer_account',r.owner_id is not null);
 else
  new.status:='skipped';new.last_error:='UNSUPPORTED_EVENT';return new;
 end if;
 if new.recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
  new.status:='skipped';new.last_error:='INVALID_RECIPIENT';
 elsif (test_delivery or new.mode='test') and lower(new.recipient) not in
 ('chromazen.zen@gmail.com','chromazen.zen+customer1@gmail.com','chromazen.zen+customer2@gmail.com') then
  new.status:='skipped';new.last_error:='TEST_RECIPIENT_RESTRICTED';
 end if;
 if test_delivery then new.mode:='test';end if;
 return new;
end $$;
create trigger prepare_notification before insert on private.notifications for each row execute function private.prepare_notification();

create function private.check_gateway_mode(p_mode text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_mode not in ('test','live') or p_mode is null then raise exception 'Invalid payment mode';end if;
 if p_mode='live' and not exists(select 1 from private.commerce_settings where singleton and live_enabled and revoke_partial_refund is not null)
 then raise exception 'Live settlement is disabled';end if;
end $$;

create function private.apply_gateway_refunds(p_order uuid,p_mode text,p_payment text,p_provider_total bigint)
returns void language plpgsql security definer set search_path='' as $$
declare amount bigint; previous bigint; total bigint; revoke_partial boolean;
begin
 if p_mode='test' then
  select amount_minor,refunded_minor into strict amount,previous from private.test_payment_captures where order_id=p_order and capture_id=p_payment;
 else
  select amount_minor,refunded_minor into strict amount,previous from private.payments where order_id=p_order and id='razorpay:'||p_payment;
 end if;
 select greatest(previous,p_provider_total,coalesce(sum(amount_minor),0),coalesce(max(provider_total_minor),0)) into total
 from private.gateway_refunds where mode=p_mode and payment_id=p_payment;
 if total<0 or total>amount then raise exception 'Refund exceeds capture';end if;
 if total=previous then return;end if;
 if p_mode='test' then
  update private.test_payment_captures set refunded_minor=total where order_id=p_order;
 else
  select revoke_partial_refund into revoke_partial from private.commerce_settings where singleton;
  update private.payments set refunded_minor=total where order_id=p_order;
  update public.orders set payment_status=case when total=amount then 'refunded' else 'partially_refunded' end where id=p_order;
  if total=amount or revoke_partial then
   update private.entitlements set expires_at=least(coalesce(expires_at,now()),now())
   where item_id in(select id from public.order_items where order_id=p_order);
  end if;
 end if;
 insert into private.notifications(entity_id,event,mode,dedupe_key)
 values(p_order,case when p_mode='test' then 'payment.test_refunded' else 'payment.refunded' end,p_mode,
  'refund:'||p_mode||':'||p_payment||':'||total::text) on conflict(dedupe_key) do nothing;
end $$;

create function public.record_gateway_capture(p_mode text,p_order_id uuid,p_payment_id text,p_amount_minor bigint,p_currency text,p_refunded_minor bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.orders; first_capture boolean; refunded bigint;
begin
 perform private.check_gateway_mode(p_mode);
 if p_payment_id !~ '^pay_[a-zA-Z0-9]+$' or p_amount_minor<=0 or p_currency is distinct from 'INR'
 or p_refunded_minor not between 0 and p_amount_minor then raise exception 'Invalid capture';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_mode||p_payment_id,0));
 select * into strict o from public.orders where id=p_order_id for update;
 if p_mode='test' then
  select not exists(select 1 from private.test_payment_captures where order_id=p_order_id) into first_capture;
 else
  select not exists(select 1 from private.payments where order_id=p_order_id) into first_capture;
 end if;
 if p_mode='live' and first_capture and (o.status='cancelled' or o.total_minor<>p_amount_minor or o.currency<>p_currency) then
  insert into private.payment_reviews(order_id,mode,payment_id,amount_minor,currency,reason)
  values(p_order_id,p_mode,p_payment_id,p_amount_minor,p_currency,case when o.status='cancelled' then 'cancelled_order' else 'amount_mismatch' end)
  on conflict(mode,payment_id) do nothing;
  if found then insert into private.notifications(entity_id,event,mode,dedupe_key)
    values(p_order_id,'payment.review_required',p_mode,'review:'||p_payment_id) on conflict(dedupe_key) do nothing;end if;
  return jsonb_build_object('review_required',true);
 end if;
 if p_mode='test' then
  perform public.record_test_payment_capture(p_order_id,'razorpay',p_payment_id,p_amount_minor,p_currency);
 else
  perform private.record_verified_payment(p_order_id,'razorpay:'||p_payment_id,p_amount_minor,p_currency);
 end if;
 perform private.apply_gateway_refunds(p_order_id,p_mode,p_payment_id,p_refunded_minor);
 if p_mode='test' then select refunded_minor into refunded from private.test_payment_captures where order_id=p_order_id;
 else select refunded_minor into refunded from private.payments where order_id=p_order_id;end if;
 if first_capture and refunded<p_amount_minor then
  insert into private.notifications(entity_id,event,mode,dedupe_key)
  values(p_order_id,case when p_mode='test' then 'payment.test_received' else 'payment.received' end,p_mode,
   'capture:'||p_mode||':'||p_payment_id) on conflict(dedupe_key) do nothing;
 end if;
 return jsonb_build_object('recorded',true,'mode',p_mode);
end $$;

create function public.record_gateway_refund(p_mode text,p_refund_id text,p_payment_id text,p_amount_minor bigint,p_currency text,p_captured_minor bigint,p_total_refunded bigint)
returns void language plpgsql security definer set search_path='' as $$
declare previous private.gateway_refunds; oid uuid;
begin
 perform private.check_gateway_mode(p_mode);
 if p_refund_id !~ '^rfnd_[a-zA-Z0-9]+$' or p_payment_id !~ '^pay_[a-zA-Z0-9]+$' or p_amount_minor<=0
 or p_currency is distinct from 'INR' or p_total_refunded not between p_amount_minor and p_captured_minor then raise exception 'Invalid refund';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_mode||p_payment_id,0));
 select * into previous from private.gateway_refunds where mode=p_mode and refund_id=p_refund_id;
 if found and (previous.payment_id<>p_payment_id or previous.amount_minor<>p_amount_minor or previous.currency<>p_currency
 or previous.captured_minor<>p_captured_minor) then raise exception 'Conflicting refund';end if;
 insert into private.gateway_refunds(mode,refund_id,payment_id,amount_minor,currency,captured_minor,provider_total_minor)
 values(p_mode,p_refund_id,p_payment_id,p_amount_minor,p_currency,p_captured_minor,p_total_refunded)
 on conflict(mode,refund_id) do update set provider_total_minor=greatest(private.gateway_refunds.provider_total_minor,excluded.provider_total_minor);
 if p_mode='test' then select order_id into oid from private.test_payment_captures where capture_id=p_payment_id and provider='razorpay';
 else select order_id into oid from private.payments where id='razorpay:'||p_payment_id;end if;
 if oid is not null then
  perform 1 from public.orders where id=oid for update;
  perform private.apply_gateway_refunds(oid,p_mode,p_payment_id,p_total_refunded);
 end if;
end $$;

create function public.record_gateway_failure(p_mode text,p_payment_id text,p_amount_minor bigint,p_currency text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.check_gateway_mode(p_mode);
 if p_payment_id !~ '^pay_[a-zA-Z0-9]+$' or p_amount_minor<=0 or p_currency is distinct from 'INR' then raise exception 'Invalid failed payment';end if;
 insert into private.gateway_failures(mode,payment_id,amount_minor,currency) values(p_mode,p_payment_id,p_amount_minor,p_currency)
 on conflict(mode,payment_id) do nothing;
end $$;

create function public.gateway_order_state(p_order_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('test_refunded_minor',coalesce((select refunded_minor from private.test_payment_captures where order_id=p_order_id),0),
 'review_required',exists(select 1 from private.payment_reviews where order_id=p_order_id))
$$;
create function public.gateway_live_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select live_enabled and revoke_partial_refund is not null from private.commerce_settings where singleton
$$;
create or replace function public.order_downloads(p_id uuid) returns table(id uuid,filename text,version int)
language sql stable security definer set search_path='' as $$
 select e.id,a.filename,a.version from private.entitlements e join public.order_items i on i.id=e.item_id
 join public.digital_assets a on a.id=e.asset_id join public.orders o on o.id=i.order_id
 where o.id=p_id and o.payment_status in ('verified','partially_refunded') and (e.expires_at is null or e.expires_at>now())
$$;
create or replace function public.advance_order(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;begin
 select * into strict o from public.orders where id=p_id for update;
 if not ((o.status='pending' and p_status='cancelled' and o.payment_status='unpaid') or
 (o.payment_status in ('verified','partially_refunded') and (o.status,p_status) in (('pending','processing'),('processing','shipped'),('shipped','completed'),('processing','completed'))))
 then raise exception 'Invalid order transition';end if;
 update public.orders set status=p_status where id=p_id;
 insert into private.notifications(entity_id,event) values(p_id,'order.'||p_status);
end $$;

-- Configure the scheduled worker only after SMTP verification by the authenticated owner.
create function public.configure_notification_worker() returns void language plpgsql security definer set search_path='' as $$
declare token text; secret_id uuid;
begin
 select id,decrypted_secret into secret_id,token from vault.decrypted_secrets where name='chroma_notification_worker';
 if secret_id is null then token:=encode(extensions.gen_random_bytes(32),'hex');
  perform vault.create_secret(token,'chroma_notification_worker','Chroma3D notification worker authentication');end if;
 update private.commerce_settings set worker_token_hash=encode(extensions.digest(token,'sha256'),'hex'),email_enabled=true where singleton;
 perform cron.schedule('chroma-notification-delivery','* * * * *','select private.kick_notification_worker();');
end $$;
create function public.notification_worker_access(p_token text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(p_token ~ '^[a-f0-9]{64}$' and worker_token_hash=encode(extensions.digest(p_token,'sha256'),'hex'),false)
 from private.commerce_settings where singleton
$$;
create function public.notification_delivery_settings() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',email_enabled,'test_mode',email_test_mode) from private.commerce_settings where singleton
$$;
create function public.pause_notification_delivery() returns void language sql security definer set search_path='' as $$
 update private.commerce_settings set email_enabled=false where singleton
$$;
create function public.claim_notifications() returns setof private.notifications language plpgsql security definer set search_path='' as $$
begin
 update private.notifications set status='unknown',last_error='WORKER_INTERRUPTED' where status='sending' and claimed_at<now()-interval '10 minutes';
 return query with ready as (
 select id from private.notifications where status in ('pending','retry') and attempts<4 and next_attempt_at<=now()
 order by id for update skip locked limit 3
 )
 update private.notifications n set status='sending',attempts=n.attempts+1,lease_id=gen_random_uuid(),claimed_at=now()
 from ready where n.id=ready.id returning n.*;
end $$;
create function public.finish_notification(p_id bigint,p_lease uuid,p_outcome text,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_outcome not in ('delivered','retry','failed','unknown','skipped') or length(coalesce(p_error,''))>80 then raise exception 'Invalid delivery outcome';end if;
 if exists(select 1 from private.notifications where id=p_id and lease_id=p_lease and status=p_outcome) then return true;end if;
 update private.notifications set status=case when p_outcome='retry' and attempts>=4 then 'failed' else p_outcome end,
 delivered_at=case when p_outcome='delivered' then now() else delivered_at end,last_error=p_error,
 next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,attempts)::integer))
 where id=p_id and lease_id=p_lease and status='sending';
 return found;
end $$;
create function private.kick_notification_worker() returns void language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if not exists(select 1 from private.commerce_settings where singleton and email_enabled) then return;end if;
 if not exists(select 1 from private.notifications where status in ('pending','retry') and next_attempt_at<=now()) then return;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='chroma_notification_worker';
 if token is null then return;end if;
 perform net.http_post(url:='https://mbilemzzpoxdwujyswfk.supabase.co/functions/v1/chroma-notifications',
  headers:=jsonb_build_object('content-type','application/json','x-chroma-worker',token),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
create function private.dispatch_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='pending' then perform private.kick_notification_worker();end if;
 return new;
end $$;
create trigger dispatch_notification after insert on private.notifications for each row execute function private.dispatch_notification();

do $$ declare f record;begin
 for f in select p.oid::regprocedure as identity,n.nspname as schema_name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='public' and p.proname in ('record_gateway_capture','record_gateway_refund','record_gateway_failure','gateway_order_state','gateway_live_enabled',
 'configure_notification_worker','notification_worker_access','notification_delivery_settings','pause_notification_delivery','claim_notifications','finish_notification'))
 or (n.nspname='private' and p.proname in ('prepare_notification','check_gateway_mode','apply_gateway_refunds','kick_notification_worker','dispatch_notification'))
 loop execute format('revoke all on function %s from public,anon,authenticated',f.identity);
 if f.schema_name='public' then execute format('grant execute on function %s to service_role',f.identity);end if;
 end loop;
end $$;
