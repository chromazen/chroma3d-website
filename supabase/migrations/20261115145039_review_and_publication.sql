-- An operator supplies measured total mass. Material cost never determines the selling price.
alter table public.requests
  add column estimated_minor bigint check (estimated_minor between 0 and 999999999999),
  add column material_grams numeric(12,3) check (material_grams > 0),
  add column material_cost_minor bigint check (material_cost_minor >= 0);

create function public.review_print_estimate(p_id uuid, p_actor uuid, p_grams numeric, p_estimate bigint)
returns void language plpgsql security invoker set search_path='' as $$
declare
  r public.requests;
  rate integer;
begin
  select * into strict r from public.requests where id=p_id and kind='print' for update;
  if r.status not in ('submitted','review') or p_grams is null or p_grams not between 0.001 and 999999999
      or p_estimate is null or p_estimate not between 0 and 999999999999 then
    raise exception 'A reviewable request, measured mass and indicative price are required';
  end if;
  select cost_minor_per_kg into rate from public.pricing_settings where material=r.specification->>'material';
  update public.requests set material_grams=p_grams,
    material_cost_minor=round(p_grams*rate/1000), estimated_minor=p_estimate where id=p_id;
  insert into public.request_history(request_id,status,actor_id,note)
    values(p_id,r.status,p_actor,'Indicative estimate: INR '||to_char(p_estimate/100.0,'FM9999999999990.00'));
end $$;

create function public.check_listing(p_id uuid, p_sample boolean)
returns void language plpgsql stable security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.variants where product_id=p_id)
    or not exists(select 1 from public.product_media where product_id=p_id and kind='photo' and is_primary)
  then raise exception 'A variant and primary photograph are required'; end if;
  if not p_sample and exists(select 1 from public.variants v where v.product_id=p_id and v.format='stl'
      and v.available and not exists(select 1 from public.digital_assets a where a.variant_id=v.id))
  then raise exception 'A private digital asset is required'; end if;
end $$;
-- Trigger runs with the steward's privileges so catalogue editors need no privileged RPC grant.
create or replace function private.publication_check() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='published' then
    perform public.check_listing(new.id,new.sample);
    new.published_at:=coalesce(old.published_at,now());
  else new.published_at:=null; end if;
  return new;
end $$;
revoke all on function public.check_listing(uuid,boolean), public.review_print_estimate(uuid,uuid,numeric,bigint) from public,anon,authenticated;
grant execute on function public.check_listing(uuid,boolean), public.review_print_estimate(uuid,uuid,numeric,bigint) to service_role;
