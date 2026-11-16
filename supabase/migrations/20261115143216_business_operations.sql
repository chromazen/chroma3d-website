-- Only the service-role Edge API calls the routines below. Client roles have no execute grant.
create function public.workflow_rate(p_key text,p_limit int) returns boolean language plpgsql security definer set search_path='' as $$
declare n int;begin
 insert into private.rate_windows as w values(p_key,now(),1) on conflict(key) do update
 set starts_at=case when w.starts_at<now()-interval '1 hour' then now() else w.starts_at end,
 hits=case when w.starts_at<now()-interval '1 hour' then 1 else w.hits+1 end returning hits into n;
 delete from private.rate_windows where starts_at<now()-interval '1 day';
 return n<=p_limit;
end $$;
create function public.receipt_matches(p_id uuid,p_hash text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.receipts where id=p_id and secret_hash=p_hash)
$$;

create function public.submit_work(p_id uuid,p_secret text,p_digest text,p_owner uuid,p_data jsonb,p_files jsonb) returns uuid
 language plpgsql security definer set search_path='' as $$
declare existing private.receipts; row_item jsonb; v record; subtotal bigint:=0; physical boolean:=false; rid uuid; k text:=p_data->>'kind';
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into existing from private.receipts where id=p_id;
 if found then
  if existing.secret_hash<>p_secret or existing.payload_hash<>p_digest then raise exception 'Request identifier conflict';end if;
  return p_id;
 end if;
 insert into private.receipts values(p_id,p_secret,p_digest);
 if k='order' then
  if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 60 then raise exception 'Invalid bag';end if;
  insert into public.orders(id,owner_id,name,email,shipping,total_minor) values(p_id,p_owner,p_data->>'name',p_data->>'email',p_data->'shipping',0);
  for row_item in select * from jsonb_array_elements(p_data->'items') loop
   select a.*,b.name into strict v from public.variants a join public.products b on b.id=a.product_id
    where a.id=(row_item->>'variant_id')::uuid and a.available and b.status='published' and not b.sample for share of a,b;
   if row_item ? 'height_mm' and (v.format<>'print' or not(v.attributes ? 'height_mm') or (row_item->>'height_mm')::numeric<>(v.attributes->>'height_mm')::numeric) then raise exception 'Height requires a quotation';end if;
   insert into public.order_items(order_id,variant_id,product_name,sku,format,quantity,unit_minor,preferences)
    values(p_id,v.id,v.name,v.sku,v.format,(row_item->>'quantity')::integer,v.price_minor,row_item-'variant_id'-'quantity') returning id into rid;
   subtotal:=subtotal+v.price_minor::bigint*(row_item->>'quantity')::integer;
   physical:=physical or v.format='print';
  end loop;
  if physical and (coalesce(length(trim(p_data#>>'{shipping,address}')),0)=0 or coalesce(length(trim(p_data#>>'{shipping,city}')),0)=0 or coalesce(p_data#>>'{shipping,pin}','') !~ '^[0-9]{6}$') then raise exception 'Delivery address required';end if;
  update public.orders set total_minor=subtotal where id=p_id;
 elsif k in ('print','studio') then
  insert into public.requests(id,owner_id,kind,name,email,title,specification) values(p_id,p_owner,k,p_data->>'name',p_data->>'email',p_data->>'title',p_data->'specification');
  if k='print' and jsonb_array_length(p_files)<>1 then raise exception 'A print file is required';end if;
  insert into public.request_files(request_id,path,filename,bytes,purpose)
   select p_id,f.path,f.filename,f.bytes,'input' from jsonb_to_recordset(p_files) f(path text, filename text,bytes int);
  insert into public.request_history(request_id,status,actor_id) values(p_id,'submitted',p_owner);
 else raise exception 'Unknown request';end if;
 insert into private.notifications(entity_id,event) values(p_id,k||'.submitted');
 return p_id;
end $$;

create function public.advance_work(p_id uuid,p_actor uuid,p_admin boolean,p_status text,p_note text,p_amount bigint default null,p_until timestamptz default null,p_file uuid default null,p_internal boolean default false) returns void
 language plpgsql security definer set search_path='' as $$
declare r public.requests; permitted boolean; rev uuid;begin
 select * into strict r from public.requests where id=p_id for update;
 if length(p_note)>3000 then raise exception 'Note too long';end if;
 if p_status='note' then
  if trim(p_note)='' or (p_internal and not p_admin) then raise exception 'Invalid note';end if;
  insert into public.request_history(request_id,status,note,internal,actor_id) values(p_id,r.status,p_note,p_internal,p_actor);return;
 end if;
 if r.kind='print' then
  permitted:=case when p_admin then (r.status,p_status) in (('submitted','review'),('review','quoted'),('review','rejected'),('quoted','review'),('accepted','manufacturing'),('manufacturing','shipped'),('shipped','completed'))
   else (r.status,p_status) in (('submitted','cancelled'),('review','cancelled'),('quoted','accepted'),('quoted','rejected')) end;
  if p_status='quoted' and (p_amount is null or p_amount<=0 or p_until is null or p_until<=now()) then raise exception 'A future validity date and a positive quotation are required';end if;
  if r.status='quoted' and r.valid_until<=now() then update public.requests set status='expired' where id=p_id;
   insert into public.request_history(request_id,status) values(p_id,'expired');return;end if;
 else
  permitted:=case when p_admin then (r.status,p_status) in (('submitted','review'),('review','discussion'),('review','rejected'),('discussion','revision'),('revision','awaiting_approval'),('approved','manufacturing'),('manufacturing','shipped'),('shipped','completed'))
   else (r.status,p_status) in (('submitted','cancelled'),('discussion','cancelled'),('awaiting_approval','approved'),('awaiting_approval','revision'),('awaiting_approval','rejected')) end;
  if p_status='awaiting_approval' then
   select id into strict rev from public.request_files where id=p_file and request_id=p_id and purpose='revision';
  elsif r.status='awaiting_approval' then
   select revision_id into rev from public.request_history where request_id=p_id and status='awaiting_approval' and revision_id is not null order by id desc limit 1;
   if rev is null or p_file is distinct from rev then raise exception 'Review the current revision';end if;
  end if;
 end if;
 if not coalesce(permitted,false) then raise exception 'Invalid status transition';end if;
 update public.requests set status=p_status,quote_minor=case when p_status='quoted' then p_amount else quote_minor end,
 valid_until=case when p_status='quoted' then p_until else valid_until end where id=p_id;
 insert into public.request_history(request_id,status,note,actor_id,revision_id) values(p_id,p_status,p_note,p_actor,rev);
 insert into private.notifications(entity_id,event) values(p_id,r.kind||'.'||p_status);
end $$;

-- Payment adapters must authenticate the provider, verify its captured amount/currency and deduplicate its reference BEFORE calling this routine.
-- There is intentionally no HTTP payment-success endpoint.
create function private.record_verified_payment(p_id uuid,p_reference text,p_amount bigint,p_currency text) returns void
 language plpgsql security definer set search_path='' as $$
declare o public.orders; ref private.payments;begin
 select * into strict o from public.orders where id=p_id for update;
 if o.total_minor<>p_amount or o.currency<>p_currency or o.status='cancelled' or length(trim(p_reference))<5 then raise exception 'Payment mismatch';end if;
 select * into ref from private.payments where order_id=p_id;
 if found then
  if ref.id<>p_reference then raise exception 'Conflicting payment';end if;return;
 end if;
 insert into private.payments values(p_reference,p_id,p_amount,now());
 update public.orders set payment_status='verified' where id=p_id;
 insert into private.entitlements(item_id,asset_id) select i.id,a.id from public.order_items i
 join (select distinct on(variant_id,filename) * from public.digital_assets order by variant_id,filename,version desc) a using(variant_id)
 where i.order_id=p_id and i.format='stl';
end $$;
create function public.order_downloads(p_id uuid) returns table(id uuid,filename text,version int)
 language sql stable security definer set search_path='' as $$
 select e.id,a.filename,a.version from private.entitlements e join public.order_items i on i.id=e.item_id
 join public.digital_assets a on a.id=e.asset_id join public.orders o on o.id=i.order_id
 where o.id=p_id and o.payment_status='verified' and (e.expires_at is null or e.expires_at>now())
$$;
create function public.authorize_download(p_id uuid,p_entitlement uuid) returns text language plpgsql security definer set search_path='' as $$
declare k text;begin
 select a.path into strict k from public.order_downloads(p_id) x join private.entitlements e on e.id=x.id join public.digital_assets a on a.id=e.asset_id where e.id=p_entitlement;
 insert into private.download_audit(entitlement_id) values(p_entitlement);return k;
end $$;
create function public.advance_order(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare o public.orders;begin
 select * into strict o from public.orders where id=p_id for update;
 if not ((o.status='pending' and p_status='cancelled' and o.payment_status='unpaid') or
 (o.payment_status='verified' and (o.status,p_status) in (('pending','processing'),('processing','shipped'),('shipped','completed'),('processing','completed')))) then raise exception 'Invalid order transition';end if;
 update public.orders set status=p_status where id=p_id;
 insert into private.notifications(entity_id,event) values (p_id,'order.'||p_status);
end $$;
create function private.publication_check() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='published' then
  if not exists(select 1 from public.variants where product_id=new.id) or not exists(select 1 from public.product_media where product_id=new.id and is_primary) then raise exception 'Add a cover and a variant before publishing';end if;
  if not new.sample and exists(select 1 from public.variants v where v.product_id=new.id and v.format='stl' and v.available and not exists(select 1 from public.digital_assets f where f.variant_id=v.id)) then raise exception 'Add the private STL before publishing';end if;
  new.published_at:=coalesce(old.published_at,now());
 else new.published_at:=null;end if;return new;
end $$;
create trigger validate_publication before insert or update on public.products for each row execute function private.publication_check();
do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on p.pronamespace=n.oid
 where n.nspname='public' and p.proname in ('submit_work','workflow_rate','receipt_matches','advance_work','authorize_download','order_downloads','advance_order') loop
 execute format('revoke all on function %s from public,anon,authenticated',f);
 execute format('grant execute on function %s to service_role',f);
 end loop;end $$;
revoke all on function private.record_verified_payment(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function private.record_verified_payment(uuid,text,bigint,text) to service_role;
revoke insert,update on public.products from authenticated;
grant insert(slug,name,description,category_id,sample,featured,display_order,seo_title,seo_description),
 update(name,description,category_id,featured,display_order,seo_title,seo_description) on public.products to authenticated;
