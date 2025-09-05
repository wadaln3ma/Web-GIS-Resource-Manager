-- === Activity (audit) table ===
create table if not exists public.resource_activity (
  id bigserial primary key,
  resource_id bigint references public.resources(id) on delete set null,
  action text not null check (action in ('create','update','delete')),
  old_values jsonb,
  new_values jsonb,
  at timestamptz not null default now()
);
create index if not exists resource_activity_resource_idx on public.resource_activity(resource_id);
alter table public.resource_activity enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'resource_activity' and policyname = 'anon_read_activity') then
    create policy anon_read_activity on public.resource_activity for select using (true);
  end if;
end $$;

grant select on public.resource_activity to anon, authenticated;

-- === Update RPC with logging ===
create or replace function public.update_resource(
  p_id bigint,
  p_name text default null,
  p_rtype text default null,
  p_status text default null,
  p_properties jsonb default null,
  p_geometry jsonb default null
) returns public.resources
language plpgsql
security definer
as $$
declare
  old_row public.resources;
  new_row public.resources;
begin
  select * into old_row from public.resources where id = p_id;

  update public.resources
  set
    name = coalesce(p_name, name),
    rtype = coalesce(p_rtype, rtype),
    status = coalesce(p_status, status),
    properties = coalesce(p_properties, properties),
    geom = coalesce(
      case when p_geometry is not null
           then st_setsrid(st_geomfromgeojson(p_geometry::text), 4326)
      end,
      geom
    )
  where id = p_id
  returning * into new_row;

  insert into public.resource_activity (resource_id, action, old_values, new_values)
  values (p_id, 'update', to_jsonb(old_row), to_jsonb(new_row));

  return new_row;
end;
$$;

-- Enhance create/delete RPCs to log activity and fix FK order
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

  insert into public.resource_activity (resource_id, action, new_values)
  values (new_row.id, 'create', to_jsonb(new_row));

  return new_row;
end; $$;

create or replace function public.delete_resource(p_id bigint)
returns void
language plpgsql
security definer
as $$
declare
  old_row public.resources;
begin
  select * into old_row from public.resources where id = p_id;

  -- Log before deletion
  insert into public.resource_activity (resource_id, action, old_values)
  values (p_id, 'delete', to_jsonb(old_row));

  delete from public.resources where id = p_id;
end;
$$;

grant execute on function public.update_resource(bigint, text, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.create_resource_from_geojson(text, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.delete_resource(bigint) to anon, authenticated;

-- === Work orders (per resource) ===
create table if not exists public.work_orders (
  id bigserial primary key,
  resource_id bigint references public.resources(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  due_date date,
  created_at timestamptz not null default now()
);
create index if not exists work_orders_resource_idx on public.work_orders(resource_id);

alter table public.work_orders enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'work_orders' and policyname = 'anon_read_wo') then
    create policy anon_read_wo on public.work_orders for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'work_orders' and policyname = 'anon_write_wo') then
    create policy anon_write_wo on public.work_orders for all using (true) with check (true);
  end if;
end $$;

-- Optional RPCs for work orders
create or replace function public.create_work_order(
  p_resource_id bigint,
  p_title text,
  p_description text default null,
  p_status text default 'open',
  p_due_date date default null
) returns public.work_orders
language sql
security definer
as $$
  insert into public.work_orders (resource_id, title, description, status, due_date)
  values (p_resource_id, p_title, p_description, p_status, p_due_date)
  returning *;
$$;

create or replace function public.update_work_order(
  p_id bigint,
  p_title text default null,
  p_description text default null,
  p_status text default null,
  p_due_date date default null
) returns public.work_orders
language plpgsql
security definer
as $$
declare
  new_row public.work_orders;
begin
  update public.work_orders
  set
    title = coalesce(p_title, title),
    description = coalesce(p_description, description),
    status = coalesce(p_status, status),
    due_date = coalesce(p_due_date, due_date)
  where id = p_id
  returning * into new_row;
  return new_row;
end;
$$;

create or replace function public.delete_work_order(p_id bigint)
returns void language sql security definer as $$
  delete from public.work_orders where id = p_id;
$$;

grant execute on function public.create_work_order(bigint, text, text, text, date) to anon, authenticated;
grant execute on function public.update_work_order(bigint, text, text, text, date) to anon, authenticated;
grant execute on function public.delete_work_order(bigint) to anon, authenticated;
