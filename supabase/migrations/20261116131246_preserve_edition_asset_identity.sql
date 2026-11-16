-- Reuse the existing identity before BEFORE INSERT guards run on an upsert.
-- Private STL assets remain attached to the edition's original UUID.
create or replace function public.save_product_editions(p_product_id uuid, p_editions jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_editions) is distinct from 'array' or jsonb_array_length(p_editions) not between 1 and 2 then
    raise exception 'Choose one or two editions to save';
  end if;

  insert into public.variants (id, product_id, format, sku, price_minor, available)
  select coalesce(existing.id, gen_random_uuid()), p_product_id, e.format, e.sku, e.price_minor, e.available
  from jsonb_to_recordset(p_editions) as e(format text, sku text, price_minor integer, available boolean)
  left join public.variants existing on existing.product_id = p_product_id and existing.format = e.format
  order by e.format
  on conflict (product_id, format) do update
  set sku = excluded.sku, price_minor = excluded.price_minor, available = excluded.available;

  -- An omitted height leaves it alone. An explicit null clears only the height.
  update public.variants v
  set attributes = (v.attributes - 'height_mm') || jsonb_strip_nulls(jsonb_build_object('height_mm', e.value->'height_mm'))
  from jsonb_array_elements(p_editions) as e(value)
  where v.product_id = p_product_id and v.format = 'print'
    and e.value->>'format' = 'print' and e.value ? 'height_mm';
end;
$$;
