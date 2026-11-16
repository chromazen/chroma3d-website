create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
create table private.admin_members (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.admin_members enable row level security;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.jwt()->>'aal')='aal2' and exists(select 1 from private.admin_members where user_id=(select auth.uid()))
$$;
create function public.admin_access() returns text language sql stable security definer set search_path='' as $$
  select case when private.is_admin() then 'admin' when exists(select 1 from private.admin_members where user_id=(select auth.uid())) then 'mfa_required' else 'denied' end
$$;
revoke all on function private.is_admin(), public.admin_access() from public,anon,authenticated;
grant execute on function private.is_admin() to anon,authenticated,service_role;
grant execute on function public.admin_access() to authenticated,service_role;

create table public.categories (
 id uuid primary key default gen_random_uuid(), name text not null unique check(length(trim(name)) between 1 and 80)
);
create table public.products (
 id uuid primary key default gen_random_uuid(), slug text unique not null check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug)<=100),
 name text not null check(length(trim(name)) between 1 and 160), description text not null check(length(description)<=8000),
 category_id uuid not null references public.categories, status text not null default 'draft' check(status in ('draft','published','archived')),
 sample boolean not null default false, featured boolean not null default false, display_order int not null default 100,
 seo_title text check(length(seo_title)<=180), seo_description text check(length(seo_description)<=500),
 published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((status='published')=(published_at is not null))
);
create table public.variants (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products on delete cascade,
 format text not null check(format in ('print','stl')), sku text not null unique check(length(trim(sku)) between 1 and 100),
 price_minor integer not null check(price_minor between 0 and 100000000), currency text not null default 'INR' check(currency='INR'),
 available boolean not null default false, attributes jsonb not null default '{}' check(jsonb_typeof(attributes)='object'), unique(product_id,format)
);
create table public.product_media (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products on delete cascade,
 kind text not null check(kind in ('photo','preview')), path text not null unique, alt text not null check(length(trim(alt)) between 1 and 200),
 display_order int not null default 0, is_primary boolean not null default false,
 check(not is_primary or kind='photo')
);
create unique index product_cover on public.product_media(product_id) where is_primary;
create table public.digital_assets (
 id uuid primary key default gen_random_uuid(), variant_id uuid not null references public.variants,
 path text not null unique, filename text not null, version int not null check(version>0),
 bytes bigint not null check(bytes>0), sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 unique(variant_id,filename,version)
);
create table public.requests (
 id uuid primary key, owner_id uuid references auth.users on delete set null, kind text not null check(kind in ('print','studio')),
 name text not null check(length(trim(name)) between 1 and 100), email text not null check(length(email)<=254 and position('@' in email)>1),
 title text not null check(length(trim(title)) between 1 and 180), specification jsonb not null check(jsonb_typeof(specification)='object'),
 status text not null default 'submitted' check(status in ('submitted','review','discussion','revision','awaiting_approval','approved','manufacturing','shipped','completed','quoted','accepted','rejected','cancelled','expired')),
 quote_minor bigint check(quote_minor>=0), valid_until timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.request_files (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.requests on delete cascade,
 path text not null unique, filename text not null, bytes integer not null check(bytes>0),
 purpose text not null check(purpose in ('input','revision','final')), created_at timestamptz not null default now()
);
create table public.request_history (
 id bigint generated always as identity primary key, request_id uuid not null references public.requests on delete cascade,
 status text not null, note text not null default '', internal boolean not null default false,
 actor_id uuid references auth.users on delete set null, revision_id uuid references public.request_files, created_at timestamptz not null default now()
);
create table public.orders (
 id uuid primary key, owner_id uuid references auth.users on delete set null,
 name text not null check(length(trim(name)) between 1 and 100), email text not null check(length(email)<=254 and position('@' in email)>1),
 shipping jsonb, currency text not null default 'INR' check(currency='INR'), total_minor bigint not null check(total_minor>=0),
 status text not null default 'pending' check(status in ('pending','processing','shipped','completed','cancelled')),
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','verified')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders, variant_id uuid not null references public.variants,
 product_name text not null, sku text not null, format text not null, quantity integer not null check(quantity between 1 and 100000),
 unit_minor integer not null check(unit_minor>=0), preferences jsonb not null default '{}', check(format<>'stl' or quantity=1)
);
create table private.receipts (
 id uuid primary key, secret_hash text not null check(length(secret_hash)=64), payload_hash text not null check(length(payload_hash)=64)
);
create table private.rate_windows (key text primary key, starts_at timestamptz not null, hits int not null);
create table private.payments (id text primary key, order_id uuid not null unique references public.orders, amount_minor bigint not null, verified_at timestamptz not null default now());
create table private.entitlements (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.order_items,
 asset_id uuid not null references public.digital_assets, expires_at timestamptz, unique(item_id,asset_id)
);
create table private.download_audit (id bigint generated always as identity primary key, entitlement_id uuid not null references private.entitlements, created_at timestamptz not null default now());
create table private.notifications (
 id bigint generated always as identity primary key, entity_id uuid not null, event text not null, created_at timestamptz not null default now(), delivered_at timestamptz
);
create table public.pricing_settings (material text primary key, cost_minor_per_kg integer not null check(cost_minor_per_kg>=0), check(material <> 'PLA' or cost_minor_per_kg=100000));
insert into public.pricing_settings values ('PLA',100000);
create index requests_owner on public.requests(owner_id); create index orders_owner on public.orders(owner_id);
create index request_files_parent on public.request_files(request_id); create index request_history_parent on public.request_history(request_id);
create index order_items_parent on public.order_items(order_id); create index media_parent on public.product_media(product_id);
create function private.set_updated() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now();return new;end $$;
do $$ declare t text;begin
 foreach t in array array['products','orders','requests'] loop
 execute format('create trigger touch before update on public.%I for each row execute function private.set_updated()',t);
 end loop;
 foreach t in array array['categories','products','variants','product_media','digital_assets','requests','request_files','request_history','orders','order_items','pricing_settings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on table public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['receipts','rate_windows','payments','entitlements','download_audit','notifications'] loop
 execute format('alter table private.%I enable row level security',t);
 end loop;
end $$;
grant select on public.products,public.categories,public.variants,public.product_media to anon,authenticated;
grant select on public.digital_assets,public.requests,public.request_files,public.request_history,public.orders,public.order_items,public.pricing_settings to authenticated;
grant insert,update on public.products,public.categories,public.variants,public.pricing_settings to authenticated;
create policy catalog_products on public.products for select using (status='published' or (select private.is_admin()));
create policy catalog_categories on public.categories for select using ((select private.is_admin()) or exists(select 1 from public.products p where p.category_id=categories.id and p.status='published'));
create policy catalog_variants on public.variants for select using (exists(select 1 from public.products p where p.id=variants.product_id));
create policy catalog_media on public.product_media for select using (exists(select 1 from public.products p where p.id=product_media.product_id));
do $$ declare t text;begin
 foreach t in array array['products','variants','categories','pricing_settings'] loop
 execute format('create policy admin_manage on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))',t);
 end loop;end $$;
create policy assets_admin on public.digital_assets for select to authenticated using ((select private.is_admin()));
create policy owned_requests on public.requests for select to authenticated using(owner_id=(select auth.uid()) or (select private.is_admin()));
create policy owned_files on public.request_files for select to authenticated using(exists(select 1 from public.requests r where r.id=request_id));
create policy owned_history on public.request_history for select to authenticated using((not internal or (select private.is_admin())) and exists(select 1 from public.requests r where r.id=request_id));
create policy owned_orders on public.orders for select to authenticated using(owner_id=(select auth.uid()) or (select private.is_admin()));
create policy owned_items on public.order_items for select to authenticated using(exists(select 1 from public.orders o where o.id=order_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('product-media','product-media',true,26214400,array['image/jpeg','image/png','image/webp','model/gltf-binary']),
 ('digital-products','digital-products',false,26214400,array['application/octet-stream']),
 ('print-uploads','print-uploads',false,26214400,array['application/octet-stream']),
 ('studio-files','studio-files',false,10485760,array['image/jpeg','image/png','application/pdf','application/octet-stream']);
-- Private object reads and all writes pass through the Edge Function. Public keeps only display derivatives.
alter publication supabase_realtime add table public.requests, public.orders;
