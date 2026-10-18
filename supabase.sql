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

create table public.song_likes (
  song_id uuid not null references public.songs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (song_id, user_id)
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
alter table public.song_likes enable row level security;

-- The code hash cannot be read through the browser API.
revoke all on table public.band_settings from anon, authenticated;
revoke all on table public.band_members from anon, authenticated;
revoke all on table public.songs from anon, authenticated;
revoke all on table public.song_likes from anon, authenticated;
grant select on table public.band_members to authenticated;
grant select, insert, update, delete on table public.songs to authenticated;
grant select, insert, delete on table public.song_likes to authenticated;

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

create policy "Members can see likes"
on public.song_likes for select to authenticated
using (
  exists (
    select 1 from public.band_members
    where user_id = (select auth.uid())
  )
);

create policy "Members can like suggestions"
on public.song_likes for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.band_members
    where user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.songs
    where id = song_id and stage = 'suggestions'
  )
);

create policy "Members can remove their likes"
on public.song_likes for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
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
alter publication supabase_realtime add table public.song_likes;

-- Set the real band code after running this schema. Use a long random code:
-- update public.band_settings
-- set code_hash = encode(sha256(convert_to('YOUR-LONG-RANDOM-BAND-CODE', 'UTF8')), 'hex')
-- where id = true;

-- Run in Supabase SQL Editor to add the separate 4-Song Challenge.
-- Keeps all existing songs, likes, members and the band code.

create table if not exists public.challenge_picks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  picked_by text not null check (length(btrim(picked_by)) between 1 and 80),
  title text not null check (length(btrim(title)) between 1 and 120),
  artist text not null check (length(btrim(artist)) between 1 and 120),
  link_url text check (link_url is null or length(link_url) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists challenge_picks_owner_idx on public.challenge_picks (owner_user_id);

create table if not exists public.challenge_ratings (
  pick_id uuid not null references public.challenge_picks (id) on delete cascade,
  voter_user_id uuid not null references auth.users (id) on delete cascade,
  score smallint not null check (score in (1, 3, 5)),
  created_at timestamptz not null default now(),
  primary key (pick_id, voter_user_id)
);

create schema if not exists private;

-- Lock each member's row so two simultaneous submissions cannot exceed four.
create or replace function private.enforce_challenge_pick_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.owner_user_id <> auth.uid() then
    raise exception 'Only the member can add their own pick';
  end if;
  perform 1 from public.band_members
  where user_id = new.owner_user_id for update;
  if not found then
    raise exception 'Join the band before adding picks';
  end if;
  if (select count(*) from public.challenge_picks where owner_user_id = new.owner_user_id) >= 4 then
    raise exception 'Four picks maximum. Remove one of your picks first.';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_challenge_pick_limit() from public, anon, authenticated;
drop trigger if exists challenge_picks_limit on public.challenge_picks;
create trigger challenge_picks_limit
before insert on public.challenge_picks
for each row execute function private.enforce_challenge_pick_limit();

alter table public.challenge_picks enable row level security;
alter table public.challenge_ratings enable row level security;
revoke all on table public.challenge_picks from anon, authenticated;
revoke all on table public.challenge_ratings from anon, authenticated;
grant select, insert, delete on table public.challenge_picks to authenticated;
grant select, insert, delete on table public.challenge_ratings to authenticated;
grant update (score) on table public.challenge_ratings to authenticated;

drop policy if exists "Members can see challenge picks" on public.challenge_picks;
create policy "Members can see challenge picks" on public.challenge_picks
for select to authenticated using (
  exists (select 1 from public.band_members where user_id = (select auth.uid()))
);

drop policy if exists "Members can add their own challenge picks" on public.challenge_picks;
create policy "Members can add their own challenge picks" on public.challenge_picks
for insert to authenticated with check (
  owner_user_id = (select auth.uid())
  and picked_by = (select display_name from public.band_members where user_id = (select auth.uid()))
);

drop policy if exists "Members can remove their own challenge picks" on public.challenge_picks;
create policy "Members can remove their own challenge picks" on public.challenge_picks
for delete to authenticated using (owner_user_id = (select auth.uid()));

drop policy if exists "Members can see challenge ratings" on public.challenge_ratings;
create policy "Members can see challenge ratings" on public.challenge_ratings
for select to authenticated using (
  exists (select 1 from public.band_members where user_id = (select auth.uid()))
);

drop policy if exists "Members can rate other challenge picks" on public.challenge_ratings;
create policy "Members can rate other challenge picks" on public.challenge_ratings
for insert to authenticated with check (
  voter_user_id = (select auth.uid())
  and exists (select 1 from public.band_members where user_id = (select auth.uid()))
  and exists (select 1 from public.challenge_picks where id = pick_id and owner_user_id <> (select auth.uid()))
);

drop policy if exists "Members can change their challenge ratings" on public.challenge_ratings;
create policy "Members can change their challenge ratings" on public.challenge_ratings
for update to authenticated using (
  voter_user_id = (select auth.uid())
  and exists (select 1 from public.band_members where user_id = (select auth.uid()))
  and exists (select 1 from public.challenge_picks where id = pick_id and owner_user_id <> (select auth.uid()))
)
with check (
  voter_user_id = (select auth.uid())
  and exists (select 1 from public.challenge_picks where id = pick_id and owner_user_id <> (select auth.uid()))
);

drop policy if exists "Members can remove their challenge ratings" on public.challenge_ratings;
create policy "Members can remove their challenge ratings" on public.challenge_ratings
for delete to authenticated using (
  voter_user_id = (select auth.uid())
  and exists (select 1 from public.band_members where user_id = (select auth.uid()))
);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'challenge_picks') then
    alter publication supabase_realtime add table public.challenge_picks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'challenge_ratings') then
    alter publication supabase_realtime add table public.challenge_ratings;
  end if;
end;
$$;
