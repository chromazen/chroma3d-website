-- Status screens consume inserts and updates. Deleted identifiers have no audience here.
do $$
begin
  if exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and (schemaname<>'public' or tablename not in ('requests','orders'))) then
    raise exception 'Review publication changes with other subscribers before applying';
  end if;
end $$;
alter publication supabase_realtime set (publish='insert, update');
