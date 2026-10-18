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
