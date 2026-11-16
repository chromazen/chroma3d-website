-- Replace the three seeded sample offers with published listings awaiting owner pricing.
with former_samples as materialized (
  select id from public.products where slug in ('mahalakshmi','bhuvaneshwari','adiyogi') and sample for update
), reset_editions as (
  update public.variants set price_minor=0, available=false
  where product_id in (select id from former_samples) returning product_id
)
update public.products set sample=false,status='published'
where id in (select product_id from reset_editions);
