-- Run once in the SQL Editor of a new Supabase project.
-- Members use anonymous Supabase Auth plus a private, shared band code.
-- The code hash stays server-side; only joined members can access songs.

create table public.band_settings (
  id boolean primary key default true check (id),
  code_hash text check (code_hash is null or length(code_hash) = 64)
);

insert into public.band_settings (id, code_hash) values (true, null);

create table public.band_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  joined_at timestamptz not null default now()
);

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  artist text not null check (length(btrim(artist)) between 1 and 120),
  suggested_by text not null check (length(btrim(suggested_by)) between 1 and 80),
  notes text check (notes is null or length(notes) <= 1000),
  stage text not null default 'suggestions'
    check (stage in ('suggestions', 'practice', 'ready')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index songs_stage_updated_at_idx on public.songs (stage, updated_at desc);

create function public.touch_song_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger songs_touch_updated_at
before update on public.songs
for each row execute function public.touch_song_updated_at();

alter table public.band_settings enable row level security;
alter table public.band_members enable row level security;
alter table public.songs enable row level security;

-- The code hash cannot be read through the browser API.
revoke all on table public.band_settings from anon, authenticated;
revoke all on table public.band_members from anon, authenticated;
revoke all on table public.songs from anon, authenticated;
grant select on table public.band_members to authenticated;
grant select, insert, update, delete on table public.songs to authenticated;

create policy "Members can see their own membership"
on public.band_members for select to authenticated
using (user_id = (select auth.uid()));

create policy "Members can see songs"
on public.songs for select to authenticated
using (
  exists (
    select 1 from public.band_members
    where user_id = (select auth.uid())
  )
);

create policy "Members can suggest songs"
on public.songs for insert to authenticated
with check (
  exists (
    select 1 from public.band_members
    where user_id = (select auth.uid())
  )
);

create policy "Members can edit songs"
on public.songs for update to authenticated
using (
  exists (
    select 1 from public.band_members
    where user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.band_members
    where user_id = (select auth.uid())
  )
);

create policy "Members can delete songs"
on public.songs for delete to authenticated
using (
  exists (
    select 1 from public.band_members
    where user_id = (select auth.uid())
  )
);

-- Keep the privileged code check outside the exposed public API schema.
create schema if not exists private;

create function private.join_band_secret(p_code text, p_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_hash text;
begin
  if auth.uid() is null or length(btrim(p_code)) < 16
     or length(btrim(p_name)) not between 1 and 80 then
    return false;
  end if;

  select code_hash into expected_hash
  from public.band_settings where id = true;

  if expected_hash is null
     or encode(sha256(convert_to(btrim(p_code), 'UTF8')), 'hex') <> expected_hash then
    return false;
  end if;

  insert into public.band_members (user_id, display_name)
  values (auth.uid(), btrim(p_name))
  on conflict (user_id) do update set display_name = excluded.display_name;
  return true;
end;
$$;

revoke all on function private.join_band_secret(text, text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.join_band_secret(text, text) to authenticated;

-- This unprivileged wrapper is the only function exposed to the browser API.
create function public.join_band(p_code text, p_name text)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.join_band_secret(p_code, p_name);
$$;

revoke all on function public.join_band(text, text) from public, anon, authenticated;
grant execute on function public.join_band(text, text) to authenticated;

-- Enables live updates when another member changes the board.
alter publication supabase_realtime add table public.songs;

-- Set the real band code after running this schema. Use a long random code:
-- update public.band_settings
-- set code_hash = encode(sha256(convert_to('YOUR-LONG-RANDOM-BAND-CODE', 'UTF8')), 'hex')
-- where id = true;
