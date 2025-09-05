-- Enable PostGIS
create extension if not exists postgis;

-- Base table
create table if not exists public.resources (
  id bigserial primary key,
  name text not null,
  rtype text not null,
  status text not null default 'active',
  properties jsonb,
  geom geometry(Geometry, 4326) not null,
  created_at timestamptz not null default now()
);

create index if not exists resources_geom_gix on public.resources using gist (geom);

-- View returning GeoJSON geometry for easy client consumption
create or replace view public.resources_geojson as
select
  id,
  name,
  rtype,
  status,
  properties,
  created_at,
  (st_asgeojson(geom)::jsonb) as geometry
from public.resources;

-- RPC: create from GeoJSON
create or replace function public.create_resource_from_geojson(
  p_name text,
  p_rtype text,
  p_status text,
  p_properties jsonb,
  p_geometry jsonb
) returns public.resources
language plpgsql
security definer
as $$
declare
  new_row public.resources;
begin
  insert into public.resources (name, rtype, status, properties, geom)
  values (
    p_name,
    p_rtype,
    coalesce(p_status,'active'),
    p_properties,
    st_setsrid(st_geomfromgeojson(p_geometry::text), 4326)
  )
  returning * into new_row;

  return new_row;
end; $$;

-- RPC: delete by id
create or replace function public.delete_resource(p_id bigint)
returns void language sql security definer as $$
  delete from public.resources where id = p_id;
$$;

-- RLS (demo-open; tighten later)
alter table public.resources enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'resources' and policyname = 'anon_read') then
    create policy anon_read on public.resources for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'resources' and policyname = 'anon_insert') then
    create policy anon_insert on public.resources for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'resources' and policyname = 'anon_update') then
    create policy anon_update on public.resources for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'resources' and policyname = 'anon_delete') then
    create policy anon_delete on public.resources for delete using (true);
  end if;
end $$;

-- Grants
grant usage on schema public to anon, authenticated;
grant execute on function public.create_resource_from_geojson(text, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.delete_resource(bigint) to anon, authenticated;
grant select on public.resources_geojson to anon, authenticated;
