-- Provider credentials and webhook verification belong on the server. Test money
-- is kept out of the real payment ledger and can never create download rights.
create table private.test_payment_captures (
  order_id uuid primary key references public.orders(id),
  provider text not null,
  capture_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency = 'INR'),
  captured_at timestamptz not null default now(),
  unique (provider, capture_id)
);
alter table private.test_payment_captures enable row level security;
revoke all on private.test_payment_captures from public, anon, authenticated;

create function public.record_test_payment_capture(
  p_order_id uuid, p_provider text, p_capture_id text, p_amount_minor bigint, p_currency text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  customer_order public.orders;
  previous private.test_payment_captures;
begin
  if p_provider is null or p_provider !~ '^[a-z0-9_-]{1,40}$'
     or p_capture_id is null or length(trim(p_capture_id)) not between 1 and 200 then
    raise exception 'Invalid gateway reference';
  end if;

  select * into strict customer_order from public.orders where id = p_order_id for update;
  if p_currency is distinct from customer_order.currency
     or p_amount_minor is distinct from customer_order.total_minor or p_amount_minor <= 0 then
    raise exception 'Payment amount or currency mismatch';
  end if;

  select * into previous from private.test_payment_captures where order_id = p_order_id;
  if found then
    if previous.provider = p_provider and previous.capture_id = p_capture_id then return; end if;
    raise exception 'Conflicting test payment';
  end if;
  if customer_order.status <> 'pending' or customer_order.payment_status <> 'unpaid' then
    raise exception 'Order is not payable';
  end if;

  insert into private.test_payment_captures (order_id, provider, capture_id, amount_minor, currency)
  values (p_order_id, p_provider, p_capture_id, p_amount_minor, p_currency);
end $$;
revoke all on function public.record_test_payment_capture(uuid,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.record_test_payment_capture(uuid,text,text,bigint,text) to service_role;

create function public.has_test_payment_capture(p_order_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.test_payment_captures where order_id = p_order_id)
$$;
revoke all on function public.has_test_payment_capture(uuid) from public, anon, authenticated;
grant execute on function public.has_test_payment_capture(uuid) to service_role;
