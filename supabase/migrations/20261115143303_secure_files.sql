insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('draft-media','draft-media',false,26214400,array['image/jpeg','image/png','image/webp','model/gltf-binary']);
create table public.upload_intents (
 path text primary key, bucket text not null, created_at timestamptz not null default now()
);
alter table public.upload_intents enable row level security;
revoke all on public.upload_intents from public,anon,authenticated;
grant all on public.upload_intents to service_role;
create index upload_expiry on public.upload_intents(created_at);
create function public.unused_uploads() returns setof public.upload_intents language sql stable security invoker set search_path='' as $$
 select i.* from public.upload_intents i where i.created_at<now()-interval '2 hours'
 and not exists(select 1 from public.request_files f where f.path=i.path)
 and not exists(select 1 from public.product_media m where m.path=i.path)
 and not exists(select 1 from public.digital_assets a where a.path=i.path)
 order by i.created_at limit 100
$$;
revoke all on function public.unused_uploads() from public,anon,authenticated;
grant execute on function public.unused_uploads() to service_role;
alter function public.admin_access() set schema private;
create function public.admin_access() returns text language sql stable security invoker set search_path='' as $$ select private.admin_access() $$;
revoke all on function public.admin_access() from public,anon,authenticated;
grant execute on function public.admin_access() to authenticated,service_role;
create function private.variant_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.format='stl' and new.available and exists(select 1 from public.products where id=new.product_id and status='published' and not sample)
 and not exists(select 1 from public.digital_assets where variant_id=new.id) then raise exception 'Upload a private STL first';end if;
 if tg_op='UPDATE' and (new.format<>old.format or new.product_id<>old.product_id) then raise exception 'Variant identity is immutable';end if;
 return new;
end $$;
create trigger validate_variant before insert or update on public.variants for each row execute function private.variant_guard();
-- Remove execution on internal trigger functions from API roles.
revoke all on function private.variant_guard(),private.set_updated(),private.publication_check() from public,anon,authenticated;
